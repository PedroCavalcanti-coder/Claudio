const bcrypt = require('bcryptjs');
const db = require('../../config/database');
const audit = require('../../services/audit');
const { success, created, paginated, noContent } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');
const env = require('../../config/env');

async function list(req, res) {
  const { page, limit, role, active, health_unit_id } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  const conditions = [];

  if (role !== undefined)           { params.push(role);            conditions.push(`u.role = $${params.length}`); }
  if (active !== undefined)         { params.push(active);          conditions.push(`u.is_active = $${params.length}`); }
  if (health_unit_id !== undefined) { params.push(health_unit_id);  conditions.push(`u.health_unit_id = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRes, dataRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM auth.users u ${where}`, params),
    db.query(
      `SELECT u.id, u.name, u.email, u.role, u.crm, u.crm_uf, u.specialty,
              u.is_active, u.last_login_at, u.created_at,
              u.health_unit_id, hu.name AS health_unit_name,
              u.is_network_resource, u.shared_specialties, u.extra_roles,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'id', s.id, 'name', s.name,
                         'start_time', s.start_time, 'end_time', s.end_time)
                         ORDER BY s.start_time)
                  FROM ris.user_shifts us
                  JOIN ris.shifts s ON s.id = us.shift_id
                 WHERE us.user_id = u.id
              ), '[]') AS shifts
       FROM auth.users u
       LEFT JOIN ris.health_units hu ON hu.id = u.health_unit_id
       ${where}
       ORDER BY u.name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  return paginated(res, { data: dataRes.rows, total: parseInt(countRes.rows[0].count), page, limit });
}

async function getById(req, res) {
  const { rows } = await db.query(
    `SELECT id, name, email, role, crm, crm_uf, specialty, is_active,
            mfa_enabled, last_login_at, last_login_ip, created_at, updated_at
     FROM auth.users WHERE id = $1`,
    [req.params.id]
  );
  if (!rows.length) throw new NotFoundError('Usuário');
  return success(res, rows[0]);
}

async function create(req, res) {
  const body = req.body;

  // Verificar e-mail único
  const { rows: existing } = await db.query(
    `SELECT id FROM auth.users WHERE email = $1`, [body.email.toLowerCase()]
  );
  if (existing.length) throw new AppError('E-mail já cadastrado', 409, 'DUPLICATE_EMAIL');

  const hash = await bcrypt.hash(body.password, env.BCRYPT_ROUNDS);

  const { rows } = await db.query(
    `INSERT INTO auth.users (name, email, password_hash, role, crm, crm_uf, specialty,
                             health_unit_id, is_network_resource, shared_specialties, extra_roles)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, name, email, role, health_unit_id, is_network_resource, created_at`,
    [
      body.name, body.email.toLowerCase(), hash, body.role,
      body.crm || null, body.crm_uf || null, body.specialty || null,
      // Admin não tem unidade (acessa a rede inteira)
      body.role === 'admin' ? null : (body.health_unit_id || null),
      !!body.is_network_resource,
      body.shared_specialties || [],
      body.extra_roles || [],
    ]
  );

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.USER_CREATED,
    resourceType: 'user',
    resourceId: rows[0].id,
    details: { role: body.role },
  });

  return created(res, rows[0], 'Usuário criado com sucesso');
}

async function update(req, res) {
  const { id } = req.params;
  const body = req.body;

  if (body.email) {
    const { rows } = await db.query(
      `SELECT id FROM auth.users WHERE email = $1 AND id != $2`, [body.email.toLowerCase(), id]
    );
    if (rows.length) throw new AppError('E-mail já em uso', 409, 'DUPLICATE_EMAIL');
  }

  const { rowCount } = await db.query(
    `UPDATE auth.users
     SET name                = COALESCE($1, name),
         email               = COALESCE($2, email),
         role                = COALESCE($3, role),
         crm                 = COALESCE($4, crm),
         crm_uf              = COALESCE($5, crm_uf),
         specialty           = COALESCE($6, specialty),
         health_unit_id      = COALESCE($7, health_unit_id),
         is_network_resource = COALESCE($8, is_network_resource),
         shared_specialties  = COALESCE($9, shared_specialties),
         extra_roles         = COALESCE($10, extra_roles),
         updated_at          = NOW()
     WHERE id = $11`,
    [
      body.name, body.email?.toLowerCase(), body.role,
      body.crm, body.crm_uf, body.specialty,
      body.health_unit_id, body.is_network_resource, body.shared_specialties,
      body.extra_roles ?? null,
      id,
    ]
  );
  if (!rowCount) throw new NotFoundError('Usuário');

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.USER_UPDATED,
    resourceType: 'user',
    resourceId: id,
  });

  return success(res, { id }, 'Usuário atualizado');
}

async function deactivate(req, res) {
  const { id } = req.params;

  // Admin não pode se auto-desativar
  if (id === req.user.sub) throw new AppError('Você não pode desativar sua própria conta', 422);

  const { rowCount } = await db.query(
    `UPDATE auth.users SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND is_active = TRUE`,
    [id]
  );
  if (!rowCount) throw new NotFoundError('Usuário');

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.USER_DEACTIVATED,
    resourceType: 'user',
    resourceId: id,
  });

  return noContent(res);
}

async function resetPassword(req, res) {
  const { id } = req.params;
  const hash = await bcrypt.hash(req.body.password, env.BCRYPT_ROUNDS);
  const { rowCount } = await db.query(
    `UPDATE auth.users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [hash, id]
  );
  if (!rowCount) throw new NotFoundError('Usuário');

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.PASSWORD_CHANGED,
    resourceType: 'user',
    resourceId: id,
    details: { reset_by_admin: true },
  });

  return success(res, null, 'Senha redefinida com sucesso');
}

// RBAC granular (#31): define overrides de permissão (granted/revoked) do usuário.
// Aplica no próximo login (overrides são embutidos no JWT).
async function setPermissions(req, res) {
  const { isValidPermission } = require('../../config/permissions');
  const granted = Array.isArray(req.body.granted) ? [...new Set(req.body.granted)] : [];
  const revoked = Array.isArray(req.body.revoked) ? [...new Set(req.body.revoked)] : [];
  const invalid = [...granted, ...revoked].filter(p => !isValidPermission(p));
  if (invalid.length) throw new AppError(`Permissões inválidas: ${invalid.join(', ')}`, 422, 'INVALID_PERMISSION');

  const overrides = { granted, revoked };
  const { rows } = await db.query(
    `UPDATE auth.users SET permission_overrides = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
    [JSON.stringify(overrides), req.params.id]
  );
  if (!rows.length) throw new NotFoundError('Usuário');

  await audit.log({
    ...audit.fromRequest(req),
    action: 'USER_PERMISSIONS_UPDATED',
    resourceType: 'user',
    resourceId: req.params.id,
    details: { granted, revoked },
  });

  return success(res, { id: req.params.id, permission_overrides: overrides },
    'Permissões atualizadas (efetivas no próximo login do usuário)');
}

module.exports = { list, getById, create, update, deactivate, resetPassword, setPermissions };
