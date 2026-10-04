'use strict';
/**
 * Índice cego do nome do paciente (ver 001_schema.sql §21.8).
 *   · nameTokens(nome)  → hashes das palavras e de seus prefixos (3+ letras);
 *   · queryTokens(q)    → um hash por palavra da busca (exige palavra inteira = prefixo indexado);
 *   · indexPatientName  → regrava os tokens de um paciente;
 *   · backfillNameTokens→ indexa pacientes que ainda não têm tokens (instalação existente).
 */
const crypto = require('crypto');
const env = require('../config/env');
const enc = require('./encryption');
const logger = require('../config/logger');

const KEY = crypto.createHash('sha256').update(`name-token-key:${env.ENCRYPTION_KEY}`).digest();
const MIN_QUERY_LEN = 3;

const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s) => normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
const hmac = (t) => crypto.createHmac('sha256', KEY).update(t).digest('hex');

function nameTokens(name) {
  const out = new Set();
  for (const w of words(name)) {
    if (w.length < 3) { out.add(hmac(w)); continue; }
    for (let n = 3; n <= w.length; n++) out.add(hmac(w.slice(0, n)));
  }
  return [...out];
}

/** Tokens da consulta; palavras com menos de 3 letras são ignoradas (ruído: "da", "de"). */
function queryTokens(q) {
  return [...new Set(words(q).filter((w) => w.length >= MIN_QUERY_LEN).map(hmac))];
}

// Token inerte para quem não tem nome indexável (evita reprocessar no backfill).
const NONE = hmac('\u0000sem-nome');

async function indexPatientName(client, patientId, name) {
  await client.query(`DELETE FROM ris.patient_name_tokens WHERE patient_id = $1`, [patientId]);
  const tokens = name ? nameTokens(name) : [NONE];
  if (!tokens.length) { await client.query(`INSERT INTO ris.patient_name_tokens VALUES ($1, $2)`, [patientId, NONE]); return 0; }
  await client.query(
    `INSERT INTO ris.patient_name_tokens (patient_id, token_hash)
     SELECT $1, unnest($2::char(64)[]) ON CONFLICT DO NOTHING`, [patientId, tokens]);
  return tokens.length;
}

/** Indexa quem ainda não tem tokens (nome legível). Idempotente; devolve quantos indexou. */
async function backfillNameTokens(client, { batch = 500 } = {}) {
  let total = 0;
  for (;;) {
    const { rows } = await client.query(
      `SELECT p.id, p.name_encrypted FROM ris.patients p
        WHERE p.anonymized_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM ris.patient_name_tokens t WHERE t.patient_id = p.id)
        ORDER BY p.created_at LIMIT $1`, [batch]);
    if (!rows.length) break;
    let progressed = 0;
    for (const r of rows) {
      const name = enc.safeDecrypt(r.name_encrypted, null);
      await indexPatientName(client, r.id, name);   // nome ilegível → token inerte
      progressed++;
    }
    total += progressed;
    if (rows.length < batch) break;
  }
  if (total) logger.info('Índice de nomes: pacientes indexados', { total });
  return total;
}

module.exports = { nameTokens, queryTokens, indexPatientName, backfillNameTokens, normalize };
