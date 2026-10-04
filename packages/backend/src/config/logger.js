const { createLogger, format, transports } = require('winston');
const env = require('./env');

const { combine, timestamp, errors, json, colorize, simple } = format;

/**
 * Logs:
 *   · SEMPRE no console (stdout) — é o que `docker compose logs backend` mostra e o Docker rotaciona
 *     (max-size no compose). Produção: JSON, uma linha por evento (fácil de filtrar/ingerir);
 *     desenvolvimento: colorido e legível.
 *   · Arquivo opcional (LOG_TO_FILE=true) em LOG_DIR, com rotação (maxsize/maxfiles) — antes o
 *     arquivo crescia sem limite e se perdia ao recriar o container.
 */
const jsonFormat = combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), json());

const logger = createLogger({
  level: env.LOG_LEVEL,
  format: jsonFormat,
  defaultMeta: { service: 'ris-pacs-api' },
  transports: [],
});

if (env.NODE_ENV === 'production') {
  logger.add(new transports.Console());
} else if (env.NODE_ENV !== 'test') {
  logger.add(new transports.Console({
    format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), colorize(), simple()),
  }));
} else {
  // Testes: console silencioso (só erros aparecem, via LOG_LEVEL=error do setup).
  logger.add(new transports.Console({ format: combine(colorize(), simple()) }));
}

if (env.LOG_TO_FILE) {
  const path = require('path');
  const dir = env.LOG_DIR;
  logger.add(new transports.File({
    filename: path.join(dir, 'error.log'), level: 'error',
    maxsize: 10 * 1024 * 1024, maxFiles: 5, tailable: true,
  }));
  logger.add(new transports.File({
    filename: path.join(dir, 'combined.log'),
    maxsize: 10 * 1024 * 1024, maxFiles: 5, tailable: true,
  }));
}

module.exports = logger;
