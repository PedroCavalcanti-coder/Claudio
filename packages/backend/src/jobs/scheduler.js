'use strict';
/**
 * Idempotência dos ticks: lembrete usa ris.appointment_reminders (1 linha 'email'
 * por agendamento); SLA usa ris.notifications (1 'SLA_OVERDUE' por estudo).
 * Os ticks são exportados separadamente para permitir teste direto.
 */
const db        = require('../config/database');
const logger    = require('../config/logger');
const { notify } = require('../services/notifications');
const { createNotification } = require('../modules/notifications/notifications.routes');
const uploadSession = require('../services/uploadSession');
const { sweepOrthanc } = require('../services/dicomIngest');
const mwl = require('../services/mwl.service');

async function reminderTick() {
  const { rows } = await db.query(
    `SELECT a.id
       FROM ris.appointments a
      WHERE a.status IN ('scheduled','confirmed')
        AND a.scheduled_at BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM ris.appointment_reminders r
           WHERE r.appointment_id = a.id AND r.channel = 'email'
        )
      LIMIT 200`
  );
  let sent = 0;
  for (const { id } of rows) {
    try {
      await notify('appointment.reminder', { appointmentId: id });
      await db.query(
        `INSERT INTO ris.appointment_reminders (appointment_id, channel, sent_at, status)
         VALUES ($1, 'email', NOW(), 'sent')`,
        [id]
      );
      sent++;
    } catch (err) {
      logger.error('[scheduler] falha ao enfileirar lembrete', { appointmentId: id, error: err.message });
    }
  }
  if (sent) logger.info('[scheduler] lembretes enfileirados', { sent });
  return sent;
}

async function slaTick() {
  const { rows } = await db.query(
    `SELECT s.id AS study_id, s.health_unit_id,
            EXTRACT(EPOCH FROM (NOW() - (s.received_at + (sla.report_hours * INTERVAL '1 hour')))) / 3600 AS hours_overdue,
            proc.name AS procedure_name
       FROM pacs.studies s
       JOIN ris.appointments a   ON a.id = s.appointment_id
       JOIN ris.sla_configs sla  ON sla.priority = a.priority AND sla.modality_type IS NULL
       LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id
       LEFT JOIN ris.reports r   ON r.study_id = s.id AND r.status NOT IN ('cancelled')
      WHERE s.status = 'complete'
        AND (r.id IS NULL OR r.status IN ('draft','review'))
        AND s.received_at + (sla.report_hours * INTERVAL '1 hour') < NOW()
        AND NOT EXISTS (
          SELECT 1 FROM ris.notifications n
           WHERE n.type = 'SLA_OVERDUE' AND n.resource_id = s.id
        )
      ORDER BY hours_overdue DESC
      LIMIT 100`
  );

  let notified = 0;
  for (const row of rows) {
    // Destinatários: radiologistas ativos da unidade do estudo; se nenhum, admins.
    let recipients = [];
    if (row.health_unit_id) {
      const { rows: rads } = await db.query(
        `SELECT id FROM auth.users WHERE role='radiologist' AND is_active=TRUE AND health_unit_id=$1`,
        [row.health_unit_id]
      );
      recipients = rads.map(r => r.id);
    }
    if (!recipients.length) {
      const { rows: admins } = await db.query(`SELECT id FROM auth.users WHERE role='admin' AND is_active=TRUE`);
      recipients = admins.map(r => r.id);
    }
    const horas = Math.round(row.hours_overdue);
    for (const userId of recipients) {
      await createNotification({
        userId,
        type:         'SLA_OVERDUE',
        title:        'Laudo atrasado (SLA)',
        body:         `O laudo de ${row.procedure_name || 'exame'} está ${horas}h além do prazo.`,
        resourceType: 'study',
        resourceId:   row.study_id,
      });
    }
    if (recipients.length) notified++;
  }
  if (notified) logger.info('[scheduler] alertas de SLA emitidos', { studies: notified });
  return notified;
}

function startSchedulers() {
  const REMINDER_MS = 15 * 60 * 1000;
  const SLA_MS      = 30 * 60 * 1000;
  const SWEEP_MS    = 60 * 60 * 1000;

  const safe = (fn, name) => () => fn().catch(err =>
    logger.error(`[scheduler] ${name} falhou`, { error: err.message })
  );

  // Primeira execução após 1 min (deixa a API estabilizar), depois no intervalo.
  setTimeout(safe(reminderTick, 'reminderTick'), 60_000);
  setTimeout(safe(slaTick, 'slaTick'),           90_000);
  setInterval(safe(reminderTick, 'reminderTick'), REMINDER_MS);
  setInterval(safe(slaTick, 'slaTick'),           SLA_MS);

  // Limpa diretórios de upload em blocos abandonados (sessões nunca finalizadas).
  setTimeout(safe(uploadSession.sweepStale, 'uploadSweep'), 120_000);
  setInterval(safe(uploadSession.sweepStale, 'uploadSweep'), SWEEP_MS);

  // Rede de segurança do C-STORE: estudos que estão no Orthanc mas o webhook perdeu
  // (backend fora do ar no momento em que o estudo ficou estável).
  const ORTHANC_SWEEP_MS = 10 * 60 * 1000;
  setTimeout(safe(sweepOrthanc, 'orthancSweep'), 45_000);
  setInterval(safe(sweepOrthanc, 'orthancSweep'), ORTHANC_SWEEP_MS);

  setTimeout(safe(mwl.cleanupWorklists, 'mwlCleanup'), 150_000);
  setInterval(safe(mwl.cleanupWorklists, 'mwlCleanup'), SWEEP_MS);

  logger.info('⏰ Schedulers iniciados (lembretes 15min · SLA 30min · upload-sweep 1h · orthanc-sweep 10min)');
}

module.exports = { startSchedulers, reminderTick, slaTick };
