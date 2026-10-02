'use strict';
const db = require('../../config/database');
const { success, created } = require('../../utils/response');
const { AppError, NotFoundError } = require('../../utils/errors');

async function list(req, res) {
  const { q, active, health_unit_id } = req.query;
  const conditions = [];
  const params = [];

  if (active !== 'all') {
    conditions.push(`is_active = TRUE`);
  }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(name ILIKE $${params.length} OR tuss_code ILIKE $${params.length})`);
  }
  // Se a unidade tem mapeamento em ris.unit_procedures, oferece só esses; sem mapeamento, todos (retrocompat).
  if (health_unit_id && /^[0-9a-fA-F-]{36}$/.test(health_unit_id)) {
    params.push(health_unit_id);
    conditions.push(`(
      NOT EXISTS (SELECT 1 FROM ris.unit_procedures up WHERE up.health_unit_id = $${params.length})
      OR id IN (SELECT procedure_id FROM ris.unit_procedures up WHERE up.health_unit_id = $${params.length})
    )`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT id, name, name_abbrev, tuss_code, cbhpm_code, modality_type,
            body_part, duration_minutes, requires_fasting, fasting_hours,
            requires_contrast, requires_referral, preparation_instructions, is_active
     FROM ris.procedures
     ${where}
     ORDER BY name ASC`,
    params
  );
  return success(res, rows);
}

async function create(req, res) {
  const {
    name, name_abbrev, tuss_code, cbhpm_code, modality_type, body_part,
    duration_minutes = 30, requires_fasting = false, fasting_hours,
    requires_contrast = false, requires_referral = false, preparation_instructions,
  } = req.body;

  const { rows } = await db.query(
    `INSERT INTO ris.procedures
       (name, name_abbrev, tuss_code, cbhpm_code, modality_type, body_part,
        duration_minutes, requires_fasting, fasting_hours,
        requires_contrast, requires_referral, preparation_instructions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [name, name_abbrev || null, tuss_code, cbhpm_code || null, modality_type || null,
     body_part || null, duration_minutes, requires_fasting, fasting_hours || null,
     requires_contrast, requires_referral, preparation_instructions || null]
  );
  return created(res, rows[0]);
}

async function update(req, res) {
  const { id } = req.params;
  const fields = [
    'name','name_abbrev','tuss_code','cbhpm_code','modality_type','body_part',
    'duration_minutes','requires_fasting','fasting_hours',
    'requires_contrast','requires_referral','preparation_instructions','is_active',
  ];

  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      params.push(req.body[f]);
      updates.push(`${f} = $${params.length}`);
    }
  }
  if (!updates.length) throw new AppError('Nenhum campo para atualizar', 400);

  params.push(id);
  const { rows } = await db.query(
    `UPDATE ris.procedures SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows.length) throw new NotFoundError('Procedimento não encontrado');
  return success(res, rows[0]);
}

async function deactivate(req, res) {
  const { id } = req.params;
  const { rows } = await db.query(
    `UPDATE ris.procedures SET is_active = FALSE WHERE id = $1 RETURNING id`,
    [id]
  );
  if (!rows.length) throw new NotFoundError('Procedimento não encontrado');
  return success(res, { id });
}

module.exports = { list, create, update, deactivate };
