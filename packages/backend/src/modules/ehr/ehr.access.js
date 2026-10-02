'use strict';
/**
 * Controle de acesso clínico ao PEP — modelo global + break-glass.
 * Ver docs/pep-design.md §3.
 *
 * Diferente da visibilidade por unidade do RIS (estudos/agenda), o dado clínico
 * do prontuário é GLOBAL: um profissional pode, em tese, alcançar qualquer
 * paciente da rede — mas só sem fricção quando há VÍNCULO; fora do vínculo o
 * acesso exige quebra de sigilo (break-glass) justificada e auditada.
 *
 *   1. admin / is_network_resource → acesso global (sem break-glass).
 *   2. vínculo: tem encounter desse paciente (autor/criador) OU está lotado na
 *      unidade de algum encounter do paciente.
 *   3. break-glass ativo (grant não expirado) → acesso temporário.
 *   4. senão → 403 NO_CLINICAL_BOND (o front oferece "quebrar sigilo").
 */
const db = require('../../config/database');
const audit = require('../../services/audit');
const { AppError } = require('../../utils/errors');

async function resolveClinicalAccess(user, patientId) {
  if (!user) throw new AppError('Não autenticado', 401);
  if (user.role === 'admin' || user.is_network_resource) return { mode: 'global' };

  const bond = await db.query(
    `SELECT 1 FROM ehr.encounters
       WHERE patient_id = $1
         AND ( professional_id = $2
            OR created_by      = $2
            OR (health_unit_id IS NOT NULL AND health_unit_id = $3) )
       LIMIT 1`,
    [patientId, user.sub, user.health_unit_id || null]
  );
  if (bond.rows.length) return { mode: 'bond' };

  const bg = await db.query(
    `SELECT 1 FROM ehr.breakglass_grants
       WHERE user_id = $1 AND patient_id = $2 AND expires_at > NOW()
       LIMIT 1`,
    [user.sub, patientId]
  );
  if (bg.rows.length) return { mode: 'breakglass' };

  throw new AppError(
    'Sem vínculo clínico com este paciente. Registre uma quebra de sigilo (break-glass) com justificativa para acessar.',
    403, 'NO_CLINICAL_BOND'
  );
}

/**
 * Autoriza o acesso clínico ao paciente (lança 403 se negado) e devolve o modo.
 * Guarda o modo em req.clinicalAccess para a auditoria a jusante.
 */
async function assertClinicalAccess(req, patientId) {
  const access = await resolveClinicalAccess(req.user, patientId);
  req.clinicalAccess = access;
  return access;
}

/** Registra acesso/operação sobre dado clínico (LGPD Art. 37 + CFM 1.821). */
async function logClinical(req, action, { patientId, resourceType, resourceId, details = {} }) {
  await audit.log({
    ...audit.fromRequest(req),
    action,
    resourceType,
    resourceId: resourceId || patientId,
    details: { patient_id: patientId, access_mode: req.clinicalAccess?.mode, ...details },
  });
}

module.exports = { resolveClinicalAccess, assertClinicalAccess, logClinical };
