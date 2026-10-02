const rateLimit = require('express-rate-limit');
const env = require('../config/env');

/** Rate limiter geral para toda a API */
// Fluxos legítimos que disparam MUITAS requisições para um único recurso e não
// devem ser barrados pelo limite global (auth + escopo já os protegem):
//   - upload em blocos (#23): 1 req por chunk; um estudo grande passa de 100;
//   - viewer DICOM: abrir UM estudo baixa 1 instância por imagem (CT > 400);
//   - listagem de instâncias do viewer.
const HIGH_VOLUME_PATHS = [
  /\/studies\/upload\/[^/]+\/chunk$/,
  /\/studies\/[^/]+\/instances\/[^/]+\/stream$/,
  /\/studies\/dicom\/[^/]+\/instances$/,
];

const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max:      env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders:   false,
  skip: (req) => {
    const path = (req.originalUrl || req.url).split('?')[0];
    return HIGH_VOLUME_PATHS.some((re) => re.test(path));
  },
  message: { success: false, message: 'Muitas requisições. Tente novamente em alguns minutos.' },
});

/** Rate limiter severo para rotas de autenticação (anti brute-force) */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max:      env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

/** Rate limiter para portal externo */
const portalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Limite de acesso ao portal excedido.' },
});

/**
 * Rate limiter para leitura de imagens DICOM no portal do paciente. O viewer
 * lite e o download do exame baixam 1 instância por imagem — um estudo de CT
 * passa de 400 — então o portalLimiter (20/h) é inviável aqui. Ainda assim
 * mantém um teto generoso por janela como proteção contra abuso (auth + posse
 * do estudo já restringem o acesso).
 */
const portalStreamLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max:      3000,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Limite de download de imagens excedido. Tente novamente em alguns minutos.' },
});

module.exports = { apiLimiter, authLimiter, portalLimiter, portalStreamLimiter };
