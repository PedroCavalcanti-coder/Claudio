'use strict';
/**
 * Segunda Opinião / Conselho Técnico
 * Conforme Resolução CFM nº 2.107/2014 e normas de auditoria clínica
 */
const { Router }    = require('express');
const db            = require('../../config/database');
const audit         = require('../../services/audit');
const { success, created } = require('../../utils/response');
const { AppError, NotFoundError } = require('../../utils/errors');
const authenticate  = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');

const router = Router();
router.use(authenticate);

router.post('/', requirePermission('second_opinion:manage'), async (req, res) => {
  const { study_id, report_id, reason, description } = req.body;
  if (!study_id || !reason || !description)
    throw new AppError('study_id, reason e description são obrigatórios', 422);

  const validReasons = ['technical_quality','diagnostic_doubt','complex_case','peer_review'];
  if (!validReasons.includes(reason))
    throw new AppError(`Motivo inválido. Use: ${validReasons.join(', ')}`, 422);

  const { rows: studyRows } = await db.query(
    `SELECT a.priority FROM pacs.studies s
     JOIN ris.appointments a ON a.id = s.appointment_id
     WHERE s.id=$1`, [study_id]
  );
  const priority = studyRows[0]?.priority ?? 0;

  const { rows: slaRows } = await db.query(
    `SELECT second_op_hours FROM ris.sla_configs
     WHERE priority=$1 AND modality_type IS NULL LIMIT 1`, [priority]
  );
  const hours = slaRows[0]?.second_op_hours ?? 48;
  const slaDeadline = new Date(Date.now() + hours * 3600 * 1000);

  const { rows } = await db.query(
    `INSERT INTO ris.second_opinions
       (study_id, report_id, requesting_user_id, reason, description, sla_deadline)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, status, created_at`,
    [study_id, report_id || null, req.user.sub, reason, description, slaDeadline]
  );

  await db.query(
    `UPDATE pacs.studies SET display_status='second_opinion', updated_at=NOW() WHERE id=$1`,
    [study_id]
  );

  if (report_id) {
    await db.query(
      `UPDATE ris.reports SET status='review', updated_at=NOW() WHERE id=$1`, [report_id]
    );
  }

  await audit.log({
    ...audit.fromRequest(req),
    action: 'SECOND_OPINION_REQUESTED',
    resourceType: 'study', resourceId: study_id,
    details: { reason, sla_deadline: slaDeadline },
  });

  return created(res, rows[0], 'Solicitação de segunda opinião enviada ao conselho');
});

router.get('/', requirePermission('second_opinion:manage'), async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  const where  = [];

  if (status) { params.push(status); where.push(`so.status=$${params.length}`); }

  // Sem filtro por médico: qualquer usuário com second_opinion:manage vê toda a fila do conselho
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT
       so.id, so.reason, so.description, so.status, so.sla_deadline,
       so.joint_report, so.created_at, so.updated_at,
       s.study_date, s.modality_type, s.accession_number,
       p.name_encrypted, p.medical_record_number,
       u.name AS requesting_physician,
       COUNT(sor.id)::int AS reviewer_count,
       EXTRACT(EPOCH FROM (so.sla_deadline - NOW())) / 3600 AS hours_remaining
     FROM ris.second_opinions so
     JOIN pacs.studies s ON s.id = so.study_id
     JOIN ris.patients p ON p.id = s.patient_id
     JOIN auth.users u   ON u.id = so.requesting_user_id
     LEFT JOIN ris.second_opinion_reviewers sor ON sor.second_opinion_id = so.id
     ${whereClause}
     GROUP BY so.id, s.study_date, s.modality_type, s.accession_number,
              p.name_encrypted, p.medical_record_number, u.name
     ORDER BY so.sla_deadline ASC
     LIMIT $${params.length+1} OFFSET $${params.length+2}`,
    [...params, limit, offset]
  );

  const enc = require('../../services/encryption');
  return success(res, rows.map(r => ({
    ...r,
    patient_name: enc.safeDecrypt(r.name_encrypted),
    name_encrypted: undefined,
    is_overdue: r.hours_remaining < 0,
    is_urgent:  r.hours_remaining < 4,
  })));
});

router.get('/:id', requirePermission('second_opinion:manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT so.*,
            s.study_date, s.modality_type, s.accession_number, s.study_instance_uid,
            p.name_encrypted, p.medical_record_number,
            u_req.name AS requesting_physician,
            u_res.name AS resolved_by_name,
            json_agg(json_build_object(
              'reviewer_id', sor.reviewer_id,
              'reviewer_name', u_rev.name,
              'opinion_text', sor.opinion_text,
              'opinion_at', sor.opinion_at
            )) FILTER (WHERE sor.id IS NOT NULL) AS reviewers
     FROM ris.second_opinions so
     JOIN pacs.studies s      ON s.id = so.study_id
     JOIN ris.patients p      ON p.id = s.patient_id
     JOIN auth.users u_req    ON u_req.id = so.requesting_user_id
     LEFT JOIN auth.users u_res ON u_res.id = so.resolved_by
     LEFT JOIN ris.second_opinion_reviewers sor ON sor.second_opinion_id = so.id
     LEFT JOIN auth.users u_rev ON u_rev.id = sor.reviewer_id
     WHERE so.id=$1
     GROUP BY so.id, s.study_date, s.modality_type, s.accession_number, s.study_instance_uid,
              p.name_encrypted, p.medical_record_number, u_req.name, u_res.name`,
    [req.params.id]
  );

  if (!rows.length) throw new NotFoundError('Segunda opinião');
  const enc = require('../../services/encryption');
  const row = rows[0];

  // Registrar acesso (rastreabilidade CFM)
  await audit.log({
    ...audit.fromRequest(req),
    action: 'SECOND_OPINION_VIEWED',
    resourceType: 'second_opinion', resourceId: req.params.id,
  });

  return success(res, { ...row, patient_name: enc.safeDecrypt(row.name_encrypted), name_encrypted: undefined });
});

router.post('/:id/review', requirePermission('second_opinion:manage'), async (req, res) => {
  const { opinion_text } = req.body;
  if (!opinion_text?.trim()) throw new AppError('Parecer obrigatório', 422);

  await db.query(
    `INSERT INTO ris.second_opinion_reviewers (second_opinion_id, reviewer_id, opinion_text, opinion_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (second_opinion_id, reviewer_id)
     DO UPDATE SET opinion_text=$3, opinion_at=NOW()`,
    [req.params.id, req.user.sub, opinion_text]
  );

  await db.query(
    `UPDATE ris.second_opinions SET status='under_review', updated_at=NOW() WHERE id=$1 AND status='pending'`,
    [req.params.id]
  );

  await audit.log({
    ...audit.fromRequest(req),
    action: 'SECOND_OPINION_REVIEWED',
    resourceType: 'second_opinion', resourceId: req.params.id,
  });

  return success(res, null, 'Parecer registrado');
});

router.patch('/:id/recall', requirePermission('second_opinion:manage'), async (req, res) => {
  const { reason } = req.body;
  await db.query(
    `UPDATE ris.second_opinions
     SET status='patient_recalled', resolution=$1, updated_at=NOW()
     WHERE id=$2`,
    [reason || 'Qualidade técnica inadequada — reconvocação necessária', req.params.id]
  );

  await audit.log({
    ...audit.fromRequest(req),
    action: 'PATIENT_RECALLED',
    resourceType: 'second_opinion', resourceId: req.params.id,
  });

  return success(res, null, 'Paciente marcado para reconvocação');
});

router.patch('/:id/resolve', requirePermission('second_opinion:manage'), async (req, res) => {
  const { resolution, joint_report } = req.body;
  if (!resolution?.trim()) throw new AppError('Resolução obrigatória', 422);

  const { rows } = await db.query(
    `UPDATE ris.second_opinions
     SET status='resolved', resolution=$1, joint_report=$2,
         resolved_at=NOW(), resolved_by=$3, updated_at=NOW()
     WHERE id=$4 AND status IN ('pending','under_review')
     RETURNING study_id`,
    [resolution, joint_report || false, req.user.sub, req.params.id]
  );

  if (!rows.length) throw new AppError('Solicitação não pode ser resolvida neste status', 422);

  await db.query(
    `UPDATE pacs.studies SET display_status='in_report', updated_at=NOW() WHERE id=$1`,
    [rows[0].study_id]
  );

  await audit.log({
    ...audit.fromRequest(req),
    action: 'SECOND_OPINION_RESOLVED',
    resourceType: 'second_opinion', resourceId: req.params.id,
    details: { joint_report },
  });

  return success(res, null, 'Caso resolvido — laudo pode ser emitido');
});

module.exports = router;
