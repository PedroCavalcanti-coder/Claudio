'use strict';
/**
 * Teleconsulta (#6 Nível 4) — sessão de vídeo WebRTC P2P.
 *
 *  · Sem provedor pago e sem socket.io: a sinalização (offer/answer/ICE) trafega
 *    por REST com polling (ehr.teleconsult_signals); a MÍDIA é P2P direta entre
 *    os navegadores (STUN público). A sala é identificada por room_token (UUID
 *    não adivinhável) — o médico (host) cria, o paciente (guest) entra pelo link.
 *  · Gestão da sessão exige teleconsult:manage (clínico). A sinalização exige só
 *    autenticação + conhecer o room_token (capability).
 */
const db    = require('../../config/database');
const { success, created } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');

async function createSession(req, res) {
  const { patient_id, encounter_id = null, appointment_id = null } = req.body;
  const { rows } = await db.query(
    `INSERT INTO ehr.teleconsultations (patient_id, encounter_id, appointment_id, host_id, status)
     VALUES ($1,$2,$3,$4,'created')
     RETURNING id, room_token, status, created_at`,
    [patient_id, encounter_id, appointment_id, req.user.sub]
  );
  return created(res, rows[0], 'Sala de teleconsulta criada');
}

async function listSessions(req, res) {
  const { rows } = await db.query(
    `SELECT t.id, t.room_token, t.status, t.started_at, t.ended_at, t.created_at,
            t.encounter_id, t.appointment_id, u.name AS host_name
       FROM ehr.teleconsultations t
       LEFT JOIN auth.users u ON u.id = t.host_id
      WHERE t.patient_id = $1
      ORDER BY t.created_at DESC`,
    [req.params.id]
  );
  return success(res, rows);
}

async function setStatus(req, res) {
  const { status } = req.body;
  const setStarted = status === 'active' ? ', started_at = COALESCE(started_at, NOW())' : '';
  const setEnded   = (status === 'ended' || status === 'cancelled') ? ', ended_at = NOW()' : '';
  const { rows } = await db.query(
    `UPDATE ehr.teleconsultations SET status = $1 ${setStarted} ${setEnded}
      WHERE id = $2 RETURNING id, status, started_at, ended_at`,
    [status, req.params.id]
  );
  if (!rows.length) throw new NotFoundError('Teleconsulta');
  return success(res, rows[0], 'Status atualizado');
}

// ── Sala (por room_token) ─────────────────────────────────────────────────────
async function roomInfo(req, res) {
  const { rows } = await db.query(
    `SELECT t.id, t.room_token, t.status, t.started_at,
            (t.host_id IS NOT NULL) AS has_host
       FROM ehr.teleconsultations t WHERE t.room_token = $1`,
    [req.params.token]
  );
  if (!rows.length) throw new NotFoundError('Sala');
  return success(res, rows[0]);
}

// Publica um sinal (offer/answer/ICE/bye). sender = 'host' | 'guest'.
async function postSignal(req, res) {
  const { sender, kind, payload } = req.body;
  const t = await db.query(`SELECT id, status FROM ehr.teleconsultations WHERE room_token = $1`, [req.params.token]);
  if (!t.rows.length) throw new NotFoundError('Sala');
  if (t.rows[0].status === 'ended' || t.rows[0].status === 'cancelled')
    throw new AppError('Sala encerrada', 409, 'ROOM_CLOSED');
  // Primeira oferta marca a sala como ativa.
  if (kind === 'offer') {
    await db.query(`UPDATE ehr.teleconsultations SET status='active', started_at=COALESCE(started_at,NOW()) WHERE room_token=$1`, [req.params.token]);
  }
  const { rows } = await db.query(
    `INSERT INTO ehr.teleconsult_signals (room_token, sender, kind, payload)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [req.params.token, sender, kind, JSON.stringify(payload)]
  );
  return created(res, { id: rows[0].id }, 'Sinal publicado');
}

// Lê os sinais do OUTRO par desde o cursor `since` (id). role = meu papel.
async function getSignals(req, res) {
  const since = Number(req.query.since || 0);
  const role  = req.query.role === 'host' ? 'host' : 'guest';
  const { rows } = await db.query(
    `SELECT id, sender, kind, payload, created_at
       FROM ehr.teleconsult_signals
      WHERE room_token = $1 AND sender <> $2 AND id > $3
      ORDER BY id ASC LIMIT 200`,
    [req.params.token, role, since]
  );
  return success(res, rows);
}

module.exports = { createSession, listSessions, setStatus, roomInfo, postSignal, getSignals };
