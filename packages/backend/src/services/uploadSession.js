'use strict';

/**
 * Sessões de upload em blocos (chunked) gravadas em DISCO.
 * --------------------------------------------------------------------
 * Motivação: o upload antigo usava multer.memoryStorage(), que
 * bufferiza TODOS os arquivos do estudo em RAM de uma vez. Um estudo de
 * CT/MR com milhares de cortes (vários GB) derrubava o processo por OOM.
 *
 * Aqui o cliente:
 *   1. abre uma sessão (init) declarando o manifesto (nome/size/sha256);
 *   2. envia cada arquivo em um ou mais blocos (chunk) — gravados direto
 *      em disco via stream, consumo de RAM constante e pequeno;
 *   3. chama finalize, que VERIFICA integridade (size + sha256) antes de
 *      enviar ao Orthanc e indexar no PACS.
 *
 * Os blocos são anexados (append) em ordem; o orquestrador do cliente
 * envia os blocos de cada arquivo sequencialmente.
 */

const fs       = require('fs');
const fsp       = require('fs/promises');
const path     = require('path');
const crypto   = require('crypto');
const { randomUUID } = require('crypto');
const { pipeline }   = require('stream/promises');
const env    = require('../config/env');
const logger = require('../config/logger');

const BASE_DIR       = env.UPLOAD_TMP_DIR;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;   // 6h — sessão órfã é varrida

// Índice em memória (uploadId -> manifest). O manifesto também é persistido
// em disco (manifest.json), então sobrevive a uma releitura, mas NÃO a uma
// reinicialização do processo — sessões pendentes nesse caso são varridas.
const sessions = new Map();

async function ensureBase() {
  await fsp.mkdir(BASE_DIR, { recursive: true });
}

const sessionDir   = (uploadId)            => path.join(BASE_DIR, uploadId);
const partPath     = (uploadId, fileIndex) => path.join(sessionDir(uploadId), `${fileIndex}.part`);
const manifestPath = (uploadId)            => path.join(sessionDir(uploadId), 'manifest.json');

/**
 * Cria uma sessão de upload.
 * @param {{ ownerSub: string, meta: object, files: Array<{name,size,sha256?}> }} args
 */
async function create({ ownerSub, meta, files }) {
  await ensureBase();
  const uploadId = randomUUID();
  await fsp.mkdir(sessionDir(uploadId), { recursive: true });

  const manifest = {
    uploadId,
    ownerSub,
    meta,
    createdAt: Date.now(),
    files: files.map((f, i) => ({
      index:  i,
      name:   f.name,
      size:   f.size,
      sha256: f.sha256 ? String(f.sha256).toLowerCase() : null,
    })),
  };

  await fsp.writeFile(manifestPath(uploadId), JSON.stringify(manifest), 'utf8');
  sessions.set(uploadId, manifest);
  return manifest;
}

/** Carrega o manifesto (cache em memória → disco). null se não existir. */
async function load(uploadId) {
  if (sessions.has(uploadId)) return sessions.get(uploadId);
  try {
    const manifest = JSON.parse(await fsp.readFile(manifestPath(uploadId), 'utf8'));
    sessions.set(uploadId, manifest);
    return manifest;
  } catch {
    return null;
  }
}

/**
 * Anexa um bloco ao arquivo de índice `fileIndex`. Stream direto pro disco.
 * Retorna o tamanho acumulado do arquivo .part.
 */
async function appendChunk(uploadId, fileIndex, readable) {
  const target = partPath(uploadId, fileIndex);
  const ws = fs.createWriteStream(target, { flags: 'a' });
  await pipeline(readable, ws);
  const { size } = await fsp.stat(target);
  return size;
}

/** SHA-256 (hex) de um arquivo, lido em stream (RAM constante). */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const rs   = fs.createReadStream(filePath);
    rs.on('error', reject);
    rs.on('data',  (d) => hash.update(d));
    rs.on('end',   () => resolve(hash.digest('hex')));
  });
}

/**
 * Verifica integridade de todos os arquivos da sessão.
 * @returns {{ ok: boolean, failures: Array }}
 */
async function verify(uploadId) {
  const manifest = await load(uploadId);
  if (!manifest) return { ok: false, failures: [{ reason: 'session_not_found' }] };

  const failures = [];
  for (const f of manifest.files) {
    const p = partPath(uploadId, f.index);
    let stat;
    try {
      stat = await fsp.stat(p);
    } catch {
      failures.push({ index: f.index, name: f.name, reason: 'missing' });
      continue;
    }
    if (stat.size !== f.size) {
      failures.push({ index: f.index, name: f.name, reason: 'size_mismatch', expected: f.size, actual: stat.size });
      continue;
    }
    if (f.sha256) {
      const digest = await sha256File(p);
      if (digest !== f.sha256) {
        failures.push({ index: f.index, name: f.name, reason: 'checksum_mismatch' });
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Stream de leitura de um arquivo da sessão (para enviar ao Orthanc). */
function openFileStream(uploadId, fileIndex) {
  return fs.createReadStream(partPath(uploadId, fileIndex));
}

/** Remove a sessão (memória + disco). Idempotente. */
async function cleanup(uploadId) {
  sessions.delete(uploadId);
  try {
    await fsp.rm(sessionDir(uploadId), { recursive: true, force: true });
  } catch (err) {
    logger.warn('[uploadSession] falha ao limpar sessão', { uploadId, error: err.message });
  }
}

/** Varre e remove sessões mais velhas que o TTL (órfãs/abandonadas). */
async function sweepStale() {
  await ensureBase();
  let entries;
  try {
    entries = await fsp.readdir(BASE_DIR, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const uploadId = e.name;
    let createdAt = null;
    try {
      const m = JSON.parse(await fsp.readFile(manifestPath(uploadId), 'utf8'));
      createdAt = m.createdAt;
    } catch {
      try { createdAt = (await fsp.stat(sessionDir(uploadId))).mtimeMs; } catch { /* ignore */ }
    }
    if (createdAt != null && Date.now() - createdAt > SESSION_TTL_MS) {
      await cleanup(uploadId);
      removed++;
    }
  }
  if (removed) logger.info('[uploadSession] sessões expiradas removidas', { removed });
  return removed;
}

module.exports = {
  create, load, appendChunk, verify, openFileStream, cleanup, sweepStale,
  BASE_DIR, SESSION_TTL_MS,
};
