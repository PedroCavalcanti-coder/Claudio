/**
 * Serviço de Auditoria — LGPD Art. 37 + CFM 1.821/2007
 * Registra toda operação sensível de forma imutável.
 */
const db = require('../config/database');
const logger = require('../config/logger');

const ACTIONS = {
  // Auth
  LOGIN:               'LOGIN',
  LOGOUT:              'LOGOUT',
  LOGIN_FAILED:        'LOGIN_FAILED',
  PASSWORD_CHANGED:    'PASSWORD_CHANGED',
  // Pacientes
  PATIENT_CREATED:     'PATIENT_CREATED',
  PATIENT_VIEWED:      'PATIENT_VIEWED',
  PATIENT_UPDATED:     'PATIENT_UPDATED',
  PATIENT_DELETED:     'PATIENT_DELETED',
  APPOINTMENT_CREATED: 'APPOINTMENT_CREATED',
  // Estudos
  STUDY_VIEWED:        'STUDY_VIEWED',
  STUDY_EXPORTED:      'STUDY_EXPORTED',
  // Laudos
  REPORT_CREATED:      'REPORT_CREATED',
  REPORT_VIEWED:       'REPORT_VIEWED',
  REPORT_SIGNED:       'REPORT_SIGNED',
  REPORT_AMENDED:      'REPORT_AMENDED',
  REPORT_EXPORTED:     'REPORT_EXPORTED',
  // Imagens
  IMAGE_VIEWED:        'IMAGE_VIEWED',
  IMAGE_EXPORTED:      'IMAGE_EXPORTED',
  // Portal externo
  PORTAL_ACCESSED:     'PORTAL_ACCESSED',
  // Check-in
  CHECKIN:              'CHECKIN',
  // Usuários
  USER_CREATED:        'USER_CREATED',
  USER_UPDATED:        'USER_UPDATED',
  USER_DEACTIVATED:    'USER_DEACTIVATED',
  // PEP / Prontuário Eletrônico (EHR)
  EHR_ENCOUNTER_CREATED: 'EHR_ENCOUNTER_CREATED',
  EHR_ENCOUNTER_VIEWED:  'EHR_ENCOUNTER_VIEWED',
  EHR_ENCOUNTER_UPDATED: 'EHR_ENCOUNTER_UPDATED',
  EHR_ENCOUNTER_CLOSED:  'EHR_ENCOUNTER_CLOSED',
  EHR_NOTE_CREATED:      'EHR_NOTE_CREATED',
  EHR_NOTE_VIEWED:       'EHR_NOTE_VIEWED',
  EHR_NOTE_UPDATED:      'EHR_NOTE_UPDATED',
  EHR_NOTE_SIGNED:       'EHR_NOTE_SIGNED',
  EHR_NOTE_AMENDED:      'EHR_NOTE_AMENDED',
  EHR_PROBLEM_CREATED:   'EHR_PROBLEM_CREATED',
  EHR_PROBLEM_UPDATED:   'EHR_PROBLEM_UPDATED',
  EHR_VITALS_RECORDED:   'EHR_VITALS_RECORDED',
  EHR_TIMELINE_VIEWED:   'EHR_TIMELINE_VIEWED',
  EHR_BREAKGLASS:        'EHR_BREAKGLASS',
  // PEP F2/F3
  EHR_ALLERGY_WRITE:     'EHR_ALLERGY_WRITE',
  EHR_MEDICATION_WRITE:  'EHR_MEDICATION_WRITE',
  EHR_HISTORY_WRITE:     'EHR_HISTORY_WRITE',
  EHR_ATTACHMENT_WRITE:  'EHR_ATTACHMENT_WRITE',
  EHR_ATTACHMENT_VIEWED: 'EHR_ATTACHMENT_VIEWED',
  EHR_PRESCRIPTION_SIGNED: 'EHR_PRESCRIPTION_SIGNED',
  EHR_CERTIFICATE_SIGNED:  'EHR_CERTIFICATE_SIGNED',
  EHR_IMMUNIZATION_WRITE:  'EHR_IMMUNIZATION_WRITE',
  EHR_CLINICAL_VIEWED:     'EHR_CLINICAL_VIEWED',
};

/**
 * Registra uma entrada de auditoria.
 * Nunca lança erro — falha silenciosa com log de erro.
 */
async function log({
  userId,
  userEmail,
  userRole,
  action,
  resourceType,
  resourceId,
  ipAddress,
  userAgent,
  details = {},
}) {
  try {
    await db.query(
      `INSERT INTO audit.logs
         (user_id, user_email, user_role, action, resource_type, resource_id,
          ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId     || null,
        userEmail  || null,
        userRole   || null,
        action,
        resourceType || null,
        resourceId   || null,
        ipAddress    || null,
        userAgent    || null,
        JSON.stringify(details),
      ]
    );
  } catch (err) {
    // Auditoria não deve derrubar a requisição
    logger.error('Falha ao registrar auditoria', { action, error: err.message });
  }
}

/**
 * Helper para extrair contexto da requisição Express.
 */
function fromRequest(req) {
  return {
    userId:    req.user?.sub,
    userEmail: req.user?.email,
    userRole:  req.user?.role,
    ipAddress: req.ip || req.headers['x-forwarded-for'],
    userAgent: req.headers['user-agent'],
  };
}

module.exports = { log, fromRequest, ACTIONS };
