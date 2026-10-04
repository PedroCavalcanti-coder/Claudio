'use strict';
const db     = require('../../config/database');
const enc    = require('../../services/encryption');
const audit  = require('../../services/audit');
const { buildUnitFilter } = require('../../middlewares/unitVisibility');
const { success, paginated } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');

// ── Worklist do radiologista ───────────────────────────────────────────────────
// Mostra agendamentos em checked_in (paciente aguardando exame) e in_progress
// (exame em execução/laudo em andamento). Ordenado por prioridade e horário.
async function worklist(req, res) {
  const { status, priority, modality, page, limit } = req.query;
  const offset = (page - 1) * limit;

  const params = [];
  const conditions = [`a.status IN ('checked_in', 'in_progress')`];

  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (priority !== undefined) {
    params.push(Number(priority));
    conditions.push(`a.priority = $${params.length}`);
  }
  if (modality) {
    params.push(modality);
    conditions.push(`proc.modality_type = $${params.length}`);
  }

  // Escopo de unidade — fila da própria unidade (admin/recurso veem tudo;
  // sem lotação não vê nada). Filtra pela unidade do agendamento.
  const unitFilter = buildUnitFilter(req, 'a', params);
  if (unitFilter) conditions.push(unitFilter);

  const where = `WHERE ${conditions.join(' AND ')}`;

  const baseQuery = `
    FROM ris.appointments a
    JOIN ris.patients   p    ON p.id   = a.patient_id
    JOIN ris.procedures proc ON proc.id = a.procedure_id
    LEFT JOIN ris.modalities m ON m.id = a.modality_id
    LEFT JOIN ris.rooms      r ON r.id = a.room_id
    LEFT JOIN pacs.studies   s ON s.appointment_id = a.id
    LEFT JOIN ris.reports    rep ON rep.study_id = s.id AND rep.status NOT IN ('cancelled')
    ${where}`;

  const [countRes, dataRes] = await Promise.all([
    db.query(`SELECT COUNT(*) ${baseQuery}`, params),
    db.query(`
      SELECT
        a.id, a.scheduled_at, a.status, a.priority, a.checked_in_at,
        a.clinical_indication,
        proc.name AS procedure_name, proc.tuss_code, proc.modality_type,
        proc.duration_minutes AS procedure_duration,
        m.name AS modality_name, m.dicom_ae_title,
        r.name AS room_name,
        p.birth_date, p.gender, p.medical_record_number,
        p.name_encrypted,
        s.id AS study_id, s.status AS study_status,
        s.number_of_series, s.number_of_instances,
        s.upload_completed_at,
        rep.id AS report_id, rep.status AS report_status
      ${baseQuery}
      ORDER BY a.priority DESC, a.checked_in_at ASC NULLS LAST, a.scheduled_at ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  const data = dataRes.rows.map(row => ({
    ...row,
    patient_name:    enc.safeDecrypt(row.name_encrypted),
    name_encrypted:  undefined,
    images_ready:    !!row.upload_completed_at,
    can_start_report: !!row.study_id && !!row.upload_completed_at && !row.report_id,
  }));

  return paginated(res, {
    data,
    total: parseInt(countRes.rows[0].count),
    page,
    limit,
  });
}

// ── Claim: radiologista assume o exame ────────────────────────────────────────
// Altera status de checked_in → in_progress e registra quem assumiu.
async function claim(req, res) {
  const { id } = req.params;

  await db.transaction(async client => {
    const { rows } = await client.query(
      `SELECT a.id, a.status, a.patient_id, a.procedure_id,
              proc.name AS procedure_name,
              p.name_encrypted
       FROM ris.appointments a
       JOIN ris.procedures proc ON proc.id = a.procedure_id
       JOIN ris.patients   p    ON p.id   = a.patient_id
       WHERE a.id = $1 FOR UPDATE`,
      [id]
    );
    if (!rows.length) throw new NotFoundError('Agendamento');

    const ap = rows[0];
    if (ap.status !== 'checked_in') {
      throw new AppError(
        `Agendamento está em status '${ap.status}', não pode ser assumido`,
        422,
        'INVALID_STATUS'
      );
    }

    await client.query(
      `UPDATE ris.appointments
       SET status     = 'in_progress',
           updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    await audit.log({
      userId:       req.user.sub,
      userEmail:    req.user.email,
      userRole:     req.user.role,
      action:       'WORKLIST_CLAIMED',
      resourceType: 'appointment',
      resourceId:   id,
      ipAddress:    req.ip,
    });
  });

  return success(res, { id, status: 'in_progress' }, 'Exame assumido para análise');
}

// ── Notificações do radiologista ───────────────────────────────────────────────
async function getNotifications(req, res) {
  const { rows } = await db.query(
    `SELECT id, type, title, body, resource_type, resource_id, read_at, created_at
     FROM ris.notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.user.sub]
  );
  const { rows: unread } = await db.query(
    `SELECT COUNT(*) FROM ris.notifications WHERE user_id = $1 AND read_at IS NULL`,
    [req.user.sub]
  );
  return success(res, {
    notifications: rows,
    unread_count:  parseInt(unread[0].count),
  });
}

module.exports = { worklist, claim, getNotifications };
