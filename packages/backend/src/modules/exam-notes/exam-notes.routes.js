'use strict';

const { Router } = require('express');
const { z } = require('zod');
const controller   = require('./exam-notes.controller');
const authenticate = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');

const router = Router();
router.use(authenticate);

const noteBody = z.object({
  title:   z.string().max(200).optional(),
  content: z.string().max(50_000).default(''),    // 50KB de texto cobre laudo completo
});

router.get(
  '/studies/:studyId/notes',
  requirePermission('exam_notes:manage'),
  validate({ params: z.object({ studyId: z.string().uuid() }) }),
  controller.listByStudy
);

router.post(
  '/studies/:studyId/notes',
  requirePermission('exam_notes:manage'),
  validate({
    params: z.object({ studyId: z.string().uuid() }),
    body:   noteBody,
  }),
  controller.create
);

router.patch(
  '/notes/:id',
  requirePermission('exam_notes:manage'),
  validate({ params: schemas.uuidParam, body: noteBody.partial() }),
  controller.update
);

router.delete(
  '/notes/:id',
  requirePermission('exam_notes:manage'),
  validate({ params: schemas.uuidParam }),
  controller.remove
);

module.exports = router;
