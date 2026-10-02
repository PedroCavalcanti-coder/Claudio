'use strict';
/**
 * P0-8: o limite é por USUÁRIO/conta (não por IP) e os fluxos de polling não caem.
 * Usa um app mínimo com limites pequenos para simular o volume sem milhares de requests.
 */
const express = require('express');
const request = require('supertest');
const { buildLimiters, HIGH_VOLUME_PATHS } = require('../src/middlewares/rateLimiter');
const { generatePortalJwt } = require('../src/services/portalToken');
const { login } = require('./helpers/api');

function appWith(cfg) {
  const L = buildLimiters(cfg);
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/v1', L.apiLimiter);
  app.get('/api/v1/ehr/panel', (req, res) => res.json({ ok: 1 }));
  app.get('/api/v1/appointments', (req, res) => res.json({ ok: 1 }));
  app.get('/api/v1/teleconsult/room/:token/signal', (req, res) => res.json({ ok: 1 }));
  app.post('/api/v1/auth/login_recepcao', L.authLimiter, (req, res) =>
    (req.body.password === 'certa' ? res.json({ ok: 1 }) : res.status(401).json({ ok: 0 })));
  const portal = express.Router();
  portal.get('/exams', L.portalLimiter, (req, res) => res.json({ ok: 1 }));
  app.use('/api/v1/patient-portal', portal);
  const tele = express.Router();
  tele.use('/room/:token', L.roomLimiter);
  tele.get('/room/:token/signal', (req, res) => res.json({ ok: 1 }));
  app.use('/api/v1/tele', tele);
  return app;
}

const burst = async (fn, n) => { const out = []; for (let i = 0; i < n; i++) out.push((await fn()).status); return out; };

describe('limite global', () => {
  it('é por usuário: um funcionário no limite não afeta o colega atrás do mesmo IP', async () => {
    const app = appWith({ max: 5 });
    const a = (await login('recep')).token;
    const b = (await login('doctor')).token;
    const as = (t) => () => request(app).get('/api/v1/appointments').set('Authorization', `Bearer ${t}`);
    expect(await burst(as(a), 7)).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect(await burst(as(b), 5)).toEqual([200, 200, 200, 200, 200]);       // colega segue normal
  });

  it('token forjado não ganha balde novo (cai no IP)', async () => {
    const app = appWith({ max: 3 });
    const fake = (i) => () => request(app).get('/api/v1/appointments').set('Authorization', `Bearer forjado-${i}.x.y`);
    const st = [];
    for (let i = 0; i < 5; i++) st.push((await fake(i)()).status);
    expect(st).toEqual([200, 200, 200, 429, 429]);
  });

  it('Painel TV (polling 6 s) e sala de teleconsulta não consomem o limite global', async () => {
    const app = appWith({ max: 3 });
    const t = (await login('recep')).token;
    const panel = await burst(() => request(app).get('/api/v1/ehr/panel').set('Authorization', `Bearer ${t}`), 50);
    expect(new Set(panel)).toEqual(new Set([200]));
    const room = await burst(() => request(app).get('/api/v1/teleconsult/room/abc/signal'), 50);
    expect(new Set(room)).toEqual(new Set([200]));
    const normal = await burst(() => request(app).get('/api/v1/appointments').set('Authorization', `Bearer ${t}`), 3);
    expect(normal).toEqual([200, 200, 200]);                               // continua com a cota cheia
  });

  it('as rotas de alto volume estão na lista de exceções', () => {
    const ok = (p) => HIGH_VOLUME_PATHS.some((re) => re.test(p));
    expect(ok('/api/v1/ehr/panel')).toBe(true);
    expect(ok('/api/v1/teleconsult/room/uuid/signal')).toBe(true);
    expect(ok('/api/v1/patients')).toBe(false);
  });
});

describe('portal do paciente', () => {
  it('polling de 1 h não é bloqueado (antes: 20 req/hora) e cada conta tem a sua cota', async () => {
    const app = appWith({ portalMax: 100 });
    const tok = (id) => generatePortalJwt(id, id);
    const as = (t) => () => request(app).get('/api/v1/patient-portal/exams').set('X-Portal-Token', t);
    const r = await burst(as(tok('acc-1')), 100);
    expect(new Set(r)).toEqual(new Set([200]));                            // >> 20
    expect((await as(tok('acc-1'))()).status).toBe(429);
    expect((await as(tok('acc-2'))()).status).toBe(200);
  });
});

describe('login (anti brute-force)', () => {
  const attempt = (app, user, pass) => request(app).post('/api/v1/auth/login_recepcao').send({ username: user, password: pass });

  it('bloqueia depois de N senhas erradas do mesmo usuário e IP', async () => {
    const app = appWith({ authMax: 3 });
    const st = [];
    for (let i = 0; i < 5; i++) st.push((await attempt(app, 'alvo', 'errada')).status);
    expect(st).toEqual([401, 401, 401, 429, 429]);
  });

  it('logins corretos não consomem o limite', async () => {
    const app = appWith({ authMax: 3 });
    for (let i = 0; i < 10; i++) expect((await attempt(app, 'ana', 'certa')).status).toBe(200);
  });

  it('falhas em um usuário não bloqueiam outro usuário do mesmo IP', async () => {
    const app = appWith({ authMax: 2 });
    await attempt(app, 'alvo', 'x'); await attempt(app, 'alvo', 'x');
    expect((await attempt(app, 'alvo', 'x')).status).toBe(429);
    expect((await attempt(app, 'outro', 'certa')).status).toBe(200);
  });

  it('varredura de muitos usuários a partir de um IP esbarra no teto por IP', async () => {
    const app = appWith({ authMax: 100, authIpMax: 4 });
    const st = [];
    for (let i = 0; i < 6; i++) st.push((await attempt(app, `u${i}`, 'errada')).status);
    expect(st).toEqual([401, 401, 401, 401, 429, 429]);
  });
});

describe('sala de teleconsulta', () => {
  it('30 min de polling (≈1,2 s) cabem no limite da sala', async () => {
    // 30 min / 1,2 s = 1500 req por participante → 2 participantes = 3000 < 6000 padrão
    const app = appWith({ roomMax: 3000 });
    const n = 60; // amostra; o teto é checado por config
    const st = await burst(() => request(app).get('/api/v1/tele/room/tok1/signal'), n);
    expect(new Set(st)).toEqual(new Set([200]));
  });
  it('salas diferentes não dividem cota', async () => {
    const app = appWith({ roomMax: 2 });
    expect(await burst(() => request(app).get('/api/v1/tele/room/A/signal'), 3)).toEqual([200, 200, 429]);
    expect(await burst(() => request(app).get('/api/v1/tele/room/B/signal'), 2)).toEqual([200, 200]);
  });
});
