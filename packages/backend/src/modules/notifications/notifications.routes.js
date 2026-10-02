'use strict';
const { Router }    = require('express');
const db            = require('../../config/database');
const { success }   = require('../../utils/response');
const authenticate  = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const { page = 1, limit = 30, unread_only } = req.query;
  const offset  = (page - 1) * limit;
  const params  = [req.user.sub];
  const where   = ['user_id=$1'];

  if (unread_only === 'true') where.push('read_at IS NULL');

  const { rows } = await db.query(
    `SELECT id, type, title, body, resource_type, resource_id,
            channel, status, read_at, created_at
     FROM ris.notifications
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length+1} OFFSET $${params.length+2}`,
    [...params, limit, offset]
  );

  const { rows: count } = await db.query(
    `SELECT COUNT(*) FROM ris.notifications WHERE user_id=$1 AND read_at IS NULL`,
    [req.user.sub]
  );

  return success(res, { notifications: rows, unread_count: parseInt(count[0].count) });
});

router.patch('/:id/read', async (req, res) => {
  await db.query(
    `UPDATE ris.notifications SET read_at=NOW(), status='read'
     WHERE id=$1 AND user_id=$2`,
    [req.params.id, req.user.sub]
  );
  return success(res, null, 'Notificação marcada como lida');
});

router.patch('/read-all', async (req, res) => {
  await db.query(
    `UPDATE ris.notifications SET read_at=NOW(), status='read'
     WHERE user_id=$1 AND read_at IS NULL`,
    [req.user.sub]
  );
  return success(res, null, 'Todas as notificações marcadas como lidas');
});

router.get('/sla/overdue', requirePermission('notifications:sla'), async (req, res) => {
  // sla_configs.modality_type IS NULL = config genérica por prioridade (não específica de modalidade)
  const { rows } = await db.query(
    `SELECT
       s.id AS study_id, s.study_instance_uid, s.accession_number, s.received_at,
       s.modality_type, a.priority,
       r.id AS report_id, r.status AS report_status,
       sla.report_hours,
       s.received_at + (sla.report_hours * INTERVAL '1 hour') AS deadline,
       EXTRACT(EPOCH FROM (NOW() - (s.received_at + (sla.report_hours * INTERVAL '1 hour')))) / 3600 AS hours_overdue,
       p.name_encrypted, p.medical_record_number
     FROM pacs.studies s
     JOIN ris.appointments a   ON a.id = s.appointment_id
     JOIN ris.patients p       ON p.id = s.patient_id
     JOIN ris.sla_configs sla  ON sla.priority = a.priority AND sla.modality_type IS NULL
     LEFT JOIN ris.reports r   ON r.study_id = s.id AND r.status NOT IN ('cancelled')
     WHERE s.status = 'complete'
       AND (r.id IS NULL OR r.status IN ('draft','review'))
       AND s.received_at + (sla.report_hours * INTERVAL '1 hour') < NOW()
     ORDER BY hours_overdue DESC
     LIMIT 50`
  );

  const enc = require('../../services/encryption');
  return success(res, rows.map(r => ({
    ...r,
    patient_name: enc.decrypt(r.name_encrypted),
    name_encrypted: undefined,
  })));
});

async function createNotification({ userId, type, title, body, resourceType, resourceId }) {
  try {
    await db.query(
      `INSERT INTO ris.notifications (user_id, type, title, body, resource_type, resource_id, channel, status)
       VALUES ($1,$2,$3,$4,$5,$6,'in_app','sent')`,
      [userId, type, title, body, resourceType || null, resourceId || null]
    );
  } catch (err) {
    // Falha ao notificar não pode derrubar o fluxo que a chamou (best effort)
    const logger = require('../../config/logger');
    logger.error('Falha ao criar notificação', { error: err.message });
  }
}

module.exports = { router, createNotification };
