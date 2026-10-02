'use strict';
/**
 * Seed curado dos catálogos clínicos (#9): medicamentos, CID-10 e interações.
 * Idempotente. Rodar: node scripts/seed_catalog.js   (o bootstrap já chama isto)
 */
require('dotenv').config();
const { Pool } = require('pg');
const { seedCatalog } = require('./lib/seedCatalog');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await seedCatalog(pool);
    console.log(`Seed OK — medicamentos +${r.med} (total ${r.medTotal}); CID-10 +${r.cid} (total ${r.cidTotal}); interações +${r.inter} (total ${r.intTotal}).`);
  } catch (e) {
    console.error('FALHA:', e.message); process.exitCode = 1;
  } finally { await pool.end(); }
})();
