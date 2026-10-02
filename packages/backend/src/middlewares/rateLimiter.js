'use strict';
/**
 * Limites de requisição.
 *
 * Princípio: o limite é por IDENTIDADE (usuário autenticado / conta do portal / sala de
 * teleconsulta), não por IP. Atrás do NAT/proxy de uma prefeitura todos os funcionários
 * compartilham UM IP — limitar por IP derrubava o Painel TV (polling 6 s), a sala de
 * teleconsulta (polling 1,2 s) e o portal (polling 20-60 s) em poucos minutos.
 *
 *   apiLimiter            global, por identidade; teto alto só como anti-abuso.
 *   authLimiter           anti brute-force de login: conta falhas por (IP + identificador)
 *                         e, em separado, por IP. Login bem-sucedido não consome o limite.
 *   portalLimiter         leituras do portal do paciente, por conta.
 *   portalSensitiveLimiter troca de senha etc., por conta, bem restrito.
 *   portalStreamLimiter   imagens DICOM no portal (1 req por instância).
 *   roomLimiter           sinalização WebRTC da teleconsulta, por sala + IP.
 */
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { verifyAccessToken } = require('../services/token');
const { verifyPortalJwt } = require('../services/portalToken');

// Fluxos legítimos que disparam MUITAS requisições e não devem consumir o limite global
// (auth + escopo já os protegem; alguns têm limitador próprio):
//   - upload em blocos: 1 req por chunk;
//   - viewer DICOM: 1 instância por imagem (CT > 400);
//   - Painel TV (/ehr/panel): polling a cada 6 s, o dia todo;
//   - sala de teleconsulta: polling de sinalização a cada ~1,2 s (tem roomLimiter próprio).
const HIGH_VOLUME_PATHS = [
  /\/studies\/upload\/[^/]+\/chunk$/,
  /\/studies\/[^/]+\/instances\/[^/]+\/stream$/,
  /\/studies\/dicom\/[^/]+\/instances$/,
  /\/ehr\/panel$/,
  /\/teleconsult\/room\//,
];

const pathOf = (req) => (req.originalUrl || req.url).split('?')[0];
const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 24);

/**
 * Chave de identidade da requisição. Só aceita identidade VERIFICADA (assinatura válida);
 * token forjado/expirado cai no IP — senão bastaria inventar um `sub` para ganhar um balde novo.
 */
async function identityKey(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const p = await verifyAccessToken(auth.slice(7));
      if (p?.sub) return `u:${p.sub}`;
    } catch { /* cai no próximo */ }
  }
  const portal = req.headers['x-portal-token'] || req.cookies?.portal_token;
  if (portal) {
    try { return `p:${verifyPortalJwt(portal).sub}`; } catch { /* cai no IP */ }
  }
  return `ip:${req.ip}`;
}

const base = {
  standardHeaders: true,
  legacyHeaders:   false,
};

function buildLimiters(cfg = {}) {
  const c = {
    windowMs:       env.RATE_LIMIT_WINDOW_MS,
    max:            env.RATE_LIMIT_MAX,
    authMax:        env.AUTH_RATE_LIMIT_MAX,
    authIpMax:      env.AUTH_IP_RATE_LIMIT_MAX,
    portalMax:      env.PORTAL_RATE_LIMIT_MAX,
    ...cfg,
  };

  /** Rate limiter geral para toda a API (por usuário/conta; IP só para anônimos). */
  const apiLimiter = rateLimit({
    ...base,
    windowMs: c.windowMs,
    max:      c.max,
    keyGenerator: identityKey,
    skip: (req) => HIGH_VOLUME_PATHS.some((re) => re.test(pathOf(req))),
    message: { success: false, message: 'Muitas requisições. Tente novamente em alguns minutos.' },
  });

  // Identificador da tentativa de login (CPF / e-mail / usuário) — sem guardar PII em claro.
  const loginIdentifier = (req) => {
    const b = req.body || {};
    const v = b.cpf ? String(b.cpf).replace(/\D/g, '') : (b.email || b.username || '');
    return hash(String(v).toLowerCase().trim());
  };
  const authLoginLimiter = rateLimit({
    ...base,
    windowMs: 15 * 60 * 1000,
    max:      c.authMax,
    skipSuccessfulRequests: true,                 // só tentativas que FALHAM contam
    keyGenerator: (req) => `${req.ip}|${loginIdentifier(req)}`,
    message: { success: false, message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  });
  // Teto por IP (varredura de vários usuários a partir de uma máquina), bem acima do uso normal.
  const authIpLimiter = rateLimit({
    ...base,
    windowMs: 15 * 60 * 1000,
    max:      c.authIpMax,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => `ip:${req.ip}`,
    message: { success: false, message: 'Muitas tentativas de login a partir deste endereço. Tente novamente em 15 minutos.' },
  });
  /** Anti brute-force das rotas de autenticação (login, registro, esqueci a senha). */
  const authLimiter = (req, res, next) =>
    authLoginLimiter(req, res, (err) => (err ? next(err) : authIpLimiter(req, res, next)));

  /** Leituras do portal do paciente: por conta (tela + polling de 20/30/60 s). */
  const portalLimiter = rateLimit({
    ...base,
    windowMs: 15 * 60 * 1000,
    max:      c.portalMax,
    keyGenerator: identityKey,
    message: { success: false, message: 'Limite de acesso ao portal excedido. Tente novamente em alguns minutos.' },
  });

  /** Ações sensíveis do portal (troca de senha): poucas por hora, por conta. */
  const portalSensitiveLimiter = rateLimit({
    ...base,
    windowMs: 60 * 60 * 1000,
    max:      20,
    keyGenerator: identityKey,
    message: { success: false, message: 'Limite de tentativas excedido. Tente novamente em 1 hora.' },
  });

  /**
   * Leitura de imagens DICOM no portal: 1 requisição por instância (um CT passa de 400),
   * então o teto é alto; auth + posse do estudo já restringem o acesso.
   */
  const portalStreamLimiter = rateLimit({
    ...base,
    windowMs: 15 * 60 * 1000,
    max:      3000,
    keyGenerator: identityKey,
    message: { success: false, message: 'Limite de download de imagens excedido. Tente novamente em alguns minutos.' },
  });

  /** Sala de teleconsulta: polling ~1,2 s por participante (≈ 750 req/15 min) + sinais. */
  const roomLimiter = rateLimit({
    ...base,
    windowMs: 15 * 60 * 1000,
    max:      c.roomMax ?? 6000,
    keyGenerator: (req) => `room:${req.params?.token || pathOf(req)}|${req.ip}`,
    message: { success: false, message: 'Muitas requisições à sala. Aguarde alguns instantes.' },
  });

  return { apiLimiter, authLimiter, portalLimiter, portalSensitiveLimiter, portalStreamLimiter, roomLimiter };
}

module.exports = { ...buildLimiters(), buildLimiters, HIGH_VOLUME_PATHS, identityKey };
