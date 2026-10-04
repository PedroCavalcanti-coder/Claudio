'use strict';
/**
 * Migração delta §20 — agendamento clínico (consulta/teleconsulta).
 * Idempotente. Aplica no Neon via DATABASE_URL.
 * Rodar: node scripts/migrate_clinical_appointments.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const SQL = `
ALTER TABLE ris.appointments
  ADD COLUMN IF NOT EXISTS appointment_kind VARCHAR(16) NOT NULL DEFAULT 'imaging',
  ADD COLUMN IF NOT EXISTS specialty        VARCHAR(80),
  ADD COLUMN IF NOT EXISTS reason           TEXT,
  ADD COLUMN IF NOT EXISTS encounter_id     UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL;

ALTER TABLE ris.appointments ALTER COLUMN procedure_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE ris.appointments ADD CONSTRAINT chk_appt_kind CHECK (
    (appointment_kind = 'imaging' AND procedure_id IS NOT NULL)
    OR (appointment_kind IN ('consultation','teleconsultation'))
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_appt_kind ON ris.appointments(appointment_kind, scheduled_at);
`;

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL ausente'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(SQL);
    const { rows } = await pool.query(`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='ris' AND table_name='appointments' AND column_name='appointment_kind') AS kind_col,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='ris' AND table_name='appointments' AND column_name='encounter_id') AS enc_col,
        (SELECT is_nullable FROM information_schema.columns
                 WHERE table_schema='ris' AND table_name='appointments' AND column_name='procedure_id') AS proc_nullable
    `);
    console.log('OK §20:', rows[0]);
    process.exit(rows[0].kind_col && rows[0].enc_col && rows[0].proc_nullable === 'YES' ? 0 : 1);
  } catch (e) { console.error('FALHA:', e.message); process.exit(1); }
  finally { await pool.end(); }
})();
