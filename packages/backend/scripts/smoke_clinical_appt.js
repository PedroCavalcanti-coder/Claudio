'use strict';
/**
 * Smoke transacional — agendamento clínico (§20). Verifica:
 *  - chk_appt_kind rejeita imaging sem procedure_id e aceita clínico sem ele;
 *  - check-in clínico cria encounter (waiting_doctor) + liga appointment.encounter_id.
 * ROLLBACK no fim (não persiste).  Rodar: node scripts/smoke_clinical_appt.js
 */
require('dotenv').config();
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const u = await c.query(`SELECT id FROM ris.health_units LIMIT 1`);
    const p = await c.query(`SELECT id FROM ris.patients LIMIT 1`);
    const d = await c.query(`SELECT id FROM auth.users WHERE role='doctor' LIMIT 1`);
    if (!u.rows.length || !p.rows.length) throw new Error('faltam unidade/paciente');
    const unit = u.rows[0].id, pat = p.rows[0].id, doc = d.rows.length ? d.rows[0].id : null;

    // 1. CHECK rejeita imaging sem procedure_id
    let imagingBlocked = false;
    await c.query('SAVEPOINT s1');
    try {
      await c.query(
        `INSERT INTO ris.appointments (patient_id, appointment_kind, requesting_user_id, scheduled_at, health_unit_id)
         VALUES ($1,'imaging',$2,NOW(),$3)`, [pat, doc || pat, unit]);
      await c.query('RELEASE SAVEPOINT s1');
    } catch { imagingBlocked = true; await c.query('ROLLBACK TO SAVEPOINT s1'); }

    // 2. Clínico SEM procedure_id é aceito
    const appt = await c.query(
      `INSERT INTO ris.appointments
         (patient_id, appointment_kind, requesting_user_id, assigned_doctor_id,
          specialty, reason, scheduled_at, health_unit_id)
       VALUES ($1,'consultation',$2,$3,'Clínica Geral','dor de cabeça',NOW(),$4)
       RETURNING id`, [pat, doc || pat, doc, unit]);
    const apptId = appt.rows[0].id;

    // 3. Check-in clínico: cria encounter + liga
    const tk = await c.query(
      `INSERT INTO ehr.daily_ticket_counters (health_unit_id, ticket_date, last_number)
         VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (health_unit_id, ticket_date) DO UPDATE SET last_number = ehr.daily_ticket_counters.last_number + 1
       RETURNING last_number`, [unit]);
    const enc = await c.query(
      `INSERT INTO ehr.encounters
         (patient_id, professional_id, health_unit_id, appointment_id, encounter_type,
          status, flow_stage, assigned_doctor_id, ticket_number, ticket_date, created_by)
       VALUES ($1,$2,$3,$4,'ambulatorial','open','waiting_doctor',$5,$6,CURRENT_DATE,$2)
       RETURNING id, flow_stage`, [pat, doc || pat, unit, apptId, doc, tk.rows[0].last_number]);
    await c.query(`UPDATE ris.appointments SET encounter_id=$1 WHERE id=$2`, [enc.rows[0].id, apptId]);

    const chk = await c.query(
      `SELECT a.appointment_kind, a.procedure_id, a.encounter_id, e.flow_stage
         FROM ris.appointments a JOIN ehr.encounters e ON e.id = a.encounter_id WHERE a.id=$1`, [apptId]);
    const r = chk.rows[0];

    console.log('imaging sem procedure bloqueado =', imagingBlocked, '(esperado true)');
    console.log('clinico procedure_id null       =', r.procedure_id === null, '(esperado true)');
    console.log('encounter ligado + waiting_doctor=', !!r.encounter_id && r.flow_stage === 'waiting_doctor');
    const pass = imagingBlocked && r.procedure_id === null && !!r.encounter_id && r.flow_stage === 'waiting_doctor';
    await c.query('ROLLBACK');
    console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
    process.exit(pass ? 0 : 1);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('ERRO:', e.message); process.exit(1);
  } finally { c.release(); await pool.end(); }
})();
