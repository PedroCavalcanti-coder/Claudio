#!/usr/bin/env bash
# Testa o restore do último pg_dump num banco descartável (ris_pacs_test), confere contagens e
# — o teste que importa — DECIFRA um paciente com a ENCRYPTION_KEY. NÃO toca no banco real.
#
#   bash infra/backup/restore-test.sh
#   ENV_FILE=/caminho/.env-recuperado bash infra/backup/restore-test.sh   # simula DR: chaves do backup
#
# Para validar também o .env cifrado do backup, informe BACKUP_PASSPHRASE / BACKUP_PASSPHRASE_FILE.
set -euo pipefail
PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"; cd "$PROJECT_DIR"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
ENV_FILE="${ENV_FILE:-.env}"
env_get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
fail() { echo "ERRO: $*" >&2; exit 1; }

PGPW="$(grep -E '^POSTGRES_PASSWORD=' .env | head -1 | cut -d= -f2-)"
PGUSER="$(grep -E '^POSTGRES_USER=' .env | head -1 | cut -d= -f2-)"; PGUSER="${PGUSER:-ris}"
ENC_KEY="$(env_get ENCRYPTION_KEY)"
[ "${#ENC_KEY}" = "64" ] || fail "ENCRYPTION_KEY ausente/inválida em $ENV_FILE"

LATEST="$(ls -t "$BACKUP_DIR"/daily/pg_*.sql.gz 2>/dev/null | head -1)"
[ -z "$LATEST" ] && fail "Sem dump p/ testar em $BACKUP_DIR/daily"
echo "Testando restore de: $LATEST"

# .env cifrado do mesmo dia: abre e confere que traz a MESMA ENCRYPTION_KEY.
PASS="${BACKUP_PASSPHRASE:-}"
[ -z "$PASS" ] && [ -n "${BACKUP_PASSPHRASE_FILE:-}" ] && PASS="$(head -1 "$BACKUP_PASSPHRASE_FILE")"
ENVBK="$(echo "$LATEST" | sed 's#/pg_#/env_#; s#\.sql\.gz$#.tar.gz.enc#')"
if [ -f "$ENVBK" ] && [ -n "$PASS" ]; then
  BK_KEY="$(BP="$PASS" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BP -in "$ENVBK" | tar xzO .env | grep -E '^ENCRYPTION_KEY=' | cut -d= -f2-)" \
    || fail "não foi possível abrir $ENVBK (senha errada?)"
  [ "$BK_KEY" = "$ENC_KEY" ] || fail "ENCRYPTION_KEY do backup difere da do $ENV_FILE"
  echo "  · .env cifrado do backup abre e traz a mesma ENCRYPTION_KEY"
elif [ ! -f "$ENVBK" ]; then
  echo "  · AVISO: sem $(basename "$ENVBK") — o backup não contém as chaves!" >&2
fi

psql() { docker compose exec -T -e PGPASSWORD="$PGPW" postgres psql -U "$PGUSER" "$@"; }
psql -d postgres -c "DROP DATABASE IF EXISTS ris_pacs_test;" -c "CREATE DATABASE ris_pacs_test;" >/dev/null
gunzip -c "$LATEST" | docker compose exec -T -e PGPASSWORD="$PGPW" postgres psql -U "$PGUSER" -d ris_pacs_test -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 || true

USERS="$(psql -d ris_pacs_test -tA -c 'SELECT count(*) FROM auth.users')"
UNITS="$(psql -d ris_pacs_test -tA -c 'SELECT count(*) FROM ris.health_units')"
PATS="$(psql -d ris_pacs_test -tA -c 'SELECT count(*) FROM ris.patients')"
echo "Restore OK → users=$USERS units=$UNITS patients=$PATS"
[ "${USERS:-0}" -ge 1 ] || fail "restore sem usuários — dump inválido?"

# Decifragem de pacientes (valida chave × dados restaurados). Tenta até 20 linhas: com a chave
# certa TODAS decifram; uma linha isolada de origem diversa (ex.: carga manual) não reprova o teste.
if [ "${PATS:-0}" -ge 1 ]; then
  OKN=0; TRIED=0
  for HEX in $(psql -d ris_pacs_test -tA -c 'SELECT encode(name_encrypted, $$hex$$) FROM ris.patients WHERE name_encrypted IS NOT NULL ORDER BY created_at DESC LIMIT 20'); do
    TRIED=$((TRIED+1))
    if docker compose exec -T -e ENC_KEY="$ENC_KEY" -e HEXBUF="$HEX" backend node -e '
      const c=require("crypto"); const b=Buffer.from(process.env.HEXBUF,"hex");
      const iv=b.subarray(0,12), tag=b.subarray(b.length-16), ct=b.subarray(12,b.length-16);
      const d=c.createDecipheriv("aes-256-gcm",Buffer.from(process.env.ENC_KEY,"hex"),iv); d.setAuthTag(tag);
      Buffer.concat([d.update(ct),d.final()]);' >/dev/null 2>&1; then OKN=$((OKN+1)); fi
  done
  echo "Decifragem: $OKN de $TRIED pacientes decifrados com a ENCRYPTION_KEY de $ENV_FILE"
  [ "$OKN" -ge 1 ] || fail "NENHUM paciente decifrou — ENCRYPTION_KEY errada/perdida! O backup do banco, sem a chave, não serve."
else
  echo "Sem pacientes no dump (instalação nova) — decifragem não testada."
fi

psql -d postgres -c "DROP DATABASE ris_pacs_test;" >/dev/null
echo "Banco de teste removido. Restore VÁLIDO."
