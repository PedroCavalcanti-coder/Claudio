'use strict';
/**
 * Catálogos clínicos locais (#9): CID-10 (ris.cid10) e medicamentos
 * (ris.medications_catalog). Busca offline p/ autocompletar no PEP — sem API
 * externa. Acessível a qualquer papel clínico (perm catalog:read).
 */
const db = require('../../config/database');
const { success } = require('../../utils/response');

async function searchCid10(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return success(res, []);
  const { rows } = await db.query(
    `SELECT code, description, category
       FROM ris.cid10
      WHERE code ILIKE $1 OR lower(description) LIKE lower($2)
      ORDER BY (code ILIKE $1) DESC, code
      LIMIT 30`,
    [`${q}%`, `%${q}%`]
  );
  return success(res, rows);
}

async function searchMedications(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return success(res, []);
  const { rows } = await db.query(
    `SELECT id, name, active_ingredient, form, controlled
       FROM ris.medications_catalog
      WHERE lower(name) LIKE lower($1) OR lower(active_ingredient) LIKE lower($1)
      ORDER BY (lower(name) LIKE lower($2)) DESC, name
      LIMIT 30`,
    [`%${q}%`, `${q}%`]
  );
  return success(res, rows);
}

module.exports = { searchCid10, searchMedications };
