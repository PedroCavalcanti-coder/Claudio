'use strict';
/** P2-6: servidores ICE vêm da configuração (vazio na LAN) e não do Google fixo no frontend. */
const db = require('../src/config/database');
const { as, anon, uniqueCpf } = require('./helpers/api');

afterAll(async () => { await db.pool.end(); });

it('sala devolve ice_servers vazio por padrão (LAN, sem internet)', async () => {
  const [recep, doctor] = await Promise.all([as('recep'), as('doctor')]);
  const pid = (await recep.post('/patients', { name: 'Paciente Tele', birth_date: '1990-01-01', gender: 'F', cpf: uniqueCpf() })).body.data.id;
  await db.query(`INSERT INTO ehr.encounters (patient_id, professional_id, health_unit_id, encounter_type, status, flow_stage, created_by)
                  VALUES ($1,$2,$3,'teleconsulta','open','in_consultation',$2)`, [pid, doctor.user.id, doctor.user.health_unit_id]);
  const sess = await doctor.post('/teleconsult/sessions', { patient_id: pid });
  expect(sess.status).toBe(201);
  const room = await anon().get(`/teleconsult/room/${sess.body.data.room_token}`);
  expect(room.status).toBe(200);
  expect(room.body.data.ice_servers).toEqual([]);
});

describe('ICE_SERVERS no ambiente', () => {
  const load = (v) => { let e; jest.isolateModules(() => { process.env.ICE_SERVERS = v; e = require('../src/config/env'); }); return e; };
  afterEach(() => { delete process.env.ICE_SERVERS; });

  it('aceita lista STUN/TURN', () => {
    const e = load('[{"urls":"stun:s.exemplo:3478"},{"urls":"turn:t.exemplo:3478","username":"u","credential":"c"}]');
    expect(e.ICE_SERVERS).toHaveLength(2);
    expect(e.ICE_SERVERS[1].credential).toBe('c');
  });
  it('JSON inválido derruba o boot com mensagem clara', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => load('isso nao e json')).toThrow('exit');
    expect(JSON.stringify(err.mock.calls)).toContain('ICE_SERVERS');
    exit.mockRestore(); err.mockRestore();
  });
});
