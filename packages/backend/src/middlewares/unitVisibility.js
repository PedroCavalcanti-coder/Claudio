'use strict';
/**
 * Helpers para visibilidade multi-unidade.
 *
 * Política em vigor (decorre do schema + migration 009):
 *
 *   - admin .................. vê TUDO.
 *   - is_network_resource .... vê TUDO (recurso compartilhado da rede).
 *   - demais ................. veem apenas registros da sua health_unit_id
 *                              OU referenciados a si (ris.referrals aceito).
 *   - sem lotação ............ NÃO vê nada (fail-closed → fragmento "1=0").
 *
 * Estes helpers produzem fragmentos SQL prontos para serem concatenados em
 * cláusulas WHERE — junto com os parâmetros que devem ser anexados ao array
 * de bindings. Mantém o padrão usado pelo restante dos controllers.
 */

/**
 * Constrói o fragmento de filtro de unidade para um SELECT que tem acesso
 * a `<alias>.health_unit_id`. Devolve null se o usuário pode ver tudo.
 *
 *   const filter = buildUnitFilter(req, 's', params);
 *   if (filter) conditions.push(filter);
 *
 * @param {Object} req     — requisição com req.user (sub, role, health_unit_id, is_network_resource)
 * @param {string} alias   — alias SQL da tabela cujo health_unit_id será comparado
 * @param {Array}  params  — array de parâmetros do query builder (será mutado)
 * @returns {string|null}  — fragmento SQL ou null se admin/recurso de rede
 */
function buildUnitFilter(req, alias, params) {
  const u = req.user;
  if (!u) return '1=0';
  if (u.role === 'admin')          return null;
  if (u.is_network_resource)       return null;
  // Fail-CLOSED: funcionário sem lotação não vê nada (em vez de ver tudo).
  if (!u.health_unit_id)           return '1=0';
  params.push(u.health_unit_id);
  return `${alias}.health_unit_id = $${params.length}`;
}

/**
 * Cláusula que cobre "registro pertence à minha unidade OU paciente foi
 * referenciado para mim/minha unidade". Útil em queries baseadas em paciente
 * (patients, studies via patient_id).
 *
 * @param {Object} req
 * @param {string} aliasUnit   — alias da tabela com `health_unit_id`
 * @param {string} aliasPat    — alias da tabela paciente (ou da PK do paciente)
 * @param {Array}  params
 */
function buildUnitOrReferralFilter(req, aliasUnit, aliasPatientId, params) {
  const u = req.user;
  if (!u) return '1=0';
  if (u.role === 'admin' || u.is_network_resource) return null;
  // Fail-CLOSED: sem lotação → não vê nada.
  if (!u.health_unit_id) return '1=0';

  params.push(u.health_unit_id, u.sub);
  const unitParamIdx = params.length - 1;
  const userParamIdx = params.length;
  return `(
    ${aliasUnit}.health_unit_id = $${unitParamIdx}
    OR EXISTS (
      SELECT 1 FROM ris.referrals ref
       WHERE ref.patient_id = ${aliasPatientId}
         AND ref.status     = 'accepted'
         AND (ref.to_unit_id = $${unitParamIdx} OR ref.to_user_id = $${userParamIdx})
    )
  )`;
}

module.exports = { buildUnitFilter, buildUnitOrReferralFilter };
