'use strict';
const { Router } = require('express');
const controller = require('./availability.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(authenticate);

const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário deve ser HH:MM');

const slotsQuery = z.object({
  health_unit_id: z.string().uuid(),
  date:           schemas.date,
  modality_id:    z.string().uuid().optional(),
  procedure_id:   z.string().uuid().optional(),
});

const ruleBody = z.object({
  health_unit_id: z.string().uuid(),
  modality_id:    z.string().uuid().nullable().optional(),
  weekday:        z.number().int().min(0).max(6),
  start_time:     timeStr,
  end_time:       timeStr,
  slot_minutes:   z.number().int().min(5).max(240).optional(),
  capacity:       z.number().int().min(1).max(50).optional(),
}).refine(d => d.start_time < d.end_time, { message: 'end_time deve ser maior que start_time', path: ['end_time'] });

const rulePatch = z.object({
  modality_id:  z.string().uuid().nullable().optional(),
  weekday:      z.number().int().min(0).max(6).optional(),
  start_time:   timeStr.optional(),
  end_time:     timeStr.optional(),
  slot_minutes: z.number().int().min(5).max(240).optional(),
  capacity:     z.number().int().min(1).max(50).optional(),
  is_active:    z.boolean().optional(),
});

const holidayBody = z.object({
  health_unit_id: z.string().uuid().nullable().optional(),
  holiday_date:   schemas.date,
  description:    z.string().max(160).optional(),
});

const READ  = requirePermission('availability:read');
const WRITE = requirePermission('availability:manage');

// Slots livres do dia (usado na tela de agendamento)
router.get('/slots', READ, validate({ query: slotsQuery }), controller.getSlots);

// Regras de disponibilidade
router.get('/rules',        READ,  controller.listRules);
router.post('/rules',       WRITE, validate({ body: ruleBody }), controller.createRule);
router.patch('/rules/:id',  WRITE, validate({ params: schemas.uuidParam, body: rulePatch }), controller.updateRule);
router.delete('/rules/:id', WRITE, validate({ params: schemas.uuidParam }), controller.deleteRule);

// Feriados
router.get('/holidays',        READ,  controller.listHolidays);
router.post('/holidays',       WRITE, validate({ body: holidayBody }), controller.createHoliday);
router.delete('/holidays/:id', WRITE, validate({ params: schemas.uuidParam }), controller.deleteHoliday);

module.exports = router;
