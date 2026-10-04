'use strict';
/** P1-9: documento assinado sem PDF (Puppeteer/storage falhou na assinatura) é regerado no download. */
const db = require('../src/config/database');
const storage = require('../src/config/storage');
const { as, anon, uniqueCpf } = require('./helpers/api');

const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
const isPdf = (r) => r.status === 200 && r.body.subarray(0, 4).toString() === '%PDF';

let recep, doctor, radio, patientId, cpf;

beforeAll(async () => {
  await storage.ensureBuckets();
  [recep, doctor, radio] = await Promise.all([as('recep'), as('doctor'), as('radio')]);
  cpf = uniqueCpf();
  patientId = (await recep.post('/patients', { name: 'Paciente Pdf', birth_date: '1985-03-03', gender: 'F', cpf })).body.data.id;
  await db.query(`INSERT INTO ehr.encounters (patient_id, professional_id, health_unit_id, encounter_type, status, flow_stage, created_by)
                  VALUES ($1,$2,$3,'ambulatorial','open','in_consultation',$2)`, [patientId, doctor.user.id, doctor.user.health_unit_id]);
}, 60000);
afterAll(async () => { await db.pool.end(); });

describe('receita assinada com o storage fora do ar', () => {
  let rxId;
  it('assina com falha no upload → fica sem PDF', async () => {
    const spy = jest.spyOn(storage, 'upload').mockRejectedValue(new Error('rustfs fora do ar'));
    const c = await doctor.post('/ehr/prescriptions', { patient_id: patientId, items: [{ drug_name: 'Dipirona 500mg', quantity: '10' }] });
    rxId = c.body.data.id;
    const s = await doctor.post(`/ehr/prescriptions/${rxId}/sign`);
    spy.mockRestore();
    expect(s.status).toBe(200);
    expect(s.body.data.pdf_available).toBe(false);
    const { rows: [r] } = await db.query(`SELECT pdf_storage_key, signature_hash FROM ehr.prescriptions WHERE id = $1`, [rxId]);
    expect(r.pdf_storage_key).toBeNull();
  });

  it('RustFS volta → download regenera, guarda e serve o PDF', async () => {
    const res = await doctor.get(`/ehr/prescriptions/${rxId}/pdf`).buffer(true).parse(binary);
    expect(isPdf(res)).toBe(true);
    const { rows: [r] } = await db.query(`SELECT pdf_storage_key FROM ehr.prescriptions WHERE id = $1`, [rxId]);
    expect(r.pdf_storage_key).toBe(`prescriptions/${rxId}.pdf`);
    expect(await storage.exists(storage.BUCKETS.DOCUMENTS, r.pdf_storage_key)).toBe(true);
  });

  it('o paciente baixa pelo portal mesmo se o objeto sumiu do storage', async () => {
    const grant = await recep.post(`/patients/${patientId}/portal-access`, {});
    const login = await anon().post('/patient-portal/login', { cpf, password: grant.body.data.temp_password });
    const token = login.body.data.token;
    await storage.remove(storage.BUCKETS.DOCUMENTS, `prescriptions/${rxId}.pdf`);
    const res = await anon().get(`/patient-portal/prescriptions/${rxId}/pdf`).set('X-Portal-Token', token).buffer(true).parse(binary);
    expect(isPdf(res)).toBe(true);
  });

  it('rascunho não gera PDF', async () => {
    const c = await doctor.post('/ehr/prescriptions', { patient_id: patientId, items: [{ drug_name: 'X', quantity: '1' }] });
    const res = await doctor.get(`/ehr/prescriptions/${c.body.data.id}/pdf`);
    expect(res.status).toBe(404);
  });
});

describe('atestado, evolução e laudo', () => {
  it('atestado', async () => {
    const c = await doctor.post('/ehr/certificates', { patient_id: patientId, cert_type: 'attendance', content: 'Compareceu à consulta.' });
    const id = c.body.data.id;
    expect((await doctor.post(`/ehr/certificates/${id}/sign`)).status).toBe(200);
    await db.query(`UPDATE ehr.certificates SET pdf_storage_key = NULL WHERE id = $1`, [id]);
    await storage.remove(storage.BUCKETS.DOCUMENTS, `certificates/${id}.pdf`);
    expect(isPdf(await doctor.get(`/ehr/certificates/${id}/pdf`).buffer(true).parse(binary))).toBe(true);
  });

  it('evolução (nova rota /clinical-notes/:id/pdf)', async () => {
    const { rows: [enc] } = await db.query(`SELECT id FROM ehr.encounters WHERE patient_id = $1 LIMIT 1`, [patientId]);
    const n = await doctor.post(`/ehr/encounters/${enc.id}/notes`, { subjective: 'Dor', assessment: 'Cefaleia', plan: 'Analgesia' });
    const id = n.body.data.id;
    expect((await doctor.post(`/ehr/clinical-notes/${id}/sign`)).status).toBe(200);
    await db.query(`UPDATE ehr.clinical_notes SET pdf_storage_key = NULL WHERE id = $1`, [id]);
    await storage.remove(storage.BUCKETS.DOCUMENTS, `clinical-notes/${id}.pdf`);
    expect(isPdf(await doctor.get(`/ehr/clinical-notes/${id}/pdf`).buffer(true).parse(binary))).toBe(true);
  });

  it('laudo: regenera do HTML assinado (tela e portal)', async () => {
    const { rows: [st] } = await db.query(
      `INSERT INTO pacs.studies (patient_id, study_instance_uid, accession_number, study_date, study_time, modality_type, status, display_status)
       VALUES ($1,$2,'ACCP',CURRENT_DATE,'10:00:00','CR','complete','in_report') RETURNING id`, [patientId, `1.2.9.${Date.now()}`]);
    const rep = (await radio.post('/reports', { study_id: st.id })).body.data.id;
    expect((await radio.post(`/reports/${rep}/sign`, { findings: 'Sem alterações.', conclusion: 'Normal.' })).status).toBe(200);
    await db.query(`UPDATE ris.reports SET pdf_storage_key = NULL WHERE id = $1`, [rep]);
    await storage.remove(storage.BUCKETS.REPORTS, `reports/${rep}.pdf`);
    expect(isPdf(await radio.get(`/reports/${rep}/pdf`).buffer(true).parse(binary))).toBe(true);

    await db.query(`UPDATE ris.reports SET pdf_storage_key = NULL WHERE id = $1`, [rep]);
    await storage.remove(storage.BUCKETS.REPORTS, `reports/${rep}.pdf`);
    const grant = await recep.post(`/patients/${patientId}/portal-access`, { reset: true });
    const login = await anon().post('/patient-portal/login', { cpf, password: grant.body.data.temp_password });
    const res = await anon().get(`/patient-portal/exams/${st.id}/pdf`).set('X-Portal-Token', login.body.data.token).buffer(true).parse(binary);
    expect(isPdf(res)).toBe(true);
  });
});
