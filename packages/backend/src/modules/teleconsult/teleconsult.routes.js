'use strict';
/**
 * Teleconsulta (#6 Nível 4) — montado em /api/v1/teleconsult.
 * Sessão (teleconsult:manage) + sinalização WebRTC por REST (só authenticate +
 * room_token como capability; paciente entra pelo portal autenticado).
 */
const { Router } = require('express');
const controller = require('./teleconsult.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const { roomLimiter } = require('../../middlewares/rateLimiter');

const router = Router();

const uuid = z.string().uuid('ID inválido');
const tokenParam = { params: z.object({ token: uuid }) };
const sender = z.enum(['host', 'guest']);

// ── Sessão (clínico) — exige autenticação interna + permissão ─────────────────
router.post('/sessions',
  authenticate, requirePermission('teleconsult:manage'),
  validate({ body: z.object({
    patient_id: uuid, encounter_id: uuid.optional(), appointment_id: uuid.optional(),
  }) }),
  controller.createSession);

router.get('/patients/:id/sessions',
  authenticate, requirePermission('teleconsult:manage'),
  validate({ params: schemas.uuidParam }),
  controller.listSessions);

router.patch('/sessions/:id/status',
  authenticate, requirePermission('teleconsult:manage'),
  validate({ params: schemas.uuidParam, body: z.object({
    status: z.enum(['active', 'ended', 'cancelled']),
  }) }),
  controller.setStatus);

// ── Sala + sinalização — CAPABILITY por room_token (UUID não adivinhável) ──────
// SEM autenticação interna: o paciente entra pelo portal (auth diferente) e o
// próprio link é a credencial. O token é o segredo; só quem o tem participa.
// Limite próprio (por sala+IP) — o polling de sinalização é de ~1 req/s e fica fora do limite global.
router.use('/room/:token', roomLimiter);
router.get('/room/:token', validate(tokenParam), controller.roomInfo);

router.post('/room/:token/signal',
  validate({ ...tokenParam, body: z.object({
    sender, kind: z.enum(['offer', 'answer', 'ice', 'bye']),
    payload: z.any(),
  }) }),
  controller.postSignal);

router.get('/room/:token/signal',
  validate({ ...tokenParam, query: z.object({
    since: z.string().regex(/^\d+$/).optional(),
    role: sender.optional(),
  }) }),
  controller.getSignals);

module.exports = router;
