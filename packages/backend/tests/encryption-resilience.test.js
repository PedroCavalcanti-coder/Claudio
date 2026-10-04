'use strict';
/** P2-2: registro ilegível não derruba a lista; chave errada impede o boot com mensagem clara. */
const crypto = require('crypto');
const { Pool, Client } = require('pg');
const db = require('../src/config/database');
const enc = require('../src/services/encryption');
const { verifyEncryptionKey, KeyMismatchError } = require('../src/services/keyCheck');
const { as, uniqueCpf, uniqueSlot } = require('./helpers/api');

describe('listagens com registro ilegível', () => {
  let recep, doctor, pid;
  beforeAll(async () => {
    [recep, doctor] = await Promise.all([as('recep'), as('doctor')]);
    pid = (await recep.post('/patients', { name: 'Paciente Corrompido', birth_date: '1980-01-01', gender: 'M', cpf: uniqueCpf() })).body.data.id;
    await recep.post('/appointments', { patient_id: pid, appointment_kind: 'consultation',
      assigned_doctor_id: doctor.user.id, scheduled_at: uniqueSlot(), reason: 'x' });
  });
  afterAll(async () => { await db.pool.end(); });

  it('nome cifrado com outra chave → lista segue 200 e mostra "[ilegível]"', async () => {
    const other = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', other, iv);
    const bad = Buffer.concat([iv, c.update('Nome Qualquer'), c.final(), c.getAuthTag()]);
    await db.query(`UPDATE ris.patients SET name_encrypted = $2 WHERE id = $1`, [pid, bad]);

    const appts = await recep.get('/appointments?limit=100');
    expect(appts.status).toBe(200);
    expect(appts.body.data.find((a) => a.patient_id === pid).patient_name).toBe('[ilegível]');
    const pts = await recep.get('/patients?limit=100&include_inactive=true');
    expect(pts.status).toBe(200);
    expect((await recep.get(`/patients/${pid}`)).status).toBe(200);
    expect((await doctor.get('/ehr/queue')).status).toBe(200);
  });

  it('safeDecrypt: nulo → nulo; e-mail/telefone ilegível nunca vira texto', () => {
    expect(enc.safeDecrypt(null)).toBeNull();
    expect(enc.safeDecrypt(Buffer.from('lixo-qualquer-coisa-aqui-123456'), null)).toBeNull();
    expect(enc.safeDecrypt(Buffer.from('lixo-qualquer-coisa-aqui-123456'))).toBe('[ilegível]');
  });
});

describe('canário da ENCRYPTION_KEY no boot', () => {
  const base = new URL(process.env.TEST_DATABASE_URL);
  const name = `${base.pathname.slice(1)}_key`;
  let pool;
  const wrongKeyCipher = (text) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', crypto.randomBytes(32), iv);
    return Buffer.concat([iv, c.update(text), c.final(), c.getAuthTag()]);
  };

  beforeEach(async () => {
    const admin = new Client({ connectionString: Object.assign(new URL(base), { pathname: '/postgres' }).toString() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.end();
    pool = new Pool({ connectionString: Object.assign(new URL(base), { pathname: `/${name}` }).toString() });
    await pool.query(`CREATE SCHEMA ris; CREATE TABLE ris.patients (id serial primary key, name_encrypted bytea, created_at timestamptz default now())`);
  });
  afterEach(async () => { await pool.end(); });

  it('banco novo: cria o canário; depois confere', async () => {
    expect((await verifyEncryptionKey(pool)).status).toBe('created');
    expect((await verifyEncryptionKey(pool)).status).toBe('ok');
  });

  it('canário de outra chave → recusa subir com mensagem explícita', async () => {
    await verifyEncryptionKey(pool);
    await pool.query(`UPDATE ris.system_canary SET value_enc = $1`, [wrongKeyCipher('ris-pacs-canary-v1')]);
    await expect(verifyEncryptionKey(pool)).rejects.toThrow(KeyMismatchError);
    await expect(verifyEncryptionKey(pool)).rejects.toThrow(/ENCRYPTION_KEY/);
  });

  it('banco antigo sem canário: chave que NÃO decifra pacientes é recusada; a certa cria o canário', async () => {
    await pool.query(`INSERT INTO ris.patients (name_encrypted) VALUES ($1)`, [wrongKeyCipher('Fulano')]);
    await expect(verifyEncryptionKey(pool)).rejects.toThrow(KeyMismatchError);
    await pool.query(`INSERT INTO ris.patients (name_encrypted) VALUES ($1)`, [enc.encrypt('Beltrano')]);
    expect((await verifyEncryptionKey(pool)).status).toBe('created_existing_db');
  });
});
