const { Router } = require('express');
const controller = require('./appointments.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(authenticate);

// Base (ZodObject) — reusada com .refine no create e .partial no update.
const appointmentBase = z.object({
  patient_id:              z.string().uuid(),
  appointment_kind:        z.enum(['imaging', 'consultation', 'teleconsultation']).default('imaging'),
  // Imagem: procedimento obrigatório (validado no refine). Clínico: omitido.
  procedure_id:            z.string().uuid().optional(),
  modality_id:             z.string().uuid().optional(),
  room_id:                 z.string().uuid().optional(),
  requesting_user_id:      z.string().uuid().optional(),
  requesting_physician_id: z.string().uuid().optional(),
  // Médico interno designado. Opcional p/ imagem (auto-plantonista); para consulta
  // é obrigatório (validado no controller). Recepção pode sobrescrever.
  assigned_doctor_id:      z.string().uuid().optional(),
  specialty:               z.string().max(80).optional(),
  reason:                  z.string().max(2000).optional(),
  scheduled_at:            z.string().datetime(),
  duration_minutes:        z.number().int().min(5).max(480).default(30),
  priority:                z.number().int().min(0).max(2).default(0),
  clinical_indication:     z.string().optional(),
  notes:                   z.string().optional(),
  // Encaixe: permite sobrepor outra consulta do mesmo médico (decisão explícita da recepção)
  allow_overbooking:       z.boolean().optional(),
});
const appointmentSchema = appointmentBase.refine(
  (d) => d.appointment_kind !== 'imaging' || !!d.procedure_id,
  { message: 'Procedimento é obrigatório para exame de imagem', path: ['procedure_id'] },
);

// Atendimento avulso (walk-in) — sem agendamento prévio; entra já em check-in.
const walkInSchema = z.object({
  patient_id:          z.string().uuid(),
  procedure_id:        z.string().uuid(),
  modality_id:         z.string().uuid().optional(),
  room_id:             z.string().uuid().optional(),
  duration_minutes:    z.number().int().min(5).max(480).optional(),
  priority:            z.number().int().min(0).max(2).optional(),
  clinical_indication: z.string().optional(),
  notes:               z.string().optional(),
});

const listSchema = z.object({
  date:        schemas.date.optional(),
  date_from:   schemas.date.optional(),
  date_to:     schemas.date.optional(),
  status:      z.enum(['scheduled','confirmed','checked_in','in_progress','done','cancelled','no_show']).optional(),
  modality_id: z.string().uuid().optional(),
  patient_id:  z.string().uuid().optional(),
  page:        schemas.page,
  limit:       schemas.limit,
});

router.get('/',    requirePermission('appointments:read'), validate({ query: listSchema }),                      controller.list);
router.get('/worklist', requirePermission('worklist:read'), controller.worklist);
router.get('/:id', requirePermission('appointments:read'), validate({ params: schemas.uuidParam }),                           controller.getById);
router.post('/',   requirePermission('appointments:create'), validate({ body: appointmentSchema }),                             controller.create);
router.post('/walk-in', requirePermission('appointments:walkin'), validate({ body: walkInSchema }),        controller.createWalkIn);
router.patch('/:id', requirePermission('appointments:update'), validate({ params: schemas.uuidParam, body: appointmentBase.partial() }), controller.update);
// Check-in: confirma a IDENTIDADE (CPF, CNS ou documento com foto conferido). Não cria conta do portal.
const checkinSchema = z.object({
  identity_verified_by: z.enum(['cpf', 'cns', 'document']).optional(),
  cpf:   schemas.cpf.optional(),
  cns:   schemas.cns.optional(),
  document_verified: z.boolean().optional(),
  terms_accepted:    z.boolean().optional(),
  password: z.any().optional(),   // legado (clientes antigos): ignorado — o portal tem fluxo próprio
});
router.patch('/:id/checkin', requirePermission('appointments:checkin'), validate({ params: schemas.uuidParam, body: checkinSchema }), controller.checkIn);
router.patch('/:id/cancel',  requirePermission('appointments:cancel'), validate({ params: schemas.uuidParam, body: z.object({ reason: z.string().min(3) }) }), controller.cancel);

// Status do agendamento — acessível a todos os perfis autenticados (paciente usa portal-patient)
router.get('/:id/status', validate({ params: schemas.uuidParam }), controller.getStatus);

module.exports = router;
