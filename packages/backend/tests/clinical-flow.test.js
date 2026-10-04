'use strict';
/**
 * Fluxo clínico completo (consulta): cadastro → agendamento → check-in → fila →
 * triagem → evolução assinada → receita assinada (+PDF) → medicação → farmácia → portal.
 * Regressão de P0-1 (enum do check-in), P0-2 (variável enc), P0-3 (recepção cadastra),
 * P0-4 (buckets) e P1-2 (busca de paciente).
 */
const db = require('../src/config/database');
const { as, anon, uniqueCpf, uniqueSlot } = require('./helpers/api');

// Lê a resposta como Buffer (PDF).
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const cpf = uniqueCpf();
let PASSWORD_PORTAL;
let recep, doctor, nurse;
let patientId, appointmentId, encounterId, noteId, rxId, rxItemId, stockId;

beforeAll(async () => {
  // O boot da API (app.js) cria os buckets; a suíte importa o app sem subir o servidor.
  expect((await require('../src/config/storage').ensureBuckets()).ok).toBe(true);
  [recep, doctor, nurse] = await Promise.all([as('recep'), as('doctor'), as('nurse')]);
});
afterAll(async () => { await db.pool.end(); });

describe('Consulta: do cadastro ao portal', () => {
  it('recepção cadastra o paciente (P0-3)', async () => {
    const res = await recep.post('/patients', { name: 'Maria Silva Fluxo', birth_date: '1980-05-10', gender: 'F', cpf });
    expect(res.status).toBe(201);
    patientId = res.body.data.id;
  });

  it('busca por CPF encontra o paciente (P1-2: filtro é "q")', async () => {
    const res = await recep.get(`/patients?q=${cpf}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.id)).toContain(patientId);
    const none = await recep.get('/patients?q=00000000099');
    expect(none.body.data).toHaveLength(0);
  });

  it('recepção agenda consulta com motivo', async () => {
    const res = await recep.post('/appointments', {
      patient_id: patientId, appointment_kind: 'consultation',
      assigned_doctor_id: doctor.user.id,
      scheduled_at: uniqueSlot(),
      reason: 'Dor de cabeça persistente', specialty: 'Clínica geral',
    });
    expect(res.status).toBe(201);
    appointmentId = res.body.data.id;
  });

  it('check-in da consulta COM motivo abre o atendimento (P0-1, P0-2)', async () => {
    const res = await recep.patch(`/appointments/${appointmentId}/checkin`, { identity_verified_by: 'cpf', cpf, terms_accepted: true });
    expect(res.status).toBe(200);
    const { rows } = await db.query(
      `SELECT e.id, e.chief_complaint_enc, p.current_status
         FROM ris.appointments a
         JOIN ehr.encounters e ON e.id = a.encounter_id
         JOIN ris.patients p ON p.id = a.patient_id
        WHERE a.id = $1`, [appointmentId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].current_status).toBe('aguardando atendimento');
    expect(rows[0].chief_complaint_enc).not.toBeNull();
    encounterId = rows[0].id;
    // O motivo grava cifrado e é legível pelo PEP
    const enc = require('../src/services/encryption');
    expect(enc.decrypt(rows[0].chief_complaint_enc)).toBe('Dor de cabeça persistente');
  });

  it('paciente aparece na fila do PEP', async () => {
    const res = await doctor.get('/ehr/queue');
    expect(res.status).toBe(200);
    expect(res.body.data.map((q) => q.patient_id)).toContain(patientId);
  });

  it('enfermagem faz a triagem', async () => {
    const res = await nurse.post(`/ehr/encounters/${encounterId}/triage`, {
      systolic: 120, diastolic: 80, heart_rate: 72, spo2: 98, temp_c: 36.6, manchester_level: 'green',
    });
    expect(res.status).toBe(200);
  });

  it('médico registra e assina a evolução', async () => {
    const c = await doctor.post(`/ehr/encounters/${encounterId}/notes`, {
      subjective: 'Cefaleia há 3 dias', objective: 'PA 120/80', assessment: 'Cefaleia tensional', plan: 'Analgesia',
    });
    expect(c.status).toBe(201);
    noteId = c.body.data.id;
    const s = await doctor.post(`/ehr/clinical-notes/${noteId}/sign`);
    expect(s.status).toBe(200);
  });

  it('médico prescreve e assina a receita — PDF é gerado e fica baixável (P0-4)', async () => {
    const c = await doctor.post('/ehr/prescriptions', {
      patient_id: patientId, encounter_id: encounterId,
      items: [{ drug_name: 'Dipirona 500mg', dose: '1 comprimido', frequency: '6/6h', duration: '3 dias', quantity: '12', administer_at_unit: true }],
    });
    expect(c.status).toBe(201);
    rxId = c.body.data.id;
    const s = await doctor.post(`/ehr/prescriptions/${rxId}/sign`);
    expect(s.status).toBe(200);
    const { rows } = await db.query(`SELECT id FROM ehr.prescription_items WHERE prescription_id = $1`, [rxId]);
    rxItemId = rows[0].id;
    const pdf = await doctor.get(`/ehr/prescriptions/${rxId}/pdf`).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('enfermagem vê a fila de medicação e administra a dose', async () => {
    const q = await nurse.get('/ehr/medication-queue');
    expect(q.status).toBe(200);
    const res = await nurse.post('/ehr/medication-administrations', {
      patient_id: patientId, drug_name: 'Dipirona 500mg', prescription_item_id: rxItemId,
      encounter_id: encounterId, dose: '1 comprimido', route: 'VO', status: 'administered', patient_verified: true,
    });
    expect(res.status).toBe(201);
  });

  it('farmácia: estoque + dispensação da receita baixa o saldo', async () => {
    const st = await nurse.post('/pharmacy/stock', { drug_name: 'Dipirona 500mg', quantity: 100, unit_label: 'comp' });
    expect(st.status).toBe(201);
    stockId = st.body.data.id;
    const d = await nurse.post('/pharmacy/dispensations', {
      patient_id: patientId, prescription_id: rxId,
      items: [{ prescription_item_id: rxItemId, stock_id: stockId, drug_name: 'Dipirona 500mg', quantity: 12, unit_label: 'comp' }],
    });
    expect(d.status).toBe(201);
    const { rows } = await db.query(`SELECT quantity FROM ris.pharmacy_stock WHERE id = $1`, [stockId]);
    expect(Number(rows[0].quantity)).toBe(88);
  });

  it('portal é opcional: a recepção libera o acesso e o paciente entra com a senha provisória', async () => {
    const grant = await recep.post(`/patients/${patientId}/portal-access`, {});
    expect(grant.status).toBe(201);
    PASSWORD_PORTAL = grant.body.data.temp_password;
    const login = await anon().post('/patient-portal/login', { cpf, password: PASSWORD_PORTAL });
    expect(login.status).toBe(200);
    const token = login.body.data.token;
    const rx = await anon().get('/patient-portal/prescriptions').set('X-Portal-Token', token);
    expect(rx.status).toBe(200);
    expect(rx.body.data.length).toBeGreaterThan(0);
    const pdf = await anon().get(`/patient-portal/prescriptions/${rxId}/pdf`).set('X-Portal-Token', token);
    expect(pdf.status).toBe(200);
  });
});
