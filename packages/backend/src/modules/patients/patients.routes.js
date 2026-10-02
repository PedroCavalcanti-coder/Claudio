const { Router } = require('express');
const controller = require('./patients.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(authenticate);

// Schema de criação/atualização.
// CPF e CNS são ambos opcionais, mas exige-se PELO MENOS UM identificador
// (rede pública: há pacientes sem CPF). Validação reforçada pelo .refine abaixo.
const patientBase = z.object({
  name:              z.string().min(3).max(200),
  birth_date:        schemas.date,
  gender:            z.enum(['M','F','O']),
  cpf:               schemas.cpf.optional(),
  cns:               schemas.cns.optional(),
  rg:                z.string().optional(),
  phone:             schemas.phone.optional(),
  email:             schemas.email.optional(),
  blood_type:        z.string().max(3).optional(),
  allergies:         z.string().optional(),
  notes:             z.string().optional(),
  // Aceite dos Termos/LGPD marcado no cadastro (registrado na auditoria).
  terms_accepted:    z.boolean().optional(),
  address: z.object({
    street:       z.string().optional(),
    number:       z.string().optional(),
    complement:   z.string().optional(),
    neighborhood: z.string().optional(),
    city:         z.string().optional(),
    state:        z.string().length(2).optional(),
    zip:          z.string().regex(/^\d{8}$|^\d{5}-\d{3}$/).optional(),
  }).optional(),
  appointment: z.object({
    procedure_id:            z.string().uuid(),
    scheduled_at:            z.string().datetime(),
    modality_id:             z.string().uuid().optional(),
    room_id:                 z.string().uuid().optional(),
    duration_minutes:        z.number().int().min(5).max(480).optional(),
    priority:                z.number().int().min(0).max(2).optional(),
    requesting_user_id:      z.string().uuid().optional(),
    requesting_physician_id: z.string().uuid().optional(),
    clinical_indication:     z.string().optional(),
    notes:                   z.string().optional(),
  }).optional(),
});

const patientSchema = patientBase.refine(d => !!d.cpf || !!d.cns, {
  message: 'Informe ao menos um identificador: CPF ou CNS',
  path: ['cpf'],
});

const listSchema = z.object({
  q:                z.string().optional(),           // nome (parcial c/ data), CPF ou CNS
  birth_date:       schemas.date.optional(),         // filtra/limita busca por nome parcial
  page:             schemas.page,
  limit:            schemas.limit,
  gender:           z.enum(['M','F','O']).optional(),
  include_inactive: z.enum(['true','false']).optional(),
});

router.get('/',
  requirePermission('patients:read'),
  validate({ query: listSchema }),
  controller.list
);

router.get('/:id',
  requirePermission('patients:read'),
  validate({ params: schemas.uuidParam }),
  controller.getById
);

// Apenas técnicos e admins podem cadastrar pacientes/agendamentos
router.post('/',
  requirePermission('patients:create'),
  validate({ body: patientSchema }),
  controller.create
);

router.patch('/:id',
  requirePermission('patients:update'),
  validate({ params: schemas.uuidParam, body: patientBase.partial() }),
  controller.update
);

// Inativação (soft delete) — dados preservados
router.delete('/:id',
  requirePermission('patients:delete'),
  validate({ params: schemas.uuidParam }),
  controller.deactivate
);

router.post('/:id/reactivate',
  requirePermission('patients:delete'),
  validate({ params: schemas.uuidParam }),
  controller.reactivate
);

// HARD DELETE — distinto da inativação acima, exige confirmação de senha do admin
router.delete('/:id/permanent',
  requirePermission('patients:delete'),
  validate({
    params: schemas.uuidParam,
    body:   z.object({ password: z.string().min(1) }),
  }),
  controller.deletePermanently
);

router.get('/:id/history',
  requirePermission('patients:history'),
  validate({ params: schemas.uuidParam }),
  controller.history
);

// LGPD — exportação de dados do titular e relatório de acessos (admin/DPO)
router.get('/:id/lgpd-export', requirePermission('patients:export'), validate({ params: schemas.uuidParam }), controller.lgpdExport);
router.get('/:id/access-log',  requirePermission('patients:export'), validate({ params: schemas.uuidParam }), controller.accessLog);

// POST /patients/:id/merge  (admin) — mescla um cadastro duplicado neste.
// :id = sobrevivente; body.duplicate_id = cadastro que será absorvido e inativado.
router.post('/:id/merge',
  requirePermission('patients:merge'),
  validate({
    params: schemas.uuidParam,
    body:   z.object({ duplicate_id: z.string().uuid() }),
  }),
  controller.merge
);

// POST /patients/:id/portal-access — libera (ou reseta com body.reset=true) o acesso
// ao portal do paciente, devolvendo uma senha temporária uma vez. Desacopla a conta
// do check-in de exame: serve para paciente clínico (consulta/emergência) também.
router.post('/:id/portal-access',
  requirePermission('portal:grant'),
  validate({ params: schemas.uuidParam, body: z.object({ reset: z.boolean().optional() }) }),
  controller.grantPortalAccess
);

module.exports = router;
