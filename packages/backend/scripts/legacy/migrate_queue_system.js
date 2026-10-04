'use strict';
/**
 * Migração delta — Sistema de fila automática (#10/#11/#12).
 * Idempotente (ADD COLUMN / CREATE TABLE IF NOT EXISTS). Aplica direto no Neon
 * via DATABASE_URL. Rodar: node scripts/migrate_queue_system.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const SQL = `
-- #10 — médico interno designado no agendamento
ALTER TABLE ris.appointments
  ADD COLUMN IF NOT EXISTS assigned_doctor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appt_doctor ON ris.appointments(assigned_doctor_id, scheduled_at);

-- #11 — fichas diárias + chamada no PEP
ALTER TABLE ehr.encounters
  ADD COLUMN IF NOT EXISTS ticket_number      INTEGER,
  ADD COLUMN IF NOT EXISTS ticket_date        DATE,
  ADD COLUMN IF NOT EXISTS assigned_doctor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS called_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS room_label         VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_enc_ticket ON ehr.encounters(health_unit_id, ticket_date, ticket_number);

CREATE TABLE IF NOT EXISTS ehr.daily_ticket_counters (
  health_unit_id UUID    NOT NULL REFERENCES ris.health_units(id) ON DELETE CASCADE,
  ticket_date    DATE    NOT NULL,
  last_number    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (health_unit_id, ticket_date)
);
`;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(SQL);
    // Verificação
    const { rows } = await pool.query(`
      SELECT
        (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='ris' AND table_name='appointments' AND column_name='assigned_doctor_id') AS appt_doctor,
        (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='ehr' AND table_name='encounters' AND column_name='ticket_number') AS enc_ticket,
        (SELECT count(*) FROM information_schema.tables
          WHERE table_schema='ehr' AND table_name='daily_ticket_counters') AS counter_tbl
    `);
    console.log('OK — colunas/tabela:', rows[0]);
  } catch (e) {
    console.error('FALHA:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
