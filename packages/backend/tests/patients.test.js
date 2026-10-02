const request = require('supertest');
const app     = require('../src/app');
const db      = require('../src/config/database');
const bcrypt  = require('bcryptjs');

let receptionistToken;
let patientId;

beforeAll(async () => {
  const hash = await bcrypt.hash('Teste@123', 10);
  await db.query(
    `INSERT INTO auth.users (name, email, password_hash, role)
     VALUES ('Recepcionista Teste', 'recepcao@ris.com', $1, 'receptionist')
     ON CONFLICT (email) DO UPDATE SET password_hash = $1`,
    [hash]
  );

  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'recepcao@ris.com', password: 'Teste@123' });
  receptionistToken = res.body.data?.access_token;
});

afterAll(async () => {
  if (patientId) {
    await db.query(`DELETE FROM ris.patients WHERE id = $1`, [patientId]);
  }
  await db.query(`DELETE FROM auth.users WHERE email = 'recepcao@ris.com'`);
  await db.pool.end();
});

const newPatient = {
  name:       'Maria Souza Teste',
  birth_date: '1985-06-15',
  gender:     'F',
  cpf:        '12345678901',
  phone:      '11999990000',
  email:      'maria@teste.com',
  address: { city: 'São Paulo', state: 'SP', zip: '01310100' },
};

describe('POST /api/v1/patients', () => {
  it('deve criar paciente com dados criptografados', async () => {
    const res = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send(newPatient);

    expect(res.status).toBe(201);
    expect(res.body.data.medical_record_number).toMatch(/^MR-/);
    patientId = res.body.data.id;
  });

  it('CPF repetido não duplica o cadastro (devolve o paciente existente)', async () => {
    const res = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send(newPatient); // mesmo CPF

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(patientId);
  });

  it('deve rejeitar sem autenticação', async () => {
    const res = await request(app).post('/api/v1/patients').send(newPatient);
    expect(res.status).toBe(401);
  });

  it('deve rejeitar body inválido', async () => {
    const res = await request(app)
      .post('/api/v1/patients')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ name: 'A', cpf: 'invalido', gender: 'X' });

    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/patients/:id', () => {
  it('deve retornar paciente descriptografado', async () => {
    const res = await request(app)
      .get(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(newPatient.name);
    // Campos criptografados não devem aparecer na resposta
    expect(res.body.data.name_encrypted).toBeUndefined();
    expect(res.body.data.cpf_hash).toBeUndefined();
  });

  it('deve retornar 404 para ID inexistente', async () => {
    const res = await request(app)
      .get('/api/v1/patients/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/patients/:id', () => {
  it('deve atualizar telefone do paciente', async () => {
    const res = await request(app)
      .patch(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({ phone: '11988880000' });

    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/patients (busca)', () => {
  it('deve buscar por CPF via hash', async () => {
    const res = await request(app)
      .get('/api/v1/patients?q=12345678901')
      .set('Authorization', `Bearer ${receptionistToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});
