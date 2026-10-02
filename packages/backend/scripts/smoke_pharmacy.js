'use strict';
/**
 * Smoke transacional da farmácia (§17). Entrada de estoque → dispensação baixa →
 * confere saldo, ledger e CHECK de saldo negativo. ROLLBACK (não persiste nada).
 * Rodar: node scripts/smoke_pharmacy.js
 */
require('dotenv').config();
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const u = await c.query(`SELECT id FROM ris.health_units LIMIT 1`);
    const p = await c.query(`SELECT id FROM ris.patients LIMIT 1`);
    if (!u.rows.length || !p.rows.length) throw new Error('sem unidade/paciente para o smoke');
    const unit = u.rows[0].id, pat = p.rows[0].id;

    const s = await c.query(
      `INSERT INTO ris.pharmacy_stock (health_unit_id, drug_name, lot, unit_label, quantity, min_level)
       VALUES ($1,'SMOKE Dipirona 500mg','L1','comp',100,10) RETURNING id`, [unit]);
    const stockId = s.rows[0].id;
    await c.query(`INSERT INTO ris.pharmacy_movements (stock_id,health_unit_id,movement_type,quantity,balance_after,reason)
      VALUES ($1,$2,'in',100,100,'entrada')`, [stockId, unit]);

    const d = await c.query(`INSERT INTO ehr.dispensations (patient_id,health_unit_id,status) VALUES ($1,$2,'dispensed') RETURNING id`, [pat, unit]);
    const dispId = d.rows[0].id;
    const newQty = 70;
    await c.query(`UPDATE ris.pharmacy_stock SET quantity=$1 WHERE id=$2`, [newQty, stockId]);
    await c.query(`INSERT INTO ris.pharmacy_movements (stock_id,health_unit_id,movement_type,quantity,balance_after,reason,dispensation_id)
      VALUES ($1,$2,'out',30,$3,'Dispensação',$4)`, [stockId, unit, newQty, dispId]);
    await c.query(`INSERT INTO ehr.dispensation_items (dispensation_id,stock_id,drug_name,quantity,unit_label)
      VALUES ($1,$2,'SMOKE Dipirona 500mg',30,'comp')`, [dispId, stockId]);

    const chk = await c.query(`SELECT quantity FROM ris.pharmacy_stock WHERE id=$1`, [stockId]);
    const mv  = await c.query(`SELECT count(*)::int n FROM ris.pharmacy_movements WHERE stock_id=$1`, [stockId]);
    let negBlocked = false;
    await c.query('SAVEPOINT sp');
    try { await c.query(`UPDATE ris.pharmacy_stock SET quantity=-1 WHERE id=$1`, [stockId]); await c.query('RELEASE SAVEPOINT sp'); }
    catch { negBlocked = true; await c.query('ROLLBACK TO SAVEPOINT sp'); }

    console.log('saldo apos baixa =', chk.rows[0].quantity, '(esperado 70)');
    console.log('movimentos       =', mv.rows[0].n, '(esperado 2)');
    console.log('CHECK qty>=0     =', negBlocked, '(esperado true)');
    const pass = Number(chk.rows[0].quantity) === 70 && mv.rows[0].n === 2 && negBlocked;
    await c.query('ROLLBACK');
    console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
    process.exit(pass ? 0 : 1);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('ERRO:', e.message);
    process.exit(1);
  } finally { c.release(); await pool.end(); }
})();
