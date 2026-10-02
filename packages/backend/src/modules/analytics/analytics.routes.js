'use strict';
/**
 * Relatórios operacionais (#6) — montado em /api/v1/analytics.
 * Só agregados; sem PII. Permissão `analytics:read`.
 */
const { Router } = require('express');
const controller = require('./analytics.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(authenticate);

const rangeQuery = z.object({
  from: schemas.date.optional(),
  to: schemas.date.optional(),
  health_unit_id: z.string().uuid().optional(),
});

router.get('/production',
  requirePermission('analytics:read'), validate({ query: rangeQuery }), controller.production);
router.get('/no-show',
  requirePermission('analytics:read'), validate({ query: rangeQuery }), controller.noShow);
router.get('/queue',
  requirePermission('analytics:read'),
  validate({ query: z.object({ health_unit_id: z.string().uuid().optional() }) }), controller.queueStats);

module.exports = router;
