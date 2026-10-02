'use strict';

const { Router } = require('express');
const multer     = require('multer');
const controller = require('./dicom.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');

const router  = Router();
const upload  = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 500 * 1024 * 1024, files: 500 }, // 500MB por arquivo, até 500 arquivos
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/dicom' ||
               file.originalname.toLowerCase().endsWith('.dcm');
    cb(null, ok);
  },
});

// ── Webhook do Orthanc (sem auth JWT — protegido por IP no NGINX) ─────────────
router.post('/webhook/orthanc', controller.orthancWebhook);

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
