'use strict';
/** P1-8: a mesma receita não pode ser dispensada várias vezes (estoque baixava em dobro). */
const db = require('../src/config/database');
const storage = require('../src/config/storage');
const { as, uniqueCpf } = require('./helpers/api');

let recep, doctor, nurse, patientId, stockId;

async function receita(items, { sign = true } = {}) {
  const c = await doctor.post('/ehr/prescriptions', { patient_id: patientId, items });
  expect(c.status).toBe(201);
  const id = c.body.data.id;
  if (sign) expect((await doctor.post(`/ehr/prescriptions/${id}/sign`)).status).toBe(200);
  const { rows } = await db.query(`SELECT id, drug_name FROM ehr.prescription_items WHERE prescription_id = $1 ORDER BY drug_name`, [id]);
  return { id, items: rows };
}
const dispense = (rx, qty, extra = {}, idx = 0) => nurse.post('/pharmacy/dispensations', {
  patient_id: patientId, prescription_id: rx.id,
  items: [{ prescription_item_id: rx.items[idx].id, stock_id: stockId, drug_name: rx.items[idx].drug_name, quantity: qty }],
  ...extra,
});
const saldo = async () => Number((await db.query(`SELECT quantity FROM ris.pharmacy_stock WHERE id = $1`, [stockId])).rows[0].quantity);

beforeAll(async () => {
  await storage.ensureBuckets();
  [recep, doctor, nurse] = await Promise.all([as('recep'), as('doctor'), as('nurse')]);
  patientId = (await recep.post('/patients', { name: 'Paciente Farmacia', birth_date: '1960-06-06', gender: 'F', cpf: uniqueCpf() })).body.data.id;
  // O médico precisa de vínculo clínico para prescrever
  await db.query(`INSERT INTO ehr.encounters (patient_id, professional_id, health_unit_id, encounter_type, status, flow_stage, created_by)
                  VALUES ($1,$2,$3,'ambulatorial','open','in_consultation',$2)`, [patientId, doctor.user.id, doctor.user.health_unit_id]);
  stockId = (await nurse.post('/pharmacy/stock', { drug_name: 'Amoxicilina 500mg', quantity: 1000, unit_label: 'cap' })).body.data.id;
}, 60000);
afterAll(async () => { await db.pool.end(); });

describe('dispensação ligada à receita', () => {
  it('receita ainda não assinada não é dispensada', async () => {
    const rx = await receita([{ drug_name: 'Amoxicilina 500mg', quantity: '12' }], { sign: false });
    const res = await dispense(rx, 12);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PRESCRIPTION_NOT_SIGNED');
  });

  it('2ª dispensação integral da mesma receita → 422 e o estoque baixa UMA vez', async () => {
    const rx = await receita([{ drug_name: 'Amoxicilina 500mg', quantity: '12 cápsulas' }]);
    const antes = await saldo();
    expect((await dispense(rx, 12)).status).toBe(201);
    const segunda = await dispense(rx, 12);
    expect(segunda.status).toBe(422);
    expect(segunda.body.code).toBe('ALREADY_DISPENSED');
    expect(segunda.body.message).toMatch(/já dispensado/i);
    expect(await saldo()).toBe(antes - 12);
  });

  it('dispensação parcial: soma até o prescrito e bloqueia o excedente', async () => {
    const rx = await receita([{ drug_name: 'Amoxicilina 500mg', quantity: '10' }]);
    expect((await dispense(rx, 4)).status).toBe(201);
    expect((await dispense(rx, 6)).status).toBe(201);
    expect((await dispense(rx, 1)).status).toBe(422);
  });

  it('excedente só com confirmação explícita + motivo (auditado)', async () => {
    const rx = await receita([{ drug_name: 'Amoxicilina 500mg', quantity: '5' }]);
    expect((await dispense(rx, 5)).status).toBe(201);
    expect((await dispense(rx, 5, { override: true })).status).toBe(422);          // sem motivo
    const ok = await dispense(rx, 5, { override: true, override_reason: 'Extravio da 1ª cartela' });
    expect(ok.status).toBe(201);
    const { rows } = await db.query(
      `SELECT details FROM audit.logs WHERE action = 'PHARMACY_DISPENSE' AND resource_id = $1`, [ok.body.data.id]);
    expect(rows[0].details).toMatchObject({ override: true, override_reason: 'Extravio da 1ª cartela' });
  });

  it('quantidade em texto livre ("1 caixa") aceita só a 1ª dispensação', async () => {
    const rx = await receita([{ drug_name: 'Amoxicilina 500mg', quantity: '1 caixa' }]);
    expect((await dispense(rx, 1)).status).toBe(201);
    expect((await dispense(rx, 1)).status).toBe(422);
  });

  it('receita cancelada e item de outra receita são recusados', async () => {
    const rx = await receita([{ drug_name: 'Amoxicilina 500mg', quantity: '3' }]);
    const outra = await receita([{ drug_name: 'Amoxicilina 500mg', quantity: '3' }]);
    const cruzado = await nurse.post('/pharmacy/dispensations', {
      patient_id: patientId, prescription_id: rx.id,
      items: [{ prescription_item_id: outra.items[0].id, stock_id: stockId, drug_name: 'x', quantity: 1 }] });
    expect(cruzado.status).toBe(422);
    expect(cruzado.body.code).toBe('ITEM_NOT_IN_PRESCRIPTION');
    expect((await doctor.post(`/ehr/prescriptions/${rx.id}/cancel`)).status).toBe(200);
    const res = await dispense(rx, 1);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PRESCRIPTION_NOT_SIGNED');
  });

  it('dispensação avulsa (sem receita, ex.: doação) continua possível', async () => {
    const res = await nurse.post('/pharmacy/dispensations', {
      patient_id: patientId, items: [{ stock_id: stockId, drug_name: 'Amoxicilina 500mg', quantity: 1 }] });
    expect(res.status).toBe(201);
  });
});
