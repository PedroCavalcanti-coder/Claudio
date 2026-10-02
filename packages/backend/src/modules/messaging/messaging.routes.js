'use strict';
/**
 * Mensageria (#8 Nível 4) — montado em /api/v1/messaging.
 * Outbox (messaging:read) + reenvio/envio manual (messaging:send).
 */
const { Router } = require('express');
const controller = require('./messaging.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(authenticate);

router.get('/outbox',
  requirePermission('messaging:read'),
  validate({ query: z.object({
    status: z.enum(['pending', 'sent', 'failed']).optional(),
    channel: z.enum(['sms', 'whatsapp', 'email']).optional(),
    health_unit_id: z.string().uuid().optional(),
  }) }),
  controller.listOutbox);

router.post('/outbox/:id/retry',
  requirePermission('messaging:send'),
  validate({ params: schemas.uuidParam }),
  controller.retry);

router.post('/send',
  requirePermission('messaging:send'),
  validate({ body: z.object({
    channel: z.enum(['sms', 'whatsapp', 'email']),
    to: z.string().min(3).max(200),
    body: z.string().min(1).max(1000),
    template: z.string().max(40).optional(),
  }) }),
  controller.sendManual);

module.exports = router;
