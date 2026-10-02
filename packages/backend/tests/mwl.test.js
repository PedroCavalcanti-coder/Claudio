'use strict';
/** P1-7: data/hora da worklist saem no fuso local (SCHEDULE_TZ_OFFSET), não em UTC. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwl-'));
process.env.MWL_DIR = dir;
const db = require('../src/config/database');
const mwl = require('../src/services/mwl.service');
const { as, uniqueCpf } = require('./helpers/api');

afterAll(async () => { await db.pool.end(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('MWL — fuso horário', () => {
  it('21:30 (-03:00) continua no MESMO dia, 21:30', () => {
    const at = '2026-10-03T00:30:00.000Z'; // = 2026-10-02 21:30 em -03:00
    expect(mwl.dicomDate(at)).toBe('20261002');
    expect(mwl.dicomTime(at)).toBe('213000');
  });
  it('meio-dia local', () => {
    expect(mwl.dicomDate('2026-01-15T15:00:00Z')).toBe('20260115');
    expect(mwl.dicomTime('2026-01-15T15:00:00Z')).toBe('120000');
  });
  it('vazio', () => { expect(mwl.dicomDate(null)).toBe(''); expect(mwl.dicomTime(undefined)).toBe(''); });
});

describe('MWL — nome e arquivo', () => {
  it('Nome livre vira Sobrenome^Nome^Meio', () => {
    expect(mwl.dicomPersonName('Maria da Silva')).toBe('Silva^Maria^da');
    expect(mwl.dicomPersonName('Madonna')).toBe('Madonna');
  });

  it('grava o .wl por agendamento e a faxina remove os obsoletos', async () => {
    const recep = await as('recep');
    const doctor = await as('doctor');
    const p = (await recep.post('/patients', { name: 'Paciente Worklist', birth_date: '1990-01-01', gender: 'M', cpf: uniqueCpf() })).body.data;
    const { rows: [proc] } = await db.query(`SELECT id FROM ris.procedures WHERE modality_type = 'CR' LIMIT 1`);
    const { rows: [mod] } = await db.query(`SELECT id FROM ris.modalities LIMIT 1`);
    const mk = async (status) => (await db.query(
      `INSERT INTO ris.appointments (patient_id, procedure_id, modality_id, scheduled_at, status, requesting_user_id)
       VALUES ($1,$2,$3,NOW() + INTERVAL '2 hours',$4,$5) RETURNING id`,
      [p.id, proc.id, mod.id, status, doctor.user.id])).rows[0].id;

    const open = await mk('checked_in');
    const cancelled = await mk('cancelled');
    await mwl.writeWorklist(open);
    await mwl.writeWorklist(cancelled);
    expect(fs.existsSync(mwl._wlPath(mwl.accessionFor(open)))).toBe(true);

    const removed = await mwl.cleanupWorklists();
    expect(removed).toBe(1);
    expect(fs.existsSync(mwl._wlPath(mwl.accessionFor(open)))).toBe(true);
    expect(fs.existsSync(mwl._wlPath(mwl.accessionFor(cancelled)))).toBe(false);
  });
});
