'use strict';
// ── TCLE — Consentimento LGPD ─────────────────────────────────────────────────
const { Router } = require('express');
const db       = require('../../config/database');
const audit    = require('../../services/audit');
const enc      = require('../../services/encryption');
const { success, created } = require('../../utils/response');
const { AppError, NotFoundError } = require('../../utils/errors');
const authenticate  = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');

const router = Router();

router.get('/active', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, version, title, content_html, created_at
     FROM ris.consent_terms WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 1`
  );
  if (!rows.length) throw new NotFoundError('Termo de consentimento');
  return success(res, rows[0]);
});

router.get('/patient/:patientId/status',
  authenticate, requirePermission('consent:read'),
  async (req, res) => {
    const { rows } = await db.query(
      `SELECT pc.id, pc.signed_at, pc.method, ct.version, ct.title
       FROM ris.patient_consents pc
       JOIN ris.consent_terms ct ON ct.id = pc.term_id
       WHERE pc.patient_id = $1
       ORDER BY pc.signed_at DESC`,
      [req.params.patientId]
    );
    return success(res, { signed: rows.length > 0, consents: rows });
  }
);

router.post('/sign',
  authenticate, requirePermission('consent:sign'),
  async (req, res) => {
    const { patient_id, term_id, appointment_id, method = 'digital', signature_data } = req.body;
    if (!patient_id || !term_id) throw new AppError('patient_id e term_id são obrigatórios', 422);

    const { rows: existing } = await db.query(
      `SELECT id FROM ris.patient_consents WHERE patient_id=$1 AND term_id=$2`,
      [patient_id, term_id]
    );
    if (existing.length) {
      return success(res, { id: existing[0].id, already_signed: true }, 'Paciente já assinou este termo');
    }

    // Guarda o hash do CPF (não o valor), suficiente para auditoria sem expor dado sensível em claro
    const { rows: pRows } = await db.query(
      `SELECT cpf_encrypted FROM ris.patients WHERE id=$1`, [patient_id]
    );
    const cpfHash = pRows[0] ? enc.searchHash(enc.decrypt(pRows[0].cpf_encrypted)) : null;

    const { rows } = await db.query(
      `INSERT INTO ris.patient_consents
         (patient_id, term_id, appointment_id, signed_by_cpf, ip_address, user_agent, method, signature_data, witness_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, signed_at`,
      [patient_id, term_id, appointment_id || null, cpfHash,
       req.ip, req.headers['user-agent'], method,
       signature_data || null, req.user.sub]
    );

    await audit.log({
      ...audit.fromRequest(req),
      action:       'CONSENT_SIGNED',
      resourceType: 'patient',
      resourceId:   patient_id,
      details:      { term_id, method },
    });

    return created(res, rows[0], 'Consentimento registrado com sucesso');
  }
);

router.get('/', authenticate, requirePermission('consent:manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, version, title, is_active, created_at FROM ris.consent_terms ORDER BY created_at DESC`
  );
  return success(res, rows);
});

router.post('/', authenticate, requirePermission('consent:manage'), async (req, res) => {
  const { version, title, content_html } = req.body;
  if (!version || !title || !content_html) throw new AppError('version, title e content_html são obrigatórios', 422);

  // Apenas um termo pode estar ativo por vez
  await db.query(`UPDATE ris.consent_terms SET is_active = FALSE`);

  const { rows } = await db.query(
    `INSERT INTO ris.consent_terms (version, title, content_html, is_active)
     VALUES ($1,$2,$3,TRUE) RETURNING id, version, created_at`,
    [version, title, content_html]
  );
  return created(res, rows[0], 'Termo criado e ativado');
});

// LGPD: direito de revogação — marca como revogado em vez de apagar, preservando a trilha de auditoria
router.post('/:id/revoke', authenticate, requirePermission('consent:manage'), async (req, res) => {
  const { rowCount } = await db.query(
    `UPDATE ris.patient_consents
        SET revoked_at = NOW(), revoked_by = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [req.params.id, req.user.sub]
  );
  if (!rowCount) throw new AppError('Consentimento não encontrado ou já revogado', 404, 'CONSENT_NOT_REVOCABLE');
  await audit.log({
    ...audit.fromRequest(req),
    action: 'CONSENT_REVOKED', resourceType: 'patient_consent', resourceId: req.params.id,
  });
  return success(res, { id: req.params.id }, 'Consentimento revogado');
});

module.exports = router;
