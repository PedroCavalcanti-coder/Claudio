'use strict';
/**
 * Mensageria externa (#8 Nível 4) — SMS / WhatsApp / e-mail, fila (outbox).
 *
 * Provider-agnóstico: a mensagem é PERSISTIDA em ris.message_outbox e a entrega
 * é tentada por um adapter. Sem credencial de provedor (Twilio/Meta/Zenvia), a
 * mensagem fica `pending` e é apenas logada — a fatia local (geração + fila +
 * visualização + reenvio) funciona; a entrega real depende de credencial
 * externa (ver docs/pendencias.md). NÃO é dependência do DATASUS.
 */
const enc    = require('./encryption');
const logger = require('../config/logger');

// Provedor configurado? (apenas presença de credencial; envio real fora do MVP).
function providerFor(channel) {
  if (channel === 'sms')      return process.env.SMS_PROVIDER || null;
  if (channel === 'whatsapp') return process.env.WHATSAPP_PROVIDER || null;
  if (channel === 'email')    return process.env.EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? 'resend' : null);
  return null;
}

// Tenta entregar. Sem provedor → pending (logado). Com provedor → aqui entraria
// a chamada real ao SDK; mantido como ponto de extensão único.
async function tryDeliver({ channel }) {   // `to`/`body` serão usados pelo SDK do provedor (ponto de extensão)
  const provider = providerFor(channel);
  if (!provider) {
    logger.warn('Mensagem enfileirada sem provedor configurado', { channel });
    return { status: 'pending', provider: null, error: 'Provedor não configurado' };
  }
  try {
    // PONTO DE EXTENSÃO: integrar SDK do provedor (Twilio/Meta/Zenvia/Resend).
    // Sem implementação real aqui — evita falso "enviado".
    logger.info('Entrega de mensagem delegada ao provedor (stub)', { channel, provider });
    return { status: 'pending', provider, error: 'Entrega não implementada (stub de provedor)' };
  } catch (err) {
    return { status: 'failed', provider, error: String(err.message || err).slice(0, 290) };
  }
}

/**
 * Enfileira uma mensagem (e tenta entregar best-effort). `executor` = db ou um
 * client de transação (ambos expõem .query). Nunca lança — falha de mensageria
 * não pode derrubar o fluxo de negócio.
 */
async function enqueue(executor, { channel, to, body, template = null, refType = null, refId = null, unitId = null, userId = null }) {
  try {
    const toClean = String(to || '').trim();
    const delivery = await tryDeliver({ channel, to: toClean, body });
    const { rows } = await executor.query(
      `INSERT INTO ris.message_outbox
         (channel, to_enc, to_hash, body, template, ref_type, ref_id,
          status, provider, error, attempts, health_unit_id, created_by, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, status`,
      [
        channel,
        toClean ? enc.encrypt(toClean) : null,
        toClean ? enc.searchHash(toClean) : null,
        String(body || '').slice(0, 1000),
        template, refType, refId,
        delivery.status, delivery.provider, delivery.error,
        1, unitId, userId,
        delivery.status === 'sent' ? new Date() : null,
      ]
    );
    return rows[0];
  } catch (err) {
    logger.error('Falha ao enfileirar mensagem', { channel, error: err.message });
    return null;
  }
}

function buildAppointmentConfirm({ patientName, procedure, when, unitName }) {
  const first = String(patientName || '').trim().split(/\s+/)[0] || '';
  const dt = when ? new Date(when).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  return `Ola ${first}, seu agendamento de ${procedure || 'exame/consulta'} em ${unitName || 'nossa unidade'} ` +
         `esta marcado para ${dt}. Responda CONFIRMAR ou ligue para reagendar.`;
}

module.exports = { enqueue, tryDeliver, buildAppointmentConfirm, providerFor };
