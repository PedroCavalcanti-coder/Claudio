'use strict';
/**
 * Migra USUÁRIOS (auth.users) + UNIDADES (ris.health_units) do Neon → Postgres
 * LOCAL, por CHAVE NATURAL (mantém os UUIDs locais → não quebra FKs de seed
 * existentes: modalidades, salas, unit_procedures, etc.).
 *
 *  · Unidades: casa por cnes → cnpj → name. Match = UPDATE dos dados; sem match
 *    = INSERT (com o UUID do Neon).
 *  · Usuários: casa por email. Remapeia health_unit_id (id do Neon → id local).
 *    Match = UPDATE; sem match = INSERT (traz contas novas criadas no Neon).
 *
 * Idempotente. Transacional (rollback se a verificação de FK falhar).
 * Rodar:  NEON_URL="postgres://...neon.tech/..." node scripts/migrate_org_from_neon.js
 *         (DATABASE_URL do .env aponta para o LOCAL)
 */
require('dotenv').config();
const { Pool } = require('pg');

const norm = (v) => (v === undefined ? null : v);

(async () => {
  if (!process.env.NEON_URL) { console.error('Defina NEON_URL (origem Neon)'); process.exit(1); }
  const neon = new Pool({ connectionString: process.env.NEON_URL, ssl: { rejectUnauthorized: false } });
  const loc  = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await loc.connect();

  // Tipos das colunas locais (p/ serializar jsonb).
  const colTypes = async (schema, table) => {
    const { rows } = await loc.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [schema, table]);
    return rows; // [{column_name, data_type}]
  };
  const toParam = (val, type) => {
    if (val === null || val === undefined) return null;
    if (type === 'jsonb' || type === 'json') return JSON.stringify(val);
    return val; // arrays (ARRAY), timestamps, text — pg lida
  };

  try {
    const unitCols = await colTypes('ris', 'health_units');
    const userCols = await colTypes('auth', 'users');
    const unitNames = unitCols.map(c => c.column_name);
    const userNames = userCols.map(c => c.column_name);

    const neonUnits = (await neon.query(`SELECT ${unitNames.join(',')} FROM ris.health_units`)).rows;
    const neonUsers = (await neon.query(`SELECT ${userNames.join(',')} FROM auth.users`)).rows;
    const localUnits = (await loc.query(`SELECT id, cnes, cnpj, name FROM ris.health_units`)).rows;

    await client.query('BEGIN');

    // ── Unidades ──────────────────────────────────────────────────────────────
    const unitMap = {}; // neon unit id -> local unit id
    let unitsUpdated = 0, unitsInserted = 0;
    const findLocalUnit = (u) =>
      (u.cnes && localUnits.find(l => l.cnes && l.cnes === u.cnes)) ||
      (u.cnpj && localUnits.find(l => l.cnpj && l.cnpj === u.cnpj)) ||
      localUnits.find(l => l.name === u.name) || null;

    for (const u of neonUnits) {
      const match = findLocalUnit(u);
      if (match) {
        const sets = unitCols.filter(c => c.column_name !== 'id');
        const vals = sets.map(c => toParam(u[c.column_name], c.data_type));
        await client.query(
          `UPDATE ris.health_units SET ${sets.map((c, i) => `${c.column_name}=$${i + 1}`).join(', ')} WHERE id=$${sets.length + 1}`,
          [...vals, match.id]);
        unitMap[u.id] = match.id; unitsUpdated++;
      } else {
        const vals = unitCols.map(c => toParam(u[c.column_name], c.data_type));
        await client.query(
          `INSERT INTO ris.health_units (${unitNames.join(',')}) VALUES (${unitNames.map((_, i) => `$${i + 1}`).join(',')})`,
          vals);
        unitMap[u.id] = u.id; unitsInserted++;
      }
    }

    // ── Usuários ────────────────────────────────────────────────────────────────
    let usersUpdated = 0, usersInserted = 0;
    for (const usr of neonUsers) {
      const localUnitId = usr.health_unit_id ? (unitMap[usr.health_unit_id] || null) : null;
      const row = { ...usr, health_unit_id: localUnitId };
      const ex = await client.query(`SELECT id FROM auth.users WHERE email=$1`, [usr.email]);
      if (ex.rows.length) {
        const sets = userCols.filter(c => c.column_name !== 'id');
        const vals = sets.map(c => toParam(row[c.column_name], c.data_type));
        await client.query(
          `UPDATE auth.users SET ${sets.map((c, i) => `${c.column_name}=$${i + 1}`).join(', ')} WHERE id=$${sets.length + 1}`,
          [...vals, ex.rows[0].id]);
        usersUpdated++;
      } else {
        const vals = userCols.map(c => toParam(row[c.column_name], c.data_type));
        await client.query(
          `INSERT INTO auth.users (${userNames.join(',')}) VALUES (${userNames.map((_, i) => `$${i + 1}`).join(',')})`,
          vals);
        usersInserted++;
      }
    }

    // ── Verificação de integridade (FK user→unit) antes de commitar ─────────────
    const dangling = await client.query(
      `SELECT count(*) c FROM auth.users u
        WHERE u.health_unit_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ris.health_units h WHERE h.id=u.health_unit_id)`);
    if (Number(dangling.rows[0].c) > 0) throw new Error('FK quebrada: usuários com health_unit_id inexistente');

    await client.query('COMMIT');
    console.log(`Unidades: ${unitsUpdated} atualizadas, ${unitsInserted} inseridas.`);
    console.log(`Usuários: ${usersUpdated} atualizados, ${usersInserted} inseridos.`);
    console.log('FK user→unit: OK (sem dangling). COMMIT.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FALHA (rollback):', e.message);
    process.exitCode = 1;
  } finally {
    client.release(); await neon.end(); await loc.end();
  }
})();
