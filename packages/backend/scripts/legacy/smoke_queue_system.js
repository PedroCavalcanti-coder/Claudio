'use strict';
/**
 * Smoke transacional (ROLLBACK) do sistema de fila (#10/#11/#12).
 * Exercita as queries dos controllers contra o schema real p/ pegar erro de
 * coluna/sintaxe. NÃO altera dados (rollback no fim).
 */
require('dotenv').config();
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  const log = (ok, name, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  try {
    await c.query('BEGIN');

    const unit = (await c.query(`SELECT id FROM ris.health_units LIMIT 1`)).rows[0];
    if (!unit) throw new Error('sem health_units no banco');
    const uid = unit.id;

    // 1) Contador diário de fichas — UPSERT incrementa.
    const t1 = (await c.query(
      `INSERT INTO ehr.daily_ticket_counters (health_unit_id, ticket_date, last_number)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (health_unit_id, ticket_date)
         DO UPDATE SET last_number = ehr.daily_ticket_counters.last_number + 1
       RETURNING last_number`, [uid])).rows[0].last_number;
    const t2 = (await c.query(
      `INSERT INTO ehr.daily_ticket_counters (health_unit_id, ticket_date, last_number)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (health_unit_id, ticket_date)
         DO UPDATE SET last_number = ehr.daily_ticket_counters.last_number + 1
       RETURNING last_number`, [uid])).rows[0].last_number;
    log(t2 === t1 + 1, 'ficha incrementa', `${t1}→${t2}`);

    // 2) pickQueueDoctor — plantonista em turno (não deve dar erro de SQL).
    await c.query(
      `SELECT u.id FROM auth.users u
         JOIN ris.user_shifts us ON us.user_id = u.id
         JOIN ris.shifts s ON s.id = us.shift_id AND s.is_active
        WHERE u.role = 'doctor' AND u.is_active AND s.health_unit_id = $1
          AND LOCALTIME BETWEEN s.start_time AND s.end_time
        GROUP BY u.id LIMIT 1`, [uid]);
    log(true, 'pickQueueDoctor SQL');

    // 3) pickPlantonista (agendamento) — janela por horário.
    await c.query(
      `SELECT u.id FROM auth.users u
         JOIN ris.user_shifts us ON us.user_id = u.id
         JOIN ris.shifts s ON s.id = us.shift_id AND s.is_active
        WHERE u.role = 'doctor' AND u.is_active AND s.health_unit_id = $1
          AND $2::time BETWEEN s.start_time AND s.end_time
        GROUP BY u.id
        ORDER BY (SELECT count(*) FROM ris.appointments a
                   WHERE a.assigned_doctor_id = u.id AND a.scheduled_at::date = $3::date
                     AND a.status NOT IN ('cancelled','no_show')) ASC, random()
        LIMIT 1`, [uid, '10:00', '2026-06-20']);
    log(true, 'pickPlantonista SQL');

    // 4) queue enriquecida — JOIN com assigned_doctor + colunas novas.
    await c.query(
      `SELECT e.id, e.ticket_number, e.called_at, e.room_label,
              d.name AS assigned_doctor_name
         FROM ehr.encounters e
         LEFT JOIN auth.users d ON d.id = e.assigned_doctor_id
        WHERE e.flow_stage NOT IN ('completed','cancelled') LIMIT 1`);
    log(true, 'queue SQL');

    // 5) callNext — seleção do topo com SKIP LOCKED.
    await c.query(
      `SELECT e.id FROM ehr.encounters e
        WHERE e.flow_stage = 'waiting_doctor' AND e.called_at IS NULL
          AND ($1::uuid IS NULL OR e.health_unit_id = $1)
        ORDER BY e.is_emergency DESC, e.started_at ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED`, [uid]);
    log(true, 'callNext SQL');

    // 6) panel — fila pública + equipe de plantão.
    await c.query(
      `SELECT e.ticket_number, e.room_label, e.called_at, p.name_encrypted
         FROM ehr.encounters e JOIN ris.patients p ON p.id = e.patient_id
        WHERE e.flow_stage IN ('waiting_doctor','in_consultation')
          AND e.ticket_date = CURRENT_DATE AND ($1::uuid IS NULL OR e.health_unit_id = $1)
        ORDER BY (e.called_at IS NOT NULL) DESC, e.called_at DESC NULLS LAST, e.started_at ASC
        LIMIT 20`, [uid]);
    await c.query(
      `SELECT DISTINCT u.id, u.name, u.role FROM auth.users u
         JOIN ris.user_shifts us ON us.user_id = u.id
         JOIN ris.shifts s ON s.id = us.shift_id AND s.is_active
        WHERE u.is_active AND u.role IN ('doctor','nurse')
          AND ($1::uuid IS NULL OR s.health_unit_id = $1)
          AND LOCALTIME BETWEEN s.start_time AND s.end_time
        ORDER BY u.role, u.name`, [uid]);
    log(true, 'panel SQL');

    await c.query('ROLLBACK');
    console.log('\nSMOKE OK — rollback aplicado, nada persistido.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('SMOKE FALHOU:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
