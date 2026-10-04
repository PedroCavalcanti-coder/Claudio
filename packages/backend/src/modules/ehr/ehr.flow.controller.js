'use strict';
/**
 * Fluxo de atendimento (atendimento comum): recepção/acolhimento → triagem
 * (medições) → fila médica → atendimento → medicação (administração na unidade).
 * Reusa ehr.encounters (flow_stage) + ehr.vitals + ehr.medication_administrations.
 */
const db    = require('../../config/database');
const enc   = require('../../services/encryption');
const audit = require('../../services/audit');
const { success, created } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');
const { assertClinicalAccess, logClinical } = require('./ehr.access');

const norm = (v) => (v === undefined || v === null || v === '' ? null : v);
const VITAL_FIELDS = ['systolic', 'diastolic', 'heart_rate', 'resp_rate', 'temp_c',
  'spo2', 'weight_kg', 'height_cm', 'pain_scale', 'glucose_mgdl', 'notes'];

// Vocabulário controlado do motivo da não-administração/recusa (padrão p/ auditoria).
// Fonte única — reusado pelo schema de validação da rota.
const REFUSAL_REASONS = [
  'patient_refused',
  'patient_absent',
  'fasting',
  'clinical_change',
  'not_available',
  'intolerance',
  'medical_order',
  'other',            // detalhar motivo no campo de observação
];

async function loadEncounterOr404(id) {
  const { rows } = await db.query(`SELECT * FROM ehr.encounters WHERE id = $1`, [id]);
  if (!rows.length) throw new NotFoundError('Atendimento');
  return rows[0];
}

// Ordenação canônica da fila médica: emergência → prioridade Manchester → chegada.
const QUEUE_ORDER = `
  e.is_emergency DESC,
  CASE e.manchester_level WHEN 'red' THEN 0 WHEN 'orange' THEN 1 WHEN 'yellow' THEN 2
                          WHEN 'green' THEN 3 WHEN 'blue' THEN 4 ELSE 5 END ASC,
  e.started_at ASC`;

// Primeiro nome só (LGPD): painel público nunca expõe nome completo/PII.
const firstName = (full) => String(full || '').trim().split(/\s+/)[0] || '—';

// Senha sequencial por unidade que reinicia a cada dia; incremento atômico via UPSERT.
async function assignDailyTicket(client, unitId) {
  if (!unitId) return { number: null, date: null };
  const { rows } = await client.query(
    `INSERT INTO ehr.daily_ticket_counters (health_unit_id, ticket_date, last_number)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (health_unit_id, ticket_date)
       DO UPDATE SET last_number = ehr.daily_ticket_counters.last_number + 1
     RETURNING last_number, ticket_date`,
    [unitId]
  );
  return { number: rows[0].last_number, date: rows[0].ticket_date };
}

// Prioriza o plantonista em turno ativo com menos atendimentos abertos hoje (round-robin por carga).
async function pickQueueDoctor(client, unitId) {
  if (!unitId) return null;
  const onShift = await client.query(
    `SELECT u.id
       FROM auth.users u
       JOIN ris.user_shifts us ON us.user_id = u.id
       JOIN ris.shifts s ON s.id = us.shift_id AND s.is_active
      WHERE u.role = 'doctor' AND u.is_active
        AND s.health_unit_id = $1
        AND LOCALTIME BETWEEN s.start_time AND s.end_time
      GROUP BY u.id
      ORDER BY (
        SELECT count(*) FROM ehr.encounters e
         WHERE e.assigned_doctor_id = u.id
           AND e.ticket_date = CURRENT_DATE
           AND e.flow_stage NOT IN ('completed','cancelled')
      ) ASC, random()
      LIMIT 1`,
    [unitId]
  );
  if (onShift.rows.length) return onShift.rows[0].id;
  const anyDoc = await client.query(
    `SELECT u.id FROM auth.users u
      WHERE u.role = 'doctor' AND u.is_active AND u.health_unit_id = $1
      ORDER BY (
        SELECT count(*) FROM ehr.encounters e
         WHERE e.assigned_doctor_id = u.id AND e.ticket_date = CURRENT_DATE
           AND e.flow_stage NOT IN ('completed','cancelled')
      ) ASC, random()
      LIMIT 1`,
    [unitId]
  );
  return anyDoc.rows.length ? anyDoc.rows[0].id : null;
}

// ── Iniciar atendimento (recepção/acolhimento) ───────────────────────────────
async function startEpisode(req, res) {
  const { patient_id, cpf, cns, name, gender, encounter_type, chief_complaint, health_unit_id } = req.body;
  const unitId = health_unit_id ?? req.user.health_unit_id ?? null;
  let pid = patient_id;
  let emergency = false;
  let pendingRegistration = false;

  if (!pid) {
    // Emergência: pula o cadastro completo, cria paciente mínimo (pending) por CPF/CNS.
    if (!cpf && !cns) throw new AppError('Informe um paciente existente ou CPF/CNS para emergência', 422, 'PATIENT_REQUIRED');
    emergency = true;
    const encd = enc.encryptPatientFields({ name: name || 'PACIENTE NÃO IDENTIFICADO', cpf, cns });
    const conds = [], params = [];
    if (encd.cpf_hash) { params.push(encd.cpf_hash); conds.push(`cpf_hash = $${params.length}`); }
    if (encd.cns_hash) { params.push(encd.cns_hash); conds.push(`cns_hash = $${params.length}`); }
    const ex = conds.length
      ? await db.query(`SELECT id, registration_status FROM ris.patients WHERE ${conds.join(' OR ')} LIMIT 1`, params)
      : { rows: [] };
    if (ex.rows.length) {
      pid = ex.rows[0].id;
      pendingRegistration = ex.rows[0].registration_status === 'pending';
    } else {
      const { rows } = await db.query(
        `INSERT INTO ris.patients
           (name_encrypted, name_search_hash, birth_date, gender,
            cpf_encrypted, cpf_hash, cns_encrypted, cns_hash,
            created_by, health_unit_id, registration_status)
         VALUES ($1,$2,'1900-01-01',$3,$4,$5,$6,$7,$8,$9,'pending')
         RETURNING id`,
        [encd.name_encrypted, encd.name_search_hash, gender || 'O',
         encd.cpf_encrypted || null, encd.cpf_hash || null,
         encd.cns_encrypted || null, encd.cns_hash || null, req.user.sub, unitId]
      );
      pid = rows[0].id;
      pendingRegistration = true;
    }
  }

  // Contador é atômico (UPSERT); dispensa transação explícita para não duplicar a senha.
  const ticket = await assignDailyTicket(db, unitId);
  const queueDoctorId = await pickQueueDoctor(db, unitId);

  const { rows } = await db.query(
    `INSERT INTO ehr.encounters
       (patient_id, professional_id, health_unit_id, encounter_type, chief_complaint_enc,
        created_by, flow_stage, is_emergency,
        ticket_number, ticket_date, assigned_doctor_id)
     VALUES ($1, $2, $3, COALESCE($4::ehr.encounter_type, $5::ehr.encounter_type), $6, $2, 'triage', $7,
        $8, $9, $10)
     RETURNING id, flow_stage, is_emergency, encounter_type, started_at,
               ticket_number, ticket_date, assigned_doctor_id`,
    [pid, req.user.sub, unitId, norm(encounter_type), emergency ? 'urgencia' : 'ambulatorial',
     enc.encrypt(norm(chief_complaint)), emergency,
     ticket.number, ticket.date, queueDoctorId]
  );

  req.clinicalAccess = { mode: 'bond' };
  await logClinical(req, 'EHR_EPISODE_STARTED', {
    patientId: pid, resourceType: 'ehr_encounter', resourceId: rows[0].id,
    details: { emergency, pending_registration: pendingRegistration, ticket_number: ticket.number },
  });
  return created(res, {
    encounter: rows[0], patient_id: pid, emergency, pending_registration: pendingRegistration,
  }, emergency ? 'Atendimento de emergência iniciado (cadastro pendente)' : 'Atendimento iniciado');
}

// ── Triagem: medições básicas na recepção + avança p/ fila médica ────────────
async function recordTriage(req, res) {
  const e = await loadEncounterOr404(req.params.id);
  await assertClinicalAccess(req, e.patient_id);

  const cols = ['encounter_id', 'patient_id', 'measured_by'];
  const vals = [e.id, e.patient_id, req.user.sub];
  for (const f of VITAL_FIELDS) {
    if (req.body[f] !== undefined && req.body[f] !== null && req.body[f] !== '') { cols.push(f); vals.push(req.body[f]); }
  }
  let vitalsId = null;
  if (cols.length > 3) {
    const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await db.query(`INSERT INTO ehr.vitals (${cols.join(', ')}) VALUES (${ph}) RETURNING id, bmi`, vals);
    vitalsId = rows[0].id;
  }
  // Classificação de risco (Manchester) — grava a cor escolhida na triagem.
  const manchester = ['red', 'orange', 'yellow', 'green', 'blue'].includes(req.body.manchester_level)
    ? req.body.manchester_level : null;
  await db.query(
    `UPDATE ehr.encounters
        SET flow_stage = 'waiting_doctor',
            manchester_level = COALESCE($2, manchester_level)
      WHERE id = $1 AND flow_stage IN ('reception','triage')`, [e.id, manchester]);

  await logClinical(req, 'EHR_TRIAGE_DONE', { patientId: e.patient_id, resourceType: 'ehr_encounter', resourceId: e.id });
  return success(res, { id: e.id, flow_stage: 'waiting_doctor', vitals_id: vitalsId }, 'Triagem registrada — paciente na fila médica');
}

// ── Avançar estágio do fluxo ─────────────────────────────────────────────────
const STAGES = ['reception', 'triage', 'waiting_doctor', 'in_consultation', 'medication', 'completed', 'cancelled'];
async function advanceEpisode(req, res) {
  const e = await loadEncounterOr404(req.params.id);
  await assertClinicalAccess(req, e.patient_id);
  const { stage } = req.body;
  if (!STAGES.includes(stage)) throw new AppError('Estágio inválido', 422);
  await db.query(
    `UPDATE ehr.encounters
        SET flow_stage = $2::ehr.flow_stage,
            status      = CASE WHEN $2 = 'completed' THEN 'closed'
                               WHEN $2 = 'cancelled' THEN 'cancelled' ELSE status END,
            closed_at   = CASE WHEN $2 IN ('completed','cancelled') THEN NOW() ELSE closed_at END
      WHERE id = $1`, [e.id, stage]);
  await logClinical(req, 'EHR_EPISODE_ADVANCED', {
    patientId: e.patient_id, resourceType: 'ehr_encounter', resourceId: e.id, details: { stage },
  });
  return success(res, { id: e.id, flow_stage: stage }, 'Atendimento atualizado');
}

// ── Fila de atendimento (painel por unidade/estágio) ─────────────────────────
async function queue(req, res) {
  const unitId = req.query.health_unit_id ?? req.user.health_unit_id ?? null;
  const stage = req.query.stage;
  const params = [];
  let where = `e.flow_stage NOT IN ('completed','cancelled')`;
  const restrictUnit = !(req.user.role === 'admin' || req.user.is_network_resource);
  if (unitId && (restrictUnit || req.query.health_unit_id)) { params.push(unitId); where += ` AND e.health_unit_id = $${params.length}`; }
  if (stage) { params.push(stage); where += ` AND e.flow_stage = $${params.length}::ehr.flow_stage`; }
  const { rows } = await db.query(
    `SELECT e.id, e.patient_id, e.flow_stage, e.is_emergency, e.encounter_type, e.started_at,
            e.manchester_level, e.ticket_number, e.called_at, e.room_label,
            p.name_encrypted, p.registration_status, p.medical_record_number,
            u.name AS professional_name,
            d.name AS assigned_doctor_name,
            (SELECT count(*) FROM ehr.clinical_notes n WHERE n.encounter_id = e.id) AS notes_count
       FROM ehr.encounters e
       JOIN ris.patients p ON p.id = e.patient_id
       LEFT JOIN auth.users u ON u.id = e.professional_id
       LEFT JOIN auth.users d ON d.id = e.assigned_doctor_id
      WHERE ${where}
      ORDER BY ${QUEUE_ORDER}`, params);
  return success(res, rows.map((r) => ({
    id: r.id, patient_id: r.patient_id, patient_name: enc.safeDecrypt(r.name_encrypted),
    mrn: r.medical_record_number, registration_status: r.registration_status,
    flow_stage: r.flow_stage, is_emergency: r.is_emergency, encounter_type: r.encounter_type,
    manchester_level: r.manchester_level, ticket_number: r.ticket_number,
    called_at: r.called_at, room_label: r.room_label, assigned_doctor_name: r.assigned_doctor_name,
    started_at: r.started_at, professional_name: r.professional_name, notes_count: Number(r.notes_count),
  })));
}

// ── Fila de medicação (enfermeiro): itens p/ administrar na unidade ──────────
async function medicationQueue(req, res) {
  const unitId = req.query.health_unit_id ?? req.user.health_unit_id ?? null;
  const params = [];
  let unitWhere = '';
  const restrictUnit = !(req.user.role === 'admin' || req.user.is_network_resource);
  if (unitId && (restrictUnit || req.query.health_unit_id)) { params.push(unitId); unitWhere = ` AND COALESCE(e.health_unit_id, p.health_unit_id) = $${params.length}`; }
  const { rows } = await db.query(
    `SELECT i.id AS item_id, i.drug_name, i.dose, i.route, i.frequency, i.instructions,
            rx.id AS prescription_id, rx.patient_id, rx.encounter_id, rx.created_at,
            p.name_encrypted, p.medical_record_number, pr.name AS prescriber_name
       FROM ehr.prescription_items i
       JOIN ehr.prescriptions rx ON rx.id = i.prescription_id
       JOIN ris.patients p ON p.id = rx.patient_id
       LEFT JOIN auth.users pr ON pr.id = rx.prescriber_id
       LEFT JOIN ehr.encounters e ON e.id = rx.encounter_id
      WHERE i.administer_at_unit = TRUE AND rx.status = 'signed'
        AND NOT EXISTS (SELECT 1 FROM ehr.medication_administrations ma WHERE ma.prescription_item_id = i.id)
        ${unitWhere}
      ORDER BY rx.created_at ASC`, params);
  return success(res, rows.map((r) => ({
    item_id: r.item_id, drug_name: r.drug_name, dose: r.dose, route: r.route, frequency: r.frequency,
    instructions: r.instructions, prescription_id: r.prescription_id, patient_id: r.patient_id,
    encounter_id: r.encounter_id, patient_name: enc.safeDecrypt(r.name_encrypted), mrn: r.medical_record_number,
    prescriber_name: r.prescriber_name, created_at: r.created_at,
  })));
}

// ── Aprazamento: define horários de administração de um item ─────────────────
async function setItemSchedule(req, res) {
  const itemId = req.params.id;
  const { times } = req.body;
  const { rows } = await db.query(
    `SELECT i.id, rx.patient_id
       FROM ehr.prescription_items i
       JOIN ehr.prescriptions rx ON rx.id = i.prescription_id
      WHERE i.id = $1`, [itemId]);
  if (!rows.length) throw new NotFoundError('Item de prescrição');
  await assertClinicalAccess(req, rows[0].patient_id);
  const clean = Array.isArray(times)
    ? [...new Set(times.filter((t) => /^\d{2}:\d{2}$/.test(t)))].sort()
    : [];
  await db.query(
    `UPDATE ehr.prescription_items SET scheduled_times = $2::jsonb WHERE id = $1`,
    [itemId, JSON.stringify(clean)]);
  return success(res, { id: itemId, scheduled_times: clean }, 'Aprazamento atualizado');
}

// ── Doses de hoje (aprazadas) ─────────────────────────────────────────────────
// Status atrasada/pendente/feita é calculado no cliente (fuso do navegador = fuso do enfermeiro).
async function medicationSchedule(req, res) {
  const unitId = req.query.health_unit_id ?? req.user.health_unit_id ?? null;
  const params = [];
  let unitWhere = '';
  const restrictUnit = !(req.user.role === 'admin' || req.user.is_network_resource);
  if (unitId && (restrictUnit || req.query.health_unit_id)) { params.push(unitId); unitWhere = ` AND COALESCE(e.health_unit_id, p.health_unit_id) = $${params.length}`; }
  const { rows } = await db.query(
    `SELECT i.id AS item_id, i.drug_name, i.dose, i.route, i.scheduled_times,
            rx.patient_id, rx.encounter_id, p.name_encrypted, p.medical_record_number,
            (SELECT count(*) FROM ehr.medication_administrations ma
              WHERE ma.prescription_item_id = i.id
                AND ma.status = 'administered'
                AND ma.administered_at::date = CURRENT_DATE)::int AS done_count
       FROM ehr.prescription_items i
       JOIN ehr.prescriptions rx ON rx.id = i.prescription_id
       JOIN ris.patients p ON p.id = rx.patient_id
       LEFT JOIN ehr.encounters e ON e.id = rx.encounter_id
      WHERE i.administer_at_unit = TRUE AND rx.status = 'signed'
        AND i.scheduled_times IS NOT NULL AND jsonb_array_length(i.scheduled_times) > 0
        ${unitWhere}
      ORDER BY rx.created_at ASC`, params);
  return success(res, rows.map((r) => ({
    item_id: r.item_id, drug_name: r.drug_name, dose: r.dose, route: r.route,
    scheduled_times: r.scheduled_times || [], done_count: r.done_count,
    patient_id: r.patient_id, encounter_id: r.encounter_id,
    patient_name: enc.safeDecrypt(r.name_encrypted), mrn: r.medical_record_number,
  })));
}

// ── Registrar administração de medicamento (MAR) ─────────────────────────────
async function administerMedication(req, res) {
  const { prescription_item_id, patient_id, encounter_id, drug_name, dose, route, site, status, refusal_reason, notes, patient_verified } = req.body;
  await assertClinicalAccess(req, patient_id);
  // Motivo só faz sentido quando NÃO administrado/recusado; ignora se administrado.
  const notAdministered = norm(status) === 'refused' || norm(status) === 'not_administered';
  const reason = notAdministered ? norm(refusal_reason) : null;
  const { rows } = await db.query(
    `INSERT INTO ehr.medication_administrations
       (prescription_item_id, patient_id, encounter_id, drug_name, dose, route, site, status, refusal_reason, administered_by, notes, patient_verified)
     VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::ehr.admin_status,'administered'), $9, $10, $11, $12)
     RETURNING id, status, refusal_reason, administered_at, patient_verified`,
    [norm(prescription_item_id), patient_id, norm(encounter_id), drug_name, norm(dose),
     norm(route), norm(site), norm(status), reason, req.user.sub, norm(notes), patient_verified === true]
  );
  await logClinical(req, 'EHR_MEDICATION_ADMINISTERED', {
    patientId: patient_id, resourceType: 'ehr_medication_administration', resourceId: rows[0].id,
    details: { drug_name, status: rows[0].status },
  });

  // Roteamento do fluxo só se a administração estiver vinculada a um atendimento em medicação.
  const encId = norm(encounter_id);
  let flow = {};
  if (encId) {
    if (rows[0].status === 'refused' || rows[0].status === 'not_administered') {
      // Recusa/não administração devolve ao médico decidir a conduta (não conclui sozinho).
      await db.query(
        `UPDATE ehr.encounters SET flow_stage = 'waiting_doctor'
          WHERE id = $1 AND flow_stage = 'medication'`, [encId]);
      flow = { returned_to_doctor: true };
    } else {
      // Sem itens pendentes p/ administrar na unidade, conclui automaticamente o atendimento.
      const { rows: pend } = await db.query(
        `SELECT count(*)::int AS n
           FROM ehr.prescription_items i
           JOIN ehr.prescriptions rx ON rx.id = i.prescription_id
          WHERE rx.encounter_id = $1 AND i.administer_at_unit = TRUE AND rx.status = 'signed'
            AND NOT EXISTS (SELECT 1 FROM ehr.medication_administrations ma WHERE ma.prescription_item_id = i.id)`,
        [encId]);
      if (pend[0].n === 0) {
        await db.query(
          `UPDATE ehr.encounters
              SET flow_stage = 'completed', status = 'closed', closed_at = NOW()
            WHERE id = $1 AND flow_stage = 'medication'`, [encId]);
        flow = { completed: true };
      } else {
        flow = { remaining: pend[0].n };
      }
    }
  }

  return created(res, { ...rows[0], ...flow }, 'Medicação registrada na MAR');
}

async function listAdministrations(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT ma.id, ma.drug_name, ma.dose, ma.route, ma.site, ma.status, ma.administered_at,
            ma.refusal_reason, ma.notes, u.name AS administered_by_name
       FROM ehr.medication_administrations ma
       LEFT JOIN auth.users u ON u.id = ma.administered_by
      WHERE ma.patient_id = $1 ORDER BY ma.administered_at DESC`, [patientId]);
  return success(res, rows);
}

// ── Chamar próximo da fila médica para o consultório ─────────────────────────
// flow_stage permanece 'waiting_doctor' até o médico iniciar a consulta.
async function callNext(req, res) {
  const unitId = norm(req.body.health_unit_id) ?? req.user.health_unit_id ?? null;
  const room = norm(req.body.room_label);
  const callerDoctorId = req.user.role === 'doctor' ? req.user.sub : null;

  const result = await db.transaction(async (client) => {
    // Próximo: ainda não chamado, na fila médica, da unidade — trava a linha.
    const { rows } = await client.query(
      `SELECT e.id, e.patient_id, e.ticket_number
         FROM ehr.encounters e
        WHERE e.flow_stage = 'waiting_doctor' AND e.called_at IS NULL
          AND ($1::uuid IS NULL OR e.health_unit_id = $1)
        ORDER BY ${QUEUE_ORDER}
        LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [unitId]
    );
    if (!rows.length) throw new AppError('Não há paciente aguardando na fila', 404, 'QUEUE_EMPTY');
    const e0 = rows[0];
    const { rows: upd } = await client.query(
      `UPDATE ehr.encounters
          SET called_at = NOW(),
              room_label = COALESCE($2, room_label),
              assigned_doctor_id = COALESCE(assigned_doctor_id, $3)
        WHERE id = $1
        RETURNING id, patient_id, ticket_number, room_label, called_at, assigned_doctor_id`,
      [e0.id, room, callerDoctorId]
    );
    return upd[0];
  });

  req.clinicalAccess = { mode: 'bond' };
  await logClinical(req, 'EHR_QUEUE_CALL_NEXT', {
    patientId: result.patient_id, resourceType: 'ehr_encounter', resourceId: result.id,
    details: { ticket_number: result.ticket_number, room_label: result.room_label },
  });
  return success(res, result, `Ficha ${result.ticket_number ?? ''} chamada`.trim());
}

// ── Painel público de chamada (TV) ────────────────────────────────────────────
// LGPD: só ficha + 1º nome + sala. NUNCA CPF/diagnóstico/nome completo.
async function panel(req, res) {
  const unitId = req.query.health_unit_id ?? req.user.health_unit_id ?? null;

  // Fila do dia: chamados (indo p/ sala) primeiro, depois os próximos a atender.
  const { rows: q } = await db.query(
    `SELECT e.id, e.ticket_number, e.room_label, e.called_at, e.flow_stage,
            e.is_emergency, e.manchester_level, p.name_encrypted
       FROM ehr.encounters e
       JOIN ris.patients p ON p.id = e.patient_id
      WHERE e.flow_stage IN ('waiting_doctor','in_consultation')
        AND e.ticket_date = CURRENT_DATE
        AND ($1::uuid IS NULL OR e.health_unit_id = $1)
      ORDER BY (e.called_at IS NOT NULL) DESC, e.called_at DESC NULLS LAST, ${QUEUE_ORDER}
      LIMIT 20`,
    [unitId]
  );

  // Equipe de plantão agora (médicos/enfermeiros lotados em turno que cobre a hora).
  const { rows: staff } = await db.query(
    `SELECT DISTINCT u.id, u.name, u.role
       FROM auth.users u
       JOIN ris.user_shifts us ON us.user_id = u.id
       JOIN ris.shifts s ON s.id = us.shift_id AND s.is_active
      WHERE u.is_active AND u.role IN ('doctor','nurse')
        AND ($1::uuid IS NULL OR s.health_unit_id = $1)
        AND LOCALTIME BETWEEN s.start_time AND s.end_time
      ORDER BY u.role, u.name`,
    [unitId]
  );

  let unitName = null;
  if (unitId) {
    const { rows: ur } = await db.query(`SELECT name FROM ris.health_units WHERE id = $1`, [unitId]);
    unitName = ur.length ? ur[0].name : null;
  }

  const called = q.filter((r) => r.called_at)
    .map((r) => ({ ticket_number: r.ticket_number, name: firstName(enc.safeDecrypt(r.name_encrypted)),
                   room_label: r.room_label, called_at: r.called_at, is_emergency: r.is_emergency }));
  const waiting = q.filter((r) => !r.called_at && r.flow_stage === 'waiting_doctor')
    .map((r) => ({ ticket_number: r.ticket_number, name: firstName(enc.safeDecrypt(r.name_encrypted)),
                   is_emergency: r.is_emergency, manchester_level: r.manchester_level }));

  return success(res, {
    unit_name: unitName,
    now_calling: called[0] || null,
    called,
    waiting,
    doctors_on_duty: staff.filter((s) => s.role === 'doctor').map((s) => s.name),
    nurses_on_duty:  staff.filter((s) => s.role === 'nurse').map((s) => s.name),
    server_time: new Date().toISOString(),
  });
}

module.exports = {
  startEpisode, recordTriage, advanceEpisode, queue,
  medicationQueue, administerMedication, listAdministrations,
  setItemSchedule, medicationSchedule, callNext, panel,
  REFUSAL_REASONS,
};
