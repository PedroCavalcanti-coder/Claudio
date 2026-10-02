'use strict';

/**
 * Bull Queue para envio de e-mails transacionais.
 *
 * Produtor: services/notifications.js#notify() → addEmailJob()
 * Consumidor: este arquivo (worker embutido — mesmo processo do API).
 * Quando crescer, mover pra container separado e expor só addEmailJob().
 */

const Bull       = require('bull');
const env        = require('../config/env');
const logger     = require('../config/logger');
const db         = require('../config/database');
const { render } = require('../templates/email/render');
const { sendEmail } = require('../services/email');
const audit      = require('../services/audit');
const { buildICS } = require('../utils/ics');

const QUEUE_NAME = 'email-transactional';

// Bull aceita a URL de Redis direto. Mantém defaults conservadores.
const queue = new Bull(QUEUE_NAME, env.REDIS_URL, {
  defaultJobOptions: {
    attempts: 4,                          // 1 imediata + 3 retries
    backoff:  { type: 'exponential', delay: 60_000 },  // 1min, 2min, 4min, 8min
    removeOnComplete: 200,                // mantém últimos 200 sucessos pra inspeção
    removeOnFail:     500,                // mantém últimos 500 falhas
  },
});

queue.on('error',  (err) => logger.error('[emailQueue] error', { message: err.message }));
queue.on('failed', (job, err) => {
  logger.warn('[emailQueue] job falhou', {
    notificationId: job?.data?.notificationId,
    eventType:      job?.data?.eventType,
    attempt:        job?.attemptsMade,
    maxAttempts:    job?.opts?.attempts,
    message:        err?.message,
  });
});

// ── Produtor ────────────────────────────────────────────────────────────────
async function addEmailJob(payload) {
  await queue.add(payload);
}

// ── Consumidor ──────────────────────────────────────────────────────────────
queue.process(async (job) => {
  const {
    notificationId, eventType, template, templateData,
    recipientEmail, resourceType, resourceId,
  } = job.data;

  // Marca tentativa
  await db.query(
    `UPDATE ris.notifications
        SET retry_count = $2,
            next_retry_at = NULL
      WHERE id = $1`,
    [notificationId, job.attemptsMade]
  );

  let result;
  try {
    const { subject, html, text } = render(template, templateData);

    // .ics anexo só para appointment.created
    const attachments = [];
    if (eventType === 'appointment.created' && templateData?.appointment?.scheduled_at) {
      const ics = buildICS({
        uid:             templateData.appointment.id,
        startsAt:        templateData.appointment.scheduled_at,
        durationMinutes: templateData.appointment.duration_minutes || 30,
        title:           `${templateData.procedure?.name || 'Exame'} — ${templateData.clinic?.name || ''}`.trim(),
        description:     `Paciente: ${templateData.patient?.name}\\nProntuário: ${templateData.patient?.medical_record_number || '—'}`,
        location:        templateData.clinic?.address || '',
      });
      attachments.push({
        filename:    'agendamento.ics',
        content:     Buffer.from(ics).toString('base64'),
        contentType: 'text/calendar',
      });
    }

    result = await sendEmail({
      to:       recipientEmail,
      subject,
      html,
      text,
      attachments: attachments.length ? attachments : undefined,
    });
  } catch (err) {
    // Erros 4xx malformados — não retry
    if (err?.statusCode >= 400 && err?.statusCode < 500 && err?.statusCode !== 429) {
      await db.query(
        `UPDATE ris.notifications
            SET status = 'failed', error_message = $2
          WHERE id = $1`,
        [notificationId, err.message]
      );
      logger.error('[emailQueue] erro terminal (4xx) — não retentado', {
        notificationId, eventType, status: err.statusCode, message: err.message,
      });
      return; // não relança → não retenta
    }
    // 5xx/timeout/etc — deixa Bull retentar
    throw err;
  }

  // Sucesso — atualiza notificação + audit
  await db.query(
    `UPDATE ris.notifications
        SET status = 'sent',
            sent_at = NOW(),
            provider_message_id = $2,
            error_message = NULL
      WHERE id = $1`,
    [notificationId, result?.id ?? null]
  );

  await audit.log({
    userId:       null,
    userRole:     'system',
    action:       'EMAIL_SENT',
    resourceType,
    resourceId,
    details: { type: eventType, provider_message_id: result?.id, to: recipientEmail },
  }).catch(() => { /* audit best effort */ });

  logger.info('[emailQueue] enviado', { notificationId, eventType, providerId: result?.id });
});

// ── Fail-final hook: quando esgota attempts, marca notification como failed ─
queue.on('failed', async (job, err) => {
  if (job.attemptsMade >= (job.opts?.attempts || 1)) {
    try {
      await db.query(
        `UPDATE ris.notifications
            SET status = 'failed',
                error_message = $2,
                retry_count = $3
          WHERE id = $1
            AND status = 'pending'`,
        [job.data.notificationId, err.message, job.attemptsMade]
      );
    } catch (e) { /* swallow */ }
  }
});

async function shutdown() {
  await queue.close();
}

module.exports = { addEmailJob, queue, shutdown };
