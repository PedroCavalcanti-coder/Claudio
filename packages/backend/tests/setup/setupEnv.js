'use strict';
/** Ambiente de cada arquivo de teste (roda ANTES de qualquer require da aplicação). */
const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  JWT_PRIVATE_KEY: privateKey,
  JWT_PUBLIC_KEY: publicKey,
  ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  KEY_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  RUSTFS_ENDPOINT: '127.0.0.1',
  RUSTFS_PORT: process.env.TEST_S3_PORT,
  RUSTFS_ACCESS_KEY: 'test',
  RUSTFS_SECRET_KEY: 'testtest',
  FRONTEND_URL: 'http://localhost:5173',
  // Os testes fazem dezenas de logins/requisições do mesmo "IP".
  AUTH_RATE_LIMIT_MAX: '100000',
  RATE_LIMIT_MAX: '100000',
  LOG_LEVEL: 'error',
});
process.env.ORTHANC_WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
