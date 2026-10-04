'use strict';
/**
 * Rotas do PEP (montadas em /api/v1/ehr).
 * Guard duplo: requirePermission (RBAC por papel/override) + assertClinicalAccess
 * (vínculo/break-glass, dentro do controller, por ser dependente de dados).
 */
const { Router } = require('express');
const controller = require('./ehr.controller');
const clinical = require('./ehr.clinical.controller');
const flow = require('./ehr.flow.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

const uuid = z.string().uuid('ID inválido');
const cidArr = z.array(z.object({
  code: z.string().max(10), description: z.string().optional(),
})).optional();
const soapBody = z.object({
  subjective: z.string().max(20000).optional(),
  objective:  z.string().max(20000).optional(),
  assessment: z.string().max(20000).optional(),
  plan:       z.string().max(20000).optional(),
  cid10_codes: cidArr,
});
const problemStatus = z.enum(['active', 'resolved', 'inactive']);
const intRange = (max) => z.number().int().min(0).max(max).optional();
const vitalsBody = z.object({
  systolic: intRange(300), diastolic: intRange(200),
  heart_rate: intRange(400), resp_rate: intRange(120),
  spo2: intRange(100), glucose_mgdl: intRange(2000),
  temp_c: z.number().min(20).max(45).optional(),
  weight_kg: z.number().min(0).max(500).optional(),
  height_cm: z.number().min(0).max(300).optional(),
  pain_scale: z.number().int().min(0).max(10).optional(),
  notes: z.string().max(500).optional(),
});

// ── Encounters ───────────────────────────────────────────────────────────────
router.post('/encounters',
  requirePermission('encounter:create'),
  validate({ body: z.object({
    patient_id: uuid,
    encounter_type: z.enum(['ambulatorial', 'urgencia', 'retorno', 'teleconsulta']).optional(),
    chief_complaint: z.string().max(2000).optional(),
    appointment_id: uuid.optional(),
    health_unit_id: uuid.optional(),
  }) }),
  controller.createEncounter);

router.get('/encounters',
  requirePermission('encounter:read'),
  validate({ query: z.object({ patient_id: uuid }) }),
  controller.listEncounters);

router.get('/encounters/:id',
  requirePermission('encounter:read'),
  validate({ params: schemas.uuidParam }),
  controller.getEncounter);

router.patch('/encounters/:id',
  requirePermission('encounter:update'),
  validate({ params: schemas.uuidParam, body: z.object({
    encounter_type: z.enum(['ambulatorial', 'urgencia', 'retorno', 'teleconsulta']).optional(),
    chief_complaint: z.string().max(2000).optional(),
  }) }),
  controller.updateEncounter);

router.post('/encounters/:id/close',
  requirePermission('encounter:close'),
  validate({ params: schemas.uuidParam }),
  controller.closeEncounter);

router.post('/encounters/:id/notes',
  requirePermission('clinical_note:create'),
  validate({ params: schemas.uuidParam, body: soapBody }),
  controller.createNote);

router.post('/encounters/:id/vitals',
  requirePermission('vitals:write'),
  validate({ params: schemas.uuidParam, body: vitalsBody }),
  controller.createVitals);

router.get('/encounters/:id/fhir',
  requirePermission('encounter:read'),
  validate({ params: schemas.uuidParam }),
  controller.exportEncounterFhir);

// ── Clinical notes (evolução SOAP) ───────────────────────────────────────────
router.patch('/clinical-notes/:id',
  requirePermission('clinical_note:update'),
  validate({ params: schemas.uuidParam, body: soapBody }),
  controller.updateNote);

router.post('/clinical-notes/:id/sign',
  requirePermission('clinical_note:sign'),
  validate({ params: schemas.uuidParam }),
  controller.signNote);

router.post('/clinical-notes/:id/amend',
  requirePermission('clinical_note:amend'),
  validate({ params: schemas.uuidParam, body: z.object({ reason: z.string().min(5).max(1000) }) }),
  controller.amendNote);

// Trilha de adendos (versões anteriores assinadas) — imutabilidade rastreável.
router.get('/clinical-notes/:id/versions',
  requirePermission('encounter:read'),
  validate({ params: schemas.uuidParam }),
  controller.listNoteVersions);

router.get('/clinical-notes/:id/pdf',
  requirePermission('clinical_note:read'),
  validate({ params: schemas.uuidParam }),
  controller.downloadNotePdf);

// ── Problemas (CID-10) ───────────────────────────────────────────────────────
router.get('/patients/:id/problems',
  requirePermission('problem:read'),
  validate({ params: schemas.uuidParam }),
  controller.listProblems);

router.post('/problems',
  requirePermission('problem:write'),
  validate({ body: z.object({
    patient_id: uuid,
    title: z.string().min(1).max(200),
    cid10_code: z.string().max(10).optional(),
    status: problemStatus.optional(),
    is_chronic: z.boolean().optional(),
    onset_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().max(2000).optional(),
    encounter_id: uuid.optional(),
  }) }),
  controller.createProblem);

router.patch('/problems/:id',
  requirePermission('problem:write'),
  validate({ params: schemas.uuidParam, body: z.object({
    cid10_code: z.string().max(10).optional(),
    title: z.string().min(1).max(200).optional(),
    status: problemStatus.optional(),
    is_chronic: z.boolean().optional(),
    onset_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    resolved_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().max(2000).optional(),
  }) }),
  controller.updateProblem);

// ── Sinais vitais ────────────────────────────────────────────────────────────
router.get('/patients/:id/vitals',
  requirePermission('vitals:read'),
  validate({ params: schemas.uuidParam }),
  controller.listVitals);

// ── Timeline ─────────────────────────────────────────────────────────────────
router.get('/patients/:id/timeline',
  requirePermission('ehr:timeline'),
  validate({ params: schemas.uuidParam }),
  controller.timeline);

// ── Break-glass ──────────────────────────────────────────────────────────────
router.post('/patients/:id/breakglass',
  requirePermission('ehr:breakglass'),
  validate({ params: schemas.uuidParam, body: z.object({ reason: z.string().min(5).max(1000) }) }),
  controller.breakGlass);

// ── PEP Fase 2/3 ──────────────────────────────────────────────────────────────
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const allergyType = z.enum(['medication', 'food', 'environmental', 'biological', 'other']);
const allergySeverity = z.enum(['mild', 'moderate', 'severe', 'unknown']);
const allergyStatus = z.enum(['active', 'inactive', 'resolved']);
const medStatus = z.enum(['active', 'suspended', 'completed']);
const historyType = z.enum(['personal', 'familial', 'surgical', 'habits', 'gyneco_obstetric', 'allergic', 'other']);

// Alergias
router.get('/patients/:id/allergies',
  requirePermission('allergy:read'), validate({ params: schemas.uuidParam }), clinical.listAllergies);
router.post('/allergies',
  requirePermission('allergy:write'),
  validate({ body: z.object({
    patient_id: uuid, allergen: z.string().min(1).max(200), allergen_type: allergyType.optional(),
    reaction: z.string().max(2000).optional(), severity: allergySeverity.optional(),
    status: allergyStatus.optional(), encounter_id: uuid.optional(),
  }) }), clinical.createAllergy);
router.patch('/allergies/:id',
  requirePermission('allergy:write'),
  validate({ params: schemas.uuidParam, body: z.object({
    allergen: z.string().min(1).max(200).optional(), allergen_type: allergyType.optional(),
    reaction: z.string().max(2000).optional(), severity: allergySeverity.optional(), status: allergyStatus.optional(),
  }) }), clinical.updateAllergy);

// Medicamentos em uso
router.get('/patients/:id/medications',
  requirePermission('medication:read'), validate({ params: schemas.uuidParam }), clinical.listMedications);
router.post('/medications',
  requirePermission('medication:write'),
  validate({ body: z.object({
    patient_id: uuid, name: z.string().min(1).max(200), dose: z.string().max(80).optional(),
    route: z.string().max(40).optional(), frequency: z.string().max(80).optional(),
    status: medStatus.optional(), started_on: dateStr.optional(), ended_on: dateStr.optional(),
    notes: z.string().max(2000).optional(), encounter_id: uuid.optional(),
  }) }), clinical.createMedication);
router.patch('/medications/:id',
  requirePermission('medication:write'),
  validate({ params: schemas.uuidParam, body: z.object({
    name: z.string().min(1).max(200).optional(), dose: z.string().max(80).optional(),
    route: z.string().max(40).optional(), frequency: z.string().max(80).optional(),
    status: medStatus.optional(), started_on: dateStr.optional(), ended_on: dateStr.optional(),
    notes: z.string().max(2000).optional(),
  }) }), clinical.updateMedication);

// Anamnese / antecedentes
router.get('/patients/:id/history',
  requirePermission('history:read'), validate({ params: schemas.uuidParam }), clinical.getHistory);
router.put('/history',
  requirePermission('history:write'),
  validate({ body: z.object({
    patient_id: uuid, history_type: historyType, content: z.string().max(20000).optional(),
  }) }), clinical.upsertHistory);

// Anexos clínicos (multipart)
router.get('/patients/:id/attachments',
  requirePermission('attachment:read'), validate({ params: schemas.uuidParam }), clinical.listAttachments);
router.post('/attachments',
  requirePermission('attachment:write'), upload.single('file'), clinical.uploadAttachment);
router.get('/attachments/:id/download',
  requirePermission('attachment:read'), validate({ params: schemas.uuidParam }), clinical.downloadAttachment);

// Prescrição eletrônica
const rxType = z.enum(['common', 'controlled', 'antimicrobial']);
const rxItem = z.object({
  drug_name: z.string().min(1).max(200), dose: z.string().max(80).optional(),
  route: z.string().max(40).optional(), frequency: z.string().max(80).optional(),
  duration: z.string().max(80).optional(), quantity: z.string().max(80).optional(),
  instructions: z.string().max(500).optional(),
  administer_at_unit: z.boolean().optional(),
});
router.get('/patients/:id/prescriptions',
  requirePermission('prescription:read'), validate({ params: schemas.uuidParam }), clinical.listPrescriptions);
router.post('/prescriptions',
  requirePermission('prescription:write'),
  validate({ body: z.object({
    patient_id: uuid, encounter_id: uuid.optional(), rx_type: rxType.optional(),
    notes: z.string().max(2000).optional(), items: z.array(rxItem).min(1).max(50),
  }) }), clinical.createPrescription);
// Checagem ao vivo de alergia + interação, sem persistir (usada antes de salvar a prescrição).
router.post('/drug-check',
  requirePermission('prescription:read'),
  validate({ body: z.object({
    patient_id: uuid.optional(),
    drug_names: z.array(z.string().max(200)).max(50),
  }) }), clinical.drugCheck);
router.post('/prescriptions/:id/sign',
  requirePermission('prescription:sign'), validate({ params: schemas.uuidParam }), clinical.signPrescription);
router.post('/prescriptions/:id/cancel',
  requirePermission('prescription:write'), validate({ params: schemas.uuidParam }), clinical.cancelPrescription);
router.get('/prescriptions/:id/pdf',
  requirePermission('prescription:read'), validate({ params: schemas.uuidParam }), clinical.downloadPrescriptionPdf);

// Atestados / declarações
const certType = z.enum(['medical_leave', 'attendance', 'fitness', 'other']);
router.get('/patients/:id/certificates',
  requirePermission('certificate:read'), validate({ params: schemas.uuidParam }), clinical.listCertificates);
router.post('/certificates',
  requirePermission('certificate:write'),
  validate({ body: z.object({
    patient_id: uuid, encounter_id: uuid.optional(), cert_type: certType.optional(),
    content: z.string().max(5000).optional(), days_off: z.number().int().min(0).max(365).optional(),
    cid10_code: z.string().max(10).optional(),
  }).refine(
    // Atestado de afastamento (medical_leave, default) ou com dias de afastamento
    // exige CID-10 — necessário para validade e faturamento (INSS/empregador).
    // Declaração de comparecimento (attendance) não carrega diagnóstico.
    (d) => {
      const needsCid = (d.cert_type ?? 'medical_leave') === 'medical_leave' || (d.days_off ?? 0) > 0;
      return !needsCid || !!(d.cid10_code && d.cid10_code.trim());
    },
    { message: 'CID-10 é obrigatório em atestado de afastamento', path: ['cid10_code'] },
  ) }), clinical.createCertificate);
router.post('/certificates/:id/sign',
  requirePermission('certificate:sign'), validate({ params: schemas.uuidParam }), clinical.signCertificate);
router.get('/certificates/:id/pdf',
  requirePermission('certificate:read'), validate({ params: schemas.uuidParam }), clinical.downloadCertificatePdf);

// Imunização
const immStatus = z.enum(['applied', 'scheduled', 'delayed']);
const immBody = {
  vaccine: z.string().min(1).max(120), dose_label: z.string().max(60).optional(),
  lot: z.string().max(60).optional(), manufacturer: z.string().max(120).optional(),
  route: z.string().max(40).optional(), site: z.string().max(40).optional(),
  status: immStatus.optional(), applied_at: z.string().optional(),
  scheduled_for: dateStr.optional(), encounter_id: uuid.optional(), notes: z.string().max(500).optional(),
};
router.get('/patients/:id/immunizations',
  requirePermission('immunization:read'), validate({ params: schemas.uuidParam }), clinical.listImmunizations);
router.post('/immunizations',
  requirePermission('immunization:write'),
  validate({ body: z.object({ patient_id: uuid, ...immBody }) }), clinical.createImmunization);
router.patch('/immunizations/:id',
  requirePermission('immunization:write'),
  validate({ params: schemas.uuidParam, body: z.object(immBody).partial() }), clinical.updateImmunization);

// ── Escalas de enfermagem (Morse=queda / Braden=lesão por pressão) ────────────
const nursingScale = z.enum(['morse', 'braden']);
router.get('/patients/:id/nursing-assessments',
  requirePermission('vitals:read'), validate({ params: schemas.uuidParam }), clinical.listNursingAssessments);
router.post('/nursing-assessments',
  requirePermission('vitals:write'),
  validate({ body: z.object({
    patient_id: uuid, encounter_id: uuid.optional(), scale: nursingScale,
    items: z.record(z.any()).optional(),
    score: z.number().int().min(0).max(200), risk_level: z.string().min(1).max(20),
  }) }), clinical.createNursingAssessment);

// ── SAE — Evolução de enfermagem ──────────────────────────────────────────────
router.get('/patients/:id/nursing-evolutions',
  requirePermission('vitals:read'), validate({ params: schemas.uuidParam }), clinical.listNursingEvolutions);
router.post('/nursing-evolutions',
  requirePermission('vitals:write'),
  validate({ body: z.object({
    patient_id: uuid, encounter_id: uuid.optional(),
    assessment: z.string().max(20000).optional(),
    diagnoses: z.array(z.string().max(200)).max(30).optional(),
    interventions: z.string().max(20000).optional(),
    evaluation: z.string().max(20000).optional(),
  }) }), clinical.createNursingEvolution);

// ── SADT — Solicitação de exames/laboratório ──────────────────────────────────
const svcItem = z.object({
  exam_name: z.string().min(1).max(200), code: z.string().max(40).optional(), notes: z.string().max(500).optional(),
});
router.get('/patients/:id/service-requests',
  requirePermission('service_request:read'), validate({ params: schemas.uuidParam }), clinical.listServiceRequests);
router.post('/service-requests',
  requirePermission('service_request:write'),
  validate({ body: z.object({
    patient_id: uuid, encounter_id: uuid.optional(),
    request_type: z.enum(['lab', 'imaging', 'other']).optional(),
    priority: z.enum(['routine', 'urgent']).optional(),
    clinical_indication: z.string().max(2000).optional(),
    items: z.array(svcItem).min(1).max(50),
  }) }), clinical.createServiceRequest);
router.patch('/service-requests/:id/status',
  requirePermission('service_request:write'),
  validate({ params: schemas.uuidParam, body: z.object({
    status: z.enum(['requested', 'in_progress', 'completed', 'cancelled']),
  }) }), clinical.updateServiceRequestStatus);

// ── Farmacovigilância — evento adverso / RAM ──────────────────────────────────
router.get('/patients/:id/adverse-events',
  requirePermission('adverse_event:read'), validate({ params: schemas.uuidParam }), clinical.listAdverseEvents);
router.post('/adverse-events',
  requirePermission('adverse_event:write'),
  validate({ body: z.object({
    patient_id: uuid, encounter_id: uuid.optional(),
    event_type: z.enum(['adverse_drug_reaction', 'allergy', 'medication_error', 'other']).optional(),
    suspected_drug: z.string().max(200).optional(),
    description: z.string().max(5000).optional(),
    severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']).optional(),
    outcome: z.enum(['recovered', 'recovering', 'sequelae', 'death', 'unknown']).optional(),
  }) }), clinical.createAdverseEvent);

// ── Fluxo de atendimento (recepção→triagem→clínico→medicação) ─────────────────
const flowStage = z.enum(['reception', 'triage', 'waiting_doctor', 'in_consultation', 'medication', 'completed', 'cancelled']);
const adminStatus = z.enum(['administered', 'refused', 'not_administered']);

router.post('/episodes',
  requirePermission('episode:manage'),
  validate({ body: z.object({
    patient_id: uuid.optional(),
    cpf: z.string().max(20).optional(), cns: schemas.cns.optional(),
    name: z.string().max(200).optional(), gender: z.enum(['M', 'F', 'O']).optional(),
    encounter_type: z.enum(['ambulatorial', 'urgencia', 'retorno', 'teleconsulta']).optional(),
    chief_complaint: z.string().max(2000).optional(), health_unit_id: uuid.optional(),
  }) }), flow.startEpisode);

const triageBody = vitalsBody.extend({
  manchester_level: z.enum(['red', 'orange', 'yellow', 'green', 'blue']).optional(),
});
router.post('/encounters/:id/triage',
  requirePermission('vitals:write'),
  validate({ params: schemas.uuidParam, body: triageBody }), flow.recordTriage);

router.post('/encounters/:id/advance',
  requirePermission('episode:manage'),
  validate({ params: schemas.uuidParam, body: z.object({ stage: flowStage }) }), flow.advanceEpisode);

router.get('/queue',
  requirePermission('episode:manage'),
  validate({ query: z.object({ health_unit_id: uuid.optional(), stage: flowStage.optional() }) }), flow.queue);

router.post('/queue/call-next',
  requirePermission('episode:manage'),
  validate({ body: z.object({ health_unit_id: uuid.optional(), room_label: z.string().max(40).optional() }) }),
  flow.callNext);

// Painel público de chamada (TV) — qualquer funcionário interno, nunca paciente.
router.get('/panel',
  requirePermission('panel:view'),
  validate({ query: z.object({ health_unit_id: uuid.optional() }) }), flow.panel);

router.get('/medication-queue',
  requirePermission('medication:administer'),
  validate({ query: z.object({ health_unit_id: uuid.optional() }) }), flow.medicationQueue);

// Aprazamento (horários da dose) + doses de hoje (com alerta de atraso no cliente)
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Horário HH:MM');
router.patch('/prescription-items/:id/schedule',
  requirePermission('medication:administer'),
  validate({ params: schemas.uuidParam, body: z.object({ times: z.array(hhmm).max(24) }) }), flow.setItemSchedule);
router.get('/medication-schedule',
  requirePermission('medication:administer'),
  validate({ query: z.object({ health_unit_id: uuid.optional() }) }), flow.medicationSchedule);

router.post('/medication-administrations',
  requirePermission('medication:administer'),
  validate({ body: z.object({
    patient_id: uuid, drug_name: z.string().min(1).max(200),
    prescription_item_id: uuid.optional(), encounter_id: uuid.optional(),
    dose: z.string().max(80).optional(), route: z.string().max(40).optional(),
    site: z.string().max(40).optional(), status: adminStatus.optional(),
    refusal_reason: z.enum(flow.REFUSAL_REASONS).optional(), notes: z.string().max(500).optional(),
    patient_verified: z.boolean().optional(),  // "5 certos" — identidade conferida
  }).refine(
    // Não administrado/recusado exige motivo estruturado (auditoria).
    (d) => d.status !== 'refused' && d.status !== 'not_administered' ? true : !!d.refusal_reason,
    { message: 'Informe o motivo da não-administração', path: ['refusal_reason'] },
  ) }), flow.administerMedication);

router.get('/patients/:id/medication-administrations',
  requirePermission('medication:read'),
  validate({ params: schemas.uuidParam }), flow.listAdministrations);

module.exports = router;
