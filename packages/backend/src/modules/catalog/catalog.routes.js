'use strict';
/**
 * Catálogos clínicos (#9) — montado em /api/v1/catalog. Busca CID-10 e
 * medicamentos p/ autocompletar no PEP. Permissão catalog:read (papéis clínicos).
 */
const { Router } = require('express');
const controller = require('./catalog.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(authenticate);

const qSchema = z.object({ q: z.string().max(120).optional() });

router.get('/cid10',
  requirePermission('catalog:read'), validate({ query: qSchema }), controller.searchCid10);
router.get('/medications',
  requirePermission('catalog:read'), validate({ query: qSchema }), controller.searchMedications);

module.exports = router;
