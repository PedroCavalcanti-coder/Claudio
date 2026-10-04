'use strict';
/** Boot aplica o schema idempotente; duas instâncias simultâneas não colidem. */
const db = require('../src/config/database');
const { migrate } = require('../src/services/migrate');

afterAll(async () => { await db.pool.end(); });

it('reaplica o schema sem erro, inclusive em paralelo (lock de migração)', async () => {
  await migrate();
  await Promise.all([migrate(), migrate(), migrate()]);
  const { rows } = await db.query(`SELECT to_regclass('ris.patient_name_tokens') AS a, to_regclass('ris.system_canary') AS b`);
  expect(rows[0].a).not.toBeNull();
  expect(rows[0].b).not.toBeNull();
});
