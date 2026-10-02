'use strict';
/**
 * Token de sessão do portal do paciente: payload JSON + HMAC-SHA256 (chave = ENCRYPTION_KEY),
 * 8 h. Separado do JWT RS256 interno de propósito (paciente nunca vira "usuário").
 * Compartilhado pelo login (auth.controller / portal-patient), pelo middleware do portal
 * e pelo rate limiter (que chaveia por conta, não por IP).
 */
const crypto = require('crypto');
const env = require('../config/env');

const TTL_SECONDS = 8 * 3600;

function sign(payload) {
  return crypto.createHmac('sha256', env.ENCRYPTION_KEY).update(payload).digest('base64url');
}

function generatePortalJwt(accountId, patientId, healthUnitId) {
  const payload = Buffer.from(JSON.stringify({
    sub: accountId, pid: patientId, huid: healthUnitId, iss: 'ris-portal',
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Retorna o payload ou lança Error('INVALID'|'EXPIRED'). */
function verifyPortalJwt(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) throw new Error('INVALID');
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('INVALID');
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new Error('INVALID'); }
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) throw new Error('EXPIRED');
  return data;
}

module.exports = { generatePortalJwt, verifyPortalJwt };
