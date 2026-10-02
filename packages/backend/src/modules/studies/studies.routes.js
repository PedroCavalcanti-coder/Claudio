const { Router } = require('express');
const multer     = require('multer');
const controller = require('./studies.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024,   // 500 MB por arquivo (DICOM enhanced multi-frame raro mas possível)
    files:    10000,               // até 10k instâncias num único estudo
    fields:   20,                  // campos não-arquivo do FormData
  },
});

const router = Router();
router.use(authenticate);

const listSchema = z.object({
  status:     z.enum(['pending','receiving','received','incomplete','complete','archived']).optional(),
  modality:   z.string().optional(),
  date:       schemas.date.optional(),
  date_from:  schemas.date.optional(),
  date_to:    schemas.date.optional(),
  page:       schemas.page,
  limit:      schemas.limit,
});

// Instâncias de um estudo por DICOM UID — usado pelo OrthoVis viewer.
// `doctor` (médico solicitante) NÃO tem viewer: o stream de instâncias é
// restrito a technician/radiologist, então listar para doctor gerava acesso
// meio-quebrado (lista 200, stream 403). Fechado por consistência.
// (Ver imagens do exame que solicitou é feature futura — exige escopo por
//  requesting_physician/referral, fora do ajuste cirúrgico desta sessão.)
router.get('/dicom/:studyUID/instances',
  requirePermission('studies:read'),
  controller.listInstances
);

// ── Conciliação (estudos do equipamento sem agendamento/paciente) ─────────────
// Declaradas ANTES de '/:id' para não serem capturadas pelo parâmetro.
router.get('/unmatched',
  requirePermission('studies:reconcile'),
  validate({ query: z.object({ status: z.enum(['pending', 'matched', 'discarded']).optional() }) }),
  controller.listUnmatched);
router.post('/unmatched/:id/match',
  requirePermission('studies:reconcile'),
  validate({ params: schemas.uuidParam, body: z.object({
    patient_id: z.string().uuid(), appointment_id: z.string().uuid().optional() }) }),
  controller.matchUnmatched);
router.post('/unmatched/:id/discard',
  requirePermission('studies:reconcile'),
  validate({ params: schemas.uuidParam, body: z.object({ reason: z.string().max(500).optional() }) }),
  controller.discardUnmatched);

// Listar estudos (pendentes de laudo)
router.get('/',             requirePermission('studies:read'), validate({ query: listSchema }), controller.list);
// Estudos aguardando laudo (view otimizada)
router.get('/pending',      requirePermission('studies:read'), controller.pending);
// Detalhe do estudo com séries
router.get('/:id',          requirePermission('studies:read'), validate({ params: schemas.uuidParam }), controller.getById);
// Exames anteriores do mesmo paciente (priors) — comparação no viewer
router.get('/:id/priors',   requirePermission('studies:read'), validate({ params: schemas.uuidParam }), controller.priors);
// Listar séries de um estudo
router.get('/:id/series',   requirePermission('studies:read'), validate({ params: schemas.uuidParam }), controller.series);
// WADO-RS: stream de instâncias DICOM
router.get('/:id/instances/:instanceId/stream',
  requirePermission('studies:stream'),
  controller.streamInstance
);

// Upload direto de DICOM pelo técnico (multipart/form-data) — legado/back-compat
router.post('/upload',
  requirePermission('studies:upload'),
  upload.array('files', 1000),
  controller.uploadDicom
);

// ── Upload em blocos (#23): init → chunk → finalize ──────────────────────────
// Resolve o problema do multer.memoryStorage(): os arquivos são gravados em
// disco bloco-a-bloco (RAM constante) e só vão ao Orthanc após verificação.
const uploadInitSchema = z.object({
  appointment_id:   z.string().uuid('appointment_id inválido'),
  accession_number: z.string().max(64).optional(),
  study_date:       schemas.date.optional(),
  health_unit_id:   z.string().uuid().optional(),
  equipment_id:     z.string().uuid().optional(),
  room_id:          z.string().uuid().optional(),
  operator_notes:   z.string().max(2000).optional(),
  // Detalhes da REALIZAÇÃO do exame (capturados pelo técnico no envio):
  performed_at:        z.string().datetime().optional(),        // data/hora da realização (ISO)
  complications:       z.string().max(2000).optional(),         // intercorrências (→ operator_notes)
  performing_physician:z.string().max(160).optional(),          // médico executor/responsável
  exam_quality:        z.enum(['adequate','limited','repeat']).optional(),
  files: z.array(z.object({
    name:   z.string().min(1).max(255),
    size:   z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/, 'sha256 inválido').optional().nullable(),
  })).min(1).max(20000),
});

router.post('/upload/init',
  requirePermission('studies:upload'),
  validate({ body: uploadInitSchema }),
  controller.uploadInit
);

// Bloco: corpo é binário cru (application/octet-stream) — sem body parser.
// O handler faz stream de req direto pro disco.
router.post('/upload/:uploadId/chunk',
  requirePermission('studies:upload'),
  controller.uploadChunk
);

router.post('/upload/:uploadId/finalize',
  requirePermission('studies:upload'),
  controller.uploadFinalize
);

router.delete('/upload/:uploadId',
  requirePermission('studies:upload'),
  controller.uploadAbort
);

// ── #29 Backup/DR: replicação DICOM Orthanc → RustFS (durável) ────────────────
// Status da durabilidade (quantas instâncias têm cópia no RustFS).
router.get('/dicom/replication-status',
  requirePermission('studies:replicate'),
  controller.replicationStatus
);
// Backfill sob demanda (cron de ops): replica um lote de instâncias 'orthanc:%'.
router.post('/dicom/replicate-pending',
  requirePermission('studies:replicate'),
  controller.replicatePending
);

// Callback do PACS: upload concluído (chamado pelo Orthanc ou pelo técnico)
router.patch('/:id/upload-complete',
  requirePermission('studies:upload'),
  validate({ params: schemas.uuidParam }),
  controller.uploadComplete
);

// Secondary Capture — frontend exporta uma captura anotada e envia ao PACS
// como nova instância DICOM SC vinculada ao estudo original.
const scUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },     // 20 MB — captura PNG/JPEG raramente passa disso
});
router.post('/:id/secondary-capture',
  requirePermission('studies:capture'),
  validate({ params: schemas.uuidParam }),
  scUpload.single('image'),
  controller.uploadSecondaryCapture
);

module.exports = router;
