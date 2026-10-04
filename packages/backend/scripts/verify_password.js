// =============================================================================
// verify_password.js — Verificador de senha bcrypt
// =============================================================================
// Uso: node verify_password.js <senha> <hash>
// Ex:  node verify_password.js "admin123456" "$2a$12$MUJ6y1n7m6JXjt5cMhfWQerwHueUjfb48sy5teta7MSUvGXxxQlcS"
// =============================================================================

const bcrypt = require('bcryptjs');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Uso: node verify_password.js <senha> <hash>');
    console.error('Exemplo: node verify_password.js "admin123456" "$2a$12$...hash..."');
    process.exit(1);
  }

  const [senha, hash] = args;

  console.log('Senha fornecida:', senha);
  console.log('Hash fornecido:  ', hash);
  console.log('----------------------------------------');

  try {
    const isValid = await bcrypt.compare(senha, hash);
    
    if (isValid) {
      console.log('✅ Senha VÁLIDA — bate com o hash!');
    } else {
      console.log('❌ Senha INVÁLIDA — não corresponde ao hash.');
    }
  } catch (err) {
    console.error('Erro ao verificar a senha:', err.message);
    console.error('Certifique-se de que o hash é um bcrypt válido (60 caracteres, começando com $2a$, $2b$ ou $2y$).');
    process.exit(2);
  }
}

main();