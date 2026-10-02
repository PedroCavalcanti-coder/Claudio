'use strict';
/** P0-9: instalação nova sem dump e sem internet — só catálogos + 1 admin com senha aleatória. */
const { Pool, Client } = require('pg');
const bcrypt = require('bcryptjs');
const { runBootstrap } = require('../scripts/lib/bootstrap');

const base = new URL(process.env.TEST_DATABASE_URL);
const dbName = `${base.pathname.slice(1)}_boot`;
let pool;

beforeAll(async () => {
  const admin = new Client({ connectionString: Object.assign(new URL(base), { pathname: '/postgres' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  pool = new Pool({ connectionString: Object.assign(new URL(base), { pathname: `/${dbName}` }).toString() });
});
afterAll(async () => { await pool.end(); });

describe('bootstrap', () => {
  let first;
  it('banco vazio → schema + catálogos + 1 admin, sem dados de demonstração', async () => {
    first = await runBootstrap(pool, { adminEmail: 'Admin@Prefeitura.gov.br', rounds: 4 });
    expect(first.adminCreated).toBe(true);
    expect(first.adminPassword).toMatch(/^P.{14,}/);

    const q = async (sql) => (await pool.query(sql)).rows[0].n;
    expect(await q(`SELECT count(*)::int n FROM auth.users`)).toBe(1);
    expect(await q(`SELECT count(*)::int n FROM ris.health_units`)).toBe(0);
    expect(await q(`SELECT count(*)::int n FROM ris.patients`)).toBe(0);
    expect(await q(`SELECT count(*)::int n FROM ris.procedures`)).toBeGreaterThan(0);
    expect(await q(`SELECT count(*)::int n FROM ris.cid10`)).toBeGreaterThan(60);
    expect(await q(`SELECT count(*)::int n FROM ris.medications_catalog`)).toBeGreaterThan(50);
    expect(await q(`SELECT count(*)::int n FROM ris.sla_configs`)).toBe(3);
    expect(await q(`SELECT count(*)::int n FROM ris.consent_terms`)).toBe(1);
  });

  it('o admin usa a senha impressa, em e-mail normalizado, com troca obrigatória', async () => {
    const { rows: [u] } = await pool.query(`SELECT email, role, password_hash, must_change_password FROM auth.users`);
    expect(u).toMatchObject({ email: 'admin@prefeitura.gov.br', role: 'admin', must_change_password: true });
    expect(await bcrypt.compare(first.adminPassword, u.password_hash)).toBe(true);
    expect(u.password_hash).not.toContain('admin123456');
  });

  it('é idempotente: reexecutar não cria 2º admin nem duplica catálogos', async () => {
    const before = (await pool.query(`SELECT (SELECT count(*) FROM ris.cid10)::int c, (SELECT count(*) FROM ris.procedures)::int p`)).rows[0];
    const again = await runBootstrap(pool, { rounds: 4 });
    expect(again.adminCreated).toBe(false);
    expect(again.adminPassword).toBeNull();
    expect((await pool.query(`SELECT count(*)::int n FROM auth.users`)).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT (SELECT count(*) FROM ris.cid10)::int c, (SELECT count(*) FROM ris.procedures)::int p`)).rows[0]).toEqual(before);
  });

  it('--reset-admin gera nova senha e invalida a antiga', async () => {
    const r = await runBootstrap(pool, { resetAdmin: true, rounds: 4 });
    expect(r.adminCreated).toBe(true);
    const { rows: [u] } = await pool.query(`SELECT password_hash FROM auth.users`);
    expect(await bcrypt.compare(r.adminPassword, u.password_hash)).toBe(true);
    expect(await bcrypt.compare(first.adminPassword, u.password_hash)).toBe(false);
    expect((await pool.query(`SELECT count(*)::int n FROM auth.users`)).rows[0].n).toBe(1);
  });
});
