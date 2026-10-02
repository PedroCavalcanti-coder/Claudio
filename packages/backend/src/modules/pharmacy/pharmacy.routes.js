'use strict';
/**
 * Farmácia (#5 Nível 4) — montado em /api/v1/pharmacy.
 * Estoque (pharmacy:stock) + dispensação ligada à prescrição (pharmacy:dispense).
 * Leitura (pharmacy:read) p/ todos os perfis clínicos.
 */
const { Router } = require('express');
const controller = require('./pharmacy.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(authenticate);

const uuid = z.string().uuid('ID inválido');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data AAAA-MM-DD');
const qty = z.number().positive().max(1_000_000);

// ── Estoque ───────────────────────────────────────────────────────────────────
router.get('/stock',
  requirePermission('pharmacy:read'),
  validate({ query: z.object({
    health_unit_id: uuid.optional(), q: z.string().max(200).optional(),
    low: z.string().optional(),
  }) }),
  controller.listStock);

router.post('/stock',
  requirePermission('pharmacy:stock'),
  validate({ body: z.object({
    drug_name: z.string().min(1).max(200),
    medication_id: uuid.optional(),
    lot: z.string().max(60).optional(),
    expiry_date: dateStr.optional(),
    unit_label: z.string().max(30).optional(),
    quantity: qty,
    min_level: z.number().min(0).max(1_000_000).optional(),
    reason: z.string().max(120).optional(),
    health_unit_id: uuid.optional(),
  }) }),
  controller.createStock);

router.post('/stock/:id/movement',
  requirePermission('pharmacy:stock'),
  validate({ params: schemas.uuidParam, body: z.object({
    movement_type: z.enum(['out', 'adjust']),
    quantity: z.number().min(0).max(1_000_000),
    reason: z.string().max(120).optional(),
  }) }),
  controller.adjustStock);

router.get('/stock/:id/movements',
  requirePermission('pharmacy:read'),
  validate({ params: schemas.uuidParam }),
  controller.listMovements);

// ── Dispensação ───────────────────────────────────────────────────────────────
router.get('/patients/:id/dispensations',
  requirePermission('pharmacy:read'),
  validate({ params: schemas.uuidParam }),
  controller.listDispensations);

router.post('/dispensations',
  requirePermission('pharmacy:dispense'),
  validate({ body: z.object({
    patient_id: uuid,
    prescription_id: uuid.optional(),
    encounter_id: uuid.optional(),
    notes: z.string().max(500).optional(),
    health_unit_id: uuid.optional(),
    items: z.array(z.object({
      prescription_item_id: uuid.optional(),
      stock_id: uuid.optional(),
      drug_name: z.string().min(1).max(200),
      quantity: qty,
      unit_label: z.string().max(30).optional(),
    })).min(1).max(50),
  }) }),
  controller.dispense);

module.exports = router;
