const { Router } = require('express');
const controller = require('./portal.controller');
const { portalLimiter } = require('../../middlewares/rateLimiter');
const { validate } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(portalLimiter);

// Acesso via token compartilhado (QR Code / link do laudo)
router.get('/reports/:token',
  validate({ params: z.object({ token: z.string().uuid() }) }),
  controller.getByToken
);

router.get('/reports/:token/pdf',
  validate({ params: z.object({ token: z.string().uuid() }) }),
  controller.getPdfByToken
);

router.get('/reports/:token/images',
  validate({ params: z.object({ token: z.string().uuid() }) }),
  controller.getImagesByToken
);

module.exports = router;
