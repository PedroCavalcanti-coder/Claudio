#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# Backup do RIS/PACS (piloto local) — banco + chaves + imagens + documentos.
#
# Gera em $BACKUP_DIR/daily (data AAAA-MM-DD):
#   pg_<data>.sql.gz         Postgres (CRÍTICO)
#   env_<data>.tar.gz.enc    .env + certificado TLS, CIFRADOS com senha do operador.
#                            Sem ENCRYPTION_KEY/KEY_ENCRYPTION_KEY o dump restaurado tem
#                            toda a PII ilegível — o backup do banco SOZINHO não basta.
#   orthanc_<data>.tar.gz    volume do Orthanc (DICOM + índice)
#   rustfs_<data>.tar.gz     volume do RustFS (PDFs de laudo/receita, anexos)
# Retenção: 7 diários + 4 semanais (domingo; a semanal copia os 4 arquivos).
#
# Qualquer falha => código de saída ≠ 0 (o cron/monitor percebe). Nada de "aviso" silencioso.
#
# Senha do .env cifrado (uma das duas; guarde-a FORA do servidor):
#   BACKUP_PASSPHRASE='…'            ou
#   BACKUP_PASSPHRASE_FILE=/root/.ris-backup-pass   (chmod 600)
#
# Uso:   bash infra/backup/backup.sh
# Cron (diário 02:30, no crontab do host):
#   30 2 * * * cd /opt/ris-pacs && BACKUP_PASSPHRASE_FILE=/root/.ris-backup-pass bash infra/backup/backup.sh >> /var/log/rispacs-backup.log 2>&1
# ═════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
DATE="$(date +%F)"          # AAAA-MM-DD
DOW="$(date +%u)"           # 1..7 (7=domingo)
PAUSE_SERVICES="${PAUSE_SERVICES:-1}"   # congela orthanc/rustfs durante o tar (índice SQLite consistente)
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

fail() { echo "[$(date +%T)] ERRO: $*" >&2; exit 1; }
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }

[ -f .env ] || fail ".env não encontrado em $PROJECT_DIR"

# Senha de cifragem do .env — obrigatória (ou ALLOW_NO_ENV_BACKUP=1 conscientemente).
PASS="${BACKUP_PASSPHRASE:-}"
if [ -z "$PASS" ] && [ -n "${BACKUP_PASSPHRASE_FILE:-}" ]; then
  [ -r "$BACKUP_PASSPHRASE_FILE" ] || fail "BACKUP_PASSPHRASE_FILE ilegível: $BACKUP_PASSPHRASE_FILE"
  PASS="$(head -1 "$BACKUP_PASSPHRASE_FILE")"
fi
if [ -z "$PASS" ] && [ "${ALLOW_NO_ENV_BACKUP:-0}" != "1" ]; then
  fail "defina BACKUP_PASSPHRASE ou BACKUP_PASSPHRASE_FILE (cifra o .env no backup). Sem as chaves do .env o banco restaurado fica ilegível."
fi

PGPW="$(env_get POSTGRES_PASSWORD)"
PGUSER="$(env_get POSTGRES_USER)"; PGUSER="${PGUSER:-ris}"
PGDB="$(env_get POSTGRES_DB)";     PGDB="${PGDB:-ris_pacs}"

# Descobre o projeto/volumes pelo próprio compose — não depende do nome da pasta.
PG_CID="$(docker compose ps -q postgres 2>/dev/null | head -1)"
[ -n "$PG_CID" ] || fail "container postgres não está rodando (docker compose ps)"
PROJECT="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$PG_CID")"
vol() { docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.volume=$1" | head -1; }
ORTHANC_VOL="$(vol orthanc-data)"; RUSTFS_VOL="$(vol rustfs-data)"
[ -n "$ORTHANC_VOL" ] || fail "volume orthanc-data não encontrado no projeto '$PROJECT'"
[ -n "$RUSTFS_VOL" ]  || fail "volume rustfs-data não encontrado no projeto '$PROJECT'"

echo "[$(date +%T)] Backup iniciado (projeto $PROJECT) → $BACKUP_DIR/daily"

# Grava em .tmp e só renomeia se o passo inteiro deu certo (nunca deixa arquivo truncado "válido").
finish() { mv -f "$1.tmp" "$1"; echo "  · $(basename "$1") ok ($(du -h "$1" | cut -f1))"; }

# 1. Postgres (CRÍTICO)
OUT="$BACKUP_DIR/daily/pg_${DATE}.sql.gz"
docker compose exec -T -e PGPASSWORD="$PGPW" postgres \
  pg_dump -U "$PGUSER" --no-owner --no-privileges "$PGDB" | gzip > "$OUT.tmp"
gzip -t "$OUT.tmp" || fail "pg_dump gerou arquivo inválido"
[ "$(gzip -dc "$OUT.tmp" | head -c 200 | wc -c)" -gt 100 ] || fail "pg_dump vazio"
finish "$OUT"

# 2. .env + certificado TLS (cifrados)
if [ -n "$PASS" ]; then
  OUT="$BACKUP_DIR/daily/env_${DATE}.tar.gz.enc"
  FILES=".env"; [ -d infra/tls ] && FILES="$FILES infra/tls"
  # shellcheck disable=SC2086
  tar czf - $FILES | BP="$PASS" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BP > "$OUT.tmp"
  finish "$OUT"
else
  echo "  · AVISO: .env NÃO incluído (ALLOW_NO_ENV_BACKUP=1). Guarde-o por outro meio!" >&2
fi

# 3+4. Volumes (Orthanc e RustFS). Pausar garante índice SQLite/objetos consistentes.
paused=""
unpause() { [ -n "$paused" ] && docker compose unpause $paused >/dev/null 2>&1 || true; }
trap unpause EXIT
if [ "$PAUSE_SERVICES" = "1" ]; then
  docker compose pause orthanc rustfs >/dev/null && paused="orthanc rustfs"
fi
tar_volume() {  # $1=volume  $2=arquivo de saída
  docker run --rm -v "$1":/v:ro -v "$BACKUP_DIR/daily":/b alpine \
    tar czf "/b/$(basename "$2").tmp" -C /v .
  finish "$2"
}
tar_volume "$ORTHANC_VOL" "$BACKUP_DIR/daily/orthanc_${DATE}.tar.gz"
tar_volume "$RUSTFS_VOL"  "$BACKUP_DIR/daily/rustfs_${DATE}.tar.gz"
unpause; paused=""

# Cópia semanal aos domingos (todos os arquivos do dia)
if [ "$DOW" = "7" ]; then
  for f in "$BACKUP_DIR"/daily/*_"${DATE}".*; do cp -f "$f" "$BACKUP_DIR/weekly/"; done
  echo "  · cópia semanal criada"
fi

# Retenção: diários > 7 dias, semanais > 28 dias
find "$BACKUP_DIR/daily"  -type f -mtime +7  -delete
find "$BACKUP_DIR/weekly" -type f -mtime +28 -delete

echo "[$(date +%T)] Backup concluído."
echo "backups/ está no .gitignore — nunca versionar (contém dados e chaves). Copie para disco/rede externa."
