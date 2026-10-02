'use strict';
const { Router } = require('express');
const { z } = require('zod');
const controller  = require('./procedures.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');

const router = Router();
router.use(authenticate);

const MODALITY_TYPES = ['CR','DX','CT','MR','US','NM','PT','MG','RF','OT','SC','XA'];

// Campos opcionais são .nullable() porque o frontend envia `null` (não ausência)
// quando o usuário deixa o campo em branco — antes isso causava 422.
const procedureSchema = z.object({
  name:                     z.string().min(2).max(300),
  name_abbrev:              z.string().max(100).optional().nullable(),
  tuss_code:                z.string().min(1).max(20),
  cbhpm_code:               z.string().max(10).optional().nullable(),
  modality_type:            z.enum(MODALITY_TYPES).optional().nullable(),
  body_part:                z.string().max(100).optional().nullable(),
  duration_minutes:         z.number().int().min(5).max(480).default(30),
  requires_fasting:         z.boolean().default(false),
  fasting_hours:            z.number().int().min(1).max(72).optional().nullable(),
  requires_contrast:        z.boolean().default(false),
  requires_referral:        z.boolean().default(false),
  preparation_instructions: z.string().optional().nullable(),
});

// Listagem — todos os perfis autenticados (usado nos formulários de agendamento)
router.get('/', controller.list);

// Gestão — apenas técnico e admin
router.post('/',
  requirePermission('procedures:manage'),
  validate({ body: procedureSchema }),
  controller.create
);

router.patch('/:id',
  requirePermission('procedures:manage'),
  validate({ params: schemas.uuidParam, body: procedureSchema.partial().extend({ is_active: z.boolean().optional() }) }),
  controller.update
);

router.delete('/:id',
  requirePermission('procedures:manage'),
  validate({ params: schemas.uuidParam }),
  controller.deactivate
);

module.exports = router;
