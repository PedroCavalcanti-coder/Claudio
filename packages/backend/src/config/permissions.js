'use strict';
/**
 * RBAC granular por recurso/ação: catálogo `resource:action` + matriz papel→permissões.
 * A matriz evita wildcards de propósito, para que um papel nunca herde uma ação
 * admin-only (ex.: reports:cancel, patients:delete) por engano.
 * Wildcards SÃO aceitos em overrides/checagem ('*', 'resource:*'), mas revoke do
 * usuário sempre vence wildcard (precedência de negação).
 */

const PERMISSIONS = [
  // Agendamento
  'appointments:read', 'appointments:create', 'appointments:walkin',
  'appointments:update', 'appointments:checkin', 'appointments:cancel',
  'worklist:read',
  'availability:read', 'availability:manage',
  // Gestão operacional da própria unidade (horários, feriados, procedimentos,
  // turnos, equipe da unidade). Recepção gere a SUA unidade; admin todas.
  'unit:manage',
  // Pacientes
  'patients:read', 'patients:create', 'patients:update', 'patients:history',
  'patients:delete', 'patients:export', 'patients:merge',
  // Estudos / PACS
  'studies:read', 'studies:stream', 'studies:upload', 'studies:capture', 'studies:replicate',
  // Conciliação: vincular a paciente os estudos do equipamento sem agendamento correspondente
  'studies:reconcile',
  'dicom:upload', 'dicom:upload_patient', 'dicom:view', 'dicom:admin',
  // Laudos
  'reports:read', 'reports:create', 'reports:update', 'reports:sign',
  'reports:render', 'reports:amend', 'reports:download', 'reports:cancel',
  // Encaminhamentos / consentimento
  'referrals:create',
  'consent:read', 'consent:sign', 'consent:manage',
  // Catálogos / segunda opinião / radiologista
  'procedures:manage', 'exam_notes:manage', 'second_opinion:manage', 'radiologist:access',
  // Administração
  'notifications:sla', 'users:manage', 'health_units:manage', 'audit:read',
  // PEP / Prontuário Eletrônico (EHR)
  'encounter:read', 'encounter:create', 'encounter:update', 'encounter:close',
  'clinical_note:read', 'clinical_note:create', 'clinical_note:update',
  'clinical_note:sign', 'clinical_note:amend',
  'problem:read', 'problem:write',
  'vitals:read', 'vitals:write',
  'ehr:timeline', 'ehr:breakglass',
  // PEP F2/F3 — alergias, medicamentos, anamnese, anexos, prescrição, atestado, imunização
  'allergy:read', 'allergy:write',
  'medication:read', 'medication:write',
  'history:read', 'history:write',
  'attachment:read', 'attachment:write',
  'prescription:read', 'prescription:write', 'prescription:sign',
  'certificate:read', 'certificate:write', 'certificate:sign',
  'immunization:read', 'immunization:write',
  // SADT — solicitação de exames/laboratório
  'service_request:read', 'service_request:write',
  // Farmacovigilância — notificação de evento adverso
  'adverse_event:read', 'adverse_event:write',
  // Fluxo de atendimento (recepção→triagem→clínico→medicação)
  'episode:manage', 'medication:administer',
  // Painel público de chamada (TV) — qualquer funcionário interno, nunca paciente
  'panel:view',
  // Relatórios operacionais (produção/fila/no-show) — gestão da unidade
  'analytics:read',
  // Catálogos clínicos (CID-10 / medicamentos) — autocompletar no PEP
  'catalog:read',
  // Faturamento SUS — extrato de produção ambulatorial
  'billing:read',
  // Farmácia — estoque + dispensação ligada à prescrição
  'pharmacy:read', 'pharmacy:stock', 'pharmacy:dispense',
  // Mensageria externa (SMS/WhatsApp/e-mail) — fila de envio
  'messaging:read', 'messaging:send',
  // Teleconsulta — abrir/gerir sala de vídeo
  'teleconsult:manage',
  // Acesso ao portal do paciente — liberar/resetar (desacoplado do check-in de exame)
  'portal:grant',
];

// Matriz papel → permissões padrão (explícita; admin = tudo).
const ROLE_PERMISSIONS = {
  admin: ['*'],
  receptionist: [
    'appointments:read', 'appointments:create', 'appointments:walkin',
    'appointments:update', 'appointments:checkin', 'appointments:cancel',
    'availability:read', 'availability:manage', 'unit:manage',
    'patients:read', 'patients:create', 'patients:update', 'patients:history',
    'dicom:upload_patient',
    'reports:download',
    'consent:read', 'consent:sign',
    'referrals:create',
    // Atendimento — recepção inicia atendimento e faz medições básicas
    'episode:manage', 'encounter:read', 'ehr:timeline', 'vitals:read', 'vitals:write',
    'panel:view', 'analytics:read', 'billing:read',
    // Farmácia (gestão de estoque) + mensageria (confirmação de agendamento)
    'pharmacy:read', 'pharmacy:stock', 'messaging:read', 'messaging:send',
    'portal:grant',
  ],
  technician: [
    'appointments:read', 'appointments:walkin',
    'worklist:read', 'availability:read',
    'patients:read', 'patients:create',
    'studies:read', 'studies:stream', 'studies:upload', 'studies:capture', 'studies:reconcile',
    'dicom:upload', 'dicom:upload_patient',
    'reports:download',
    'procedures:manage', 'exam_notes:manage',
    'referrals:create',
    // PEP — enfermagem/técnico: sinais vitais + leitura de timeline/atendimento
    'encounter:read', 'vitals:read', 'vitals:write', 'problem:read', 'ehr:timeline',
    // PEP F2/F3 — enfermagem registra alergia/anexo/vacina; lê o restante
    'allergy:read', 'allergy:write', 'medication:read', 'history:read',
    'attachment:read', 'attachment:write', 'prescription:read',
    'certificate:read', 'immunization:read', 'immunization:write',
    'panel:view',
    // SADT — técnico/laboratório lê e atualiza status (coleta/resultado)
    'service_request:read', 'service_request:write',
    'catalog:read', 'adverse_event:read',
    // Farmácia — leitura + gestão de estoque
    'pharmacy:read', 'pharmacy:stock',
  ],
  radiologist: [
    // Worklist e Dashboard (a tela abria e a chamada dava 403)
    'worklist:read', 'appointments:read',
    'studies:read', 'studies:stream', 'studies:capture',
    'patients:read', 'patients:update', 'patients:history',
    'reports:read', 'reports:create', 'reports:update', 'reports:sign',
    'reports:render', 'reports:amend', 'reports:download',
    'dicom:view',
    'exam_notes:manage', 'second_opinion:manage', 'radiologist:access',
    'referrals:create',
    // PEP — autor clínico completo
    'encounter:read', 'encounter:create', 'encounter:update', 'encounter:close',
    'clinical_note:read', 'clinical_note:create', 'clinical_note:update',
    'clinical_note:sign', 'clinical_note:amend',
    'problem:read', 'problem:write', 'vitals:read', 'vitals:write',
    'ehr:timeline', 'ehr:breakglass',
    // PEP F2/F3 — autor clínico completo
    'allergy:read', 'allergy:write', 'medication:read', 'medication:write',
    'history:read', 'history:write', 'attachment:read', 'attachment:write',
    'prescription:read', 'prescription:write', 'prescription:sign',
    'certificate:read', 'certificate:write', 'certificate:sign',
    'immunization:read', 'immunization:write',
    'panel:view', 'analytics:read',
    'service_request:read', 'service_request:write',
    'catalog:read', 'adverse_event:read', 'adverse_event:write',
    // Teleconsulta (telerradiologia/parecer remoto) + leitura de farmácia
    'teleconsult:manage', 'pharmacy:read', 'portal:grant',
  ],
  doctor: [
    // Dashboard (agenda do dia) e Relatórios operacionais leem /appointments e /analytics
    'appointments:read', 'analytics:read',
    'reports:download', 'exam_notes:manage', 'referrals:create',
    'patients:read', 'patients:history', 'episode:manage',
    // PEP — autor clínico completo
    'encounter:read', 'encounter:create', 'encounter:update', 'encounter:close',
    'clinical_note:read', 'clinical_note:create', 'clinical_note:update',
    'clinical_note:sign', 'clinical_note:amend',
    'problem:read', 'problem:write', 'vitals:read', 'vitals:write',
    'ehr:timeline', 'ehr:breakglass',
    // PEP F2/F3 — autor clínico completo
    'allergy:read', 'allergy:write', 'medication:read', 'medication:write',
    'history:read', 'history:write', 'attachment:read', 'attachment:write',
    'prescription:read', 'prescription:write', 'prescription:sign',
    'certificate:read', 'certificate:write', 'certificate:sign',
    'immunization:read', 'immunization:write',
    'panel:view',
    'service_request:read', 'service_request:write',
    'catalog:read', 'adverse_event:read', 'adverse_event:write',
    // Teleconsulta (atendimento remoto) + leitura de farmácia
    'teleconsult:manage', 'pharmacy:read', 'portal:grant',
  ],
  // Enfermeiro — aplica medicação na unidade (MAR) + medições + leitura clínica
  nurse: [
    'patients:read', 'patients:create', 'patients:history',
    'episode:manage', 'encounter:read', 'ehr:timeline',
    'vitals:read', 'vitals:write',
    'allergy:read', 'allergy:write', 'medication:read', 'problem:read',
    'immunization:read', 'immunization:write',
    'clinical_note:read', 'prescription:read',
    // Prontuário aberto pela enfermagem carrega anamnese, anexos e atestados (leitura)
    'history:read', 'attachment:read', 'certificate:read',
    'medication:administer',
    'reports:download', 'referrals:create',
    'panel:view',
    'service_request:read',
    'catalog:read', 'adverse_event:read', 'adverse_event:write',
    // Farmácia — enfermagem dispensa na unidade + gere estoque
    'pharmacy:read', 'pharmacy:stock', 'pharmacy:dispense',
    'portal:grant',
  ],
  patient: [],
};

const rolePerms = (role) => ROLE_PERMISSIONS[role] || [];

// `needed` é coberto por um conjunto que pode conter '*' e 'resource:*'?
function matchesSet(set, needed) {
  if (set.has('*') || set.has(needed)) return true;
  return set.has(`${needed.split(':')[0]}:*`);
}

// Conjunto concedido (sem aplicar revoke): papel-base ∪ extra_roles ∪ granted.
function grantedSet(role, extraRoles = [], overrides = {}) {
  const set = new Set();
  for (const p of rolePerms(role)) set.add(p);
  for (const er of (Array.isArray(extraRoles) ? extraRoles : [])) for (const p of rolePerms(er)) set.add(p);
  for (const p of (overrides.granted || [])) set.add(p);
  return set;
}

// O usuário tem a permissão `needed`? Revoke do usuário vence wildcard.
function userCan(user, needed) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const overrides = user.permission_overrides || {};
  if ((overrides.revoked || []).includes(needed)) return false;
  return matchesSet(grantedSet(user.role, user.extra_roles, overrides), needed);
}

// Lista CONCRETA de permissões efetivas (expande wildcards via catálogo).
function listEffective(user) {
  if (!user) return [];
  if (user.role === 'admin') return [...PERMISSIONS];
  return PERMISSIONS.filter(p => userCan(user, p));
}

// ── Páginas da UI (menu e rotas) ───────────────────────────────────────────────
// UMA fonte só: a visibilidade de cada página é DERIVADA da matriz granular acima (papel +
// papéis extras + overrides do usuário). Antes havia um segundo mapa (ROUTE_PERMISSIONS) que
// divergia da matriz: a tela abria e a primeira chamada dava 403.
// `perms`: a página aparece se o usuário tem QUALQUER uma. `roles`: só para páginas sem
// permissão granular natural (portal do paciente, notificações…).
const ALL_STAFF = ['receptionist', 'technician', 'radiologist', 'doctor', 'nurse'];
const PAGES = {
  dashboard:         { perms: ['appointments:read'] },
  appointments:      { perms: ['appointments:create'] },
  patients:          { perms: ['patients:create'] },
  patients_read:     { perms: ['patients:read'] },
  worklist:          { perms: ['worklist:read'] },
  studies:           { perms: ['studies:read'] },
  dicom_upload:      { perms: ['studies:upload'] },
  webviewer:         { perms: ['studies:stream'] },
  reports:           { perms: ['reports:read'] },
  reports_own:       { perms: ['reports:create'] },
  second_opinion:    { perms: ['second_opinion:manage'] },
  referrals:         { perms: ['referrals:create'] },
  settings:          { perms: ['users:manage'] },
  unit_manage:       { perms: ['unit:manage'] },
  consent:           { perms: ['consent:read'] },
  wado:              { perms: ['studies:stream'] },
  health_units:      { perms: ['health_units:manage'] },
  procedures_manage: { perms: ['procedures:manage'] },
  atendimento:       { perms: ['episode:manage'] },
  medicacao:         { perms: ['medication:administer'] },
  painel:            { perms: ['panel:view'] },
  relatorios:        { perms: ['analytics:read'] },
  faturamento:       { perms: ['billing:read'] },
  farmacia:          { perms: ['pharmacy:stock', 'pharmacy:dispense'] },
  teleconsulta:      { perms: ['teleconsult:manage'] },
  portal_grant:      { perms: ['portal:grant'] },
  // sem permissão granular equivalente:
  ehr:               { roles: ['doctor', 'technician', 'radiologist', 'nurse'] },  // prontuário (recepção fica de fora)
  notifications:     { roles: ['doctor', 'receptionist', 'technician', 'radiologist'] },
  portal:            { roles: ['patient'] },
};

// A página está liberada para `user` ({ role, extra_roles, permission_overrides })?
function canAccessPage(user, page) {
  const def = PAGES[page];
  if (!def || !user) return false;
  if (user.role === 'admin') return page !== 'portal';
  if (def.perms) return def.perms.some((p) => userCan(user, p));
  const roles = [user.role, ...(Array.isArray(user.extra_roles) ? user.extra_roles : [])];
  return def.roles.some((r) => roles.includes(r));
}

// { pagina: boolean } enviado no login/me e lido por `can('pagina')` no frontend.
function pagePermissions(user) {
  const out = {};
  for (const page of Object.keys(PAGES)) out[page] = canAccessPage(user, page);
  return out;
}


// Valida que strings de permissão existem no catálogo (para overrides).
function isValidPermission(p) { return PERMISSIONS.includes(p); }

module.exports = {
  PERMISSIONS, ROLE_PERMISSIONS, PAGES, ALL_STAFF,
  userCan, listEffective, grantedSet, isValidPermission,
  canAccessPage, pagePermissions,
};
