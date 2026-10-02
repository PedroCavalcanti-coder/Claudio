#!/usr/bin/env bash
# ═════════════════════════════════════════════════════════════════════════════
# Backup do RIS/PACS (piloto local) — Postgres + volumes DICOM/documentos.
#
# O banco agora é LOCAL (sem PITR do Neon) → backup é responsabilidade nossa.
# Faz:
#   1. pg_dump do Postgres (gzip)          → CRÍTICO
#   2. tar do volume do Orthanc (DICOM)    → imagens
#   3. tar do volume do RustFS (S3: PDFs)  → laudos/receitas
# Retenção: 7 diários + 4 semanais (domingo).
#
# Uso:   bash infra/backup/backup.sh
# Cron (diário 02:30, no crontab do usuário do host):
#   30 2 * * *  cd /caminho/do/projeto && bash infra/backup/backup.sh >> /var/log/rispacs-backup.log 2>&1
# ═════════════════════════════════════════════════════════════════════════════
set -euo pipefail

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
DATE="$(date +%F)"          # AAAA-MM-DD
DOW="$(date +%u)"           # 1..7 (7=domingo)
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

# Senha do Postgres a partir do .env (POSTGRES_PASSWORD).
PGPW="$(grep -E '^POSTGRES_PASSWORD=' .env | head -1 | cut -d= -f2-)"
PGUSER="$(grep -E '^POSTGRES_USER=' .env | head -1 | cut -d= -f2-)"; PGUSER="${PGUSER:-ris}"
PGDB="$(grep -E '^POSTGRES_DB=' .env | head -1 | cut -d= -f2-)";   PGDB="${PGDB:-ris_pacs}"

echo "[$(date +%T)] Backup iniciado → $BACKUP_DIR/daily"

# 1. Postgres (CRÍTICO)
docker compose exec -T -e PGPASSWORD="$PGPW" postgres \
  pg_dump -U "$PGUSER" --no-owner --no-privileges "$PGDB" | gzip \
  > "$BACKUP_DIR/daily/pg_${DATE}.sql.gz"
echo "  · pg_dump ok ($(du -h "$BACKUP_DIR/daily/pg_${DATE}.sql.gz" | cut -f1))"

# 2. Volume Orthanc (DICOM)
docker run --rm -v sistema_ris_pacs_orthanc-data:/v -v "$BACKUP_DIR/daily":/b alpine \
  tar czf "/b/orthanc_${DATE}.tar.gz" -C /v . 2>/dev/null || echo "  · aviso: volume orthanc não encontrado (nome?)"

# 3. Volume RustFS (PDFs/laudos)
docker run --rm -v sistema_ris_pacs_rustfs-data:/v -v "$BACKUP_DIR/daily":/b alpine \
  tar czf "/b/rustfs_${DATE}.tar.gz" -C /v . 2>/dev/null || echo "  · aviso: volume rustfs não encontrado (nome?)"

# Cópia semanal aos domingos
if [ "$DOW" = "7" ]; then
  cp "$BACKUP_DIR/daily/pg_${DATE}.sql.gz" "$BACKUP_DIR/weekly/" 2>/dev/null || true
  echo "  · cópia semanal criada"
fi

# Retenção: diários > 7 dias, semanais > 28 dias
find "$BACKUP_DIR/daily"  -type f -mtime +7  -delete 2>/dev/null || true
find "$BACKUP_DIR/weekly" -type f -mtime +28 -delete 2>/dev/null || true

echo "[$(date +%T)] Backup concluído."
echo "backups/ está no .gitignore — nunca versionar (contém dados/hashes)."
