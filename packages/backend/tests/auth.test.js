const request = require('supertest');
const app     = require('../src/app');
const db      = require('../src/config/database');
const bcrypt  = require('bcryptjs');

// Usuário de teste criado antes dos testes
let testUserId;

beforeAll(async () => {
  const hash = await bcrypt.hash('Senha@123', 10);
  const { rows } = await db.query(
    `INSERT INTO auth.users (name, email, password_hash, role)
     VALUES ('Test User', 'test@ris.com', $1, 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = $1
     RETURNING id`,
    [hash]
  );
  testUserId = rows[0].id;
});

afterAll(async () => {
  await db.query(`DELETE FROM auth.users WHERE email = 'test@ris.com'`);
  await db.pool.end();
});

describe('POST /api/v1/auth/login', () => {
  it('deve retornar access_token com credenciais válidas', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@ris.com', password: 'Senha@123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.access_token).toBeDefined();
    expect(res.body.data.user.role).toBe('admin');
  });

  it('deve rejeitar senha inválida com 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@ris.com', password: 'SenhaErrada' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('deve rejeitar e-mail inexistente sem vazar informação', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'naoexiste@ris.com', password: 'qualquer' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    // Não deve dizer "usuário não encontrado"
    expect(res.body.message).not.toContain('não encontrado');
  });

  it('deve rejeitar body inválido com 422', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'emailinvalido', password: '123' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/auth/me', () => {
  let token;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@ris.com', password: 'Senha@123' });
    token = res.body.data.access_token;
  });

  it('deve retornar dados do usuário autenticado', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('test@ris.com');
  });

  it('deve rejeitar sem token com 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('deve rejeitar token inválido com 401', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer tokeninvalido');
    expect(res.status).toBe(401);
  });
});

describe('GET /health', () => {
  it('deve retornar status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
