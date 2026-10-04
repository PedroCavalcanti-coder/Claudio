const { Router } = require('express');
const controller = require('./users.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(authenticate, requirePermission('users:manage'));

const userSchema = z.object({
  name:                z.string().min(3).max(200),
  email:               schemas.email,
  // Opcional: sem ela o backend gera uma senha provisória e devolve UMA vez (`temp_password`).
  password:            z.string().min(8).regex(/[A-Z]/, 'Deve conter maiúscula').regex(/[0-9]/, 'Deve conter número').optional(),
  role:                z.enum(['admin','radiologist','technician','receptionist','doctor','nurse','patient']),
  crm:                 z.string().optional(),
  crm_uf:              z.string().length(2).optional(),
  specialty:           z.string().optional(),
  health_unit_id:      z.string().uuid().optional(),
  is_network_resource: z.boolean().optional(),
  shared_specialties:  z.array(z.string()).optional(),
  extra_roles:         z.array(z.enum(['admin','radiologist','technician','receptionist','doctor','nurse'])).optional(),
});

router.get('/',     validate({ query: z.object({ page: schemas.page, limit: schemas.limit, role: z.string().optional(), active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), health_unit_id: z.string().uuid().optional() }) }), controller.list);
router.get('/:id',  validate({ params: schemas.uuidParam }), controller.getById);
router.post('/',    validate({ body: userSchema }),           controller.create);
router.patch('/:id',validate({ params: schemas.uuidParam, body: userSchema.omit({ password: true }).partial() }), controller.update);
router.patch('/:id/deactivate', validate({ params: schemas.uuidParam }), controller.deactivate);
router.patch('/:id/reset-password', validate({ params: schemas.uuidParam, body: z.object({ password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/).optional() }) }), controller.resetPassword);
// RBAC granular (#31): overrides de permissão por usuário
router.patch('/:id/permissions', validate({
  params: schemas.uuidParam,
  body: z.object({ granted: z.array(z.string()).optional(), revoked: z.array(z.string()).optional() }),
}), controller.setPermissions);

module.exports = router;
