'use strict';
/**
 * Faturamento SUS — produção ambulatorial (#3 Nível 5).
 * Gera o EXTRATO DE PRODUÇÃO por competência (agendamentos realizados agrupados
 * por procedimento + CNES da unidade) e exporta em CSV (estilo BPA Consolidado).
 *
 * Limite honesto: o arquivo OFICIAL do BPA-MAG (texto de largura fixa) e o TISS
 * (XML) exigem mapeamento TUSS→SIGTAP e homologação no DATASUS/operadora — isso
 * é passo de integração externa. Aqui produzimos o dado de produção pronto p/
 * conferência/importação manual. Sem submissão automática.
 */
const db = require('../../config/database');
const { success } = require('../../utils/response');
const { AppError } = require('../../utils/errors');

// competencia 'YYYYMM' → válido?
const validComp = (c) => /^\d{6}$/.test(c) && Number(c.slice(4)) >= 1 && Number(c.slice(4)) <= 12;

function unitClause(req, startIdx) {
  const isAdmin = req.user.role === 'admin' || req.user.is_network_resource;
  const unitId = isAdmin ? (req.query.health_unit_id || null) : (req.user.health_unit_id || null);
  if (!unitId) return { clause: '', params: [] };
  return { clause: ` AND a.health_unit_id = $${startIdx}`, params: [unitId] };
}

async function productionRows(req) {
  const competencia = req.query.competencia;
  if (!validComp(competencia)) throw new AppError('Competência inválida (use AAAAMM)', 422, 'BAD_COMPETENCIA');
  const u = unitClause(req, 2);
  const { rows } = await db.query(
    `SELECT hu.cnes, hu.name AS unit_name,
            proc.tuss_code AS code, proc.name AS procedure_name,
            count(*)::int AS quantity
       FROM ris.appointments a
       JOIN ris.procedures proc ON proc.id = a.procedure_id
       LEFT JOIN ris.health_units hu ON hu.id = a.health_unit_id
      WHERE a.status = 'done'
        AND to_char(a.scheduled_at, 'YYYYMM') = $1
        ${u.clause}
      GROUP BY hu.cnes, hu.name, proc.tuss_code, proc.name
      ORDER BY hu.name, proc.name`,
    [competencia, ...u.params]
  );
  return { competencia, rows };
}

async function production(req, res) {
  const { competencia, rows } = await productionRows(req);
  const total = rows.reduce((s, r) => s + r.quantity, 0);
  return success(res, { competencia, total_procedures: total, lines: rows });
}

async function exportCsv(req, res) {
  const { competencia, rows } = await productionRows(req);
  // BPA-C consolidado (conferência): competência;CNES;código;procedimento;qtd
  const header = 'competencia;cnes;codigo;procedimento;quantidade';
  const body = rows.map((r) =>
    [competencia, r.cnes || '', r.code || '', String(r.procedure_name).replace(/[;\n\r]/g, ' '), r.quantity].join(';')
  ).join('\n');
  const csv = `${header}\n${body}\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="producao_sus_${competencia}.csv"`);
  return res.send(csv);
}

module.exports = { production, exportCsv };
