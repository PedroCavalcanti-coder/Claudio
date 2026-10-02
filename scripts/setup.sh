#!/bin/bash
# =============================================================================
# RIS/PACS — setup inicial de uma instalação NOVA (servidor Linux, LAN)
#
#   SERVER_IP=192.168.1.50 bash scripts/setup.sh [--force]
#
# Gera o `.env` da raiz a partir de `.env.example` com TODOS os segredos aleatórios:
#   · chaves JWT RS256 (PKCS#8) · ENCRYPTION_KEY / KEY_ENCRYPTION_KEY (AES-256, LGPD)
#   · senha do Postgres · credenciais do RustFS · senha do Orthanc · segredo do webhook
# e o certificado TLS (infra/scripts/gen-cert.sh). Só precisa de bash + openssl.
#
# Depois:  docker compose build && docker compose up -d
#          docker compose exec backend node scripts/bootstrap.js --email admin@sua-prefeitura.gov.br
#
# !! FAÇA BACKUP DO `.env` (cofre/disco externo): sem ENCRYPTION_KEY/KEY_ENCRYPTION_KEY os
# !! dados pessoais cifrados do banco NÃO podem ser recuperados — nem de um backup do banco.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env"
TEMPLATE=".env.example"

c_ok='\033[0;32m'; c_warn='\033[1;33m'; c_err='\033[0;31m'; c_off='\033[0m'
ok()   { echo -e "${c_ok}✓ $1${c_off}"; }
warn() { echo -e "${c_warn}⚠ $1${c_off}"; }
die()  { echo -e "${c_err}✗ $1${c_off}" >&2; exit 1; }

command -v openssl >/dev/null || die "openssl não encontrado (apt install openssl)"
[[ -f "$TEMPLATE" ]] || die "$TEMPLATE não encontrado — rode a partir do repositório"

if [[ -f "$ENV_FILE" && "${1:-}" != "--force" ]]; then
  die "$ENV_FILE já existe. Não vou sobrescrever (as chaves de criptografia não podem mudar!). Use --force só em instalação nova."
fi

SERVER_IP="${SERVER_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
[[ -n "$SERVER_IP" ]] || die "Defina SERVER_IP=<ip do servidor na LAN>"

hex()  { openssl rand -hex "$1"; }
b64u() { openssl rand -base64 "$1" | tr '+/' '-_' | tr -d '=\n'; }

# Troca (ou acrescenta) KEY=VALUE preservando o resto do arquivo. O valor vai por ENVIRON:
# `awk -v` interpretaria as barras invertidas (\n do PEM).
set_var() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    KEY="$key" VAL="$val" awk '
      !done && index($0, ENVIRON["KEY"] "=") == 1 { print ENVIRON["KEY"] "=" ENVIRON["VAL"]; done=1; next } { print }
    ' "$ENV_FILE" > "$tmp"
  else
    cp "$ENV_FILE" "$tmp"; printf '%s=%s\n' "$key" "$val" >> "$tmp"
  fi
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}

cp "$TEMPLATE" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ── JWT RS256 (PKCS#8 / SPKI) — o PEM vai numa linha com \n literais ───────────
priv="$(mktemp)"; pub="$(mktemp)"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$priv" 2>/dev/null
openssl pkey -in "$priv" -pubout -out "$pub" 2>/dev/null
oneline() { awk 'BEGIN{ORS="\\n"} {print}' "$1" | sed 's/\\n$//'; }
set_var JWT_PRIVATE_KEY "\"$(oneline "$priv")\""
set_var JWT_PUBLIC_KEY  "\"$(oneline "$pub")\""
rm -f "$priv" "$pub"
ok "Chaves JWT geradas"

set_var ENCRYPTION_KEY      "$(hex 32)"
set_var KEY_ENCRYPTION_KEY  "$(hex 32)"
ok "Chaves AES-256 geradas"

PGPASS="$(b64u 24)"
set_var POSTGRES_PASSWORD "$PGPASS"
set_var DATABASE_URL      "postgresql://ris:${PGPASS}@localhost:5432/ris_pacs?sslmode=disable"
set_var RUSTFS_ACCESS_KEY "$(hex 10)"
set_var RUSTFS_SECRET_KEY "$(b64u 24)"
set_var ORTHANC_PASS      "$(b64u 18)"
set_var ORTHANC_WEBHOOK_SECRET "$(b64u 24)"
set_var FRONTEND_URL      "https://${SERVER_IP}"
set_var NODE_ENV          "production"
ok "Senhas e segredos gerados; FRONTEND_URL=https://${SERVER_IP}"

if grep -q 'COLE_AQUI\|GERE_U' "$ENV_FILE"; then
  warn "Sobrou placeholder no $ENV_FILE:"; grep -n 'COLE_AQUI\|GERE_U' "$ENV_FILE" || true
fi

# ── Certificado TLS ────────────────────────────────────────────────────────────
SERVER_IP="$SERVER_IP" sh infra/scripts/gen-cert.sh

cat <<MSG

════════════════════════════════════════════════════════════════
 Setup concluído.
════════════════════════════════════════════════════════════════
 1. COPIE O .env PARA UM LOCAL SEGURO (cofre / disco externo). Sem as
    chaves ENCRYPTION_KEY e KEY_ENCRYPTION_KEY o banco vira ilegível.
 2. docker compose build && docker compose up -d
 3. docker compose exec backend node scripts/bootstrap.js --email admin@sua-prefeitura.gov.br
    (imprime a senha do administrador UMA vez; a troca é obrigatória no 1º acesso)
 4. Acesse https://${SERVER_IP}  (aceite o aviso do certificado auto-assinado)
MSG
