'use strict';
/**
 * Farmácia (#5 Nível 4) — estoque por unidade + dispensação ligada à prescrição.
 *
 *  · Estoque é escopado por UNIDADE: não-admin opera a SUA unidade; admin escolhe
 *    via health_unit_id. Toda alteração de saldo grava um MOVIMENTO (ledger).
 *  · Dispensar consome itens da prescrição (assinada) e baixa o estoque em
 *    transação; o saldo nunca fica negativo (CHECK + guarda na app).
 */
const db    = require('../../config/database');
const audit = require('../../services/audit');
const { success, created } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');

// Unidade efetiva da operação: admin pode informar; demais usam a lotação.
function scopeUnit(req, bodyOrQuery = {}) {
  if (req.user.role === 'admin' || req.user.is_network_resource) {
    return bodyOrQuery.health_unit_id || req.user.health_unit_id || null;
  }
  return req.user.health_unit_id || null;
}

function logPharmacy(req, action, resourceId, details = {}) {
  return audit.log({ ...audit.fromRequest(req), action, resourceType: 'pharmacy', resourceId, details });
}

// ── Estoque ───────────────────────────────────────────────────────────────────
async function listStock(req, res) {
  const unitId = scopeUnit(req, req.query);
  const q = (req.query.q || '').trim().toLowerCase();
  const onlyLow = req.query.low === 'true' || req.query.low === '1';
  const params = [];
  let where = 'WHERE 1=1';
  if (unitId) { params.push(unitId); where += ` AND s.health_unit_id = $${params.length}`; }
  if (q)      { params.push(`%${q}%`); where += ` AND lower(s.drug_name) LIKE $${params.length}`; }
  if (onlyLow) where += ' AND s.quantity <= s.min_level';
  const { rows } = await db.query(
    `SELECT s.id, s.health_unit_id, s.medication_id, s.drug_name, s.lot, s.expiry_date,
            s.unit_label, s.quantity, s.min_level, s.updated_at,
            hu.name AS unit_name,
            (s.quantity <= s.min_level) AS low_stock,
            (s.expiry_date IS NOT NULL AND s.expiry_date <= (CURRENT_DATE + INTERVAL '30 day')) AS expiring
       FROM ris.pharmacy_stock s
       LEFT JOIN ris.health_units hu ON hu.id = s.health_unit_id
       ${where}
      ORDER BY low_stock DESC, lower(s.drug_name), s.expiry_date NULLS LAST`,
    params
  );
  return success(res, rows);
}

// Entrada de estoque (cria o item se a chave unidade+nome+lote não existir; senão
// soma). Sempre grava um movimento 'in'.
async function createStock(req, res) {
  const unitId = scopeUnit(req, req.body);
  if (!unitId) throw new AppError('Unidade não definida para o estoque', 400);
  const {
    drug_name, medication_id = null, lot = '', expiry_date = null,
    unit_label = 'un', quantity, min_level = 0, reason = 'Entrada de estoque',
  } = req.body;
  if (!(Number(quantity) > 0)) throw new AppError('Quantidade de entrada deve ser > 0', 400);

  const out = await db.transaction(async (client) => {
    const up = await client.query(
      `INSERT INTO ris.pharmacy_stock
         (health_unit_id, medication_id, drug_name, lot, expiry_date, unit_label, quantity, min_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (health_unit_id, drug_name, lot) DO UPDATE
         SET quantity   = ris.pharmacy_stock.quantity + EXCLUDED.quantity,
             min_level  = EXCLUDED.min_level,
             expiry_date= COALESCE(EXCLUDED.expiry_date, ris.pharmacy_stock.expiry_date),
             unit_label = EXCLUDED.unit_label,
             medication_id = COALESCE(EXCLUDED.medication_id, ris.pharmacy_stock.medication_id),
             updated_at = NOW()
       RETURNING id, quantity`,
      [unitId, medication_id, drug_name, lot || '', expiry_date, unit_label, quantity, min_level]
    );
    const stock = up.rows[0];
    await client.query(
      `INSERT INTO ris.pharmacy_movements
         (stock_id, health_unit_id, movement_type, quantity, balance_after, reason, moved_by)
       VALUES ($1,$2,'in',$3,$4,$5,$6)`,
      [stock.id, unitId, quantity, stock.quantity, reason, req.user.sub]
    );
    return stock;
  });
  await logPharmacy(req, 'PHARMACY_STOCK_IN', out.id, { drug_name, quantity });
  return created(res, out, 'Entrada registrada');
}

// Movimento manual: saída (out) ou ajuste (adjust). 'adjust' define o saldo final.
async function adjustStock(req, res) {
  const { movement_type, quantity, reason = null } = req.body;
  const out = await db.transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, health_unit_id, quantity FROM ris.pharmacy_stock WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!rows.length) throw new NotFoundError('Item de estoque');
    const s = rows[0];
    // Escopo: não-admin só mexe na própria unidade.
    if (req.user.role !== 'admin' && String(s.health_unit_id) !== String(req.user.health_unit_id)) {
      throw new AppError('Item de estoque de outra unidade', 403, 'UNIT_SCOPE');
    }
    let newQty;
    if (movement_type === 'out')      newQty = Number(s.quantity) - Number(quantity);
    else if (movement_type === 'adjust') newQty = Number(quantity);
    else throw new AppError('movement_type inválido (out|adjust)', 400);
    if (newQty < 0) throw new AppError('Saldo insuficiente em estoque', 409, 'STOCK_NEGATIVE');

    await client.query(
      `UPDATE ris.pharmacy_stock SET quantity = $1, updated_at = NOW() WHERE id = $2`,
      [newQty, s.id]
    );
    await client.query(
      `INSERT INTO ris.pharmacy_movements
         (stock_id, health_unit_id, movement_type, quantity, balance_after, reason, moved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [s.id, s.health_unit_id, movement_type, Math.abs(Number(quantity)), newQty, reason, req.user.sub]
    );
    return { id: s.id, quantity: newQty };
  });
  await logPharmacy(req, 'PHARMACY_STOCK_ADJUST', out.id, { movement_type, quantity });
  return success(res, out, 'Movimento registrado');
}

async function listMovements(req, res) {
  const { rows } = await db.query(
    `SELECT m.id, m.movement_type, m.quantity, m.balance_after, m.reason,
            m.dispensation_id, m.created_at, u.name AS moved_by_name
       FROM ris.pharmacy_movements m
       LEFT JOIN auth.users u ON u.id = m.moved_by
      WHERE m.stock_id = $1
      ORDER BY m.created_at DESC
      LIMIT 200`,
    [req.params.id]
  );
  return success(res, rows);
}

// ── Dispensação ───────────────────────────────────────────────────────────────
async function listDispensations(req, res) {
  const { rows } = await db.query(
    `SELECT d.id, d.prescription_id, d.encounter_id, d.status, d.notes, d.created_at,
            u.name AS dispensed_by_name,
            COALESCE(json_agg(json_build_object(
              'id', i.id, 'drug_name', i.drug_name, 'quantity', i.quantity,
              'unit_label', i.unit_label, 'prescription_item_id', i.prescription_item_id
            ) ORDER BY i.drug_name) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM ehr.dispensations d
       LEFT JOIN auth.users u ON u.id = d.dispensed_by
       LEFT JOIN ehr.dispensation_items i ON i.dispensation_id = d.id
      WHERE d.patient_id = $1
      GROUP BY d.id, u.name
      ORDER BY d.created_at DESC`,
    [req.params.id]
  );
  return success(res, rows);
}

// Dispensa medicamentos: cria a dispensação, baixa o estoque (movimento 'out')
// para cada item com stock_id, tudo em transação. Itens sem stock_id (ex.: doação
// externa ao estoque) são registrados sem baixa.
async function dispense(req, res) {
  const unitId = scopeUnit(req, req.body);
  if (!unitId) throw new AppError('Unidade não definida para a dispensação', 400);
  const { patient_id, prescription_id = null, encounter_id = null, notes = null, items } = req.body;
  if (!Array.isArray(items) || !items.length) throw new AppError('Informe ao menos um item', 400);

  const out = await db.transaction(async (client) => {
    const head = await client.query(
      `INSERT INTO ehr.dispensations
         (patient_id, encounter_id, prescription_id, health_unit_id, notes, dispensed_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, created_at`,
      [patient_id, encounter_id, prescription_id, unitId, notes, req.user.sub]
    );
    const dispId = head.rows[0].id;

    for (const it of items) {
      const qty = Number(it.quantity);
      if (!(qty > 0)) throw new AppError('Quantidade do item deve ser > 0', 400);
      let stockId = it.stock_id || null;
      let unitLabel = it.unit_label || 'un';

      if (stockId) {
        const sres = await client.query(
          `SELECT id, health_unit_id, quantity, unit_label FROM ris.pharmacy_stock WHERE id = $1 FOR UPDATE`,
          [stockId]
        );
        if (!sres.rows.length) throw new NotFoundError('Item de estoque');
        const s = sres.rows[0];
        if (String(s.health_unit_id) !== String(unitId))
          throw new AppError('Estoque pertence a outra unidade', 409, 'UNIT_SCOPE');
        const newQty = Number(s.quantity) - qty;
        if (newQty < 0) throw new AppError(`Saldo insuficiente: ${it.drug_name}`, 409, 'STOCK_NEGATIVE');
        unitLabel = s.unit_label || unitLabel;
        await client.query(`UPDATE ris.pharmacy_stock SET quantity = $1, updated_at = NOW() WHERE id = $2`, [newQty, s.id]);
        await client.query(
          `INSERT INTO ris.pharmacy_movements
             (stock_id, health_unit_id, movement_type, quantity, balance_after, reason, dispensation_id, moved_by)
           VALUES ($1,$2,'out',$3,$4,'Dispensação',$5,$6)`,
          [s.id, unitId, qty, newQty, dispId, req.user.sub]
        );
      }
      await client.query(
        `INSERT INTO ehr.dispensation_items
           (dispensation_id, prescription_item_id, stock_id, drug_name, quantity, unit_label)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [dispId, it.prescription_item_id || null, stockId, it.drug_name, qty, unitLabel]
      );
    }
    return { id: dispId, created_at: head.rows[0].created_at };
  });
  await logPharmacy(req, 'PHARMACY_DISPENSE', out.id, { patient_id, prescription_id, count: items.length });
  return created(res, out, 'Dispensação registrada');
}

module.exports = {
  listStock, createStock, adjustStock, listMovements,
  listDispensations, dispense,
};
