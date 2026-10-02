'use strict';
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const db      = require('../../config/database');
const tokenService = require('../../services/token');
const { generatePortalJwt } = require('../../services/portalToken');
const audit   = require('../../services/audit');
const enc     = require('../../services/encryption');
const { success } = require('../../utils/response');
const { AppError } = require('../../utils/errors');
const env     = require('../../config/env');
const { getPermissionsForRole, getEffectivePermissions } = require('../../middlewares/authorize');

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   7 * 24 * 60 * 60 * 1000,
  path:     '/api/v1/auth',
};

// ── Helper: buscar usuário e validar senha ─────────────────────────────────────
async function findAndValidate(whereClause, params, password, expectedRole) {
  const { rows } = await db.query(
    `SELECT id, name, email, password_hash, role, is_active,
            mfa_enabled, mfa_secret, failed_attempts, locked_until,
            health_unit_id, is_network_resource, shared_specialties, extra_roles,
            permission_overrides, username, cpf_hash
     FROM auth.users WHERE ${whereClause}`,
    params
  );

  const user = rows[0];

  // Timing-safe: sempre rodar bcrypt
  if (!user) {
    await bcrypt.compare(password, '$2b$12$invalidhashfortimingattack00000000000000000000');
    throw new AppError('Credenciais inválidas', 401, 'INVALID_CREDENTIALS');
  }

  if (expectedRole && user.role !== expectedRole && user.role !== 'admin') {
    await bcrypt.compare(password, '$2b$12$invalidhashfortimingattack00000000000000000000');
    throw new AppError('Credenciais inválidas', 401, 'INVALID_CREDENTIALS');
  }

  if (!user.is_active)
    throw new AppError('Conta inativa. Contate o administrador.', 401, 'ACCOUNT_INACTIVE');

  if (user.locked_until && new Date(user.locked_until) > new Date())
    throw new AppError('Conta bloqueada temporariamente. Tente em 15 minutos.', 423, 'ACCOUNT_LOCKED');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const attempts = user.failed_attempts + 1;
    const locked   = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    await db.query(
      `UPDATE auth.users SET failed_attempts=$1, locked_until=$2 WHERE id=$3`,
      [attempts, locked, user.id]
    );
    await audit.log({ action: audit.ACTIONS.LOGIN_FAILED, userId: user.id, userEmail: user.email });
    throw new AppError('Credenciais inválidas', 401, 'INVALID_CREDENTIALS');
  }

  return user;
}

async function issueTokens(req, res, user, redirectTo) {
  // Unidade desativada: funcionário lotado nela não pode operar.
  // (Admin não tem lotação → não cai aqui; paciente usa fluxo próprio.)
  if (user.health_unit_id) {
    const { rows: huRows } = await db.query(
      `SELECT is_active FROM ris.health_units WHERE id = $1`, [user.health_unit_id]
    );
    if (huRows.length && huRows[0].is_active === false) {
      throw new AppError(
        'Sua unidade de saúde está desativada. Procure o administrador da rede.',
        403, 'UNIT_INACTIVE'
      );
    }
  }

  if (user.mfa_enabled) {
    const { mfa_code } = req.body;
    if (!mfa_code) throw new AppError('Código MFA necessário', 401, 'MFA_REQUIRED');
    const speakeasy = require('speakeasy');
    const ok = speakeasy.totp.verify({ secret: user.mfa_secret, encoding: 'base32', token: mfa_code, window: 1 });
    if (!ok) throw new AppError('Código MFA inválido', 401, 'MFA_INVALID');
  }

  await db.query(
    `UPDATE auth.users SET failed_attempts=0, locked_until=NULL, last_login_at=NOW(), last_login_ip=$1 WHERE id=$2`,
    [req.ip, user.id]
  );

  const deviceInfo = { ip: req.ip, userAgent: req.headers['user-agent'] };
  const [accessToken, refreshToken] = await Promise.all([
    tokenService.generateAccessToken(user),
    tokenService.generateRefreshToken(user.id, deviceInfo),
  ]);

  await audit.log({
    action: audit.ACTIONS.LOGIN, userId: user.id, userEmail: user.email,
    userRole: user.role, ipAddress: req.ip, userAgent: req.headers['user-agent'],
  });

  res.cookie('refresh_token', refreshToken, COOKIE_OPTS);

  return success(res, {
    access_token: accessToken,
    redirect_to:  redirectTo,
    user: {
      id:             user.id,
      name:           user.name,
      email:          user.email,
      role:           user.role,
      health_unit_id: user.health_unit_id,
      extra_roles:    user.extra_roles || [],
      permissions:    getEffectivePermissions(user.role, user.extra_roles),
    },
  }, 'Login realizado com sucesso');
}

// ── /login_paciente — CPF + senha → /portal_do_paciente ──────────────────────
async function loginPaciente(req, res) {
  const { cpf, password } = req.body;
  const cpfHash = enc.searchHash(cpf.replace(/[.\-]/g, '').trim());

  const { rows } = await db.query(
    `SELECT pa.*, p.name_encrypted, p.medical_record_number, p.health_unit_id,
            p.is_active AS patient_is_active
     FROM ris.patient_portal_accounts pa
     JOIN ris.patients p ON p.id = pa.patient_id
     WHERE pa.cpf_hash=$1`, [cpfHash]
  );

  const account = rows[0];

  if (!account) {
    await bcrypt.compare(password, '$2b$12$invalidhashfortimingattack00000000000000000000');
    throw new AppError('CPF ou senha inválidos', 401, 'INVALID_CREDENTIALS');
  }

  if (!account.is_active) throw new AppError('Conta inativa', 401);
  if (account.locked_until && new Date(account.locked_until) > new Date())
    throw new AppError('Conta bloqueada. Tente em 15 minutos.', 423);

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) {
    const attempts = account.failed_attempts + 1;
    const locked   = attempts >= 5 ? new Date(Date.now() + 15*60*1000) : null;
    await db.query(`UPDATE ris.patient_portal_accounts SET failed_attempts=$1, locked_until=$2 WHERE id=$3`,
      [attempts, locked, account.id]);
    throw new AppError('CPF ou senha inválidos', 401, 'INVALID_CREDENTIALS');
  }

  // Reset tentativas (login válido — mas pode ser paciente inativo, ver abaixo)
  await db.query(`UPDATE ris.patient_portal_accounts SET failed_attempts=0, locked_until=NULL WHERE id=$1`,
    [account.id]);

  // ── Cadastro de paciente INATIVO: não gera token. Frontend mostra a tela
  //    "Reativar conta", que reusa as credenciais já validadas.
  if (!account.patient_is_active) {
    let patientName;
    try { patientName = enc.decrypt(account.name_encrypted); }
    catch { patientName = 'Paciente'; }
    return success(res, {
      code:           'ACCOUNT_INACTIVE',
      can_reactivate: true,
      patient_id:     account.patient_id,
      patient_name:   patientName,
    }, 'Conta inativa. Reative para continuar.');
  }

  await db.query(`UPDATE ris.patient_portal_accounts SET last_login_at=NOW(), last_login_ip=$1 WHERE id=$2`,
    [req.ip, account.id]);

  // Gerar token de portal (não JWT do sistema interno)
  const portalToken = generatePortalJwt(account.id, account.patient_id, account.health_unit_id);

  await audit.log({ action:'PORTAL_LOGIN', resourceType:'patient', resourceId:account.patient_id, ipAddress:req.ip });

  res.cookie('portal_token', portalToken, {
    httpOnly:true, secure:env.NODE_ENV==='production', sameSite:'strict',
    maxAge: 8*3600*1000, path:'/api/v1/patient-portal',
  });

  let patientName;
  try {
    patientName = enc.decrypt(account.name_encrypted);
  } catch (error) {
    patientName = 'Paciente';
  }

  return success(res, {
    token:       portalToken,
    redirect_to: '/portal_do_paciente',
    patient: {
      id:   account.patient_id,
      name: patientName,
      mrn:  account.medical_record_number,
    },
  }, 'Login realizado');
}

// ── /reactivate_paciente — CPF + senha → reativa + emite sessão ───────────────
async function reactivatePaciente(req, res) {
  const { cpf, password } = req.body;
  const cpfHash = enc.searchHash(cpf.replace(/[.\-]/g, '').trim());

  const { rows } = await db.query(
    `SELECT pa.*, p.name_encrypted, p.medical_record_number, p.health_unit_id,
            p.is_active AS patient_is_active
       FROM ris.patient_portal_accounts pa
       JOIN ris.patients p ON p.id = pa.patient_id
      WHERE pa.cpf_hash = $1`,
    [cpfHash]
  );
  const account = rows[0];
  if (!account) {
    await bcrypt.compare(password, '$2b$12$invalidhashfortimingattack00000000000000000000');
    throw new AppError('CPF ou senha inválidos', 401, 'INVALID_CREDENTIALS');
  }
  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) throw new AppError('CPF ou senha inválidos', 401, 'INVALID_CREDENTIALS');

  if (account.patient_is_active) {
    throw new AppError('Sua conta já está ativa', 400, 'ALREADY_ACTIVE');
  }

  await db.query(
    `UPDATE ris.patients
        SET is_active = TRUE, deactivated_at = NULL, updated_at = NOW()
      WHERE id = $1`,
    [account.patient_id]
  );

  await db.query(
    `UPDATE ris.patient_portal_accounts
        SET failed_attempts = 0, locked_until = NULL,
            last_login_at = NOW(), last_login_ip = $1
      WHERE id = $2`,
    [req.ip, account.id]
  );

  await audit.log({
    action:       'PATIENT_REACTIVATED_VIA_PORTAL',
    resourceType: 'patient',
    resourceId:   account.patient_id,
    ipAddress:    req.ip,
  });

  const portalToken = generatePortalJwt(account.id, account.patient_id, account.health_unit_id);

  res.cookie('portal_token', portalToken, {
    httpOnly: true, secure: env.NODE_ENV === 'production',
    sameSite: 'strict', maxAge: 8 * 3600 * 1000, path: '/api/v1/patient-portal',
  });

  let patientName;
  try { patientName = enc.decrypt(account.name_encrypted); }
  catch { patientName = 'Paciente'; }

  return success(res, {
    token:       portalToken,
    redirect_to: '/portal_do_paciente',
    patient: {
      id:   account.patient_id,
      name: patientName,
      mrn:  account.medical_record_number,
    },
  }, 'Conta reativada com sucesso');
}

// ── /login_medico — CPF + email + senha → / com role=radiologist ──────────────
async function loginMedico(req, res) {
  const { cpf, email, password } = req.body;
  const cpfHash = enc.searchHash(cpf.replace(/[.\-]/g,'').trim());

  const user = await findAndValidate(
    `email=$1 AND cpf_hash=$2 AND role IN ('radiologist','doctor')`,
    [email.toLowerCase(), cpfHash], password, null
  );

  return issueTokens(req, res, user, '/');
}

// ── /login_recepcao — username + senha → / com role=receptionist ─────────────
async function loginRecepcao(req, res) {
  const { username, password } = req.body;
  const user = await findAndValidate(
    `username=$1 AND role='receptionist'`, [username.toLowerCase()], password, 'receptionist'
  );
  return issueTokens(req, res, user, '/');
}

// ── /login_tecnico — username + senha → / com role=technician ────────────────
async function loginTecnico(req, res) {
  const { username, password } = req.body;
  const user = await findAndValidate(
    `username=$1 AND role='technician'`, [username.toLowerCase()], password, 'technician'
  );
  return issueTokens(req, res, user, '/');
}

// ── /login_enfermeiro — username + senha → / com role=nurse ──────────────────
async function loginEnfermeiro(req, res) {
  const { username, password } = req.body;
  const user = await findAndValidate(
    `username=$1 AND role='nurse'`, [username.toLowerCase()], password, 'nurse'
  );
  return issueTokens(req, res, user, '/');
}

// ── /login_admin — email + senha + MFA opcional → / com role=admin ────────────
async function loginAdmin(req, res) {
  const { email, password } = req.body;
  const user = await findAndValidate(
    `email=$1 AND role='admin'`, [email.toLowerCase()], password, 'admin'
  );
  return issueTokens(req, res, user, '/');
}

// ── /login legado ─────────────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;
  const ip = req.ip;
  const { rows } = await db.query(
    `SELECT id, name, email, password_hash, role, is_active, mfa_enabled, mfa_secret,
            failed_attempts, locked_until, health_unit_id, is_network_resource, shared_specialties, extra_roles,
            permission_overrides
     FROM auth.users WHERE email=$1`, [email.toLowerCase()]
  );
  const user = rows[0];
  if (!user) {
    await bcrypt.compare(password, '$2b$12$invalidhashfortimingattack00000000000000000000');
    await audit.log({ action: audit.ACTIONS.LOGIN_FAILED, ipAddress: ip, details: { email, reason:'user_not_found' } });
    throw new AppError('Credenciais inválidas', 401, 'INVALID_CREDENTIALS');
  }
  if (user.locked_until && new Date(user.locked_until) > new Date())
    throw new AppError('Conta bloqueada temporariamente.', 423, 'ACCOUNT_LOCKED');
  if (!user.is_active) throw new AppError('Conta inativa', 401, 'ACCOUNT_INACTIVE');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const attempts = user.failed_attempts + 1;
    const locked   = attempts >= 5 ? new Date(Date.now() + 15*60*1000) : null;
    await db.query(`UPDATE auth.users SET failed_attempts=$1, locked_until=$2 WHERE id=$3`, [attempts, locked, user.id]);
    await audit.log({ action: audit.ACTIONS.LOGIN_FAILED, userId: user.id });
    throw new AppError('Credenciais inválidas', 401, 'INVALID_CREDENTIALS');
  }

  const redirectMap = {
    patient:      '/portal_do_paciente',
    admin:        '/',
    radiologist:  '/',
    technician:   '/',
    receptionist: '/',
    doctor:       '/',
  };

  return issueTokens(req, res, user, redirectMap[user.role] ?? '/');
}

// ── Refresh, Logout, Me ───────────────────────────────────────────────────────
async function refresh(req, res) {
  const token = req.cookies?.refresh_token;
  if (!token) throw new AppError('Refresh token não fornecido', 401);
  const record = await tokenService.validateRefreshToken(token);
  await tokenService.revokeRefreshToken(token);
  const [accessToken, newRefreshToken] = await Promise.all([
    tokenService.generateAccessToken(record),
    tokenService.generateRefreshToken(record.user_id, { ip: req.ip }),
  ]);
  res.cookie('refresh_token', newRefreshToken, COOKIE_OPTS);
  return success(res, { access_token: accessToken }, 'Token renovado');
}

async function logout(req, res) {
  const token = req.cookies?.refresh_token;
  if (token) await tokenService.revokeRefreshToken(token);
  await audit.log({ ...audit.fromRequest(req), action: audit.ACTIONS.LOGOUT });
  res.clearCookie('refresh_token', { path: '/api/v1/auth' });
  return success(res, null, 'Logout realizado');
}

async function logoutAll(req, res) {
  await tokenService.revokeAllUserTokens(req.user.sub);
  res.clearCookie('refresh_token', { path: '/api/v1/auth' });
  return success(res, null, 'Logout em todos os dispositivos');
}

async function me(req, res) {
  const { rows } = await db.query(
    `SELECT u.id AS id, u.name, u.email, u.role, u.crm, u.crm_uf, u.specialty, u.username,
            u.last_login_at, u.is_active, u.health_unit_id, u.extra_roles, u.permission_overrides,
            hu.name AS health_unit_name
     FROM auth.users u
     LEFT JOIN ris.health_units hu ON hu.id = u.health_unit_id
     WHERE u.id=$1`, [req.user.sub]
  );
  if (!rows.length) throw new AppError('Usuário não encontrado', 404);
  const { listEffective } = require('../../config/permissions');
  return success(res, {
    ...rows[0],
    permissions: getEffectivePermissions(rows[0].role, rows[0].extra_roles),
    // Lista granular resource:action, além do papel agregado em `permissions`
    granular_permissions: listEffective(rows[0]),
  });
}

async function myPermissions(req, res) {
  const { listEffective } = require('../../config/permissions');
  return success(res, {
    role:        req.user.role,
    extra_roles: req.user.extra_roles || [],
    overrides:   req.user.permission_overrides || { granted: [], revoked: [] },
    permissions: listEffective(req.user),
  });
}

async function forgotPassword(req, res) {
  const { email } = req.body;
  const { rows } = await db.query(
    `SELECT id, name, email FROM auth.users WHERE email=$1 AND is_active=TRUE`, [email.toLowerCase()]
  );
  if (rows.length) {
    const token     = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await db.query(
      `INSERT INTO auth.password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 hour')`,
      [rows[0].id, tokenHash]
    );
    // Envia o email com o link de redefinição (best-effort: não revela ao
    // cliente se o email existe nem se o envio falhou — anti-enumeração).
    const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;
    setImmediate(async () => {
      try {
        const { render }    = require('../../templates/email/render');
        const { sendEmail } = require('../../services/email');
        const { subject, html, text } = render('password_reset', {
          user:  { name: rows[0].name },
          reset: { url: resetUrl },
        });
        await sendEmail({ to: rows[0].email, subject, html, text });
      } catch (err) {
        require('../../config/logger').error('[forgotPassword] falha ao enviar email', { error: err.message });
      }
    });
  }
  return success(res, null, 'Se o e-mail estiver cadastrado, você receberá as instruções.');
}

async function resetPassword(req, res) {
  const { token, password } = req.body;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await db.query(
    `SELECT prt.user_id FROM auth.password_reset_tokens prt WHERE prt.token_hash=$1 AND prt.used_at IS NULL AND prt.expires_at>NOW()`,
    [tokenHash]
  );
  if (!rows.length) throw new AppError('Token inválido ou expirado', 400, 'INVALID_TOKEN');
  const hash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  await db.transaction(async client => {
    await client.query(`UPDATE auth.users SET password_hash=$1 WHERE id=$2`, [hash, rows[0].user_id]);
    await client.query(`UPDATE auth.password_reset_tokens SET used_at=NOW() WHERE token_hash=$1`, [tokenHash]);
  });
  await audit.log({ action: audit.ACTIONS.PASSWORD_CHANGED, userId: rows[0].user_id });
  return success(res, null, 'Senha redefinida com sucesso');
}

module.exports = { login, loginPaciente, reactivatePaciente, loginMedico, loginRecepcao, loginTecnico,
                   loginEnfermeiro, loginAdmin,
                   refresh, logout, logoutAll, me, myPermissions, forgotPassword, resetPassword };
