'use strict';
/**
 * P0-6/P0-7/P1-6: estudos enviados pelo equipamento (C-STORE) entram no RIS sozinhos
 * (vínculo por AccessionNumber da worklist), estudos sem correspondência vão para a
 * fila de conciliação (sem paciente falso) e o webhook exige segredo.
 */
jest.mock('../src/services/orthanc', () => require('./helpers/fakeOrthanc').client);

const db = require('../src/config/database');
const fake = require('./helpers/fakeOrthanc');
const mwl = require('../src/services/mwl.service');
const storage = require('../src/config/storage');
const { ingestOrthancStudy, sweepOrthanc } = require('../src/services/dicomIngest');
const { as, anon, uniqueCpf } = require('./helpers/api');

const SECRET = process.env.ORTHANC_WEBHOOK_SECRET;
let recep, tec, doctor;
let patient, appointmentId, accession, procedureId;
let seq = 0;
const uid = () => `1.2.826.0.1.3680043.8.498.${Date.now()}${++seq}`;

async function createImagingAppointment(patientId) {
  const { rows } = await db.query(
    `INSERT INTO ris.appointments (patient_id, procedure_id, scheduled_at, status, requesting_user_id, health_unit_id)
     VALUES ($1,$2,NOW() + INTERVAL '1 hour','checked_in',$3,(SELECT id FROM ris.health_units LIMIT 1)) RETURNING id`,
    [patientId, procedureId, doctor.user.id]);
  return rows[0].id;
}

beforeAll(async () => {
  await storage.ensureBuckets();
  [recep, tec, doctor] = await Promise.all([as('recep'), as('tec'), as('doctor')]);
  const { rows } = await db.query(`SELECT id FROM ris.procedures WHERE modality_type = 'CR' LIMIT 1`);
  procedureId = rows[0].id;
  const res = await recep.post('/patients', { name: 'Joao Pedro Ingest', birth_date: '1975-03-02', gender: 'M', cpf: uniqueCpf() });
  patient = res.body.data;
  appointmentId = await createImagingAppointment(patient.id);
  accession = mwl.accessionFor(appointmentId);
});
beforeEach(() => fake.reset());
afterAll(async () => { await db.pool.end(); });

describe('ingestão automática do equipamento', () => {
  it('vincula pelo AccessionNumber da worklist, replica no storage e põe o exame em laudo', async () => {
    const studyUID = uid();
    fake.addStudy({ id: 'orth-1', studyUID, accession, patientId: 'QUALQUER-COISA', patientName: 'JOAO^PEDRO', instances: 3 });

    const r = await ingestOrthancStudy('orth-1');
    expect(r.outcome).toBe('linked');

    const { rows: [st] } = await db.query(
      `SELECT patient_id, appointment_id, status, display_status, number_of_instances, orthanc_study_id
         FROM pacs.studies WHERE study_instance_uid = $1`, [studyUID]);
    expect(st).toMatchObject({ patient_id: patient.id, appointment_id: appointmentId, status: 'complete',
      display_status: 'in_report', number_of_instances: 3, orthanc_study_id: 'orth-1' });
    const { rows: inst } = await db.query(
      `SELECT storage_key FROM pacs.instances i JOIN pacs.studies s ON s.id = i.study_id WHERE s.study_instance_uid = $1`, [studyUID]);
    expect(inst).toHaveLength(3);
    for (const i of inst) expect(await storage.exists(storage.BUCKETS.DICOM, i.storage_key)).toBe(true);
    const { rows: [ap] } = await db.query(`SELECT status FROM ris.appointments WHERE id = $1`, [appointmentId]);
    expect(ap.status).toBe('in_progress');

    // aparece na lista de estudos do radiologista/técnico
    const list = await tec.get('/studies?limit=100');
    expect(list.body.data.map((s) => s.study_instance_uid)).toContain(studyUID);
  });

  it('é idempotente (webhook duplicado não duplica estudo nem instâncias)', async () => {
    const studyUID = uid();
    // paciente SEM agendamento aberto → vínculo só pelo PatientID (prontuário)
    const p2 = (await recep.post('/patients', { name: 'Ana Sem Agenda', birth_date: '1990-01-01', gender: 'F', cpf: uniqueCpf() })).body.data;
    fake.addStudy({ id: 'orth-2', studyUID, accession: '', patientId: p2.medical_record_number, instances: 2 });
    expect((await ingestOrthancStudy('orth-2')).outcome).toBe('patient_only');
    expect((await ingestOrthancStudy('orth-2')).outcome).toBe('already');
    const { rows } = await db.query(`SELECT count(*)::int n FROM pacs.studies WHERE study_instance_uid = $1`, [studyUID]);
    expect(rows[0].n).toBe(1);
    const { rows: [c] } = await db.query(
      `SELECT count(*)::int n FROM pacs.instances i JOIN pacs.studies s ON s.id = i.study_id WHERE s.study_instance_uid = $1`, [studyUID]);
    expect(c.n).toBe(2);
  });

  it('modalidade DICOM fora do enum não derruba a ingestão', async () => {
    const studyUID = uid();
    fake.addStudy({ id: 'orth-3', studyUID, accession, modality: 'PX' });
    const r = await ingestOrthancStudy('orth-3');
    expect(['linked', 'already']).toContain(r.outcome);
  });
});

describe('P0-7: estudos sem correspondência', () => {
  it('3 estudos órfãos → nenhum erro, nenhum paciente falso, todos na fila de conciliação', async () => {
    const before = await db.query(`SELECT count(*)::int n FROM ris.patients`);
    const uids = [uid(), uid(), uid()];
    uids.forEach((u, i) => fake.addStudy({ id: `orph-${i}`, studyUID: u, accession: `ZZ${i}`, patientId: `DESCONHECIDO-${i}`, patientName: `NINGUEM^${i}` }));
    for (let i = 0; i < 3; i++) expect((await ingestOrthancStudy(`orph-${i}`)).outcome).toBe('unmatched');

    const after = await db.query(`SELECT count(*)::int n FROM ris.patients`);
    expect(after.rows[0].n).toBe(before.rows[0].n);                       // nenhum "paciente temporário"
    const { rows } = await db.query(`SELECT count(*)::int n FROM pacs.studies WHERE study_instance_uid = ANY($1)`, [uids]);
    expect(rows[0].n).toBe(0);                                            // e nada em pacs.studies

    const q = await tec.get('/studies/unmatched');
    expect(q.status).toBe(200);
    const mine = q.body.data.filter((u) => uids.includes(u.study_instance_uid));
    expect(mine).toHaveLength(3);
    expect(mine[0].dicom_patient_name).toMatch(/NINGUEM/);                // decifrado só na API
    const { rows: raw } = await db.query(`SELECT dicom_patient_name_enc FROM pacs.unmatched_studies WHERE study_instance_uid = $1`, [uids[0]]);
    expect(raw[0].dicom_patient_name_enc.toString()).not.toMatch(/NINGUEM/); // PII cifrada no banco
  });

  it('técnico vincula o órfão a um paciente → vira estudo normal', async () => {
    const studyUID = uid();
    fake.addStudy({ id: 'orph-m', studyUID, accession: 'SEMMATCH', patientId: 'X-1', patientName: 'FULANO^TAL', instances: 2 });
    await ingestOrthancStudy('orph-m');
    const { rows: [u] } = await db.query(`SELECT id FROM pacs.unmatched_studies WHERE study_instance_uid = $1`, [studyUID]);

    const bad = await recep.post(`/studies/unmatched/${u.id}/match`, { patient_id: patient.id });
    expect(bad.status).toBe(403);                                         // recepção não concilia imagem
    const ok = await tec.post(`/studies/unmatched/${u.id}/match`, { patient_id: patient.id });
    expect(ok.status).toBe(200);
    const { rows: [st] } = await db.query(`SELECT patient_id, number_of_instances FROM pacs.studies WHERE study_instance_uid = $1`, [studyUID]);
    expect(st).toMatchObject({ patient_id: patient.id, number_of_instances: 2 });
    const { rows: [after] } = await db.query(`SELECT status, matched_study_id FROM pacs.unmatched_studies WHERE id = $1`, [u.id]);
    expect(after.status).toBe('matched');
    expect(after.matched_study_id).toBeTruthy();
    expect((await tec.post(`/studies/unmatched/${u.id}/match`, { patient_id: patient.id })).status).toBe(409);
  });

  it('descartar tira da fila', async () => {
    fake.addStudy({ id: 'orph-d', studyUID: uid(), accession: 'LIXO', patientId: 'L-1', patientName: 'TESTE^LIXO' });
    await ingestOrthancStudy('orph-d');
    const q = await tec.get('/studies/unmatched');
    const item = q.body.data.find((u) => u.accession_number === 'LIXO');
    expect((await tec.post(`/studies/unmatched/${item.id}/discard`, { reason: 'estudo de teste' })).status).toBe(200);
    const q2 = await tec.get('/studies/unmatched');
    expect(q2.body.data.find((u) => u.accession_number === 'LIXO')).toBeUndefined();
  });
});

describe('varredura de segurança', () => {
  it('ingere estudos do Orthanc que o webhook perdeu', async () => {
    const studyUID = uid();
    fake.addStudy({ id: 'lost-1', studyUID, accession: 'PERDIDO1', patientId: patient.medical_record_number });
    const r = await sweepOrthanc();
    expect(r.ingested).toBeGreaterThanOrEqual(1);
    const { rows } = await db.query(`SELECT 1 FROM pacs.studies WHERE study_instance_uid = $1`, [studyUID]);
    expect(rows).toHaveLength(1);
  });
});

describe('P1-6: webhook do Orthanc exige segredo', () => {
  it('sem segredo → 401', async () => {
    const res = await anon().post('/dicom/webhook/orthanc', { ID: 'x' });
    expect(res.status).toBe(401);
  });
  it('segredo errado → 401', async () => {
    const res = await anon().post('/dicom/webhook/orthanc', { ID: 'x' }).set('X-Webhook-Secret', 'errado');
    expect(res.status).toBe(401);
  });
  it('segredo correto → 202 e o estudo é processado', async () => {
    const studyUID = uid();
    fake.addStudy({ id: 'hook-1', studyUID, accession: 'HOOK1', patientId: patient.medical_record_number });
    const res = await anon().post('/dicom/webhook/orthanc', { ID: 'hook-1' }).set('X-Webhook-Secret', SECRET);
    expect(res.status).toBe(202);
    for (let i = 0; i < 40; i++) {
      const { rows } = await db.query(`SELECT 1 FROM pacs.studies WHERE study_instance_uid = $1`, [studyUID]);
      if (rows.length) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('estudo não foi processado pelo webhook');
  });
  it('corpo sem ID → 400', async () => {
    const res = await anon().post('/dicom/webhook/orthanc', {}).set('X-Webhook-Secret', SECRET);
    expect(res.status).toBe(400);
  });
});
