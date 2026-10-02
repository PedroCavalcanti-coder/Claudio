'use strict';
/** P1-1: radiologista assina o laudo com os campos da tela Laudos; nome/CRM vêm do cadastro. */
const db = require('../src/config/database');
const storage = require('../src/config/storage');
const { as, uniqueCpf } = require('./helpers/api');

let radio, recep, reportId, studyId, patient;
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

beforeAll(async () => {
  await storage.ensureBuckets();
  [radio, recep] = await Promise.all([as('radio'), as('recep')]);
  patient = (await recep.post('/patients', { name: 'Paciente Laudo', birth_date: '1970-02-02', gender: 'F', cpf: uniqueCpf() })).body.data;
  const { rows: [st] } = await db.query(
    `INSERT INTO pacs.studies (patient_id, study_instance_uid, accession_number, study_date, study_time, modality_type, status, display_status)
     VALUES ($1,$2,'ACC1',CURRENT_DATE,'10:00:00','CR','complete','in_report') RETURNING id`,
    [patient.id, `1.2.3.${Date.now()}`]);
  studyId = st.id;
});
afterAll(async () => { await db.pool.end(); });

describe('laudo: criar, editar e assinar', () => {
  it('radiologista cria o rascunho', async () => {
    const res = await radio.post('/reports', { study_id: studyId });
    expect(res.status).toBe(201);
    reportId = res.body.data.id;
  });

  it('assina só com achados e conclusão (como a tela Laudos) — nome/CRM do cadastro (P1-1)', async () => {
    const res = await radio.post(`/reports/${reportId}/sign`, {
      findings: 'Pulmões sem consolidações.', conclusion: 'Exame dentro dos limites da normalidade.',
    });
    expect(res.status).toBe(200);
    const { rows: [r] } = await db.query(`SELECT status, pdf_storage_key, signature_hash FROM ris.reports WHERE id = $1`, [reportId]);
    expect(r.status).toBe('signed');
    expect(r.signature_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.pdf_storage_key).toBeTruthy();
    const pdf = await radio.get(`/reports/${reportId}/pdf`).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('nome/CRM enviados pelo cliente são ignorados (não dá para assinar como outra pessoa)', async () => {
    const res = await radio.post('/reports', { study_id: (await newStudy()) });
    const id = res.body.data.id;
    const sign = await radio.post(`/reports/${id}/sign`, {
      findings: 'x', conclusion: 'y', doctor_name: 'Fulano Falso', doctor_crm: '999999',
    });
    expect(sign.status).toBe(200);
    const { rows: [r] } = await db.query(`SELECT content_html FROM ris.reports WHERE id = $1`, [id]);
    expect(r.content_html).not.toContain('Fulano Falso');
    expect(r.content_html).not.toContain('999999');
    expect(r.content_html).toContain('123456');                           // CRM do cadastro do radiologista
  });

  it('sem achados → 422', async () => {
    const id = (await radio.post('/reports', { study_id: await newStudy() })).body.data.id;
    const res = await radio.post(`/reports/${id}/sign`, { findings: ' ', conclusion: 'ok' });
    expect([400, 422]).toContain(res.status);
  });
});

async function newStudy() {
  const { rows: [st] } = await db.query(
    `INSERT INTO pacs.studies (patient_id, study_instance_uid, accession_number, study_date, study_time, modality_type, status, display_status)
     VALUES ($1,$2,'ACC2',CURRENT_DATE,'10:00:00','CR','complete','in_report') RETURNING id`,
    [patient.id, `1.2.4.${Date.now()}${Math.random()}`.slice(0, 60)]);
  return st.id;
}
