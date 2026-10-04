'use strict';

/**
 * Serviço de Notificações Transacionais
 * --------------------------------------------------------------------
 * Ponto único pra disparar eventos de notificação. Não envia email
 * diretamente — registra em `ris.notifications` + enfileira no Bull.
 * O worker em queues/emailQueue.js consome e chama services/email.js.
 *
 * Uso:
 *   await notify('patient.created',        { patientId })
 *   await notify('appointment.created',    { appointmentId })
 *   await notify('appointment.checked_in', { appointmentId })
 *   await notify('study.processed',        { studyId })            // pra paciente
 *   await notify('study.images_ready',     { studyId })            // pra médico solicitante
 *   await notify('report.signed',          { reportId })           // ×2: paciente + médico
 */

const db       = require('../config/database');
const enc      = require('./encryption');
const logger   = require('../config/logger');
const jwt      = require('jsonwebtoken');
const env      = require('../config/env');
const { addEmailJob } = require('../queues/emailQueue');

// ── Tipos de evento permitidos ──────────────────────────────────────────────
const EVENT_TYPES = Object.freeze({
  PATIENT_CREATED:         'patient.created',
  APPOINTMENT_CREATED:     'appointment.created',
  APPOINTMENT_CHECKED_IN:  'appointment.checked_in',
  APPOINTMENT_REMINDER:    'appointment.reminder',       // lembrete ~24h antes
  STUDY_PROCESSED:         'study.processed',           // paciente — exame processado
  STUDY_IMAGES_READY:      'study.images_ready',        // médico — imagens disponíveis
  REPORT_SIGNED:           'report.signed',             // paciente
  REPORT_SIGNED_PHYSICIAN: 'report.signed.physician',   // médico
});

const TEMPLATE_BY_TYPE = {
  'patient.created':         'patient_created',
  'appointment.created':     'appointment_created',
  'appointment.checked_in':  'appointment_checked_in',
  'appointment.reminder':    'appointment_reminder',
  'study.processed':         'study_processed',
  'study.images_ready':      'study_images_ready',
  'report.signed':           'report_signed_patient',
  'report.signed.physician': 'report_signed_physician',
};

const RESOURCE_BY_TYPE = {
  'patient.created':         'patient',
  'appointment.created':     'appointment',
  'appointment.checked_in':  'appointment',
  'appointment.reminder':    'appointment',
  'study.processed':         'study',
  'study.images_ready':      'study',
  'report.signed':           'report',
  'report.signed.physician': 'report',
};

const FRONTEND_URL = env.FRONTEND_URL || 'http://localhost';

// ── Magic link JWT (24h) pro portal/viewer ──────────────────────────────────
function signMagicToken(payload) {
  return jwt.sign(payload, env.JWT_PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: '24h',
  });
}

// ── Carregadores de dados por evento ────────────────────────────────────────

async function loadPatientCreatedData(patientId) {
  const { rows } = await db.query(
    `SELECT p.id, p.medical_record_number, p.name_encrypted, p.email_encrypted,
            ppa.email_opt_out
       FROM ris.patients p
  LEFT JOIN ris.patient_portal_accounts ppa ON ppa.patient_id = p.id
      WHERE p.id = $1`,
    [patientId]
  );
  if (!rows.length) return null;
  const p = rows[0];
  const email = p.email_encrypted ? enc.safeDecrypt(p.email_encrypted, null) : null;
  return {
    recipientEmail: email,
    optedOut:       p.email_opt_out === true,
    templateData: {
      patient: {
        name:                   enc.safeDecrypt(p.name_encrypted),
        medical_record_number:  p.medical_record_number,
      },
      portal: {
        login_url: `${FRONTEND_URL}/login_paciente`,
      },
    },
  };
}

async function loadAppointmentData(appointmentId) {
  const { rows } = await db.query(
    `SELECT a.id, a.scheduled_at, a.duration_minutes, a.clinical_indication,
            a.checked_in_at,
            p.name_encrypted, p.email_encrypted, p.medical_record_number,
            ppa.email_opt_out,
            proc.name AS procedure_name, proc.preparation_instructions,
            r.name    AS room_name,
            hu.name   AS clinic_name, hu.address AS clinic_address
       FROM ris.appointments a
       JOIN ris.patients p     ON p.id = a.patient_id
  LEFT JOIN ris.patient_portal_accounts ppa ON ppa.patient_id = p.id
  LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id
  LEFT JOIN ris.rooms r         ON r.id = a.room_id
  LEFT JOIN ris.health_units hu ON hu.id = a.health_unit_id
      WHERE a.id = $1`,
    [appointmentId]
  );
  if (!rows.length) return null;
  const a = rows[0];
  return {
    recipientEmail: a.email_encrypted ? enc.safeDecrypt(a.email_encrypted, null) : null,
    optedOut:       a.email_opt_out === true,
    raw: a,
    templateData: {
      patient: {
        name:                  enc.safeDecrypt(a.name_encrypted),
        medical_record_number: a.medical_record_number,
      },
      appointment: {
        id:               a.id,
        scheduled_at:     a.scheduled_at,
        scheduled_date_br: a.scheduled_at
          ? new Date(a.scheduled_at).toLocaleDateString('pt-BR')
          : '',
        scheduled_time_br: a.scheduled_at
          ? new Date(a.scheduled_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          : '',
        duration_minutes: a.duration_minutes,
        checked_in_at:    a.checked_in_at,
        checkin_time_br:  a.checked_in_at
          ? new Date(a.checked_in_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          : '',
        clinical_indication: a.clinical_indication,
      },
      procedure: {
        name:                     a.procedure_name,
        preparation_instructions: a.preparation_instructions,
      },
      room:   { name: a.room_name },
      clinic: { name: a.clinic_name || 'Clínica',
                address: a.clinic_address || '' },
      portal: { status_url: `${FRONTEND_URL}/portal_do_paciente` },
    },
  };
}

async function loadStudyData(studyId) {
  const { rows } = await db.query(
    `SELECT s.id, s.study_date, s.study_instance_uid, s.accession_number,
            s.modality_type,
            p.id AS patient_id, p.name_encrypted AS p_name, p.email_encrypted AS p_email,
            p.medical_record_number,
            ppa.email_opt_out AS p_opt_out,
            a.id AS appointment_id,
            ep.id    AS phys_id,
            ep.name  AS phys_name,
            ep.email AS phys_email,
            ep.email_opt_out AS phys_opt_out,
            proc.name AS procedure_name
       FROM pacs.studies s
       JOIN ris.patients p ON p.id = s.patient_id
  LEFT JOIN ris.patient_portal_accounts ppa ON ppa.patient_id = p.id
  LEFT JOIN ris.appointments a              ON a.id = s.appointment_id
  LEFT JOIN ris.external_physicians ep      ON ep.id = a.requesting_physician_id
  LEFT JOIN ris.procedures proc             ON proc.id = a.procedure_id
      WHERE s.id = $1`,
    [studyId]
  );
  if (!rows.length) return null;
  const s = rows[0];
  return {
    patientEmail:   s.p_email ? enc.safeDecrypt(s.p_email, null) : null,
    patientOptOut:  s.p_opt_out === true,
    physicianEmail: s.phys_email || null,
    physicianOptOut:s.phys_opt_out === true,
    raw: s,
    templateData: {
      patient: {
        name:                  enc.safeDecrypt(s.p_name),
        medical_record_number: s.medical_record_number,
      },
      physician: { name: s.phys_name },
      study: {
        id:               s.id,
        accession_number: s.accession_number,
        modality:         s.modality_type,
        date_br:          s.study_date ? new Date(s.study_date).toLocaleDateString('pt-BR') : '',
      },
      procedure: { name: s.procedure_name },
      viewer: {
        link: `${FRONTEND_URL}/viewer/${encodeURIComponent(s.study_instance_uid)}?mt=${signMagicToken({ studyId: s.id, kind: 'viewer' })}`,
      },
      portal: { exams_url: `${FRONTEND_URL}/portal_do_paciente` },
    },
  };
}

async function loadReportData(reportId) {
  const { rows } = await db.query(
    `SELECT r.id, r.status, r.signed_at,
            u.name AS radiologist_name,
            s.id AS study_id, s.study_instance_uid, s.accession_number, s.modality_type,
            p.name_encrypted AS p_name, p.email_encrypted AS p_email, p.medical_record_number,
            ppa.email_opt_out AS p_opt_out,
            ep.name AS phys_name, ep.email AS phys_email, ep.email_opt_out AS phys_opt_out,
            proc.name AS procedure_name
       FROM ris.reports r
       JOIN pacs.studies s ON s.id = r.study_id
       JOIN ris.patients p ON p.id = s.patient_id
  LEFT JOIN ris.patient_portal_accounts ppa ON ppa.patient_id = p.id
  LEFT JOIN auth.users u ON u.id = r.radiologist_id
  LEFT JOIN ris.appointments a ON a.id = s.appointment_id
  LEFT JOIN ris.external_physicians ep ON ep.id = a.requesting_physician_id
  LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id
      WHERE r.id = $1`,
    [reportId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    patientEmail:    r.p_email ? enc.safeDecrypt(r.p_email, null) : null,
    patientOptOut:   r.p_opt_out === true,
    physicianEmail:  r.phys_email || null,
    physicianOptOut: r.phys_opt_out === true,
    raw: r,
    templateData: {
      patient: {
        name:                  enc.safeDecrypt(r.p_name),
        medical_record_number: r.medical_record_number,
      },
      physician:    { name: r.phys_name },
      radiologist:  { name: r.radiologist_name },
      report: {
        signed_at:    r.signed_at,
        signed_at_br: r.signed_at
          ? new Date(r.signed_at).toLocaleDateString('pt-BR') + ' às ' +
            new Date(r.signed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          : '',
      },
      procedure: { name: r.procedure_name },
      portal: {
        report_url: `${FRONTEND_URL}/portal_do_paciente?report=${r.id}&mt=${signMagicToken({ reportId: r.id, kind: 'report' })}`,
      },
    },
  };
}

// ── notify() — ponto de entrada único ───────────────────────────────────────
async function notify(eventType, data = {}) {
  try {
    const template = TEMPLATE_BY_TYPE[eventType];
    const resType  = RESOURCE_BY_TYPE[eventType];
    if (!template || !resType) {
      logger.warn('[notify] tipo desconhecido', { eventType });
      return;
    }

    let recipientEmail = null;
    let optedOut       = false;
    let resourceId     = null;
    let templateData   = null;

    if (eventType === 'patient.created') {
      const d = await loadPatientCreatedData(data.patientId);
      if (!d) return;
      recipientEmail = d.recipientEmail; optedOut = d.optedOut;
      resourceId = data.patientId;       templateData = d.templateData;
    } else if (eventType === 'appointment.created' || eventType === 'appointment.checked_in' || eventType === 'appointment.reminder') {
      const d = await loadAppointmentData(data.appointmentId);
      if (!d) return;
      recipientEmail = d.recipientEmail; optedOut = d.optedOut;
      resourceId = data.appointmentId;   templateData = d.templateData;
    } else if (eventType === 'study.processed') {
      const d = await loadStudyData(data.studyId);
      if (!d) return;
      recipientEmail = d.patientEmail;   optedOut = d.patientOptOut;
      resourceId = data.studyId;         templateData = d.templateData;
    } else if (eventType === 'study.images_ready') {
      const d = await loadStudyData(data.studyId);
      if (!d) return;
      recipientEmail = d.physicianEmail; optedOut = d.physicianOptOut;
      resourceId = data.studyId;         templateData = d.templateData;
    } else if (eventType === 'report.signed') {
      const d = await loadReportData(data.reportId);
      if (!d) return;
      recipientEmail = d.patientEmail;   optedOut = d.patientOptOut;
      resourceId = data.reportId;        templateData = d.templateData;
    } else if (eventType === 'report.signed.physician') {
      const d = await loadReportData(data.reportId);
      if (!d) return;
      recipientEmail = d.physicianEmail; optedOut = d.physicianOptOut;
      resourceId = data.reportId;        templateData = d.templateData;
    }

    if (!recipientEmail) {
      logger.info('[notify] sem email do destinatário — skipando', { eventType, resourceId });
      return;
    }
    if (optedOut) {
      logger.info('[notify] destinatário com opt-out — skipando', { eventType, resourceId });
      return;
    }

    // Idempotência: tenta inserir; índice único bloqueia duplicata ativa
    const { rows, rowCount } = await db.query(
      `INSERT INTO ris.notifications
         (type, resource_type, resource_id, channel, status,
          title, body, recipient_email_encrypted, created_at)
       VALUES ($1, $2, $3, 'email', 'pending', $4, $5, $6, NOW())
       ON CONFLICT (type, resource_type, resource_id, channel)
         WHERE status IN ('pending','sent')
         DO NOTHING
       RETURNING id`,
      [
        eventType, resType, resourceId,
        `[${eventType}]`,                    // title placeholder — renderizado pelo worker
        eventType,                            // body placeholder
        enc.encrypt(recipientEmail),
      ]
    );

    if (!rowCount) {
      logger.info('[notify] notificação já existia (idempotência)', { eventType, resourceId });
      return;
    }

    const notificationId = rows[0].id;

    // Enfileira para o worker — passamos só o ID; worker recarrega dados.
    await addEmailJob({
      notificationId,
      eventType,
      template,
      templateData,
      recipientEmail,
      resourceType: resType,
      resourceId,
    });

    logger.info('[notify] enfileirado', { eventType, resourceId, notificationId });
  } catch (err) {
    // Falha de notify() NUNCA propaga — não pode quebrar fluxo clínico.
    logger.error('[notify] falha (não fatal)', { eventType, error: err.message, stack: err.stack });
  }
}

module.exports = { notify, EVENT_TYPES };
