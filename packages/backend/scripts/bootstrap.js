'use strict';
/**
 * Bootstrap de instalação nova. Idempotente. Uso (dentro do container do backend):
 *
 *   docker compose exec backend node scripts/bootstrap.js --email admin@prefeitura.gov.br
 *
 * Opções:
 *   --email <e-mail>   e-mail do administrador (padrão admin@clinica.com.br)
 *   --name  <nome>     nome do administrador
 *   --reset-admin      gera NOVA senha para o administrador existente
 *   --no-catalog       não carrega medicamentos/CID-10/interações curados
 *   --demo             (SÓ DESENVOLVIMENTO) cria unidades/usuários de demonstração
 *
 * A senha do administrador é impressa UMA vez — anote em local seguro. O sistema exige a troca
 * no primeiro acesso.
 */
require('dotenv').config();
const { Pool } = require('pg');
const { runBootstrap } = require('./lib/bootstrap');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

(async () => {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL não definida.'); process.exit(1); }
  if (flag('--demo') && process.env.NODE_ENV === 'production') {
    console.error('--demo cria usuários com senhas conhecidas e é proibido com NODE_ENV=production.'); process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await runBootstrap(pool, {
      adminEmail: val('--email'), adminName: val('--name'),
      resetAdmin: flag('--reset-admin'), demo: flag('--demo'), catalog: !flag('--no-catalog'),
      log: (m) => console.log('▶', m),
    });
    if (r.adminCreated) {
      const line = '═'.repeat(60);
      console.log(`\n${line}\n  ADMINISTRADOR CRIADO — anote AGORA (não será exibido de novo)\n${line}`);
      console.log(`  E-mail: ${r.adminEmail}\n  Senha : ${r.adminPassword}`);
      console.log(`${line}\n  A troca da senha é obrigatória no primeiro acesso.\n`);
    }
    console.log('✓ Bootstrap concluído.');
  } catch (e) {
    console.error('FALHA no bootstrap:', e.message); process.exitCode = 1;
  } finally { await pool.end(); }
})();
