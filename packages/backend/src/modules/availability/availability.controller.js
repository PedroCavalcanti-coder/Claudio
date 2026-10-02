'use strict';
/**
 * Gestão de disponibilidade da agenda.
 * --------------------------------------------------------------------
 * - availability_rules: janelas de funcionamento por dia da semana + capacidade
 *   simultânea, por unidade (e opcionalmente por equipamento/modalidade).
 * - holidays: dias sem atendimento (unidade ou global).
 *
 * GET /availability/slots calcula os horários livres de um dia.
 * assertSchedulable() é usado pelo POST /appointments para validar (feriado,
 * janela de funcionamento e capacidade). Enforcement é OPT-IN: unidade sem
 * regras mantém o comportamento antigo.
 */
const db    = require('../../config/database');
const env   = require('../../config/env');
const audit = require('../../services/audit');
const { assertUnitScope } = require('../../middlewares/authorize');
const { success, created } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');

// ── Helpers de fuso/horário ──────────────────────────────────────────────────
function offsetMinutes() {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(env.SCHEDULE_TZ_OFFSET);
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}
const pad = (n) => String(n).padStart(2, '0');

// Converte um instante (Date/ISO) para a "hora de parede" local da agenda.
function localParts(instant) {
  const d = new Date(instant);
  const shifted = new Date(d.getTime() + offsetMinutes() * 60000); // wall-clock em UTC fields
  return {
    dateStr:      `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    weekday:      shifted.getUTCDay(),               // 0=domingo
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}
// Constrói um instante (Date) a partir de uma data local 'YYYY-MM-DD' + minutos.
function localToInstant(dateStr, minutes) {
  const hh = pad(Math.floor(minutes / 60));
  const mm = pad(minutes % 60);
  return new Date(`${dateStr}T${hh}:${mm}:00${env.SCHEDULE_TZ_OFFSET}`);
}
const timeToMin = (t) => { const [h, m] = String(t).split(':'); return parseInt(h, 10) * 60 + parseInt(m, 10); };

// ── Regras: leitura interna ──────────────────────────────────────────────────
// Regras aplicáveis a (unidade, modalidade, dia). Se modalidade informada e há
// regra específica dela, usa-a; senão cai nas regras da unidade (modality_id NULL).
async function _applicableRules(unitId, modalityId, weekday) {
  if (modalityId) {
    const spec = await db.query(
      `SELECT * FROM ris.availability_rules
        WHERE health_unit_id=$1 AND modality_id=$2 AND weekday=$3 AND is_active
        ORDER BY start_time`,
      [unitId, modalityId, weekday]
    );
    if (spec.rows.length) return spec.rows;
  }
  const generic = await db.query(
    `SELECT * FROM ris.availability_rules
      WHERE health_unit_id=$1 AND modality_id IS NULL AND weekday=$2 AND is_active
      ORDER BY start_time`,
    [unitId, weekday]
  );
  return generic.rows;
}

async function _isHoliday(unitId, dateStr) {
  const { rows } = await db.query(
    `SELECT 1 FROM ris.holidays
      WHERE holiday_date=$1 AND (health_unit_id IS NULL OR health_unit_id=$2) LIMIT 1`,
    [dateStr, unitId]
  );
  return rows.length > 0;
}

// Agendamentos que ocupam recurso no dia (para contar capacidade/overlap).
async function _dayAppointments(unitId, modalityId, dateStr) {
  const dayStart = localToInstant(dateStr, 0);
  const dayEnd   = new Date(dayStart.getTime() + 24 * 60 * 60000);
  const params = [unitId, dayStart.toISOString(), dayEnd.toISOString()];
  let modCond = '';
  if (modalityId) { params.push(modalityId); modCond = `AND modality_id=$${params.length}`; }
  const { rows } = await db.query(
    `SELECT scheduled_at, duration_minutes, id
       FROM ris.appointments
      WHERE health_unit_id=$1
        AND status NOT IN ('cancelled','no_show')
        AND scheduled_at >= $2 AND scheduled_at < $3 ${modCond}`,
    params
  );
  return rows.map(r => ({
    start: new Date(r.scheduled_at).getTime(),
    end:   new Date(r.scheduled_at).getTime() + (r.duration_minutes || 0) * 60000,
    id:    r.id,
  }));
}

// ── GET /availability/slots ──────────────────────────────────────────────────
async function getSlots(req, res) {
  const { health_unit_id, modality_id, date, procedure_id } = req.query;
  if (!health_unit_id || !date) throw new AppError('health_unit_id e date são obrigatórios', 400);

  // Duração do procedimento (se informado) ajusta o tamanho efetivo do exame.
  let procDuration = null;
  if (procedure_id) {
    const { rows } = await db.query(`SELECT duration_minutes FROM ris.procedures WHERE id=$1`, [procedure_id]);
    procDuration = rows[0]?.duration_minutes ?? null;
  }

  if (await _isHoliday(health_unit_id, date)) {
    return success(res, { date, holiday: true, slots: [] }, 'Dia sem atendimento (feriado)');
  }

  // dia da semana ao meio-dia local (evita bordas de meia-noite)
  const weekday = new Date(`${date}T12:00:00${env.SCHEDULE_TZ_OFFSET}`).getUTCDay();
  const rules = await _applicableRules(health_unit_id, modality_id || null, weekday);
  if (!rules.length) {
    return success(res, { date, holiday: false, slots: [] }, 'Sem janela de atendimento neste dia');
  }

  const appts = await _dayAppointments(health_unit_id, modality_id || null, date);
  const nowMs = Date.now();

  const slots = [];
  for (const rule of rules) {
    const startMin = timeToMin(rule.start_time);
    const endMin   = timeToMin(rule.end_time);
    const step     = rule.slot_minutes;
    const examLen  = procDuration || step;
    for (let m = startMin; m + examLen <= endMin; m += step) {
      const slotStart = localToInstant(date, m);
      const slotEnd   = new Date(slotStart.getTime() + examLen * 60000);
      const s = slotStart.getTime(), e = slotEnd.getTime();
      const overlapping = appts.filter(a => a.start < e && a.end > s).length;
      const remaining = rule.capacity - overlapping;
      slots.push({
        time:      slotStart.toISOString(),
        label:     `${pad(Math.floor(m / 60))}:${pad(m % 60)}`,
        remaining: Math.max(0, remaining),
        capacity:  rule.capacity,
        available: remaining > 0 && s > nowMs,   // não oferece horário no passado
      });
    }
  }
  // ordena e remove duplicatas de horário (caso regras se sobreponham)
  const byTime = new Map();
  for (const slot of slots.sort((a, b) => a.time.localeCompare(b.time))) {
    if (!byTime.has(slot.time)) byTime.set(slot.time, slot);
  }
  return success(res, { date, holiday: false, slots: [...byTime.values()] });
}

/**
 * Valida se um agendamento pode ser criado. OPT-IN: se a unidade não tem regras,
 * não bloqueia (mantém comportamento antigo). Lança AppError em violação.
 */
async function assertSchedulable({ unitId, modalityId, procedureId, scheduledAt, durationMin }) {
  if (!unitId) return false; // sem unidade não há como aplicar disponibilidade

  const { dateStr, weekday, minutesOfDay } = localParts(scheduledAt);
  const apptStart = minutesOfDay;
  const apptEnd   = minutesOfDay + (durationMin || 0);

  // Agenda específica do procedimento na unidade (dias da semana + janela).
  // Independente das availability_rules: se a unidade restringiu este exame,
  // vale sempre. Sem restrição (weekdays vazio e horários nulos) = não bloqueia.
  if (procedureId) {
    const { rows: up } = await db.query(
      `SELECT weekdays,
              EXTRACT(HOUR FROM start_time)*60 + EXTRACT(MINUTE FROM start_time) AS start_min,
              EXTRACT(HOUR FROM end_time)*60   + EXTRACT(MINUTE FROM end_time)   AS end_min
         FROM ris.unit_procedures
        WHERE health_unit_id=$1 AND procedure_id=$2`,
      [unitId, procedureId]
    );
    if (up.length) {
      const r = up[0];
      if (Array.isArray(r.weekdays) && r.weekdays.length && !r.weekdays.includes(weekday)) {
        throw new AppError('Este exame não é realizado neste dia da semana nesta unidade.', 422, 'PROC_DAY_UNAVAILABLE');
      }
      if (r.start_min != null && apptStart < Number(r.start_min)) {
        throw new AppError('Horário fora da janela deste exame na unidade.', 422, 'PROC_TIME_UNAVAILABLE');
      }
      if (r.end_min != null && apptEnd > Number(r.end_min)) {
        throw new AppError('Horário fora da janela deste exame na unidade.', 422, 'PROC_TIME_UNAVAILABLE');
      }
    }
  }

  const { rows: hasRules } = await db.query(
    `SELECT 1 FROM ris.availability_rules WHERE health_unit_id=$1 AND is_active LIMIT 1`, [unitId]
  );
  if (!hasRules.length) return false; // enforcement opt-in (janelas gerais)

  if (await _isHoliday(unitId, dateStr)) {
    throw new AppError('Data indisponível: feriado/sem atendimento', 422, 'HOLIDAY');
  }

  const rules = await _applicableRules(unitId, modalityId || null, weekday);
  if (!rules.length) {
    throw new AppError('Fora do horário de atendimento da unidade neste dia', 422, 'OUTSIDE_WORKING_HOURS');
  }

  // Regra cuja janela cobre todo o exame
  const covering = rules.find(r => apptStart >= timeToMin(r.start_time) && apptEnd <= timeToMin(r.end_time));
  if (!covering) {
    throw new AppError('Horário fora da janela de atendimento', 422, 'OUTSIDE_WORKING_HOURS');
  }

  // Capacidade: nº de agendamentos que se sobrepõem ao exame não pode atingir a capacidade
  const appts = await _dayAppointments(unitId, modalityId || null, dateStr);
  const s = new Date(scheduledAt).getTime();
  const e = s + (durationMin || 0) * 60000;
  const overlapping = appts.filter(a => a.start < e && a.end > s).length;
  if (overlapping >= covering.capacity) {
    throw new AppError('Capacidade esgotada para este horário', 409, 'CAPACITY_FULL');
  }

  // Cobertura de turno: deve haver ao menos um TÉCNICO em turno cobrindo todo o
  // exame. Opt-in: só enforça se a unidade tiver turno(s) com técnico atribuído
  // (senão, unidades que ainda não configuraram turnos seguem sem bloqueio).
  const { rows: techShifts } = await db.query(
    `SELECT s.start_time, s.end_time
       FROM ris.shifts s
       JOIN ris.user_shifts us ON us.shift_id = s.id
       JOIN auth.users u ON u.id = us.user_id
      WHERE s.health_unit_id = $1 AND s.is_active = TRUE
        AND u.role = 'technician' AND u.is_active = TRUE`,
    [unitId]
  );
  if (techShifts.length) {
    const covered = techShifts.some(t => apptStart >= timeToMin(t.start_time) && apptEnd <= timeToMin(t.end_time));
    if (!covered) {
      throw new AppError('Nenhum técnico em turno cobre este horário.', 422, 'NO_SHIFT_COVERAGE');
    }
  }
  return true; // enforçou (havia regras)
}

// ── CRUD: regras ─────────────────────────────────────────────────────────────
async function listRules(req, res) {
  const { health_unit_id } = req.query;
  const params = [];
  let where = '';
  if (health_unit_id) { params.push(health_unit_id); where = `WHERE ar.health_unit_id=$1`; }
  const { rows } = await db.query(
    `SELECT ar.*, m.name AS modality_name
       FROM ris.availability_rules ar
       LEFT JOIN ris.modalities m ON m.id = ar.modality_id
       ${where}
      ORDER BY ar.health_unit_id, ar.weekday, ar.start_time`,
    params
  );
  return success(res, rows);
}

async function createRule(req, res) {
  const b = req.body;
  assertUnitScope(req, b.health_unit_id);   // recepção só na própria unidade
  const { rows } = await db.query(
    `INSERT INTO ris.availability_rules
       (health_unit_id, modality_id, weekday, start_time, end_time, slot_minutes, capacity)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [b.health_unit_id, b.modality_id || null, b.weekday, b.start_time, b.end_time,
     b.slot_minutes ?? 30, b.capacity ?? 1]
  );
  await audit.log({ ...audit.fromRequest(req), action: 'AVAILABILITY_RULE_CREATED',
    resourceType: 'availability_rule', resourceId: rows[0].id, details: { health_unit_id: b.health_unit_id } });
  return created(res, rows[0], 'Regra de disponibilidade criada');
}

async function updateRule(req, res) {
  const b = req.body;
  const { rows } = await db.query(
    `UPDATE ris.availability_rules SET
       modality_id  = $1,
       weekday      = COALESCE($2, weekday),
       start_time   = COALESCE($3, start_time),
       end_time     = COALESCE($4, end_time),
       slot_minutes = COALESCE($5, slot_minutes),
       capacity     = COALESCE($6, capacity),
       is_active    = COALESCE($7, is_active),
       updated_at   = NOW()
     WHERE id = $8 RETURNING *`,
    [b.modality_id ?? null, b.weekday ?? null, b.start_time ?? null, b.end_time ?? null,
     b.slot_minutes ?? null, b.capacity ?? null, b.is_active ?? null, req.params.id]
  );
  if (!rows.length) throw new NotFoundError('Regra de disponibilidade');
  return success(res, rows[0], 'Regra atualizada');
}

async function deleteRule(req, res) {
  const { rowCount } = await db.query(`DELETE FROM ris.availability_rules WHERE id=$1`, [req.params.id]);
  if (!rowCount) throw new NotFoundError('Regra de disponibilidade');
  return success(res, { id: req.params.id }, 'Regra removida');
}

// ── CRUD: feriados ───────────────────────────────────────────────────────────
async function listHolidays(req, res) {
  const { health_unit_id, year } = req.query;
  const params = [];
  const conds = [];
  if (health_unit_id) { params.push(health_unit_id); conds.push(`(health_unit_id IS NULL OR health_unit_id=$${params.length})`); }
  if (year)           { params.push(year);           conds.push(`EXTRACT(YEAR FROM holiday_date)=$${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT * FROM ris.holidays ${where} ORDER BY holiday_date`, params
  );
  return success(res, rows);
}

async function createHoliday(req, res) {
  const b = req.body;
  if (b.health_unit_id) assertUnitScope(req, b.health_unit_id);  // recepção só a própria unidade
  try {
    const { rows } = await db.query(
      `INSERT INTO ris.holidays (health_unit_id, holiday_date, description)
       VALUES ($1,$2,$3) RETURNING *`,
      [b.health_unit_id || null, b.holiday_date, b.description || '']
    );
    return created(res, rows[0], 'Feriado registrado');
  } catch (err) {
    if (err.code === '23505') throw new AppError('Feriado já cadastrado para esta data', 409, 'DUPLICATE_HOLIDAY');
    throw err;
  }
}

async function deleteHoliday(req, res) {
  const { rowCount } = await db.query(`DELETE FROM ris.holidays WHERE id=$1`, [req.params.id]);
  if (!rowCount) throw new NotFoundError('Feriado');
  return success(res, { id: req.params.id }, 'Feriado removido');
}

module.exports = {
  getSlots, assertSchedulable,
  listRules, createRule, updateRule, deleteRule,
  listHolidays, createHoliday, deleteHoliday,
};
