#!/bin/bash
# =============================================================================
# RIS/PACS — Setup Inicial
# Gera todas as chaves e cria o .env
# =============================================================================
set -e
YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${YELLOW}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
err()  { echo -e "${RED}✗ $1${NC}"; exit 1; }

command -v node   >/dev/null || err "Node.js não encontrado"
command -v openssl>/dev/null || err "OpenSSL não encontrado"

info "Gerando chaves RSA 4096 para JWT..."
openssl genrsa -out /tmp/_jwt_priv.pem 4096 2>/dev/null
openssl rsa -in /tmp/_jwt_priv.pem -pubout -out /tmp/_jwt_pub.pem 2>/dev/null
JWT_PRIVATE=$(awk '{printf "%s\\n", $0}' /tmp/_jwt_priv.pem)
JWT_PUBLIC=$(awk '{printf "%s\\n", $0}' /tmp/_jwt_pub.pem)
rm -f /tmp/_jwt_priv.pem /tmp/_jwt_pub.pem
ok "Chaves RSA geradas"

info "Gerando chaves AES-256 (LGPD)..."
ENC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
KEK_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ok "Chaves AES geradas"

info "Gerando senhas..."
POSTGRES_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
REDIS_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
MINIO_ACCESS_KEY="rispacs"
MINIO_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(20).toString('hex'))")
ORTHANC_PASS=$(node -e "console.log(require('crypto').randomBytes(12).toString('hex'))")
WEBHOOK_SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")

cat > .env << ENVEOF
# =============================================================
# RIS/PACS — Environment (gerado em $(date '+%Y-%m-%d %H:%M'))
# NÃO commitar este arquivo no git!
# =============================================================

NODE_ENV=production
PORT=3000
API_PREFIX=/api/v1
FRONTEND_URL=https://app.SEU_DOMINIO.com

# ── Banco de Dados (NeonDB) ──────────────────────────────────
# Substitua pela URL do seu NeonDB:
DATABASE_URL=postgresql://user:pass@host.neon.tech/ris_pacs?sslmode=require
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=20
DATABASE_SSL=true

# ── Redis ────────────────────────────────────────────────────
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379

# ── JWT ──────────────────────────────────────────────────────
JWT_PRIVATE_KEY="${JWT_PRIVATE}"
JWT_PUBLIC_KEY="${JWT_PUBLIC}"
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# ── Criptografia LGPD ────────────────────────────────────────
ENCRYPTION_KEY=${ENC_KEY}
KEY_ENCRYPTION_KEY=${KEK_KEY}

# ── RustFS (MinIO-compatible) ────────────────────────────────
MINIO_ENDPOINT=rustfs
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
MINIO_BUCKET_DICOM=pacs-dicom
MINIO_BUCKET_THUMBNAILS=pacs-thumbnails
MINIO_BUCKET_REPORTS=ris-reports-pdf
MINIO_BUCKET_DOCUMENTS=ris-documents

# ── Orthanc ──────────────────────────────────────────────────
ORTHANC_URL=http://orthanc:8042
ORTHANC_USER=orthanc
ORTHANC_PASS=${ORTHANC_PASS}
ORTHANC_WEBHOOK_SECRET=${WEBHOOK_SECRET}

# ── SMTP (opcional) ──────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@SEU_DOMINIO.com
SMTP_PASS=SENHA_DE_APP_GOOGLE
SMTP_FROM="RIS/PACS <noreply@SEU_DOMINIO.com>"

# ── Misc ──────────────────────────────────────────────────────
BCRYPT_ROUNDS=12
LOG_LEVEL=info
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
ENVEOF

ok ".env criado!"

# Atualizar orthanc.json com senha gerada
if [[ -f "orthanc/orthanc.json" ]]; then
  sed -i "s/ORTHANC_PASSWORD_PLACEHOLDER/${ORTHANC_PASS}/g" orthanc/orthanc.json
  sed -i "s/WEBHOOK_SECRET_PLACEHOLDER/${WEBHOOK_SECRET}/g" orthanc/orthanc.json
  ok "orthanc.json atualizado"
fi

mkdir -p logs nginx/ssl nginx/certbot dist/ris-frontend dist/ris-viewer

echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup concluído!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "PRÓXIMOS PASSOS:"
echo "  1. Edite .env e substitua DATABASE_URL pela URL do NeonDB"
echo "  2. Substitua SEU_DOMINIO.com pelo seu domínio em nginx/nginx.conf"
echo "  3. Execute: ./scripts/deploy.sh"
echo ""
echo "CREDENCIAIS GERADAS:"
printf "  %-22s %s\n" "RustFS Access Key:" "${MINIO_ACCESS_KEY}"
printf "  %-22s %s\n" "RustFS Secret Key:" "${MINIO_SECRET_KEY}"
printf "  %-22s %s\n" "Orthanc Password:" "${ORTHANC_PASS}"
printf "  %-22s %s\n" "Redis Password:" "${REDIS_PASSWORD}"
echo ""
echo "ADMIN DO SISTEMA:"
printf "  %-22s %s\n" "Email:" "admin@clinica.com.br"
printf "  %-22s %s\n" "Senha:" "Admin@123456  ← TROCAR NO 1º LOGIN"
echo ""
