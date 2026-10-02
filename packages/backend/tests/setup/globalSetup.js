'use strict';
/**
 * Setup global do jest (roda uma vez, antes dos workers):
 *   1. recria o banco de teste e aplica 001_schema.sql + seed_catalogos.sql + seed_demo.sql;
 *   2. sobe um S3 falso (substitui o RustFS) numa porta livre.
 * O banco é descartável — NUNCA aponte TEST_DATABASE_URL para um banco real.
 *
 * Variáveis: TEST_DATABASE_URL (padrão postgresql://postgres@localhost:5432/ris_pacs_test)
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const fakeS3 = require('../helpers/fakeS3');

const DEFAULT_URL = 'postgresql://postgres@localhost:5432/ris_pacs_test';

module.exports = async () => {
  const url = new URL(process.env.TEST_DATABASE_URL || DEFAULT_URL);
  const dbName = url.pathname.slice(1);
  if (!/test/i.test(dbName)) {
    throw new Error(`TEST_DATABASE_URL deve apontar para um banco de teste (nome com "test"), recebido: ${dbName}`);
  }

  const admin = new Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  const dir = path.resolve(__dirname, '../../migrations');
  for (const f of ['001_schema.sql', 'seed_catalogos.sql', 'seed_demo.sql']) {
    await db.query(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  await db.end();

  const s3 = await fakeS3.start();
  global.__FAKE_S3__ = s3;
  process.env.TEST_DATABASE_URL = url.toString();
  process.env.TEST_S3_PORT = String(s3.port);
};
