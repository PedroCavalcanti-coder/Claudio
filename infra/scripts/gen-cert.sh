#!/bin/sh
# =============================================================================
# RIS/PACS — certificado TLS auto-assinado (piloto LAN)
#
#   SERVER_IP=192.168.1.50 sh infra/scripts/gen-cert.sh
#   SERVER_IP=192.168.1.50 EXTRA_DNS=ris.prefeitura.local DAYS=825 sh infra/scripts/gen-cert.sh
#
# Gera infra/tls/server.key (chmod 600) e infra/tls/server.crt com o IP do servidor
# (e localhost) no SAN — sem SAN o navegador recusa mesmo depois de aceitar o aviso, e a
# teleconsulta (getUserMedia) exige contexto seguro. Para trocar o certificado depois:
# rode de novo e `docker compose up -d frontend`.
# Não sobrescreve um certificado existente sem FORCE=1.
# =============================================================================
set -eu

command -v openssl >/dev/null 2>&1 || { echo "openssl não encontrado" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT_DIR:-$ROOT/infra/tls}"
DAYS="${DAYS:-825}"

if [ -z "${SERVER_IP:-}" ]; then
  SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$SERVER_IP" ] && echo "SERVER_IP não informado — usando $SERVER_IP (detectado). Confira!" >&2
fi
[ -n "${SERVER_IP:-}" ] || { echo "Defina SERVER_IP=<ip do servidor na LAN>" >&2; exit 1; }

mkdir -p "$OUT"
if [ -f "$OUT/server.crt" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Já existe $OUT/server.crt — use FORCE=1 para substituir." >&2
  exit 0
fi

SAN="IP:${SERVER_IP},IP:127.0.0.1,DNS:localhost,DNS:ris-pacs.local"
[ -n "${EXTRA_DNS:-}" ] && SAN="$SAN,DNS:${EXTRA_DNS}"

openssl req -x509 -nodes -days "$DAYS" -newkey rsa:2048 \
  -keyout "$OUT/server.key" -out "$OUT/server.crt" \
  -subj "/C=BR/O=RIS-PACS/CN=ris-pacs.local" \
  -addext "subjectAltName=$SAN" 2>/dev/null

chmod 600 "$OUT/server.key"
chmod 644 "$OUT/server.crt"
echo "✓ Certificado gerado em $OUT (válido $DAYS dias) — SAN: $SAN"
