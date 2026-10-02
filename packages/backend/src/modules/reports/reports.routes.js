const { Router } = require('express');
const controller = require('./reports.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { z } = require('zod');

const router = Router();
router.use(authenticate);

const reportSchema = z.object({
  study_id:       z.string().uuid(),
  appointment_id: z.string().uuid().optional(),
  template_id:    z.string().uuid().optional(),
  technique:      z.string().optional(),
  findings:       z.string().optional(),
  conclusion:     z.string().optional(),
  recommendations:z.string().optional(),
  report_simple:  z.string().optional(),
  content_json:   z.record(z.any()).optional(),
  content_html:   z.string().optional(),
});

const updateSchema = reportSchema.omit({ study_id: true }).partial();

const signSchema = z.object({
  // content_html é opcional: o documento legal é renderizado server-side a partir
  // dos campos estruturados abaixo (services/reportTemplate.js).
  content_html:           z.string().optional(),
  findings:               z.string().min(1),
  conclusion:             z.string().min(1),
  technique:              z.string().optional(),
  recommendations:        z.string().optional(),
  doctor_name:            z.string().min(3),
  doctor_crm:             z.string().min(3),
  doctor_institution:     z.string().optional(),
  digital_certificate_sn: z.string().optional(),
  digital_certificate_cn: z.string().optional(),
  cid10_codes:            z.array(z.object({ code: z.string(), description: z.string().optional() })).optional(),
});

// content_html opcional: se ausente, o backend reconstrói o documento canônico.
const renderSchema = z.object({
  content_html: z.string().min(100).optional(),
});

// Catálogo CID-10 (busca) — antes de /:id para não colidir
router.get('/cid10', requirePermission('reports:read'), validate({ query: z.object({ q: z.string().optional() }) }), controller.listCid10);

router.get('/',     requirePermission('reports:read'), validate({ query: z.object({ page: schemas.page, limit: schemas.limit, status: z.string().optional() }) }), controller.list);
router.get('/by-study/:studyId', requirePermission('reports:read'), validate({ params: z.object({ studyId: z.string().uuid() }) }), controller.getByStudy);
router.get('/:id',  requirePermission('reports:read'), validate({ params: schemas.uuidParam }), controller.getById);
router.post('/',    requirePermission('reports:create'), validate({ body: reportSchema }),         controller.create);
router.patch('/:id',requirePermission('reports:update'), validate({ params: schemas.uuidParam, body: updateSchema }), controller.update);

router.post('/:id/sign',       requirePermission('reports:sign'),                  validate({ params: schemas.uuidParam, body: signSchema }), controller.sign);
router.post('/:id/render-pdf', requirePermission('reports:render'),         validate({ params: schemas.uuidParam, body: renderSchema }), controller.renderPdf);
router.post('/:id/amend',      requirePermission('reports:amend'),                  validate({ params: schemas.uuidParam, body: z.object({ reason: z.string().min(5) }) }), controller.amend);
router.delete('/:id',          requirePermission('reports:cancel'),                        validate({ params: schemas.uuidParam }), controller.cancel);

router.get('/templates',   requirePermission('reports:read'), controller.listTemplates);

router.get('/auto-texts',  requirePermission('reports:read'), validate({ query: z.object({ q: z.string().optional(), modality: z.string().optional() }) }), controller.listAutoTexts);

// PDF do laudo (apenas radiologista/admin)
router.get('/:id/pdf',      requirePermission('reports:read'), validate({ params: schemas.uuidParam }), controller.getPdf);

// Download HTML do laudo para impressão (acessível a todos os perfis internos)
router.get('/:id/download', requirePermission('reports:download'), validate({ params: schemas.uuidParam }), controller.download);

// Versão simplificada (para paciente/médico solicitante)
router.get('/:id/summary', validate({ params: schemas.uuidParam }), controller.getSimpleReport);

module.exports = router;
