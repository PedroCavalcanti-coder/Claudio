'use strict';
const { Router } = require('express');
const controller = require('./auth.controller');
const { authLimiter } = require('../../middlewares/rateLimiter');
const authenticate = require('../../middlewares/authenticate');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();

// ── /login_paciente — CPF + senha ─────────────────────────────────────────────
router.post('/login_paciente', authLimiter,
  validate({ body: z.object({ cpf: schemas.cpf, password: z.string().min(1) }) }),
  controller.loginPaciente
);

// ── /reactivate_paciente — reativa paciente inativo + emite sessão ────────────
router.post('/reactivate_paciente', authLimiter,
  validate({ body: z.object({ cpf: schemas.cpf, password: z.string().min(1) }) }),
  controller.reactivatePaciente
);

// ── /login_medico — CPF + email + senha ───────────────────────────────────────
router.post('/login_medico', authLimiter,
  validate({ body: z.object({ cpf: schemas.cpf, email: schemas.email, password: z.string().min(1) }) }),
  controller.loginMedico
);

// ── /login_recepcao — username + senha ────────────────────────────────────────
router.post('/login_recepcao', authLimiter,
  validate({ body: z.object({ username: z.string().min(1), password: z.string().min(1) }) }),
  controller.loginRecepcao
);

// ── /login_tecnico — username + senha ─────────────────────────────────────────
router.post('/login_tecnico', authLimiter,
  validate({ body: z.object({ username: z.string().min(1), password: z.string().min(1) }) }),
  controller.loginTecnico
);

// ── /login_enfermeiro — username + senha ──────────────────────────────────────
router.post('/login_enfermeiro', authLimiter,
  validate({ body: z.object({ username: z.string().min(1), password: z.string().min(1) }) }),
  controller.loginEnfermeiro
);

// ── /login_admin — email + senha ──────────────────────────────────────────────
router.post('/login_admin', authLimiter,
  validate({ body: z.object({ email: schemas.email, password: z.string().min(1), mfa_code: z.string().length(6).optional() }) }),
  controller.loginAdmin
);

// ── Legado: /login genérico (mantido por compatibilidade) ─────────────────────
router.post('/login', authLimiter,
  validate({ body: z.object({ email: schemas.email, password: z.string().min(6), mfa_code: z.string().length(6).optional() }) }),
  controller.login
);

// ── Refresh / Logout / Me ─────────────────────────────────────────────────────
router.post('/refresh',        controller.refresh);
router.post('/logout',         authenticate, controller.logout);
router.post('/logout-all',     authenticate, controller.logoutAll);
router.get('/me',              authenticate, controller.me);
router.get('/me/permissions',  authenticate, controller.myPermissions);
// Troca da própria senha (obrigatória no 1º acesso com senha provisória do administrador)
router.post('/change-password', authenticate, authLimiter,
  validate({ body: z.object({ current_password: z.string().min(1), new_password: z.string().min(8) }) }),
  controller.changePassword
);
router.post('/forgot-password', authLimiter,
  validate({ body: z.object({ email: schemas.email }) }),
  controller.forgotPassword
);
router.post('/reset-password',
  validate({ body: z.object({ token: z.string().min(1), password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/) }) }),
  controller.resetPassword
);

module.exports = router;
