'use strict';
/**
 * Bootstrap de instalação NOVA (sem dump, sem internet):
 *   1. aplica migrations/001_schema.sql (idempotente);
 *   2. aplica migrations/seed_catalogos.sql (procedimentos-base, templates, SLA, TCLE, CID-10);
 *   3. carrega medicamentos/CID-10/interações curados;
 *   4. cria UM administrador com senha aleatória (impressa uma única vez; troca obrigatória
 *      no 1º login). NÃO cria unidades, pacientes nem usuários de demonstração.
 * Com { demo: true} aplica também seed_demo.sql (APENAS desenvolvimento).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { seedCatalog } = require('./seedCatalog');

const MIGRATIONS = path.resolve(__dirname, '../../migrations');
const read = (f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');

// Senha forte e digitável: maiúscula + base64url + 4 dígitos (≥ 16 chars).
function genPassword() {
  return 'P' + crypto.randomBytes(9).toString('base64url') + crypto.randomInt(1000, 9999);
}

/**
 * @param {import('pg').Pool} pool
 * @param {{adminEmail?:string, adminName?:string, resetAdmin?:boolean, demo?:boolean,
 *          catalog?:boolean, rounds?:number, log?:(m:string)=>void}} opts
 * @returns {Promise<{adminCreated:boolean, adminEmail:string|null, adminPassword:string|null}>}
 */
async function runBootstrap(pool, opts = {}) {
  const {
    adminEmail = 'admin@clinica.com.br', adminName = 'Administrador do Sistema',
    resetAdmin = false, demo = false, catalog = true,
    rounds = Number(process.env.BCRYPT_ROUNDS || 12), log = () => {},
  } = opts;

  log('Aplicando schema (001_schema.sql)…');
  await pool.query(read('001_schema.sql'));
  log('Aplicando catálogos (seed_catalogos.sql)…');
  await pool.query(read('seed_catalogos.sql'));
  if (catalog) {
    log('Carregando medicamentos / CID-10 / interações…');
    const r = await seedCatalog(pool);
    log(`  medicamentos ${r.medTotal} · CID-10 ${r.cidTotal} · interações ${r.intTotal}`);
  }
  if (demo) {
    log('!! Aplicando seed_demo.sql (usuários com senhas CONHECIDAS — só desenvolvimento) !!');
    await pool.query(read('seed_demo.sql'));
  }

  const { rows: admins } = await pool.query(
    `SELECT id, email FROM auth.users WHERE role = 'admin' AND is_active = TRUE ORDER BY created_at LIMIT 1`);
  if (admins.length && !resetAdmin) {
    log(`Administrador já existe (${admins[0].email}) — nada criado. Use --reset-admin para gerar nova senha.`);
    return { adminCreated: false, adminEmail: admins[0].email, adminPassword: null };
  }

  const password = genPassword();
  const hash = await bcrypt.hash(password, rounds);
  const email = (admins[0]?.email) || adminEmail.toLowerCase().trim();
  await pool.query(
    `INSERT INTO auth.users (name, email, password_hash, role, health_unit_id, is_active, must_change_password)
     VALUES ($1,$2,$3,'admin',NULL,TRUE,TRUE)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, is_active = TRUE, must_change_password = TRUE,
           failed_attempts = 0, locked_until = NULL, updated_at = NOW()`,
    [adminName, email, hash]);
  return { adminCreated: true, adminEmail: email, adminPassword: password };
}

module.exports = { runBootstrap, genPassword };
