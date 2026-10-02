'use strict';

const { Router } = require('express');
const multer     = require('multer');
const controller = require('./dicom.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const crypto = require('crypto');
const env = require('../../config/env');
const { AppError } = require('../../utils/errors');

const router  = Router();

function requireWebhookSecret(req, res, next) {
  const expected = env.ORTHANC_WEBHOOK_SECRET;
  if (!expected) {
    if (env.NODE_ENV === 'production') return next(new AppError('Webhook desabilitado: defina ORTHANC_WEBHOOK_SECRET', 401, 'WEBHOOK_DISABLED'));
    return next();   // dev/teste local sem segredo
  }
  const given = String(req.get('x-webhook-secret') || '');
  const h = (v) => crypto.createHash('sha256').update(v).digest();
  if (!crypto.timingSafeEqual(h(given), h(expected))) {
    return next(new AppError('Segredo do webhook inválido', 401, 'WEBHOOK_UNAUTHORIZED'));
  }
  next();
}

const upload  = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 500 * 1024 * 1024, files: 500 }, // 500MB por arquivo, até 500 arquivos
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/dicom' ||
               file.originalname.toLowerCase().endsWith('.dcm');
    cb(null, ok);
  },
});

// ── Webhook do Orthanc (sem JWT) ───────────────────────────────────────────────
// Defesa em duas camadas: (1) o nginx NÃO expõe esta rota (o Orthanc fala direto com
// backend:3000 pela rede interna do compose); (2) segredo compartilhado no header
// X-Webhook-Secret, comparado em tempo constante. Sem segredo configurado, em produção
// a rota responde 401 (fail-closed).
router.post('/webhook/orthanc', requireWebhookSecret, controller.orthancWebhook);

router.post('/upload',
  authenticate, requirePermission('dicom:upload'),
  upload.array('files', 500),
  controller.uploadDicom
);

router.post('/upload/:patientId',
  authenticate, requirePermission('dicom:upload_patient'),
  upload.array('files', 500),
  controller.uploadDicomForPatient
);

// ── WADO-RS: metadados JSON das instâncias de uma série ───────────────────────
router.get('/wado/studies/:studyUID/series/:seriesUID/instances',
  authenticate, requirePermission('dicom:view'),
  controller.wadoInstances
);

// ── WADO-RS: stream de uma instância DICOM ────────────────────────────────────
router.get('/wado/studies/:studyUID/series/:seriesUID/instances/:instanceUID',
  authenticate, requirePermission('dicom:view'),
  controller.wadoInstance
);

router.get('/studies/:studyUID/series',
  authenticate, requirePermission('dicom:view'),
  controller.getStudySeries
);

router.get('/worklist',
  authenticate, requirePermission('worklist:read'),
  controller.worklist
);

router.get('/orthanc/status',
  authenticate, requirePermission('dicom:admin'),
  controller.orthancStatus
);

module.exports = router;
