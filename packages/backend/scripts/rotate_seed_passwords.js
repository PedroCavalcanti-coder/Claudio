'use strict';
/**
 * Rotaciona as senhas dos usuários de SEED/demo (Fase 0.2 do piloto).
 * Alvo: emails `%@clinica.com.br` e `%@rede.local` (contas criadas por seed).
 * Gera senha forte por usuário, grava bcrypt (rounds do .env) e IMPRIME a tabela
 * email→senha UMA vez no stdout — copie para um cofre e apague do terminal.
 *
 * Idempotente (re-rodar gera novas senhas). NÃO toca em contas reais (outros domínios).
 * Rodar:  node scripts/rotate_seed_passwords.js
 * Dry-run: node scripts/rotate_seed_passwords.js --dry
 */
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
const DRY = process.argv.includes('--dry');

// Senha forte: maiúscula + minúsculas/dígitos base64url + dígitos. ~16 chars.
function genPassword() {
  return 'P' + crypto.randomBytes(9).toString('base64url') + crypto.randomInt(1000, 9999);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `SELECT id, email, role FROM auth.users
        WHERE email ILIKE '%@clinica.com.br' OR email ILIKE '%@rede.local'
        ORDER BY role, email`);
    if (!rows.length) { console.log('Nenhuma conta de seed encontrada (nada a rotacionar).'); return; }

    console.log(`${DRY ? '[DRY-RUN] ' : ''}Rotacionando ${rows.length} conta(s) de seed:\n`);
    console.log('EMAIL'.padEnd(48), 'PAPEL'.padEnd(14), 'NOVA SENHA');
    console.log('-'.repeat(90));
    for (const u of rows) {
      const pw = genPassword();
      if (!DRY) {
        const hash = await bcrypt.hash(pw, ROUNDS);
        await pool.query(
          `UPDATE auth.users SET password_hash=$1, failed_attempts=0, locked_until=NULL, updated_at=NOW() WHERE id=$2`,
          [hash, u.id]);
      }
      console.log(u.email.padEnd(48), (u.role || '').padEnd(14), pw);
    }
    console.log('-'.repeat(90));
    console.log(DRY ? '\n[DRY-RUN] nada foi alterado.' : '\nFeito. Guarde as senhas acima em local seguro e LIMPE o terminal.');
  } catch (e) {
    console.error('FALHA:', e.message); process.exitCode = 1;
  } finally { await pool.end(); }
})();
