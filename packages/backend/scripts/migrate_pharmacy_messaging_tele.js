'use strict';
/**
 * Migração delta — Farmácia (§17), Mensageria (§18) e Teleconsulta (§19).
 * Idempotente (CREATE TABLE/INDEX IF NOT EXISTS). Aplica direto no Neon via
 * DATABASE_URL. Rodar: node scripts/migrate_pharmacy_messaging_tele.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const SQL = `
-- §17 Farmácia ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ris.pharmacy_stock (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_unit_id UUID NOT NULL REFERENCES ris.health_units(id) ON DELETE CASCADE,
  medication_id  UUID REFERENCES ris.medications_catalog(id) ON DELETE SET NULL,
  drug_name      VARCHAR(200) NOT NULL,
  lot            VARCHAR(60) NOT NULL DEFAULT '',
  expiry_date    DATE,
  unit_label     VARCHAR(30) NOT NULL DEFAULT 'un',
  quantity       NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_level      NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stock_unit_drug_lot UNIQUE (health_unit_id, drug_name, lot),
  CONSTRAINT chk_stock_qty_nonneg CHECK (quantity >= 0)
);
CREATE INDEX IF NOT EXISTS idx_stock_unit ON ris.pharmacy_stock(health_unit_id, lower(drug_name));

CREATE TABLE IF NOT EXISTS ris.pharmacy_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        UUID NOT NULL REFERENCES ris.pharmacy_stock(id) ON DELETE CASCADE,
  health_unit_id  UUID NOT NULL REFERENCES ris.health_units(id) ON DELETE CASCADE,
  movement_type   VARCHAR(12) NOT NULL,
  quantity        NUMERIC(12,2) NOT NULL,
  balance_after   NUMERIC(12,2) NOT NULL,
  reason          VARCHAR(120),
  dispensation_id UUID,
  moved_by        UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_movement_stock ON ris.pharmacy_movements(stock_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ehr.dispensations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES ris.patients(id),
  encounter_id    UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  prescription_id UUID REFERENCES ehr.prescriptions(id) ON DELETE SET NULL,
  health_unit_id  UUID NOT NULL REFERENCES ris.health_units(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'dispensed',
  notes           VARCHAR(500),
  dispensed_by    UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disp_patient ON ehr.dispensations(patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ehr.dispensation_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispensation_id      UUID NOT NULL REFERENCES ehr.dispensations(id) ON DELETE CASCADE,
  prescription_item_id UUID REFERENCES ehr.prescription_items(id) ON DELETE SET NULL,
  stock_id             UUID REFERENCES ris.pharmacy_stock(id) ON DELETE SET NULL,
  drug_name            VARCHAR(200) NOT NULL,
  quantity             NUMERIC(12,2) NOT NULL,
  unit_label           VARCHAR(30) NOT NULL DEFAULT 'un'
);
CREATE INDEX IF NOT EXISTS idx_disp_item ON ehr.dispensation_items(dispensation_id);

-- §18 Mensageria -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ris.message_outbox (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel        VARCHAR(12) NOT NULL,
  to_enc         BYTEA,
  to_hash        CHAR(64),
  body           VARCHAR(1000) NOT NULL,
  template       VARCHAR(40),
  ref_type       VARCHAR(30),
  ref_id         UUID,
  status         VARCHAR(12) NOT NULL DEFAULT 'pending',
  provider       VARCHAR(40),
  error          VARCHAR(300),
  attempts       SMALLINT NOT NULL DEFAULT 0,
  health_unit_id UUID REFERENCES ris.health_units(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON ris.message_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_ref    ON ris.message_outbox(ref_type, ref_id);

-- §19 Teleconsulta -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS ehr.teleconsultations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id   UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  patient_id     UUID NOT NULL REFERENCES ris.patients(id),
  appointment_id UUID REFERENCES ris.appointments(id) ON DELETE SET NULL,
  room_token     UUID NOT NULL DEFAULT gen_random_uuid(),
  status         VARCHAR(12) NOT NULL DEFAULT 'created',
  host_id        UUID REFERENCES auth.users(id),
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tele_room UNIQUE (room_token)
);
CREATE INDEX IF NOT EXISTS idx_tele_patient ON ehr.teleconsultations(patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ehr.teleconsult_signals (
  id          BIGSERIAL PRIMARY KEY,
  room_token  UUID NOT NULL,
  sender      VARCHAR(8) NOT NULL,
  kind        VARCHAR(10) NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tele_signal ON ehr.teleconsult_signals(room_token, id);
`;

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL ausente'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(SQL);
    const { rows } = await pool.query(`
      SELECT
        to_regclass('ris.pharmacy_stock')        IS NOT NULL AS pharmacy_stock,
        to_regclass('ris.pharmacy_movements')    IS NOT NULL AS pharmacy_movements,
        to_regclass('ehr.dispensations')         IS NOT NULL AS dispensations,
        to_regclass('ehr.dispensation_items')    IS NOT NULL AS dispensation_items,
        to_regclass('ris.message_outbox')        IS NOT NULL AS message_outbox,
        to_regclass('ehr.teleconsultations')     IS NOT NULL AS teleconsultations,
        to_regclass('ehr.teleconsult_signals')   IS NOT NULL AS teleconsult_signals
    `);
    console.log('OK — tabelas:', rows[0]);
    const allOk = Object.values(rows[0]).every(Boolean);
    process.exit(allOk ? 0 : 1);
  } catch (e) {
    console.error('FALHA:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
