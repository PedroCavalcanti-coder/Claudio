'use strict';
const { Router } = require('express');
const db         = require('../../config/database');
const authenticate  = require('../../middlewares/authenticate');
const { requirePermission, requireUnitScopeParam } = require('../../middlewares/authorize');
const { success, created } = require('../../utils/response');
const { AppError }  = require('../../utils/errors');

const router = Router();
router.use(authenticate);

// ── Listar todas as unidades (admin) ──────────────────────────────────────────
router.get('/', requirePermission('health_units:manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT hu.*, COUNT(u.id) AS user_count
     FROM ris.health_units hu
     LEFT JOIN auth.users u ON u.health_unit_id = hu.id
     GROUP BY hu.id ORDER BY hu.name`
  );
  return success(res, rows);
});

// ── Checklist de configuração inicial (admin) ─────────────────────────────────
// A ordem que o admin precisa saber: unidade → equipamentos → procedimentos por unidade → turnos
// → equipe → senha própria. Devolve o que está feito e, por unidade, o que falta.
router.get('/setup-status', requirePermission('health_units:manage'), async (req, res) => {
  const { rows: units } = await db.query(
    `SELECT hu.id, hu.name,
            (SELECT count(*) FROM ris.modalities m WHERE m.health_unit_id = hu.id AND m.is_active)::int AS modalities,
            (SELECT count(*) FROM ris.unit_procedures up WHERE up.health_unit_id = hu.id)::int          AS procedures,
            (SELECT count(*) FROM ris.shifts sh WHERE sh.health_unit_id = hu.id AND sh.is_active)::int   AS shifts,
            (SELECT count(*) FROM auth.users u WHERE u.health_unit_id = hu.id AND u.is_active)::int      AS staff
       FROM ris.health_units hu WHERE hu.is_active ORDER BY hu.name`);
  const { rows: [adm] } = await db.query(
    `SELECT bool_and(NOT must_change_password) AS ok FROM auth.users WHERE id = $1`, [req.user.sub]);

  const any = (k) => units.some((u) => u[k] > 0);
  const steps = [
    { key: 'unit',       label: 'Cadastrar a unidade de saúde',                 done: units.length > 0,   to: '/admin/units' },
    { key: 'modalities', label: 'Cadastrar equipamentos/salas da unidade',      done: any('modalities'),  to: '/admin/units' },
    { key: 'procedures', label: 'Definir os procedimentos oferecidos por unidade', done: any('procedures'), to: '/admin/units' },
    { key: 'shifts',     label: 'Criar os turnos de trabalho',                  done: any('shifts'),      to: '/admin/units' },
    { key: 'staff',      label: 'Cadastrar a equipe (lotada na unidade)',       done: any('staff'),       to: '/admin/staff' },
    { key: 'password',   label: 'Trocar a senha provisória do administrador',   done: !!adm?.ok,          to: '/trocar_senha' },
  ];
  const LABEL = { modalities: 'equipamentos', procedures: 'procedimentos', shifts: 'turnos', staff: 'equipe' };
  const incomplete = units
    .map((u) => ({ id: u.id, name: u.name, missing: Object.keys(LABEL).filter((k) => u[k] === 0).map((k) => LABEL[k]) }))
    .filter((u) => u.missing.length);
  return success(res, { steps, done: steps.filter((x) => x.done).length, total: steps.length, units_incomplete: incomplete });
});

// ── Minha unidade (qualquer usuário logado) ───────────────────────────────────
router.get('/mine', async (req, res) => {
  if (!req.user?.health_unit_id) {
    // admin: retorna todas
    if (req.user?.role === 'admin') {
      const { rows } = await db.query(`SELECT * FROM ris.health_units WHERE is_active=TRUE ORDER BY name`);
      return success(res, rows);
    }
    return success(res, null);
  }
  const { rows } = await db.query(
    `SELECT * FROM ris.health_units WHERE id=$1`, [req.user.health_unit_id]
  );
  return success(res, rows[0] ?? null);
});

// Nome de unidade já em uso? (case/espaço-insensível; ignora a própria no update)
async function nameTaken(name, exceptId) {
  const norm = `lower(btrim(regexp_replace(%s, '\\s+', ' ', 'g')))`;
  const { rows } = await db.query(
    `SELECT 1 FROM ris.health_units
      WHERE ${norm.replace('%s','name')} = ${norm.replace('%s','$1')}
        AND ($2::uuid IS NULL OR id <> $2) LIMIT 1`,
    [name, exceptId || null]
  );
  return rows.length > 0;
}

// ── Criar unidade (admin) ────────────────────────────────────────────────────
router.post('/', requirePermission('health_units:manage'), async (req, res) => {
  const { name, cnpj, cnes, type = 'clinic', address, phone, email } = req.body;
  if (!name) throw new AppError('Nome obrigatório', 422);
  if (await nameTaken(name, null)) {
    throw new AppError('Já existe uma unidade com este nome', 409, 'UNIT_NAME_TAKEN');
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO ris.health_units (name, cnpj, cnes, type, address, phone, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, cnpj||null, cnes||null, type, address?JSON.stringify(address):null, phone||null, email||null]
    );
    return created(res, rows[0], 'Unidade criada');
  } catch (err) {
    if (err.code === '23505') throw new AppError('Já existe uma unidade com este nome', 409, 'UNIT_NAME_TAKEN');
    throw err;
  }
});

// ── Atualizar unidade (admin) ─────────────────────────────────────────────────
router.patch('/:id', requirePermission('health_units:manage'), async (req, res) => {
  const { name, cnpj, cnes, type, phone, email, is_active } = req.body;
  if (name && await nameTaken(name, req.params.id)) {
    throw new AppError('Já existe uma unidade com este nome', 409, 'UNIT_NAME_TAKEN');
  }
  try {
    const { rowCount } = await db.query(
      `UPDATE ris.health_units SET
         name=COALESCE($1,name), cnpj=COALESCE($2,cnpj), cnes=COALESCE($3,cnes),
         type=COALESCE($4,type), phone=COALESCE($5,phone), email=COALESCE($6,email),
         is_active=COALESCE($7,is_active), updated_at=NOW()
       WHERE id=$8`,
      [name,cnpj,cnes,type,phone,email,is_active,req.params.id]
    );
    if (!rowCount) throw new AppError('Unidade não encontrada', 404);
    return success(res, { id: req.params.id }, 'Unidade atualizada');
  } catch (err) {
    if (err.code === '23505') throw new AppError('Já existe uma unidade com este nome', 409, 'UNIT_NAME_TAKEN');
    throw err;
  }
});

// ── Listar equipamentos (modalidades) de uma unidade ─────────────────────────
// Acesso: qualquer usuário autenticado — usado pelo upload DICOM e pelo painel.
router.get('/:id/modalities', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, name, dicom_ae_title, modality_type, manufacturer, model, location, is_active
       FROM ris.modalities
      WHERE (health_unit_id = $1 OR health_unit_id IS NULL) AND is_active = TRUE
      ORDER BY name`,
    [req.params.id]
  );
  return success(res, rows);
});

// ── Listar salas de uma unidade ───────────────────────────────────────────────
router.get('/:id/rooms', async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.modality_id, m.name AS modality_name, r.is_active
       FROM ris.rooms r
       LEFT JOIN ris.modalities m ON m.id = r.modality_id
      WHERE (r.health_unit_id = $1 OR r.health_unit_id IS NULL) AND r.is_active = TRUE
      ORDER BY r.name`,
    [req.params.id]
  );
  return success(res, rows);
});

// ── Procedimentos oferecidos por uma unidade ──────────────────────────────────
// GET: lista TODOS os procedimentos ativos com flag `offered` (se a unidade não
// tem mapeamento, todos contam como oferecidos — retrocompat).
router.get('/:id/procedures', requirePermission('unit:manage'), requireUnitScopeParam('id'), async (req, res) => {
  const { rows: mapped } = await db.query(
    `SELECT COUNT(*)::int AS n FROM ris.unit_procedures WHERE health_unit_id = $1`,
    [req.params.id]
  );
  const hasMapping = mapped[0].n > 0;
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.tuss_code, p.modality_type, p.duration_minutes,
            ($2 = FALSE) OR (up.procedure_id IS NOT NULL) AS offered,
            COALESCE(up.weekdays, '{}')           AS weekdays,
            to_char(up.start_time, 'HH24:MI')     AS start_time,
            to_char(up.end_time,   'HH24:MI')     AS end_time
       FROM ris.procedures p
       LEFT JOIN ris.unit_procedures up
              ON up.health_unit_id = $1 AND up.procedure_id = p.id
      WHERE p.is_active = TRUE
      ORDER BY p.modality_type, p.name`,
    [req.params.id, hasMapping]
  );
  return success(res, { has_mapping: hasMapping, procedures: rows });
});

// PUT: define o conjunto de procedimentos oferecidos pela unidade.
// Aceita 2 formatos (lista vazia = unidade oferece TODOS, limpa o mapa):
//   { procedure_ids: [uuid] }                                    — simples (retrocompat)
//   { procedures: [{ procedure_id, weekdays:[0..6], start_time:'HH:MM', end_time:'HH:MM' }] }
//     weekdays/start_time/end_time opcionais (sem restrição específica = janela geral).
router.put('/:id/procedures', requirePermission('unit:manage'), requireUnitScopeParam('id'), async (req, res) => {
  const unitId = req.params.id;
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

  let items;
  if (Array.isArray(req.body.procedures)) {
    items = req.body.procedures.map(p => {
      const wk = Array.isArray(p.weekdays) ? [...new Set(p.weekdays.map(Number))].filter(n => n >= 0 && n <= 6) : [];
      const st = p.start_time && timeRe.test(p.start_time) ? p.start_time : null;
      const et = p.end_time   && timeRe.test(p.end_time)   ? p.end_time   : null;
      if (st && et && st >= et) throw new AppError('Horário do procedimento inválido (início ≥ fim).', 422, 'BAD_PROC_TIME');
      return { id: p.procedure_id, weekdays: wk, start_time: st, end_time: et };
    }).filter(p => p.id);
  } else if (Array.isArray(req.body.procedure_ids)) {
    items = [...new Set(req.body.procedure_ids)].map(id => ({ id, weekdays: [], start_time: null, end_time: null }));
  } else {
    throw new AppError('Informe procedures[] ou procedure_ids[]', 422);
  }

  await db.transaction(async (client) => {
    await client.query(`DELETE FROM ris.unit_procedures WHERE health_unit_id = $1`, [unitId]);
    for (const it of items) {
      await client.query(
        `INSERT INTO ris.unit_procedures (health_unit_id, procedure_id, weekdays, start_time, end_time)
           SELECT $1, p.id, $3::smallint[], $4::time, $5::time
             FROM ris.procedures p WHERE p.id = $2
         ON CONFLICT (health_unit_id, procedure_id) DO UPDATE
           SET weekdays = EXCLUDED.weekdays, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
        [unitId, it.id, it.weekdays, it.start_time, it.end_time]
      );
    }
  });
  return success(res, { health_unit_id: unitId, count: items.length },
    items.length ? `${items.length} procedimento(s) oferecidos` : 'Unidade passa a oferecer todos os procedimentos');
});

// ── Turnos da unidade (gestor: admin ou recepção da própria unidade) ─────────
const MANAGE = [requirePermission('unit:manage'), requireUnitScopeParam('id')];

router.get('/:id/shifts', ...MANAGE, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, name, start_time, end_time, is_active,
            (SELECT COUNT(*) FROM ris.user_shifts us WHERE us.shift_id = s.id)::int AS member_count
       FROM ris.shifts s
      WHERE health_unit_id = $1
      ORDER BY start_time, name`,
    [req.params.id]
  );
  return success(res, rows);
});

router.post('/:id/shifts', ...MANAGE, async (req, res) => {
  const { name, start_time, end_time } = req.body;
  if (!name || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end_time || ''))
    throw new AppError('Informe nome e horários válidos (HH:MM).', 422);
  const { rows } = await db.query(
    `INSERT INTO ris.shifts (health_unit_id, name, start_time, end_time)
     VALUES ($1,$2,$3,$4) RETURNING id, name, start_time, end_time, is_active`,
    [req.params.id, name, start_time, end_time]
  );
  return created(res, rows[0], 'Turno criado');
});

router.patch('/:id/shifts/:shiftId', ...MANAGE, async (req, res) => {
  const { name, start_time, end_time, is_active } = req.body;
  const { rows } = await db.query(
    `UPDATE ris.shifts SET
       name = COALESCE($1, name),
       start_time = COALESCE($2, start_time),
       end_time = COALESCE($3, end_time),
       is_active = COALESCE($4, is_active),
       updated_at = NOW()
     WHERE id = $5 AND health_unit_id = $6
     RETURNING id, name, start_time, end_time, is_active`,
    [name ?? null, start_time ?? null, end_time ?? null, is_active ?? null, req.params.shiftId, req.params.id]
  );
  if (!rows.length) throw new AppError('Turno não encontrado nesta unidade', 404);
  return success(res, rows[0], 'Turno atualizado');
});

router.delete('/:id/shifts/:shiftId', ...MANAGE, async (req, res) => {
  const { rowCount } = await db.query(
    `DELETE FROM ris.shifts WHERE id = $1 AND health_unit_id = $2`,
    [req.params.shiftId, req.params.id]
  );
  if (!rowCount) throw new AppError('Turno não encontrado nesta unidade', 404);
  return success(res, { id: req.params.shiftId }, 'Turno removido');
});

// ── Equipe da unidade + turnos atribuídos ────────────────────────────────────
router.get('/:id/staff', ...MANAGE, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.is_active,
            COALESCE(
              (SELECT json_agg(us.shift_id) FROM ris.user_shifts us WHERE us.user_id = u.id), '[]'
            ) AS shift_ids
       FROM auth.users u
      WHERE u.health_unit_id = $1 AND u.role <> 'patient'
      ORDER BY u.role, u.name`,
    [req.params.id]
  );
  return success(res, rows);
});

// Define os turnos de um funcionário (da unidade). body { shift_ids: [] }
router.put('/:id/staff/:userId/shifts', ...MANAGE, async (req, res) => {
  const ids = Array.isArray(req.body.shift_ids) ? [...new Set(req.body.shift_ids)] : null;
  if (!ids) throw new AppError('shift_ids deve ser um array', 422);

  // valida que o usuário é da unidade e que os turnos pertencem à unidade
  const { rows: uRows } = await db.query(
    `SELECT 1 FROM auth.users WHERE id = $1 AND health_unit_id = $2`, [req.params.userId, req.params.id]
  );
  if (!uRows.length) throw new AppError('Funcionário não pertence a esta unidade', 422, 'NOT_IN_UNIT');

  await db.transaction(async (client) => {
    await client.query(`DELETE FROM ris.user_shifts WHERE user_id = $1`, [req.params.userId]);
    if (ids.length) {
      await client.query(
        `INSERT INTO ris.user_shifts (user_id, shift_id)
           SELECT $1, s.id FROM ris.shifts s WHERE s.id = ANY($2) AND s.health_unit_id = $3
         ON CONFLICT DO NOTHING`,
        [req.params.userId, ids, req.params.id]
      );
    }
  });
  return success(res, { user_id: req.params.userId, count: ids.length }, 'Turnos do funcionário atualizados');
});

// ── Vincular usuário a unidade (admin) ────────────────────────────────────────
router.patch('/:id/assign-user', requirePermission('health_units:manage'), async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) throw new AppError('user_id obrigatório', 422);
  await db.query(
    `UPDATE auth.users SET health_unit_id=$1 WHERE id=$2 AND role!='admin'`,
    [req.params.id, user_id]
  );
  return success(res, null, 'Usuário vinculado à unidade');
});

module.exports = router;
