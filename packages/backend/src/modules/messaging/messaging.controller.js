'use strict';
/**
 * Mensageria — fila de envio externa. Recepção/admin veem a outbox,
 * reenviam e mandam mensagem manual. Entrega real depende de provedor (stub).
 */
const db        = require('../../config/database');
const enc       = require('../../services/encryption');
const messaging = require('../../services/messaging');
const { success, created } = require('../../utils/response');
const { NotFoundError } = require('../../utils/errors');

// Mascara o destino (LGPD): mostra só os últimos 4 dígitos/caracteres.
function maskTo(buf) {
  const v = buf ? enc.safeDecrypt(buf) : '';
  if (!v) return null;
  return v.length <= 4 ? v : `••••${v.slice(-4)}`;
}

function unitScope(req) {
  if (req.user.role === 'admin' || req.user.is_network_resource) return req.query.health_unit_id || null;
  return req.user.health_unit_id || null;
}

async function listOutbox(req, res) {
  const unitId = unitScope(req);
  const params = [];
  let where = 'WHERE 1=1';
  if (unitId)            { params.push(unitId); where += ` AND health_unit_id = $${params.length}`; }
  if (req.query.status)  { params.push(req.query.status); where += ` AND status = $${params.length}`; }
  if (req.query.channel) { params.push(req.query.channel); where += ` AND channel = $${params.length}`; }
  const { rows } = await db.query(
    `SELECT id, channel, to_enc, body, template, ref_type, ref_id, status,
            provider, error, attempts, created_at, sent_at
       FROM ris.message_outbox
       ${where}
      ORDER BY created_at DESC
      LIMIT 200`,
    params
  );
  return success(res, rows.map((r) => ({
    id: r.id, channel: r.channel, to: maskTo(r.to_enc), body: r.body,
    template: r.template, ref_type: r.ref_type, ref_id: r.ref_id, status: r.status,
    provider: r.provider, error: r.error, attempts: r.attempts,
    created_at: r.created_at, sent_at: r.sent_at,
  })));
}

async function retry(req, res) {
  const { rows } = await db.query(
    `SELECT id, channel, to_enc, body FROM ris.message_outbox WHERE id = $1`, [req.params.id]);
  if (!rows.length) throw new NotFoundError('Mensagem');
  const m = rows[0];
  const to = m.to_enc ? enc.safeDecrypt(m.to_enc) : '';
  const d = await messaging.tryDeliver({ channel: m.channel, to, body: m.body });
  const upd = await db.query(
    `UPDATE ris.message_outbox
        SET status = $1, provider = $2, error = $3, attempts = attempts + 1,
            sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END
      WHERE id = $4
      RETURNING id, status, attempts`,
    [d.status, d.provider, d.error, m.id]
  );
  return success(res, upd.rows[0], 'Reenvio tentado');
}

async function sendManual(req, res) {
  const { channel, to, body, template = null } = req.body;
  const row = await messaging.enqueue(db, {
    channel, to, body, template,
    unitId: req.user.health_unit_id || null, userId: req.user.sub,
  });
  return created(res, row, 'Mensagem enfileirada');
}

module.exports = { listOutbox, retry, sendManual };
