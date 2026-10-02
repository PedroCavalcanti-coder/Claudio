#!/usr/bin/env bash
# Testa o restore do último pg_dump num banco descartável (ris_pacs_test) e confere
# contagens. NÃO toca no banco de produção. Rode após o backup, periodicamente.
#   Uso: bash infra/backup/restore-test.sh
set -euo pipefail
PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"; cd "$PROJECT_DIR"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
PGPW="$(grep -E '^POSTGRES_PASSWORD=' .env | head -1 | cut -d= -f2-)"
PGUSER="$(grep -E '^POSTGRES_USER=' .env | head -1 | cut -d= -f2-)"; PGUSER="${PGUSER:-ris}"

LATEST="$(ls -t "$BACKUP_DIR"/daily/pg_*.sql.gz 2>/dev/null | head -1)"
[ -z "$LATEST" ] && { echo "Sem dump p/ testar em $BACKUP_DIR/daily"; exit 1; }
echo "Testando restore de: $LATEST"

psql() { docker compose exec -T -e PGPASSWORD="$PGPW" postgres psql -U "$PGUSER" "$@"; }
psql -d postgres -c "DROP DATABASE IF EXISTS ris_pacs_test;" -c "CREATE DATABASE ris_pacs_test;"
gunzip -c "$LATEST" | docker compose exec -T -e PGPASSWORD="$PGPW" postgres psql -U "$PGUSER" -d ris_pacs_test -q >/dev/null

USERS="$(psql -d ris_pacs_test -tA -c 'SELECT count(*) FROM auth.users')"
UNITS="$(psql -d ris_pacs_test -tA -c 'SELECT count(*) FROM ris.health_units')"
echo "Restore OK → users=$USERS units=$UNITS"
psql -d postgres -c "DROP DATABASE ris_pacs_test;" >/dev/null
echo "Banco de teste removido. Restore VÁLIDO."
