const { createLogger, format, transports } = require('winston');
const env = require('./env');

const { combine, timestamp, errors, json, colorize, simple } = format;

const logger = createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: { service: 'ris-pacs-api' },
  transports: [
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: combine(colorize(), simple()),
  }));
}

module.exports = logger;
