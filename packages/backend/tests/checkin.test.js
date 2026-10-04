'use strict';
/** P1-4/P1-5: check-in confirma identidade (CPF, CNS ou documento) — sem senha, sem conta de portal. */
const db = require('../src/config/database');
const { isValidCns } = require('../src/utils/cns');
const { as, uniqueCpf, uniqueSlot } = require('./helpers/api');

let recep, doctor;

function validCns() {
  for (;;) {
    const c = '7' + String(Math.floor(Math.random() * 1e14)).padStart(14, '0');
    if (isValidCns(c)) return c;
  }
}

async function patientWith(body) {
  const res = await recep.post('/patients', { name: 'Paciente Checkin', birth_date: '1950-04-04', gender: 'M', ...body });
  expect(res.status).toBe(201);
  return res.body.data.id;
}
let slot = 0;
async function consulta(patient_id) {   // cada consulta em um horário próprio (o médico não pode ficar em duas)
  const res = await recep.post('/appointments', {
    patient_id, appointment_kind: 'consultation', assigned_doctor_id: doctor.user.id,
    scheduled_at: uniqueSlot(), reason: 'Revisão',
  });
  expect(res.status).toBe(201);
  return res.body.data.id;
}
const portalAccounts = async (pid) =>
  (await db.query(`SELECT count(*)::int n FROM ris.patient_portal_accounts WHERE patient_id = $1`, [pid])).rows[0].n;

beforeAll(async () => { [recep, doctor] = await Promise.all([as('recep'), as('doctor')]); });
afterAll(async () => { await db.pool.end(); });

describe('check-in sem senha do portal', () => {
  it('paciente com CPF faz check-in só com o CPF — nenhuma conta de portal é criada', async () => {
    const cpf = uniqueCpf();
    const pid = await patientWith({ cpf });
    const ap = await consulta(pid);
    const res = await recep.patch(`/appointments/${ap}/checkin`, { cpf, terms_accepted: true });
    expect(res.status).toBe(200);
    expect(res.body.data.identity_verified_by).toBe('cpf');
    expect(await portalAccounts(pid)).toBe(0);
    const { rows: [a] } = await db.query(`SELECT status, identity_verified_by, checked_in_by FROM ris.appointments WHERE id = $1`, [ap]);
    expect(a).toMatchObject({ status: 'checked_in', identity_verified_by: 'cpf', checked_in_by: recep.user.id });
  });

  it('paciente SÓ com CNS (rede pública) faz check-in pelo CNS', async () => {
    const cns = validCns();
    const pid = await patientWith({ cns });
    const ap = await consulta(pid);
    expect((await recep.patch(`/appointments/${ap}/checkin`, { cpf: uniqueCpf() })).status).toBe(422); // não tem CPF
    const res = await recep.patch(`/appointments/${ap}/checkin`, { cns });
    expect(res.status).toBe(200);
    expect(res.body.data.identity_verified_by).toBe('cns');
  });

  it('conferência visual de documento com foto', async () => {
    const pid = await patientWith({ cpf: uniqueCpf() });
    const ap = await consulta(pid);
    expect((await recep.patch(`/appointments/${ap}/checkin`, { document_verified: false })).status).toBe(422);
    const res = await recep.patch(`/appointments/${ap}/checkin`, { identity_verified_by: 'document', document_verified: true });
    expect(res.status).toBe(200);
    expect(res.body.data.identity_verified_by).toBe('document');
  });

  it('sem nenhuma confirmação de identidade → 422; CPF errado → 422 e continua agendado', async () => {
    const pid = await patientWith({ cpf: uniqueCpf() });
    const ap = await consulta(pid);
    expect((await recep.patch(`/appointments/${ap}/checkin`, {})).status).toBe(422);
    const wrong = await recep.patch(`/appointments/${ap}/checkin`, { cpf: '99999999999' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('IDENTITY_MISMATCH');
    const { rows: [a] } = await db.query(`SELECT status FROM ris.appointments WHERE id = $1`, [ap]);
    expect(a.status).toBe('scheduled');
  });

  it('paciente que JÁ tem portal não é bloqueado nem por senha errada (clientes antigos mandam password)', async () => {
    const cpf = uniqueCpf();
    const pid = await patientWith({ cpf });
    expect((await recep.post(`/patients/${pid}/portal-access`, {})).status).toBe(201);
    const ap = await consulta(pid);
    const res = await recep.patch(`/appointments/${ap}/checkin`, { cpf, password: 'SenhaErrada1' });
    expect(res.status).toBe(200);
    expect(res.body.data.portal_access_granted).toBe(true);
    const { rows: [acc] } = await db.query(`SELECT failed_attempts FROM ris.patient_portal_accounts WHERE patient_id = $1`, [pid]);
    expect(acc.failed_attempts).toBe(0);     // não há mais contagem de tentativas de senha no check-in
  });

  it('a confirmação de identidade fica na auditoria', async () => {
    const cpf = uniqueCpf();
    const ap = await consulta(await patientWith({ cpf }));
    await recep.patch(`/appointments/${ap}/checkin`, { cpf, terms_accepted: true });
    const { rows } = await db.query(
      `SELECT details FROM audit.logs WHERE resource_id = $1 AND action = 'CHECKIN' ORDER BY created_at DESC LIMIT 1`, [ap]);
    expect(rows[0].details).toMatchObject({ identity_verified_by: 'cpf', terms_accepted: true });
  });
});

describe('P1-12: médico não é agendado duas vezes no mesmo horário', () => {
  const at = (min) => new Date(Date.UTC(2031, 0, 15, 12, 0) + min * 60000).toISOString();
  const marca = (patient_id, min, extra = {}) => recep.post('/appointments', {
    patient_id, appointment_kind: 'consultation', assigned_doctor_id: doctor.user.id,
    scheduled_at: at(min), duration_minutes: 30, reason: 'x', ...extra,
  });
  let p1, p2;
  beforeAll(async () => { p1 = await patientWith({ cpf: uniqueCpf() }); p2 = await patientWith({ cpf: uniqueCpf() }); });

  it('2ª consulta sobreposta do mesmo médico → 409', async () => {
    expect((await marca(p1, 0)).status).toBe(201);
    const clash = await marca(p2, 15);
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('DOCTOR_BUSY');
  });
  it('horário colado (fim = início) e outro médico passam; encaixe explícito também', async () => {
    expect((await marca(p2, 30)).status).toBe(201);                       // começa quando a 1ª termina
    expect((await marca(p2, 5, { allow_overbooking: true })).status).toBe(201);
    const outro = await recep.post('/appointments', { patient_id: p2, appointment_kind: 'consultation',
      assigned_doctor_id: (await as('radio')).user.id, scheduled_at: at(0), duration_minutes: 30 });
    expect(outro.status).toBe(201);
  });
  it('cancelada libera o horário; simultâneas não passam juntas', async () => {
    const a = await marca(p1, 600);
    expect(a.status).toBe(201);
    await recep.patch(`/appointments/${a.body.data.id}/cancel`, { reason: 'paciente desistiu' });
    expect((await marca(p2, 600)).status).toBe(201);
    const [x, y] = await Promise.all([marca(p1, 900), marca(p2, 900)]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
  });
  it('remarcar para cima de outra consulta também é barrado', async () => {
    const a = await marca(p1, 1200);
    const b = await marca(p2, 1260);
    const res = await recep.patch(`/appointments/${b.body.data.id}`, { scheduled_at: at(1210) });
    expect(res.status).toBe(409);
    expect(a.status).toBe(201);
  });
});
