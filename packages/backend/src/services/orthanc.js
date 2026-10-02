'use strict';

/**
 * Cliente Orthanc — singleton compartilhado.
 * --------------------------------------------------------------------
 * Centraliza baseURL/auth/timeout para evitar divergência de configuração
 * entre os controllers que falam com o Orthanc.
 */

const axios  = require('axios');
const env    = require('../config/env');
const logger = require('../config/logger');

const orthanc = axios.create({
  baseURL:          env.ORTHANC_URL,
  auth:             { username: env.ORTHANC_USER, password: env.ORTHANC_PASS },
  timeout:          120_000,       // 2 min — suficiente para uploads/downloads grandes
  maxContentLength: Infinity,
  maxBodyLength:    Infinity,
});

// Log estruturado de falhas (útil pra investigar 502 etc.)
orthanc.interceptors.response.use(
  res => res,
  err => {
    logger.error('[orthanc] request falhou', {
      url:        err.config?.url,
      method:     err.config?.method,
      code:       err.code,
      cause:      err.cause?.message ?? err.cause?.code,
      status:     err.response?.status,
      statusText: err.response?.statusText,
      message:    err.message,
    });
    return Promise.reject(err);
  }
);

module.exports = orthanc;
