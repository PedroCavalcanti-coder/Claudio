'use strict';
const { Router } = require('express');
const controller = require('./radiologist.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(authenticate);
router.use(requirePermission('radiologist:access'));

const worklistQuerySchema = z.object({
  status:   z.enum(['checked_in', 'in_progress']).optional(),
  priority: z.coerce.number().int().min(0).max(2).optional(),
  modality: z.string().optional(),
  page:     schemas.page,
  limit:    schemas.limit,
});

router.get('/worklist',
  validate({ query: worklistQuerySchema }),
  controller.worklist
);

router.patch('/worklist/:id/claim',
  validate({ params: schemas.uuidParam }),
  controller.claim
);

router.get('/notifications', controller.getNotifications);

module.exports = router;
