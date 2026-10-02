'use strict';
// Consulta de auditoria (somente leitura, admin/DPO) — atende LGPD Art. 37
// (registro de operações), permitindo rastrear quem acessou o quê.
const { Router } = require('express');
const { z }      = require('zod');
const db         = require('../../config/database');
const authenticate  = require('../../middlewares/authenticate');
const { requirePermission } = require('../../middlewares/authorize');
const { validate, schemas } = require('../../middlewares/validate');
const { paginated, success } = require('../../utils/response');

const router = Router();
router.use(authenticate, requirePermission('audit:read'));

const querySchema = z.object({
  page:          schemas.page,
  limit:         schemas.limit,
  action:        z.string().optional(),
  resource_type: z.string().optional(),
  resource_id:   z.string().uuid().optional(),
  user_email:    z.string().optional(),
  date_from:     z.string().optional(),
  date_to:       z.string().optional(),
});

router.get('/', validate({ query: querySchema }), async (req, res) => {
  const { page, limit, action, resource_type, resource_id, user_email, date_from, date_to } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  const conds  = [];

  if (action)        { params.push(action);                 conds.push(`action = $${params.length}`); }
  if (resource_type) { params.push(resource_type);          conds.push(`resource_type = $${params.length}`); }
  if (resource_id)   { params.push(resource_id);            conds.push(`resource_id = $${params.length}`); }
  if (user_email)    { params.push(`%${user_email}%`);      conds.push(`user_email ILIKE $${params.length}`); }
  if (date_from)     { params.push(date_from);              conds.push(`created_at >= $${params.length}`); }
  if (date_to)       { params.push(date_to);                conds.push(`created_at <= $${params.length}`); }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const [countRes, dataRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM audit.logs ${where}`, params),
    db.query(
      `SELECT id, user_id, user_email, user_role, action, resource_type, resource_id,
              ip_address, details, created_at
       FROM audit.logs ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  return paginated(res, { data: dataRes.rows, total: parseInt(countRes.rows[0].count), page, limit });
});

// Lista de ações distintas (para preencher o filtro no frontend)
router.get('/actions', async (req, res) => {
  const { rows } = await db.query(
    `SELECT DISTINCT action FROM audit.logs ORDER BY action`
  );
  return success(res, rows.map(r => r.action));
});

module.exports = router;
