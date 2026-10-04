'use strict';
/** Política de senha e geração de senha provisória (feita no BACKEND, nunca no navegador). */
const crypto = require('crypto');

const POLICY_MESSAGE = 'Senha fraca: mínimo 8 caracteres, 1 maiúscula e 1 número';

/** 8+ caracteres, ao menos 1 maiúscula e 1 dígito. */
const isStrong = (pw) => typeof pw === 'string' && pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw);

/** Senha provisória digitável (sem símbolos ambíguos): "P" + 10 base64url + 4 dígitos. */
function generateTempPassword() {
  return 'P' + crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10) + crypto.randomInt(1000, 9999);
}

module.exports = { isStrong, generateTempPassword, POLICY_MESSAGE };
