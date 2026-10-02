const { SignJWT, jwtVerify, importPKCS8, importSPKI } = require('jose');
const crypto = require('crypto');
const env = require('../config/env');
const db = require('../config/database');

let privateKey, publicKey;

async function loadKeys() {
  if (privateKey && publicKey) return;
  privateKey = await importPKCS8(env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
  publicKey  = await importSPKI(env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n'), 'RS256');
}

async function generateAccessToken(user) {
  await loadKeys();
  return new SignJWT({
    sub:                 user.id,
    email:               user.email,
    role:                user.role,
    name:                user.name,
    // Atributos de visibilidade multi-unidade (lidos por unitVisibility.js)
    health_unit_id:      user.health_unit_id      ?? null,
    is_network_resource: !!user.is_network_resource,
    // Perfil customizado por composição (lido por authorize())
    extra_roles:         Array.isArray(user.extra_roles) ? user.extra_roles : [],
    // Overrides granulares de permissão por usuário, lidos por requirePermission()
    permission_overrides: user.permission_overrides || { granted: [], revoked: [] },
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_EXPIRES)
    .setIssuer('ris-pacs-api')
    .setAudience('ris-pacs-frontend')
    .sign(privateKey);
}

async function verifyAccessToken(token) {
  await loadKeys();
  const { payload } = await jwtVerify(token, publicKey, {
    issuer:   'ris-pacs-api',
    audience: 'ris-pacs-frontend',
  });
  return payload;
}

// Só o hash SHA-256 do token é persistido — o token opaco em si nunca é salvo em texto puro.
async function generateRefreshToken(userId, deviceInfo = {}) {
  const token     = crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES));

  await db.query(
    `INSERT INTO auth.refresh_tokens (user_id, token_hash, device_info, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, tokenHash, JSON.stringify(deviceInfo), expiresAt]
  );

  return token;
}

async function validateRefreshToken(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await db.query(
    `SELECT rt.*, u.id as user_id, u.email, u.role, u.name, u.is_active
     FROM auth.refresh_tokens rt
     JOIN auth.users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()`,
    [tokenHash]
  );
  if (!rows.length) throw new Error('Refresh token inválido ou expirado');
  if (!rows[0].is_active) throw new Error('Usuário inativo');
  return rows[0];
}

async function revokeRefreshToken(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await db.query(
    `UPDATE auth.refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1`,
    [tokenHash]
  );
}

// Revoga todos os refresh tokens ativos do usuário — usado no logout de todos os dispositivos.
async function revokeAllUserTokens(userId) {
  await db.query(
    `UPDATE auth.refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 3600 * 1000;
  const [, n, unit] = match;
  const ms = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(n) * ms[unit];
}

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
};
