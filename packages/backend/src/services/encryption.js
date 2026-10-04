/**
 * Serviço de criptografia — LGPD Art. 46
 * AES-256-GCM para dados pessoais em repouso
 * SHA-256 determinístico para campos de busca
 */
const crypto = require('crypto');
const env = require('../config/env');

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 12;   // 96 bits — recomendado para GCM
const TAG_LENGTH = 16;   // 128 bits de autenticação

// Chave derivada da env — Buffer de 32 bytes
const ENCRYPTION_KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex');

/**
 * Criptografa um valor string.
 * @param {string} plaintext
 * @returns {Buffer}  IV (12B) + ciphertext + authTag (16B) concatenados
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]);
}

/**
 * Descriptografa um Buffer previamente gerado por encrypt().
 * @param {Buffer} buf
 * @returns {string}
 */
function decrypt(buf) {
  if (!buf) return null;
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const iv         = data.subarray(0, IV_LENGTH);
  const tag        = data.subarray(data.length - TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Hash SHA-256 determinístico (sem salt) para campos de busca.
 * Permite buscar por CPF ou nome sem descriptografar tudo.
 * @param {string} value
 * @returns {string} hex de 64 chars
 */
function searchHash(value) {
  if (!value) return null;
  return crypto
    .createHash('sha256')
    .update(String(value).toLowerCase().trim())
    .digest('hex');
}

/**
 * Hash SHA-256 de conteúdo para verificação de integridade (laudos).
 * @param {string} content
 * @returns {string} hex de 64 chars
 */
function integrityHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Normaliza CPF: remove pontos e traços.
 */
function normalizeCpf(cpf) {
  return cpf.replace(/[.\-]/g, '').trim();
}

/**
 * Prepara campos de paciente para inserção (criptografa + gera hashes).
 */
function encryptPatientFields(data) {
  const out = {};
  if (data.name !== undefined) {
    out.name_encrypted   = encrypt(data.name);
    out.name_search_hash = searchHash(data.name);
  }
  if (data.cpf !== undefined && data.cpf !== null && data.cpf !== '') {
    const cpfClean     = normalizeCpf(data.cpf);
    out.cpf_encrypted  = encrypt(cpfClean);
    out.cpf_hash       = searchHash(cpfClean);
  }
  if (data.cns !== undefined && data.cns !== null && data.cns !== '') {
    const cnsClean     = String(data.cns).replace(/\D/g, '').trim();
    out.cns_encrypted  = encrypt(cnsClean);
    out.cns_hash       = searchHash(cnsClean);
  }
  if (data.rg        !== undefined) out.rg_encrypted    = encrypt(data.rg);
  if (data.phone     !== undefined) out.phone_encrypted = encrypt(data.phone);
  if (data.email     !== undefined) out.email_encrypted = encrypt(data.email);
  return out;
}

/**
 * Descriptografa campos do paciente para resposta da API.
 */
const ILLEGIBLE = '[ilegível]';
let lastIllegibleLog = 0;

/**
 * Decifra para EXIBIÇÃO/listagem: um registro corrompido ou cifrado com outra chave não pode
 * derrubar a lista inteira (500). Devolve `fallback` ("[ilegível]" por padrão; use `null` para
 * e-mail/telefone, que nunca devem virar texto). Nulo → nulo. NÃO usar em documentos
 * assinados/PDF: ali a falha precisa interromper (use `decrypt`).
 */
function safeDecrypt(buf, fallback = ILLEGIBLE) {
  if (buf === null || buf === undefined) return null;
  try {
    return decrypt(buf);
  } catch (error) {
    // 1 log por minuto: uma chave errada afetaria TODAS as linhas e inundaria o disco.
    const now = Date.now();
    if (now - lastIllegibleLog > 60_000) {
      lastIllegibleLog = now;
      require('../config/logger').error('Dado cifrado ilegível (chave errada ou registro corrompido)', { error: error.message });
    }
    return fallback;
  }
}

function decryptPatientFields(row) {
  if (!row) return null;
  return {
    ...row,
    name:  safeDecrypt(row.name_encrypted),
    cpf:   row.cpf_encrypted  ? safeDecrypt(row.cpf_encrypted)  : undefined,
    cns:   row.cns_encrypted  ? safeDecrypt(row.cns_encrypted)  : undefined,
    rg:    row.rg_encrypted   ? safeDecrypt(row.rg_encrypted)   : undefined,
    phone: row.phone_encrypted ? safeDecrypt(row.phone_encrypted, null) : undefined,
    email: row.email_encrypted ? safeDecrypt(row.email_encrypted, null) : undefined,
    // Remover campos binários da resposta
    name_encrypted:   undefined,
    cpf_encrypted:    undefined,
    cns_encrypted:    undefined,
    rg_encrypted:     undefined,
    phone_encrypted:  undefined,
    email_encrypted:  undefined,
    name_search_hash: undefined,
    cpf_hash:         undefined,
    cns_hash:         undefined,
  };
}

module.exports = {
  encrypt,
  decrypt,
  safeDecrypt,
  ILLEGIBLE,
  searchHash,
  integrityHash,
  normalizeCpf,
  encryptPatientFields,
  decryptPatientFields,
};
