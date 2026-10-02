#!/bin/bash
# =============================================================================
# RIS/PACS — Script de Deploy Completo
# Executa em: servidor Linux com Docker + Node 20 instalados
# Uso: ./scripts/deploy.sh [--ssl-only] [--no-build]
# =============================================================================
set -euo pipefail

YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}▶ $1${NC}"; }
ok()      { echo -e "${GREEN}✓ $1${NC}"; }
warn()    { echo -e "${YELLOW}⚠ $1${NC}"; }
error()   { echo -e "${RED}✗ $1${NC}"; exit 1; }
section() { echo -e "\n${YELLOW}════════════════════════════════════════${NC}"; echo -e "${YELLOW}  $1${NC}"; echo -e "${YELLOW}════════════════════════════════════════${NC}"; }

BUILD=true
SSL_ONLY=false
for arg in "$@"; do
  [[ "$arg" == "--no-build"  ]] && BUILD=false
  [[ "$arg" == "--ssl-only"  ]] && SSL_ONLY=true
done

# ─── Verificar pré-requisitos ─────────────────────────────────────────────────
section "Verificando pré-requisitos"
command -v docker   >/dev/null || error "Docker não encontrado"
command -v node     >/dev/null || error "Node.js não encontrado"
command -v npm      >/dev/null || error "npm não encontrado"
[[ -f ".env" ]]     || error "Arquivo .env não encontrado — execute scripts/setup.sh primeiro"
source .env
[[ -n "${MINIO_ACCESS_KEY:-}" ]] || error "MINIO_ACCESS_KEY não definido no .env"
[[ -n "${REDIS_PASSWORD:-}"  ]] || error "REDIS_PASSWORD não definido no .env"
ok "Pré-requisitos OK"

# ─── Criar estrutura de diretórios ───────────────────────────────────────────
section "Criando diretórios"
mkdir -p nginx/ssl nginx/certbot dist/ris-frontend dist/ris-viewer logs
ok "Diretórios criados"

# ─── SSL: gerar certificado autoassinado para dev / usar Let's Encrypt em prod
section "Certificados SSL"
if [[ ! -f "nginx/ssl/fullchain.pem" ]]; then
  warn "Certificado não encontrado — gerando autoassinado para desenvolvimento"
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout nginx/ssl/privkey.pem \
    -out    nginx/ssl/fullchain.pem \
    -subj   "/C=BR/ST=SP/L=SaoPaulo/O=RIS-PACS/CN=localhost" \
    2>/dev/null
  ok "Certificado autoassinado gerado (válido 10 anos para dev)"
  echo ""
  warn "Para produção com Let's Encrypt:"
  warn "  1. Aponte os DNS: app.DOMINIO.com, api.DOMINIO.com, viewer.DOMINIO.com → IP do servidor"
  warn "  2. docker run --rm -v \$(pwd)/nginx/certbot:/var/www/certbot \\"
  warn "       -v \$(pwd)/nginx/ssl:/etc/letsencrypt certbot/certbot certonly \\"
  warn "       --webroot --webroot-path=/var/www/certbot -d app.DOMINIO.com \\"
  warn "       -d api.DOMINIO.com -d viewer.DOMINIO.com -d portal.DOMINIO.com"
  warn "  3. Copie fullchain.pem e privkey.pem para nginx/ssl/"
  echo ""
fi

[[ "$SSL_ONLY" == "true" ]] && { ok "SSL configurado — saindo"; exit 0; }

# ─── Build dos frontends ──────────────────────────────────────────────────────
if [[ "$BUILD" == "true" ]]; then
  section "Build: RIS Frontend"
  if [[ -d "../ris-frontend" ]]; then
    cd ../ris-frontend
    npm ci --prefer-offline 2>/dev/null || npm install
    npm run build
    cp -r dist/* ../ris-backend/dist/ris-frontend/
    cd ../ris-backend
    ok "RIS Frontend compilado"
  else
    warn "Diretório ../ris-frontend não encontrado — pulando"
  fi

  section "Build: DICOM Viewer"
  if [[ -d "../ris-viewer" ]]; then
    cd ../ris-viewer
    npm ci --prefer-offline 2>/dev/null || npm install
    npm run build
    cp -r dist/* ../ris-backend/dist/ris-viewer/
    cd ../ris-backend
    ok "DICOM Viewer compilado"
  else
    warn "Diretório ../ris-viewer não encontrado — pulando"
  fi
fi

# ─── Criar buckets no RustFS (se ainda não existirem) ─────────────────────────
section "Configurando RustFS"
docker compose up -d rustfs
sleep 5

# Tentar criar buckets via mc (MinIO Client)
if docker run --rm --network ris-backend_ris-internal \
    minio/mc:latest sh -c "
      mc alias set rustfs http://rustfs:9000 '${MINIO_ACCESS_KEY}' '${MINIO_SECRET_KEY}' 2>/dev/null
      mc mb --ignore-existing rustfs/pacs-dicom
      mc mb --ignore-existing rustfs/pacs-thumbnails
      mc mb --ignore-existing rustfs/ris-reports-pdf
      mc mb --ignore-existing rustfs/ris-documents
      mc mb --ignore-existing rustfs/ris-exports
      echo 'Buckets OK'
    " 2>/dev/null; then
  ok "Buckets criados no RustFS"
else
  warn "Não foi possível criar buckets automaticamente — crie manualmente no console: http://localhost:9001"
fi

# ─── Subir todos os serviços ──────────────────────────────────────────────────
section "Subindo serviços"
docker compose pull --ignore-pull-failures 2>/dev/null || true
docker compose up -d --build --remove-orphans

ok "Serviços iniciados"

# ─── Aguardar API ficar healthy ───────────────────────────────────────────────
section "Aguardando API"
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/health >/dev/null 2>&1; then
    ok "API respondendo em http://localhost:3000/health"
    break
  fi
  echo -n "."
  sleep 3
  [[ $i -eq 30 ]] && error "API não respondeu em 90s — verifique: docker compose logs api"
done

# ─── Resumo ──────────────────────────────────────────────────────────────────
section "Deploy concluído!"
echo ""
echo -e "  ${GREEN}API:${NC}            https://api.SEU_DOMINIO.com"
echo -e "  ${GREEN}RIS Frontend:${NC}   https://app.SEU_DOMINIO.com"
echo -e "  ${GREEN}DICOM Viewer:${NC}   https://viewer.SEU_DOMINIO.com"
echo -e "  ${GREEN}Portal Paciente:${NC}https://portal.SEU_DOMINIO.com"
echo -e "  ${GREEN}RustFS Console:${NC} https://storage.SEU_DOMINIO.com (interno)"
echo ""
echo -e "  ${YELLOW}Health check:${NC}   curl http://localhost:3000/health"
echo -e "  ${YELLOW}Logs API:${NC}       docker compose logs -f api"
echo -e "  ${YELLOW}Logs NGINX:${NC}     docker compose logs -f nginx"
echo ""
echo -e "  ${YELLOW}Admin padrão:${NC}   admin@clinica.com.br / Admin@123456"
echo -e "  ${RED}⚠ Troque a senha do admin no primeiro login!${NC}"
echo ""

# Status dos serviços
docker compose ps
