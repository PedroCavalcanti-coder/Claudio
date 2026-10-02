'use strict';
/**
 * P1-3: para cada perfil do seed, abre cada tela VISÍVEL (permissions devolvidas no login) e
 * faz as chamadas de carga da própria tela — nenhuma pode dar 403. Também confere que os botões
 * de ação só aparecem para quem o backend deixa executar (permissões granulares no login).
 * Quando uma tela nova for criada, acrescente a lista de GETs em PAGE_LOADS.
 */
const db = require('../src/config/database');
const { as, login, uniqueCpf } = require('./helpers/api');
const { PAGES } = require('../src/config/permissions');

const ROLES = ['recep', 'tec', 'nurse', 'radio', 'doctor', 'admin'];
let patientId;

// GETs que cada tela dispara ao abrir (ver pages/* no frontend). `:pid` = id de paciente.
const PAGE_LOADS = {
  dashboard:     ['/appointments?limit=5'],
  appointments:  ['/appointments?limit=5', '/health-units/mine', '/procedures'],
  patients_read: ['/patients?limit=5', '/procedures'],
  worklist:      ['/appointments/worklist'],
  studies:       ['/studies?limit=5', '/studies/pending'],
  reports:       ['/reports?limit=5'],
  second_opinion:['/second-opinion'],
  referrals:     ['/referrals'],
  atendimento:   ['/ehr/queue'],
  medicacao:     ['/ehr/medication-queue', '/ehr/medication-schedule'],
  painel:        ['/ehr/panel'],
  farmacia:      ['/pharmacy/stock'],
  teleconsulta:  ['/teleconsult/patients/:pid/sessions'],
  relatorios:    ['/analytics/production', '/analytics/no-show', '/analytics/queue'],
  faturamento:   ['/billing/production?competencia=202610'],
  procedures_manage: ['/procedures'],
  unit_manage:   ['/health-units/mine'],
  consent:       ['/consent/active'],
  notifications: ['/notifications'],
  // Prontuário (PatientChart): tudo que a ficha do paciente carrega
  ehr: [
    '/patients/:pid', '/ehr/patients/:pid/timeline', '/ehr/patients/:pid/problems', '/ehr/patients/:pid/vitals',
    '/ehr/patients/:pid/allergies', '/ehr/patients/:pid/medications', '/ehr/patients/:pid/history',
    '/ehr/patients/:pid/attachments', '/ehr/patients/:pid/prescriptions', '/ehr/patients/:pid/certificates',
    '/ehr/patients/:pid/immunizations', '/ehr/encounters?patient_id=:pid',
  ],
};

beforeAll(async () => {
  const recep = await as('recep');
  patientId = (await recep.post('/patients', { name: 'Paciente Matriz', birth_date: '1980-01-01', gender: 'M', cpf: uniqueCpf() })).body.data.id;
  // Vínculo clínico (regra do PEP, independente de permissão): atendimento na unidade dos usuários do seed.
  const { rows: [u] } = await db.query(`SELECT id, health_unit_id FROM auth.users WHERE username = 'recepcao'`);
  await db.query(
    `INSERT INTO ehr.encounters (patient_id, professional_id, health_unit_id, encounter_type, status, flow_stage, created_by)
     VALUES ($1,$2,$3,'ambulatorial','open','waiting_doctor',$2)`, [patientId, u.id, u.health_unit_id]);
});
afterAll(async () => { await db.pool.end(); });

describe.each(ROLES)('perfil %s', (who) => {
  it('nenhuma tela visível dá 403 nas chamadas da própria tela', async () => {
    const { raw } = await login(who);
    const visible = Object.entries(raw.user.permissions).filter(([, v]) => v).map(([k]) => k);
    const client = await as(who);
    const forbidden = [];
    for (const page of visible) {
      for (const tpl of PAGE_LOADS[page] || []) {
        const res = await client.get(tpl.replace(/:pid/g, patientId));
        // NO_CLINICAL_BOND é regra de vínculo (break-glass), não de permissão — tratada no teste do PEP.
        if (res.status === 403 && res.body.code !== 'NO_CLINICAL_BOND') forbidden.push(`${page} → GET ${tpl} (${res.body.message})`);
        // 401/500 também indicam tela quebrada
        if (res.status === 401 || res.status >= 500) forbidden.push(`${page} → GET ${tpl} = ${res.status}`);
      }
    }
    expect(forbidden).toEqual([]);
  });

  it('login devolve as permissões granulares que a UI usa para esconder botões', async () => {
    const { raw } = await login(who);
    expect(Array.isArray(raw.user.granular_permissions)).toBe(true);
    expect(raw.user.granular_permissions.length).toBeGreaterThan(0);
  });
});

describe('ações: botão visível ⇔ backend permite', () => {
  const g = async (who) => new Set((await login(who)).raw.user.granular_permissions);

  it('Novo Paciente: recepção/técnico/enfermagem sim; médico e radiologista não', async () => {
    for (const w of ['recep', 'tec', 'nurse']) expect((await g(w)).has('patients:create')).toBe(true);
    for (const w of ['doctor', 'radio']) expect((await g(w)).has('patients:create')).toBe(false);
    const body = { name: 'Teste Perm', birth_date: '1990-01-01', gender: 'F', cpf: uniqueCpf() };
    expect((await (await as('doctor')).post('/patients', body)).status).toBe(403);
    expect((await (await as('nurse')).post('/patients', body)).status).toBe(201);
  });

  it('Dispensar: só quem tem pharmacy:dispense (enfermagem) — recepção e técnico só gerem estoque', async () => {
    expect((await g('nurse')).has('pharmacy:dispense')).toBe(true);
    for (const w of ['recep', 'tec']) {
      const perms = await g(w);
      expect(perms.has('pharmacy:dispense')).toBe(false);
      expect(perms.has('pharmacy:stock')).toBe(true);
    }
    const res = await (await as('recep')).post('/pharmacy/dispensations', {
      patient_id: patientId, items: [{ drug_name: 'X', quantity: 1 }] });
    expect(res.status).toBe(403);
  });

  it('páginas: a tabela PAGES cobre exatamente o que o login devolve', async () => {
    const { raw } = await login('admin');
    expect(Object.keys(raw.user.permissions).sort()).toEqual(Object.keys(PAGES).sort());
    expect(raw.user.permissions.portal).toBe(false);   // admin não entra no portal do paciente
  });
});
