'use strict';
/** P2-5: audit.logs não aceita UPDATE/DELETE/TRUNCATE nem do dono da tabela. */
const db = require('../src/config/database');
const audit = require('../src/services/audit');

afterAll(async () => { await db.pool.end(); });

describe('audit.logs imutável', () => {
  let id;
  beforeAll(async () => {
    await audit.log({ action: 'TESTE_IMUTAVEL', resourceType: 'teste', details: { x: 1 } });
    id = (await db.query(`SELECT id FROM audit.logs WHERE action = 'TESTE_IMUTAVEL' ORDER BY id DESC LIMIT 1`)).rows[0].id;
  });

  it('INSERT continua funcionando (o app registra normalmente)', () => { expect(id).toBeTruthy(); });
  it('UPDATE é recusado', async () => {
    await expect(db.query(`UPDATE audit.logs SET action = 'ADULTERADO' WHERE id = $1`, [id])).rejects.toThrow(/imutável/);
  });
  it('DELETE é recusado', async () => {
    await expect(db.query(`DELETE FROM audit.logs WHERE id = $1`, [id])).rejects.toThrow(/imutável/);
  });
  it('TRUNCATE é recusado', async () => {
    await expect(db.query(`TRUNCATE audit.logs`)).rejects.toThrow(/imutável/);
  });
  it('o registro segue intacto', async () => {
    const { rows } = await db.query(`SELECT action FROM audit.logs WHERE id = $1`, [id]);
    expect(rows[0].action).toBe('TESTE_IMUTAVEL');
  });
});
