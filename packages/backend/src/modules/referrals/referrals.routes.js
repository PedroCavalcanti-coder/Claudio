'use strict';
/**
 * Encaminhamento entre unidades (referência/contrarreferência).
 *
 * Quem pode CRIAR:  recepção / médico / radiologista / técnico / admin —
 *                   precisa pertencer à unidade `from_unit_id` (ou ser admin).
 * Quem pode ACEITAR/RECUSAR: usuário pertencente à `to_unit_id`, ou o usuário
 *                            diretamente apontado em `to_user_id`, ou admin.
 *
 * Endpoints:
 *   GET    /                  lista referrals visíveis ao usuário
 *   POST   /                  cria referral
 *   PATCH  /:id/decide        aceita/recusa
 *   PATCH  /:id/cancel        cancela (pelo solicitante)
 */
const { Router } = require('express');
const { z }      = require('zod');
const db         = require('../../config/database');
const logger     = require('../../config/logger');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { createNotification } = require('../notifications/notifications.routes');
const { success, created, paginated } = require('../../utils/response');
const { AppError, NotFoundError } = require('../../utils/errors');

const router = Router();
router.use(authenticate);

// ── Notificações in-app de encaminhamento ─────────────────────────────────────
// Best-effort: nunca quebra o fluxo principal (chamado via setImmediate).

async function notifyReferralCreated(referralId) {
  const { rows } = await db.query(
    `SELECT r.id, r.to_unit_id, r.to_user_id, r.specialty,
            fu.name AS from_unit_name
       FROM ris.referrals r
       JOIN ris.health_units fu ON fu.id = r.from_unit_id
      WHERE r.id = $1`,
    [referralId]
  );
  if (!rows.length) return;
  const ref = rows[0];

  let recipientIds = [];
  if (ref.to_user_id) {
    recipientIds = [ref.to_user_id];
  } else {
    const { rows: docs } = await db.query(
      `SELECT id FROM auth.users
        WHERE health_unit_id = $1 AND is_active = TRUE
          AND role IN ('doctor','radiologist')`,
      [ref.to_unit_id]
    );
    recipientIds = docs.map(d => d.id);
  }

  const body = `Paciente encaminhado de ${ref.from_unit_name}`
    + (ref.specialty ? ` · ${ref.specialty}` : '')
    + '. Acesse "Encaminhamentos" para aceitar ou recusar.';

  await Promise.all(recipientIds.map(userId => createNotification({
    userId,
    type:         'REFERRAL_RECEIVED',
    title:        'Novo encaminhamento recebido',
    body,
    resourceType: 'referral',
    resourceId:   referralId,
  })));
}

async function notifyReferralDecided(referralId, decision) {
  const { rows } = await db.query(
    `SELECT r.id, r.created_by, tu.name AS to_unit_name
       FROM ris.referrals r
       JOIN ris.health_units tu ON tu.id = r.to_unit_id
      WHERE r.id = $1`,
    [referralId]
  );
  if (!rows.length) return;
  const ref = rows[0];
  const aceito = decision === 'accepted';

  await createNotification({
    userId:       ref.created_by,
    type:         aceito ? 'REFERRAL_ACCEPTED' : 'REFERRAL_DECLINED',
    title:        aceito ? 'Encaminhamento aceito' : 'Encaminhamento recusado',
    body:         `${ref.to_unit_name} ${aceito ? 'aceitou' : 'recusou'} o encaminhamento do paciente.`,
    resourceType: 'referral',
    resourceId:   referralId,
  });
}

async function notifyCounterReference(referralId) {
  const { rows } = await db.query(
    `SELECT r.created_by, tu.name AS to_unit_name
       FROM ris.referrals r JOIN ris.health_units tu ON tu.id = r.to_unit_id
      WHERE r.id = $1`, [referralId]);
  if (!rows.length) return;
  await createNotification({
    userId:       rows[0].created_by,
    type:         'REFERRAL_ACCEPTED',
    title:        'Contrarreferência recebida',
    body:         `${rows[0].to_unit_name} enviou a contrarreferência do paciente encaminhado.`,
    resourceType: 'referral',
    resourceId:   referralId,
  });
}

const createSchema = z.object({
  patient_id:   z.string().uuid(),
  // Origem: admin (sem lotação) DEVE informar; demais herdam a própria unidade.
  from_unit_id: z.string().uuid().optional(),
  to_unit_id:   z.string().uuid(),
  to_user_id:   z.string().uuid().optional(),
  specialty:    z.string().max(100).optional(),
  reason:       z.string().min(3).max(2000),
});

const decideSchema = z.object({
  decision:       z.enum(['accepted','declined']),
  decision_notes: z.string().max(2000).optional(),
});

// ── GET / — referrals visíveis ao usuário ────────────────────────────────────
router.get('/',
  validate({ query: z.object({
    page: schemas.page, limit: schemas.limit,
    status: z.enum(['pending','accepted','completed','declined','cancelled']).optional(),
    direction: z.enum(['incoming','outgoing']).optional(),
  })}),
  async (req, res) => {
  const u = req.user;
  const { page, limit, status, direction } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  const conds  = [];

  if (u.role !== 'admin' && !u.is_network_resource) {
    if (!u.health_unit_id) throw new AppError('Usuário sem lotação não pode ver encaminhamentos', 403);
    params.push(u.health_unit_id, u.sub);
    conds.push(`(r.from_unit_id = $${params.length-1} OR r.to_unit_id = $${params.length-1} OR r.to_user_id = $${params.length})`);
  }
  if (status)            { params.push(status);   conds.push(`r.status = $${params.length}`); }
  if (direction === 'incoming' && u.health_unit_id) {
    params.push(u.health_unit_id); conds.push(`r.to_unit_id = $${params.length}`);
  }
  if (direction === 'outgoing' && u.health_unit_id) {
    params.push(u.health_unit_id); conds.push(`r.from_unit_id = $${params.length}`);
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const baseSql = `
    FROM ris.referrals r
    JOIN ris.health_units fu ON fu.id = r.from_unit_id
    JOIN ris.health_units tu ON tu.id = r.to_unit_id
    LEFT JOIN auth.users  tcu ON tcu.id = r.to_user_id
    LEFT JOIN auth.users  ccu ON ccu.id = r.counter_referred_by
    ${where}`;

  const [countRes, dataRes] = await Promise.all([
    db.query(`SELECT COUNT(*) ${baseSql}`, params),
    db.query(
      `SELECT r.id, r.patient_id, r.from_unit_id, r.to_unit_id, r.to_user_id,
              r.specialty, r.reason, r.status, r.decided_at, r.decision_notes,
              r.counter_reference, r.counter_referred_at,
              r.created_at, r.updated_at,
              fu.name AS from_unit_name, tu.name AS to_unit_name, tcu.name AS to_user_name,
              ccu.name AS counter_referred_by_name
       ${baseSql}
       ORDER BY r.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  return paginated(res, {
    data: dataRes.rows, total: parseInt(countRes.rows[0].count), page, limit,
  });
});

// ── POST / — criar referral ──────────────────────────────────────────────────
router.post('/',
  requirePermission('referrals:create'),
  validate({ body: createSchema }),
  async (req, res) => {
  const u = req.user;
  const b = req.body;

  // Origem do encaminhamento: admin (sem lotação) escolhe via body; demais usam
  // a própria unidade. from_unit_id é NOT NULL no banco, então precisa existir.
  const fromUnitId = u.role === 'admin' ? (b.from_unit_id || u.health_unit_id) : u.health_unit_id;
  if (!fromUnitId)
    throw new AppError('Selecione a unidade de origem do encaminhamento.', 422, 'FROM_UNIT_REQUIRED');
  if (fromUnitId === b.to_unit_id)
    throw new AppError('A unidade de destino não pode ser a mesma de origem.', 422, 'SAME_UNIT');

  const { rows: pRows } = await db.query(`SELECT id FROM ris.patients WHERE id = $1`, [b.patient_id]);
  if (!pRows.length) throw new NotFoundError('Paciente');
  const { rows: uRows } = await db.query(
    `SELECT id FROM ris.health_units WHERE id = ANY($1) AND is_active = TRUE`,
    [[fromUnitId, b.to_unit_id]]
  );
  if (uRows.length < 2) throw new AppError('Unidade de origem ou destino inválida/inativa.', 422, 'INVALID_UNIT');

  const { rows } = await db.query(
    `INSERT INTO ris.referrals
       (patient_id, from_unit_id, to_unit_id, to_user_id, specialty, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, status, created_at`,
    [b.patient_id, fromUnitId, b.to_unit_id, b.to_user_id || null, b.specialty || null, b.reason, u.sub]
  );

  // Notifica o destino (in-app) — não bloqueia a resposta
  setImmediate(() => notifyReferralCreated(rows[0].id).catch(err =>
    logger.error('[referrals] falha ao notificar criação', { error: err.message, referralId: rows[0].id })
  ));

  return created(res, rows[0], 'Encaminhamento criado');
});

// ── PATCH /:id/decide ────────────────────────────────────────────────────────
router.patch('/:id/decide',
  validate({ params: schemas.uuidParam, body: decideSchema }),
  async (req, res) => {
  const u = req.user;
  const { id } = req.params;
  const { decision, decision_notes } = req.body;

  const { rows } = await db.query(`SELECT * FROM ris.referrals WHERE id = $1`, [id]);
  if (!rows.length) throw new NotFoundError('Encaminhamento');
  const ref = rows[0];
  if (ref.status !== 'pending') throw new AppError('Encaminhamento já foi decidido', 422);

  // Pode decidir: admin · destinatário direto · alguém da to_unit_id
  const canDecide = u.role === 'admin'
    || ref.to_user_id === u.sub
    || (u.health_unit_id && u.health_unit_id === ref.to_unit_id);
  if (!canDecide) throw new AppError('Você não pode decidir este encaminhamento', 403);

  await db.query(
    `UPDATE ris.referrals
       SET status = $1, decided_at = NOW(), decided_by = $2,
           decision_notes = $3, updated_at = NOW()
     WHERE id = $4`,
    [decision, u.sub, decision_notes || null, id]
  );

  // Notifica o solicitante da decisão — não bloqueia a resposta
  setImmediate(() => notifyReferralDecided(id, decision).catch(err =>
    logger.error('[referrals] falha ao notificar decisão', { error: err.message, referralId: id })
  ));

  return success(res, { id, status: decision }, 'Decisão registrada');
});

// ── PATCH /:id/cancel ────────────────────────────────────────────────────────
router.patch('/:id/cancel',
  validate({ params: schemas.uuidParam }),
  async (req, res) => {
  const u = req.user;
  const { id } = req.params;
  const { rowCount } = await db.query(
    `UPDATE ris.referrals
       SET status='cancelled', updated_at=NOW()
     WHERE id = $1 AND status='pending'
       AND (created_by = $2 OR $3 = 'admin')`,
    [id, u.sub, u.role]
  );
  if (!rowCount) throw new AppError('Encaminhamento não pode ser cancelado (não está pendente ou você não é o solicitante)', 422);
  return success(res, { id }, 'Encaminhamento cancelado');
});

// ── PATCH /:id/counter-reference — destino responde e fecha o ciclo ───────────
router.patch('/:id/counter-reference',
  validate({ params: schemas.uuidParam, body: z.object({ content: z.string().min(3).max(5000) }) }),
  async (req, res) => {
  const u = req.user;
  const { id } = req.params;
  const { content } = req.body;

  const { rows } = await db.query(`SELECT * FROM ris.referrals WHERE id = $1`, [id]);
  if (!rows.length) throw new NotFoundError('Encaminhamento');
  const ref = rows[0];
  if (ref.status !== 'accepted')
    throw new AppError('Só um encaminhamento aceito pode receber contrarreferência', 422, 'NOT_ACCEPTED');

  // Quem responde = mesmo critério de decidir (destino/admin).
  const canCounter = u.role === 'admin'
    || ref.to_user_id === u.sub
    || (u.health_unit_id && u.health_unit_id === ref.to_unit_id);
  if (!canCounter) throw new AppError('Você não pode contrarreferenciar este encaminhamento', 403);

  await db.query(
    `UPDATE ris.referrals
        SET counter_reference = $1, counter_referred_at = NOW(), counter_referred_by = $2,
            status = 'completed', updated_at = NOW()
      WHERE id = $3`,
    [content, u.sub, id]
  );

  setImmediate(() => notifyCounterReference(id).catch(err =>
    logger.error('[referrals] falha ao notificar contrarreferência', { error: err.message, referralId: id })
  ));

  return success(res, { id, status: 'completed' }, 'Contrarreferência registrada — ciclo fechado');
});

module.exports = router;
