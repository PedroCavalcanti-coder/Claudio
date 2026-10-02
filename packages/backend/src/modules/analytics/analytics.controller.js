'use strict';
/**
 * Relatórios operacionais (#6 Nível 3) — produção, fila de espera e absenteísmo.
 * Somente agregados (COUNT/AVG), sem PII. Escopo por unidade: não-admin vê só a
 * própria unidade; admin vê a rede (ou filtra por health_unit_id).
 */
const db = require('../../config/database');
const { success } = require('../../utils/response');

// Resolve o filtro de unidade. Retorna { clause, params } para concatenar.
// non-admin: força a própria unidade. admin: usa query.health_unit_id se vier.
function unitScope(req, col, startIdx) {
  const isAdmin = req.user.role === 'admin' || req.user.is_network_resource;
  const unitId = isAdmin ? (req.query.health_unit_id || null) : (req.user.health_unit_id || null);
  if (!unitId) return { clause: '', params: [] };
  return { clause: ` AND ${col} = $${startIdx}`, params: [unitId] };
}

// Período padrão: últimos 30 dias até hoje.
function range(req) {
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const from = req.query.from
    || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

// ── Produção: agendamentos por status, exames, laudos + série diária ─────────
async function production(req, res) {
  const { from, to } = range(req);
  const u = unitScope(req, 'a.health_unit_id', 3);
  const params = [from, to, ...u.params];

  const byStatus = await db.query(
    `SELECT a.status, count(*)::int AS n
       FROM ris.appointments a
      WHERE a.scheduled_at::date BETWEEN $1 AND $2 ${u.clause}
      GROUP BY a.status`, params);

  const daily = await db.query(
    `SELECT a.scheduled_at::date AS day, count(*)::int AS n
       FROM ris.appointments a
      WHERE a.scheduled_at::date BETWEEN $1 AND $2 ${u.clause}
      GROUP BY day ORDER BY day`, params);

  // Estudos PACS realizados no período (por agendamento da unidade).
  const us = unitScope(req, 'a.health_unit_id', 3);
  const studies = await db.query(
    `SELECT count(*)::int AS n
       FROM pacs.studies s
       JOIN ris.appointments a ON a.id = s.appointment_id
      WHERE COALESCE(s.upload_completed_at, s.created_at)::date BETWEEN $1 AND $2 ${us.clause}`,
    [from, to, ...us.params]);

  // Laudos assinados no período (laudo → estudo → agendamento da unidade).
  const ur = unitScope(req, 'a.health_unit_id', 3);
  const reports = await db.query(
    `SELECT count(*)::int AS n
       FROM ris.reports r
       JOIN pacs.studies s ON s.id = r.study_id
       JOIN ris.appointments a ON a.id = s.appointment_id
      WHERE r.signed_at::date BETWEEN $1 AND $2 ${ur.clause}`,
    [from, to, ...ur.params]);

  const totals = byStatus.rows.reduce((acc, r) => { acc[r.status] = r.n; acc._total += r.n; return acc; }, { _total: 0 });
  return success(res, {
    from, to,
    appointments_total: totals._total,
    by_status: byStatus.rows,
    daily: daily.rows,
    studies_done: studies.rows[0].n,
    reports_signed: reports.rows[0].n,
  });
}

// ── Absenteísmo (no-show): taxa de falta + piores procedimentos ──────────────
async function noShow(req, res) {
  const { from, to } = range(req);
  const u = unitScope(req, 'a.health_unit_id', 3);
  const params = [from, to, ...u.params];

  const overall = await db.query(
    `SELECT
        count(*) FILTER (WHERE a.status = 'no_show')::int AS no_show,
        count(*) FILTER (WHERE a.status NOT IN ('cancelled'))::int AS scheduled
       FROM ris.appointments a
      WHERE a.scheduled_at::date BETWEEN $1 AND $2 ${u.clause}`, params);

  const byProcedure = await db.query(
    `SELECT proc.name AS procedure_name,
            count(*) FILTER (WHERE a.status = 'no_show')::int AS no_show,
            count(*) FILTER (WHERE a.status NOT IN ('cancelled'))::int AS scheduled
       FROM ris.appointments a
       JOIN ris.procedures proc ON proc.id = a.procedure_id
      WHERE a.scheduled_at::date BETWEEN $1 AND $2 ${u.clause}
      GROUP BY proc.name
     HAVING count(*) FILTER (WHERE a.status = 'no_show') > 0
      ORDER BY no_show DESC LIMIT 10`, params);

  const o = overall.rows[0];
  const rate = o.scheduled > 0 ? Math.round((o.no_show / o.scheduled) * 1000) / 10 : 0;
  return success(res, {
    from, to,
    no_show: o.no_show, scheduled: o.scheduled, rate_pct: rate,
    by_procedure: byProcedure.rows.map((r) => ({
      ...r, rate_pct: r.scheduled > 0 ? Math.round((r.no_show / r.scheduled) * 1000) / 10 : 0,
    })),
  });
}

// ── Fila de espera (PEP): estágios atuais + tempos médios de hoje ────────────
async function queueStats(req, res) {
  const u = unitScope(req, 'e.health_unit_id', 1);

  const byStage = await db.query(
    `SELECT e.flow_stage, count(*)::int AS n
       FROM ehr.encounters e
      WHERE e.flow_stage NOT IN ('completed','cancelled') ${u.clause}
      GROUP BY e.flow_stage`, u.params);

  // Espera atual na fila médica (min): média de agora - started_at p/ waiting_doctor.
  const waiting = await db.query(
    `SELECT
        COALESCE(round(avg(EXTRACT(EPOCH FROM (now() - e.started_at)) / 60))::int, 0) AS avg_wait_min,
        COALESCE(max(EXTRACT(EPOCH FROM (now() - e.started_at)) / 60)::int, 0) AS max_wait_min,
        count(*)::int AS waiting
       FROM ehr.encounters e
      WHERE e.flow_stage = 'waiting_doctor' ${u.clause}`, u.params);

  // Concluídos hoje + duração média total (closed_at - started_at).
  const done = await db.query(
    `SELECT count(*)::int AS completed_today,
            COALESCE(round(avg(EXTRACT(EPOCH FROM (e.closed_at - e.started_at)) / 60))::int, 0) AS avg_total_min
       FROM ehr.encounters e
      WHERE e.flow_stage = 'completed' AND e.closed_at::date = CURRENT_DATE ${u.clause}`, u.params);

  return success(res, {
    by_stage: byStage.rows,
    avg_wait_min: waiting.rows[0].avg_wait_min,
    max_wait_min: waiting.rows[0].max_wait_min,
    waiting: waiting.rows[0].waiting,
    completed_today: done.rows[0].completed_today,
    avg_total_min: done.rows[0].avg_total_min,
  });
}

module.exports = { production, noShow, queueStats };
