'use strict';
/** P1-10: exclusão permanente — anonimiza quando há registro clínico (guarda de 20 anos). */
const db = require('../src/config/database');
const storage = require('../src/config/storage');
const { as, uniqueCpf } = require('./helpers/api');

let admin, recep, doctor;
const novo = async (name, extra = {}) => (await recep.post('/patients', { name, birth_date: '1975-08-20', gender: 'F', cpf: uniqueCpf(), ...extra })).body.data;
const inativar = (id) => admin.delete(`/patients/${id}`);
const excluir = (id, password = 'admin123456') => admin.delete(`/patients/${id}/permanent`, { password });

beforeAll(async () => {
  await storage.ensureBuckets();
  [admin, recep, doctor] = await Promise.all([as('admin'), as('recep'), as('doctor')]);
}, 60000);
afterAll(async () => { await db.pool.end(); });

describe('exclusão permanente de paciente', () => {
  it('cadastro sem nenhum atendimento é excluído de fato', async () => {
    const p = await novo('Duplicado Por Engano');
    expect((await inativar(p.id)).status).toBe(200);
    const res = await excluir(p.id);
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('deleted');
    expect((await db.query(`SELECT 1 FROM ris.patients WHERE id = $1`, [p.id])).rowCount).toBe(0);
  });

  it('paciente com atendimento NÃO dá FK violation: é anonimizado e o prontuário fica', async () => {
    const cpf = uniqueCpf();
    const p = await novo('Maria Aparecida Souza', { cpf, phone: '11999998888', email: 'maria@x.com' });
    const ap = (await recep.post('/appointments', {
      patient_id: p.id, appointment_kind: 'consultation', assigned_doctor_id: doctor.user.id,
      scheduled_at: new Date(Date.now() + 3600e3).toISOString(), reason: 'Tosse' })).body.data.id;
    expect((await recep.patch(`/appointments/${ap}/checkin`, { cpf })).status).toBe(200);   // abre o encounter
    const { rows: [e] } = await db.query(`SELECT id FROM ehr.encounters WHERE patient_id = $1`, [p.id]);
    const note = (await doctor.post(`/ehr/encounters/${e.id}/notes`, { subjective: 'Tosse seca', assessment: 'IVAS', plan: 'Repouso' })).body.data.id;
    expect((await doctor.post(`/ehr/clinical-notes/${note}/sign`)).status).toBe(200);

    expect((await inativar(p.id)).status).toBe(200);
    expect((await excluir(p.id, 'senha-errada')).status).toBe(401);
    const res = await excluir(p.id);
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('anonymized');

    const { rows: [row] } = await db.query(`SELECT * FROM ris.patients WHERE id = $1`, [p.id]);
    const enc = require('../src/services/encryption');
    expect(enc.decrypt(row.name_encrypted)).toBe('PACIENTE ANONIMIZADO');
    for (const col of ['cpf_encrypted', 'cns_encrypted', 'rg_encrypted', 'phone_encrypted', 'email_encrypted', 'address', 'notes']) {
      expect(row[col]).toBeNull();
    }
    expect(row.cpf_hash).not.toBe(enc.searchHash(cpf));          // não casa mais com o CPF real
    expect(row.is_active).toBe(false);
    expect(row.anonymized_at).not.toBeNull();
    expect(String(row.birth_date.toISOString?.() ?? row.birth_date)).toMatch(/1975-01-01|1975-01-0/);

    // registro clínico preservado
    expect((await db.query(`SELECT 1 FROM ehr.clinical_notes WHERE id = $1 AND status = 'signed'`, [note])).rowCount).toBe(1);
    expect((await db.query(`SELECT 1 FROM ehr.encounters WHERE id = $1`, [e.id])).rowCount).toBe(1);
    // não volta, e o CPF real pode ser cadastrado de novo sem conflito
    expect((await admin.post(`/patients/${p.id}/reactivate`, {})).status).toBe(409);
    const again = await recep.post('/patients', { name: 'Maria Aparecida Souza', birth_date: '1975-08-20', gender: 'F', cpf });
    expect(again.status).toBe(201);
    expect(again.body.data.id).not.toBe(p.id);
    // auditoria registrada como anonimização
    expect((await db.query(`SELECT 1 FROM audit.logs WHERE action = 'PATIENT_ANONYMIZED' AND resource_id = $1`, [p.id])).rowCount).toBe(1);
  });

  it('paciente ativo não pode ser excluído', async () => {
    const p = await novo('Paciente Ativo');
    expect((await excluir(p.id)).status).toBe(400);
  });
});
