'use strict';
/** P1-13: senha provisória gerada no backend + troca obrigatória + troca da própria senha. */
const db = require('../src/config/database');
const { request, app, as, P } = require('./helpers/api');

let admin;
const email = `func${Date.now()}@teste.local`;
let userId, temp;

const login = (e, p) => request(app).post(`${P}/auth/login`).send({ email: e, password: p });
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => { admin = await as('admin'); });
afterAll(async () => { await db.pool.end(); });

describe('ciclo da senha de funcionário', () => {
  it('admin cria sem informar senha → backend gera a provisória e marca troca obrigatória', async () => {
    const { rows: [u] } = await db.query(`SELECT id FROM ris.health_units LIMIT 1`);
    const res = await admin.post('/users', { name: 'Funcionario Novo', email, role: 'receptionist', health_unit_id: u.id });
    expect(res.status).toBe(201);
    userId = res.body.data.id;
    temp = res.body.data.temp_password;
    expect(temp).toMatch(/^P[A-Za-z0-9]{10}\d{4}$/);
    expect((await db.query(`SELECT must_change_password FROM auth.users WHERE id = $1`, [userId])).rows[0].must_change_password).toBe(true);
  });

  it('login devolve must_change_password e o resto da API fica barrado até trocar', async () => {
    const r = await login(email, temp);
    expect(r.status).toBe(200);
    expect(r.body.data.user.must_change_password).toBe(true);
    const tok = r.body.data.access_token;
    const blocked = await request(app).get(`${P}/patients`).set(bearer(tok));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await request(app).get(`${P}/auth/me`).set(bearer(tok))).status).toBe(200);
  });

  it('troca: senha atual errada 401, fraca 422, igual 422, válida 200 com sessão nova', async () => {
    const tok = (await login(email, temp)).body.data.access_token;
    const change = (cur, nw) => request(app).post(`${P}/auth/change-password`).set(bearer(tok)).send({ current_password: cur, new_password: nw });
    expect((await change('errada', 'NovaSenha123')).status).toBe(401);
    expect((await change(temp, 'fraca')).status).toBe(422);
    expect((await change(temp, 'semnumeroAA')).status).toBe(422);
    expect((await change(temp, temp)).status).toBe(422);
    const ok = await change(temp, 'NovaSenha123');
    expect(ok.status).toBe(200);
    const fresh = ok.body.data.access_token;
    expect((await request(app).get(`${P}/patients`).set(bearer(fresh))).status).toBe(200);   // liberado
    expect((await login(email, temp)).status).toBe(401);                                    // provisória não vale mais
    expect((await login(email, 'NovaSenha123')).body.data.user.must_change_password).toBe(false);
    expect((await db.query(`SELECT password_changed_at FROM auth.users WHERE id = $1`, [userId])).rows[0].password_changed_at).not.toBeNull();
    expect((await db.query(`SELECT 1 FROM audit.logs WHERE action = 'PASSWORD_CHANGED' AND resource_id = $1`, [userId])).rowCount).toBeGreaterThan(0);
  });

  it('reset pelo admin gera nova provisória, força nova troca e derruba as sessões', async () => {
    const reset = await admin.patch(`/users/${userId}/reset-password`, {});
    expect(reset.status).toBe(200);
    const t2 = reset.body.data.temp_password;
    expect(t2).toMatch(/^P/);
    expect((await login(email, 'NovaSenha123')).status).toBe(401);
    expect((await login(email, t2)).body.data.user.must_change_password).toBe(true);
    const { rows } = await db.query(`SELECT count(*)::int n FROM auth.refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    expect(rows[0].n).toBeLessThanOrEqual(1);                        // só a do login recém-feito
  });

  it('enfermeiro pode ser criado pela tela de equipe (perfil nurse aceito)', async () => {
    const { rows: [u] } = await db.query(`SELECT id FROM ris.health_units LIMIT 1`);
    const res = await admin.post('/users', { name: 'Enfermeira Nova', email: `enf${Date.now()}@teste.local`, role: 'nurse', health_unit_id: u.id });
    expect(res.status).toBe(201);
  });
});
