'use strict';
/**
 * Helpers de teste de integração: login por perfil (usuários do seed de demo) e
 * atalhos supertest autenticados. Exige setupEnv/globalSetup (banco de teste).
 */
const request = require('supertest');
const app = require('../../src/app');

const P = '/api/v1';

// Perfis do seed_demo.sql (credenciais de DEMONSTRAÇÃO — o banco de teste é descartável).
const LOGINS = {
  admin:  ['login_admin',      { email: 'admin@clinica.com.br', password: 'admin123456' }],
  recep:  ['login_recepcao',   { username: 'recepcao', password: 'recep123' }],
  tec:    ['login_tecnico',    { username: 'tecnico', password: 'tec123' }],
  nurse:  ['login_enfermeiro', { username: 'enfermeiro', password: 'enf123' }],
  radio:  ['login',            { email: 'radiologista@clinica.com.br', password: 'doctor123' }],
  doctor: ['login',            { email: 'solicitante@clinica.com.br', password: 'doctor123' }],
};

const sessions = {};

async function login(who) {
  if (sessions[who]) return sessions[who];
  const [ep, body] = LOGINS[who];
  const res = await request(app).post(`${P}/auth/${ep}`).send(body);
  if (res.status !== 200) throw new Error(`login ${who} falhou: ${res.status} ${JSON.stringify(res.body)}`);
  const d = res.body.data;
  sessions[who] = { token: d.access_token, user: d.user, raw: d };
  return sessions[who];
}

/** Cliente autenticado: `const r = await as('recep'); await r.post('/patients', {...})`. */
async function as(who) {
  const { token, user } = await login(who);
  const call = (method) => (path, body) => {
    const req = request(app)[method](`${P}${path}`).set('Authorization', `Bearer ${token}`);
    return body !== undefined && method !== 'get' ? req.send(body) : req;
  };
  return { token, user, get: call('get'), post: call('post'), patch: call('patch'), put: call('put'), delete: call('delete') };
}

/** Cliente sem autenticação. */
const anon = () => ({
  get:   (p) => request(app).get(`${P}${p}`),
  post:  (p, b) => request(app).post(`${P}${p}`).send(b),
  patch: (p, b) => request(app).patch(`${P}${p}`).send(b),
});

let cpfSeq = 0;
/** CPF único de 11 dígitos (o validador do backend só confere o formato). */
const uniqueCpf = () => String(30000000000 + Date.now() % 1e8 * 100 + (cpfSeq++ % 100)).slice(0, 11);

let slotSeq = 0;
/**
 * Horário de consulta único (ISO) bem no futuro. Os arquivos de teste compartilham o banco e o
 * mesmo médico do seed: dois testes marcando "daqui a 1 h" bateriam na regra de conflito de agenda.
 */
const uniqueSlot = () => new Date(Date.UTC(2033, 0, 1) + (Math.floor(Math.random() * 20000) * 1800e3) + (slotSeq++ % 7) * 60e3).toISOString();

/** Token de acesso válido para um usuário arbitrário (ex.: criado direto no banco) — mesmo emissor do login. */
const signToken = (user) => require('../../src/services/token').generateAccessToken(user);

module.exports = { signToken, uniqueSlot, app, request, P, login, as, anon, uniqueCpf, LOGINS };
