'use strict';
/**
 * Faturamento SUS (#3 Nível 5) — montado em /api/v1/billing. Extrato de produção
 * ambulatorial + export CSV. Permissão `billing:read` (recepção/faturamento + admin).
 */
const { Router } = require('express');
const controller = require('./billing.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(authenticate);

const compQuery = z.object({
  competencia: z.string().regex(/^\d{6}$/, 'Competência AAAAMM'),
  health_unit_id: z.string().uuid().optional(),
});

router.get('/production',
  requirePermission('billing:read'), validate({ query: compQuery }), controller.production);
router.get('/production/export',
  requirePermission('billing:read'), validate({ query: compQuery }), controller.exportCsv);

module.exports = router;
