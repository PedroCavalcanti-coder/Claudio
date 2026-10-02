'use strict';

/**
 * Serviço de Email — Resend
 * --------------------------------------------------------------------
 * Wrapper fino sobre a SDK oficial @resend/node. Lazy-init: só instancia
 * o client quando RESEND_API_KEY estiver presente. Se a key não existir
 * (ex.: ambiente de teste), faz log e retorna sem enviar — não quebra.
 */

const env    = require('../config/env');
const logger = require('../config/logger');

let resend = null;

function getClient() {
  if (resend) return resend;
  if (!env.RESEND_API_KEY) return null;
  const { Resend } = require('resend');
  resend = new Resend(env.RESEND_API_KEY);
  return resend;
}

/**
 * Envia um email transacional.
 * @param {object}   params
 * @param {string}   params.to       — destinatário (string ou array)
 * @param {string}   params.subject  — assunto
 * @param {string}  [params.html]    — corpo HTML
 * @param {string}  [params.text]    — corpo texto puro (fallback)
 * @param {string}  [params.from]    — remetente (default: env.EMAIL_FROM)
 * @param {Array}   [params.attachments] — anexos Resend ({ filename, content, ... })
 * @returns {Promise<{ id?: string, skipped?: boolean }>}
 */
async function sendEmail({ to, subject, html, text, from, attachments }) {
  const client = getClient();

  if (!client) {
    logger.warn('[email] RESEND_API_KEY ausente — email não enviado', { to, subject });
    return { skipped: true };
  }

  try {
    // O SDK do Resend NÃO lança em erro de API: retorna { data, error }.
    const { data, error } = await client.emails.send({
      from:    from ?? env.EMAIL_FROM,
      to:      Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      ...(attachments && attachments.length ? { attachments } : {}),
    });

    // Como o SDK não lança em erro de API, é preciso checar `error` aqui — senão
    // uma falha (ex.: domínio não verificado) seria tratada como envio bem-sucedido.
    if (error) {
      const e = new Error(error.message || 'Falha no envio (Resend)');
      e.statusCode = typeof error.statusCode === 'number' ? error.statusCode : 502;
      e.resendError = error;
      throw e;
    }

    logger.info('[email] enviado', { to, subject, id: data?.id });
    return { id: data?.id };
  } catch (err) {
    logger.error('[email] falha ao enviar', {
      to, subject,
      message: err.message,
      code:    err.statusCode,
    });
    throw err;
  }
}

module.exports = { sendEmail };
