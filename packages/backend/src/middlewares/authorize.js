'use strict';
const { AppError } = require('../utils/errors');
const { userCan, pagePermissions, PAGES } = require('../config/permissions');

const ROLE_HIERARCHY = {
  patient:      0,
  doctor:       1,
  receptionist: 2,
  technician:   3,
  nurse:        3,
  radiologist:  4,
  admin:        5,
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

// Páginas liberadas (menu/rotas da UI) — DERIVADAS da matriz granular (config/permissions.js).
// Aceita o usuário completo ({ role, extra_roles, permission_overrides }) ou (role, extraRoles, overrides).
function getEffectivePermissions(userOrRole, extraRoles = [], overrides = {}) {
  const user = typeof userOrRole === 'object' && userOrRole
    ? userOrRole
    : { role: userOrRole, extra_roles: extraRoles, permission_overrides: overrides };
  return pagePermissions(user);
}
const getPermissionsForRole = (role) => getEffectivePermissions(role);

// Papéis que enxergam cada página (introspecção/testes), derivado de PAGES.
const ROUTE_PERMISSIONS = Object.fromEntries(Object.keys(PAGES).map((page) => [
  page, Object.keys(ROLE_HIERARCHY).filter((r) => pagePermissions({ role: r })[page]),
]));

module.exports = {
  authorize, authorizeExact, denyRoles, requirePermission,
  assertUnitScope, requireUnitScopeParam,
  requireSameUnit, injectUnitFilter,
  requireOwnership, getPermissionsForRole, getEffectivePermissions,
  ROLE_HIERARCHY, ROUTE_PERMISSIONS,
};
