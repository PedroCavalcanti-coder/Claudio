'use strict';
/**
 * Confere, no boot, que a ENCRYPTION_KEY do .env é a que cifrou o banco.
 *   · há canário  → precisa decifrar; senão a API NÃO sobe (mensagem explícita);
 *   · sem canário → instalação nova: cria. Banco já em uso (upgrade): só cria se algum paciente
 *     existente decifra com a chave atual — se NENHUM decifra, a chave está errada → recusa.
 */
const db = require('../config/database');
const enc = require('./encryption');

const CANARY = 'ris-pacs-canary-v1';

class KeyMismatchError extends Error {
  constructor(msg) { super(msg); this.name = 'KeyMismatchError'; }
}

async function verifyEncryptionKey(client = db) {
  // Banco atualizado sem reaplicar o schema (001_schema.sql §21.7): cria a tabela aqui mesmo.
  await client.query(`CREATE TABLE IF NOT EXISTS ris.system_canary (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), value_enc BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const { rows } = await client.query(`SELECT value_enc FROM ris.system_canary WHERE id = 1`);
  if (rows.length) {
    let ok = false;
    try { ok = enc.decrypt(rows[0].value_enc) === CANARY; } catch { ok = false; }
    if (!ok) {
      throw new KeyMismatchError(
        'ENCRYPTION_KEY NÃO corresponde à chave que cifrou este banco. Restaure o .env correto ' +
        '(backup cifrado em backups/daily/env_*.tar.gz.enc) — NÃO inicie com outra chave, ' +
        'os dados pessoais ficariam ilegíveis e os novos seriam gravados com a chave errada.');
    }
    return { status: 'ok' };
  }

  const { rows: pts } = await client.query(
    `SELECT name_encrypted FROM ris.patients WHERE name_encrypted IS NOT NULL ORDER BY created_at DESC LIMIT 20`);
  if (pts.length) {
    const readable = pts.filter((p) => { try { enc.decrypt(p.name_encrypted); return true; } catch { return false; } });
    if (!readable.length) {
      throw new KeyMismatchError(
        'ENCRYPTION_KEY não decifra nenhum paciente deste banco — chave errada ou ausente no .env. ' +
        'Recupere o .env original antes de subir a API.');
    }
  }
  await client.query(`INSERT INTO ris.system_canary (id, value_enc) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`, [enc.encrypt(CANARY)]);
  return { status: pts.length ? 'created_existing_db' : 'created' };
}

module.exports = { verifyEncryptionKey, KeyMismatchError };
