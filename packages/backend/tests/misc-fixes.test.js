'use strict';
/** P2-7/P2-8: status de consulta, ?active=false, lembrete sem provedor. */
const db = require('../src/config/database');
const { as, uniqueCpf, uniqueSlot } = require('./helpers/api');
const { reminderTick } = require('../src/jobs/scheduler');

let admin, recep, doctor;
beforeAll(async () => { [admin, recep, doctor] = await Promise.all([as('admin'), as('recep'), as('doctor')]); });
afterAll(async () => { await db.pool.end(); });

it('P2-7: GET /appointments/:id/status de CONSULTA devolve 200 (antes 404 por JOIN em procedures)', async () => {
  const pid = (await recep.post('/patients', { name: 'Paciente Status', birth_date: '1990-01-01', gender: 'F', cpf: uniqueCpf() })).body.data.id;
  const ap = (await recep.post('/appointments', { patient_id: pid, appointment_kind: 'consultation',
    assigned_doctor_id: doctor.user.id, scheduled_at: uniqueSlot(), reason: 'x' })).body.data.id;
  const res = await recep.get(`/appointments/${ap}/status`);
  expect(res.status).toBe(200);
  expect(res.body.data).toMatchObject({ appointment_kind: 'consultation', status: 'scheduled', status_label: 'Agendado' });
  await recep.patch(`/appointments/${ap}/checkin`, { cpf: undefined, document_verified: true, identity_verified_by: 'document' });
  expect((await recep.get(`/appointments/${ap}/status`)).body.data.status_label).toBe('Aguardando Atendimento');
});

it('P2-8: /users?active=false filtra os INATIVOS (z.coerce.boolean() tratava "false" como true)', async () => {
  const { rows: [u] } = await db.query(`SELECT id FROM ris.health_units LIMIT 1`);
  const email = `inativo${Date.now()}@teste.local`;
  const id = (await admin.post('/users', { name: 'Func Inativo', email, role: 'receptionist', health_unit_id: u.id })).body.data.id;
  await admin.patch(`/users/${id}/deactivate`, {});
  const inativos = (await admin.get('/users?active=false&limit=100')).body.data;
  expect(inativos.map((x) => x.id)).toContain(id);
  expect(inativos.every((x) => x.is_active === false)).toBe(true);
  const ativos = (await admin.get('/users?active=true&limit=100')).body.data;
  expect(ativos.map((x) => x.id)).not.toContain(id);
});

it('P2-8: rota legada /studies/:uid/series (sombreada, authorize legado) foi removida do app', () => {
  const app = require('../src/app');
  const paths = [];
  const walk = (stack) => stack.forEach((l) => {
    if (l.route) paths.push(l.route.path);
  });
  walk(app._router.stack);
  expect(paths.some((p) => String(p).includes('/studies/:studyUID/series'))).toBe(false);
});

it('P2-8: lembrete sem provedor de e-mail registra "skipped" (não "sent") e é idempotente', async () => {
  expect(process.env.RESEND_API_KEY).toBeUndefined();
  const pid = (await recep.post('/patients', { name: 'Paciente Lembrete', birth_date: '1990-01-01', gender: 'F', cpf: uniqueCpf() })).body.data.id;
  const { rows: [ap] } = await db.query(
    `INSERT INTO ris.appointments (patient_id, appointment_kind, scheduled_at, status, assigned_doctor_id, requesting_user_id)
     VALUES ($1,'consultation', NOW() + INTERVAL '3 hours','scheduled',$2,$2) RETURNING id`, [pid, doctor.user.id]);
  await reminderTick(); await reminderTick();
  const { rows } = await db.query(`SELECT status, sent_at FROM ris.appointment_reminders WHERE appointment_id = $1`, [ap.id]);
  expect(rows).toEqual([{ status: 'skipped', sent_at: null }]);
});

describe('P2-9: configuração inicial guiada', () => {
  it('checklist do admin reflete o estado e lista o que falta por unidade', async () => {
    const res = await admin.get('/health-units/setup-status');
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(6);
    expect(res.body.data.steps.map((s) => s.key)).toEqual(['unit', 'modalities', 'procedures', 'shifts', 'staff', 'password']);
    expect(res.body.data.steps.find((s) => s.key === 'unit').done).toBe(true);
  });
  it('só admin enxerga o checklist', async () => {
    expect((await recep.get('/health-units/setup-status')).status).toBe(403);
  });
  it('agendar exame em unidade SEM procedimentos configurados explica o que falta (422)', async () => {
    const { rows: [unit] } = await db.query(`INSERT INTO ris.health_units (name, type) VALUES ('Unidade Vazia Teste', 'clinic') RETURNING id`);
    const { rows: [u] } = await db.query(
      `INSERT INTO auth.users (name, email, password_hash, role, health_unit_id)
       VALUES ('Recep Vazia', $1, crypt('x', gen_salt('bf', 4)), 'receptionist', $2) RETURNING id`, [`vazia${Date.now()}@t.local`, unit.id]);
    const { signToken } = require('./helpers/api');
    const token = await signToken({ id: u.id, email: 'x', role: 'receptionist', name: 'Recep Vazia', health_unit_id: unit.id });
    const request = require('supertest');
    const { app, P } = require('./helpers/api');
    const { rows: [proc] } = await db.query(`SELECT id FROM ris.procedures LIMIT 1`);
    const pid = (await recep.post('/patients', { name: 'Paciente Unidade Vazia', birth_date: '1990-01-01', gender: 'F', cpf: uniqueCpf() })).body.data.id;
    const res = await request(app).post(`${P}/appointments`).set('Authorization', `Bearer ${token}`)
      .send({ patient_id: pid, appointment_kind: 'imaging', procedure_id: proc.id, scheduled_at: uniqueSlot() });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UNIT_SETUP_INCOMPLETE');
    expect(res.body.message).toMatch(/procedimentos/i);
  });
});
