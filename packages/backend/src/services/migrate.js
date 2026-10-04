'use strict';
/**
 * Aplica migrations/001_schema.sql no boot. O arquivo é IDEMPOTENTE (IF NOT EXISTS / OR REPLACE /
 * DO…EXCEPTION), então reaplicar é seguro e leva a instalação antiga ao schema atual sem passo
 * manual depois de `git pull && docker compose up -d --build`. Trava de aconselhamento
 * (pg_advisory_lock) evita duas instâncias migrando juntas. Desligue com AUTO_MIGRATE=false.
 */
const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const logger = require('../config/logger');

const LOCK_ID = 727_001;   // chave arbitrária do lock de migração

async function migrate({ file = path.resolve(__dirname, '../../migrations/001_schema.sql') } = {}) {
  const sql = fs.readFileSync(file, 'utf8');
  const client = await db.getClient();
  const t0 = Date.now();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(sql);
    logger.info('Schema do banco conferido/atualizado', { ms: Date.now() - t0 });
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch { /* conexão encerrada */ }
    client.release();
  }
}

module.exports = { migrate };
