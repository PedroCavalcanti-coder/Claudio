'use strict';
const { AppError } = require('../utils/errors');
const { userCan } = require('../config/permissions');

const ROLE_HIERARCHY = {
  patient:      0,
  doctor:       1,
  receptionist: 2,
  technician:   3,
  nurse:        3,
  radiologist:  4,
  admin:        5,
};

// Permissões por recurso — admin tem tudo exceto portal
const ROUTE_PERMISSIONS = {
  dashboard:       ['doctor','receptionist','technician','radiologist','admin'],
  appointments:    ['receptionist','admin'],
  patients:        ['receptionist','admin'],             // radiologist vê apenas os seus
  patients_read:   ['receptionist','radiologist','technician','doctor','nurse','admin'],
  worklist:        ['technician','radiologist','admin'],
  studies:         ['technician','radiologist','admin'],
  dicom_upload:    ['technician','radiologist','admin'],
  webviewer:       ['technician','radiologist','admin'], // recepcionista/médico NÃO
  reports:         ['radiologist','admin'],
  reports_own:     ['radiologist','admin'],              // médico vê apenas os seus
  second_opinion:  ['radiologist','admin'],
  referrals:       ['receptionist','radiologist','doctor','technician','admin'],
  settings:        ['admin'],
  unit_manage:     ['admin','receptionist'],   // gestão da própria unidade (recepção) / todas (admin)
  consent:         ['receptionist','admin'],
  notifications:   ['doctor','receptionist','technician','radiologist','admin'],
  wado:            ['technician','radiologist','admin'],
  health_units:       ['admin'],
  procedures_manage:  ['technician','admin'],
  portal:             ['patient'],
  // PEP — prontuário eletrônico (aba clínica do paciente). Recepção fica de fora.
  ehr:                ['doctor','technician','radiologist','nurse','admin'],
  // Fluxo de atendimento — painel/fila de atendimento (recepção→clínico→medicação).
  // Recepção faz acolhimento + triagem (medições); enfermeiro e médico atuam no fluxo.
  atendimento:        ['receptionist','nurse','doctor','admin'],
  // Administração de medicamentos na unidade (enfermeiro)
  medicacao:          ['nurse','admin'],
  // Painel público de chamada (TV) — qualquer funcionário interno, nunca paciente.
  painel:             ['receptionist','nurse','doctor','technician','radiologist','admin'],
  // Relatórios operacionais (produção/fila/no-show) — gestão.
  relatorios:         ['receptionist','radiologist','doctor','admin'],
  // Faturamento SUS (produção ambulatorial) — recepção/faturamento + admin.
  faturamento:        ['receptionist','admin'],
  // Farmácia (estoque + dispensação) — enfermagem/recepção/técnico + admin.
  farmacia:           ['nurse','receptionist','technician','admin'],
  // Teleconsulta (sala de vídeo) — médico/radiologista + admin.
  teleconsulta:       ['doctor','radiologist','admin'],
  // Liberar acesso ao portal do paciente — recepção/enfermagem/clínicos + admin.
  portal_grant:       ['receptionist','nurse','doctor','radiologist','admin'],
};

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Não autenticado', 401));
    const role = req.user.role;
    if (role === 'admin') return next();
    // Perfil customizado por composição: papel-base ∪ papéis adicionais.
    const userRoles = [role, ...(Array.isArray(req.user.extra_roles) ? req.user.extra_roles : [])];
    if (allowedRoles.some(r => userRoles.includes(r))) return next();
    return next(new AppError(
      `Acesso negado. Recurso restrito a: ${allowedRoles.join(', ')}.`,
      403, 'FORBIDDEN'
    ));
  };
}

// RBAC granular (#31): exige permissão(ões) `resource:action`. Aditivo ao
// authorize() por papel — admin faz bypass; demais usam matriz papel→permissões
// + overrides do usuário (granted/revoked). Exige TODAS as permissões passadas.
function requirePermission(...needed) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Não autenticado', 401));
    if (req.user.role === 'admin') return next();
    if (needed.every(p => userCan(req.user, p))) return next();
    return next(new AppError(
      `Acesso negado. Requer permissão: ${needed.join(', ')}.`,
      403, 'FORBIDDEN'
    ));
  };
}

// Escopo por unidade: não-admin só pode gerir a PRÓPRIA unidade de lotação.
// Lança AppError 403 se um não-admin tentar agir sobre outra unidade.
function assertUnitScope(req, unitId) {
  if (req.user?.role === 'admin') return;
  if (!req.user?.health_unit_id || String(unitId) !== String(req.user.health_unit_id)) {
    throw new AppError('Você só pode gerir a sua própria unidade.', 403, 'UNIT_SCOPE');
  }
}
// Middleware: lê o id da unidade de req.params[paramName] e aplica o escopo.
function requireUnitScopeParam(paramName = 'id') {
  return (req, res, next) => {
    try { assertUnitScope(req, req.params[paramName]); next(); }
    catch (e) { next(e); }
  };
}

function authorizeExact(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Não autenticado', 401));
    if (roles.includes(req.user.role)) return next();
    return next(new AppError('Acesso negado', 403, 'FORBIDDEN'));
  };
}

function denyRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Não autenticado', 401));
    if (roles.includes(req.user.role))
      return next(new AppError('Acesso negado para este perfil', 403, 'FORBIDDEN'));
    next();
  };
}

// Garante que o usuário só acessa dados da SUA unidade de saúde
// Admin ignora esse filtro
function requireSameUnit(getUnitId) {
  return async (req, res, next) => {
    try {
      if (!req.user) return next(new AppError('Não autenticado', 401));
      if (req.user.role === 'admin') return next();

      const unitId = await getUnitId(req);
      if (!unitId) return next();

      if (req.user.health_unit_id !== unitId) {
        return next(new AppError('Acesso negado: recurso pertence a outra unidade', 403, 'FORBIDDEN'));
      }
      next();
    } catch (e) { next(e); }
  };
}

// Injeta filtro de unidade automaticamente nas queries
function injectUnitFilter(req) {
  if (req.user?.role === 'admin') return null;
  return req.user?.health_unit_id ?? null;
}

function requireOwnership(getResourceOwnerId) {
  return async (req, res, next) => {
    try {
      if (!req.user) return next(new AppError('Não autenticado', 401));
      if (['admin', 'radiologist'].includes(req.user.role)) return next();
      const ownerId = await getResourceOwnerId(req);
      if (ownerId === req.user.sub) return next();
      return next(new AppError('Acesso negado: recurso não pertence a este usuário', 403, 'FORBIDDEN'));
    } catch (e) { next(e); }
  };
}

function getPermissionsForRole(role) {
  const perms = {};
  for (const [resource, roles] of Object.entries(ROUTE_PERMISSIONS)) {
    perms[resource] = roles.includes(role) || (role === 'admin' && resource !== 'portal');
  }
  return perms;
}

// Permissões efetivas considerando papel-base + papéis adicionais (perfil customizado).
function getEffectivePermissions(role, extraRoles = []) {
  const allRoles = [role, ...(Array.isArray(extraRoles) ? extraRoles : [])];
  const perms = {};
  for (const [resource, roles] of Object.entries(ROUTE_PERMISSIONS)) {
    perms[resource] = allRoles.some(r => roles.includes(r)) || (role === 'admin' && resource !== 'portal');
  }
  return perms;
}

module.exports = {
  authorize, authorizeExact, denyRoles, requirePermission,
  assertUnitScope, requireUnitScopeParam,
  requireSameUnit, injectUnitFilter,
  requireOwnership, getPermissionsForRole, getEffectivePermissions,
  ROLE_HIERARCHY, ROUTE_PERMISSIONS,
};
