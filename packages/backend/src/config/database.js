// Driver `pg` padrão (TCP) — funciona com Postgres LOCAL e também com Neon.
// (O driver @neondatabase/serverless usa WebSocket e só fala com a nuvem Neon;
//  por isso o banco local exigia o pg.)
const { Pool } = require('pg');
const env = require('./env');
const logger = require('./logger');

// SSL só quando o destino exige (Neon/serviços gerenciados). Postgres local não
// tem TLS por padrão — forçar ssl quebraria a conexão. Decidido pela URL.
const cs = env.DATABASE_URL || '';
const needSsl = /sslmode=require/i.test(cs)
  || /neon\.tech/i.test(cs)
  || /\.rds\.amazonaws\.com/i.test(cs)
  || process.env.DB_SSL === 'true';

const pool = new Pool({
  connectionString: cs,
  ssl: needSsl ? { rejectUnauthorized: false } : false,
});


pool.on('error', (err) => {
  logger.error('PostgreSQL pool error', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('PostgreSQL: nova conexão estabelecida');
});

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (env.NODE_ENV === 'development') {
    logger.debug('DB query', { text: text.substring(0, 120), duration, rows: result.rowCount });
  }
  return result;
}

// Cliente para transações manuais: quem chamar deve usar try/finally para liberá-lo.
async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  client.query = (...args) => {
    if (env.NODE_ENV === 'development') {
      logger.debug('TX query', { text: String(args[0]).substring(0, 80) });
    }
    return originalQuery(...args);
  };
  return client;
}

async function transaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function healthCheck() {
  const { rows } = await query('SELECT NOW() AS now');
  return rows[0].now;
}

module.exports = { query, getClient, transaction, healthCheck, pool };
