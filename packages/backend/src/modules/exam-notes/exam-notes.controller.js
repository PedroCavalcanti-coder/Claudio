'use strict';

/**
 * Notas clínicas do estudo — CRUD simples, escopado por study_id.
 * O frontend (NotesPanel do OrthoVis) usa pra persistir as observações
 * do radiologista durante a análise.
 */

const db    = require('../../config/database');
const audit = require('../../services/audit');
const { success, created, noContent } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');

// Só o autor da nota (ou admin) pode editar/excluir. Notas são pessoais.
async function assertNoteOwner(noteId, user) {
  const { rows } = await db.query(`SELECT user_id FROM ris.exam_notes WHERE id = $1`, [noteId]);
  if (!rows.length) throw new NotFoundError('Nota');
  if (user.role !== 'admin' && rows[0].user_id && rows[0].user_id !== user.sub) {
    throw new AppError('Você só pode editar suas próprias notas.', 403, 'NOTE_NOT_OWNER');
  }
}

async function listByStudy(req, res) {
  const { studyId } = req.params;
  const { rows } = await db.query(
    `SELECT id, study_id, user_id, title, content, created_at, updated_at
       FROM ris.exam_notes
      WHERE study_id = $1
      ORDER BY updated_at DESC`,
    [studyId]
  );
  return success(res, rows);
}

async function create(req, res) {
  const { studyId } = req.params;
  const { title, content = '' } = req.body || {};
  const { rows } = await db.query(
    `INSERT INTO ris.exam_notes (study_id, user_id, title, content)
     VALUES ($1, $2, $3, $4)
     RETURNING id, study_id, user_id, title, content, created_at, updated_at`,
    [studyId, req.user?.sub ?? null, title ?? null, content]
  );

  await audit.log({
    ...audit.fromRequest(req),
    action:       'EXAM_NOTE_CREATED',
    resourceType: 'exam_note',
    resourceId:   rows[0].id,
    details:      { study_id: studyId },
  });

  return created(res, rows[0]);
}

async function update(req, res) {
  const { id } = req.params;
  const { title, content } = req.body || {};
  await assertNoteOwner(id, req.user);

  const sets = [];
  const params = [];
  if (typeof title === 'string')   { params.push(title);   sets.push(`title   = $${params.length}`); }
  if (typeof content === 'string') { params.push(content); sets.push(`content = $${params.length}`); }
  if (!sets.length) return success(res, { id }, 'Nada a atualizar');

  sets.push('updated_at = NOW()');
  params.push(id);

  const { rows } = await db.query(
    `UPDATE ris.exam_notes
        SET ${sets.join(', ')}
      WHERE id = $${params.length}
      RETURNING id, study_id, user_id, title, content, created_at, updated_at`,
    params
  );
  if (!rows.length) throw new NotFoundError('Nota');
  return success(res, rows[0]);
}

async function remove(req, res) {
  const { id } = req.params;
  await assertNoteOwner(id, req.user);
  const { rowCount } = await db.query(
    `DELETE FROM ris.exam_notes WHERE id = $1`,
    [id]
  );
  if (!rowCount) throw new NotFoundError('Nota');

  await audit.log({
    ...audit.fromRequest(req),
    action:       'EXAM_NOTE_DELETED',
    resourceType: 'exam_note',
    resourceId:   id,
  });

  return noContent(res);
}

module.exports = { listByStudy, create, update, remove };
