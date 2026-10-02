# Implantação — Piloto municipal (servidor Linux, rede local)

Runbook do zero num servidor Linux, LAN-only, **sem** email/SMS/DataSUS.
Marque `[x]` ao concluir. Comandos assumem repositório em `/opt/ris-pacs` (ajuste).

---

## 0. Pré-requisitos no servidor
- [ ] Linux (Ubuntu/Debian recomendado), **Docker + Docker Compose v2** instalados
      (`docker --version`, `docker compose version`).
- [ ] IP fixo na LAN (ex.: `192.168.1.50`). Anote — será o endereço de acesso.
- [ ] Portas livres no host: **80, 443** (app) e **4242** (DICOM C-STORE dos equipamentos).
- [ ] `openssl` instalado (gera o certificado).

## 1. Código + segredos (fora do git)
- [ ] Copiar o repositório para o servidor.
- [ ] Copiar os arquivos **NÃO versionados** (do ambiente atual): `.env` (raiz),
      `packages/backend/.env`, e o dump `infra/db/ris_pacs_dump.sql`.
- [ ] **Manter os mesmos** `ENCRYPTION_KEY`, `KEY_ENCRYPTION_KEY` e `JWT_*` do
      ambiente de origem — senão PII cifrada e tokens antigos quebram.
- [ ] No `.env` raiz, ajustar hosts para o IP do servidor:
      `FRONTEND_URL=https://192.168.1.50` (o compose já sobrescreve p/ o backend;
      confira que não sobrou `localhost`).

## 2. Certificado TLS (obrigatório — teleconsulta exige HTTPS)
- [ ] `SERVER_IP=192.168.1.50 sh infra/tls/gen-cert.sh`
      (gera `infra/tls/server.crt|key` com o IP no SAN).
- [ ] Conferir: `ls infra/tls/` mostra `server.crt` e `server.key`.

## 3. Banco de dados (Postgres local)
- [ ] `docker compose up -d postgres` e aguardar `healthy`
      (`docker compose ps` → ris-postgres healthy).
- [ ] Restaurar os dados:
      `PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)`
      `docker compose exec -T -e PGPASSWORD="$PW" postgres psql -U ris -d ris_pacs < infra/db/ris_pacs_dump.sql`
- [ ] Conferir: `docker compose exec -T -e PGPASSWORD="$PW" postgres psql -U ris -d ris_pacs -tAc "SELECT count(*) FROM auth.users"` → deve bater com a origem (ex.: 31).
- [ ] **Alternativa sem dump** (banco novo, precisa internet 1x p/ Neon):
      aplicar `migrations/001_schema.sql` + `002_seed.sql`, depois
      `node scripts/seed_catalog.js` e `NEON_URL=... node scripts/migrate_org_from_neon.js`.

## 4. Subir a stack
- [ ] `docker compose build backend frontend`
- [ ] `docker compose up -d`
- [ ] `docker compose ps` → **6 containers** running/healthy
      (postgres, redis, rustfs, orthanc, backend, frontend).

## 5. Segurança pós-boot
- [ ] **Rotacionar senhas de seed/demo**:
      `docker compose exec -T backend node scripts/rotate_seed_passwords.js`
      → copiar a saída (email→senha) p/ um cofre e **limpar o terminal**.
      (Ou rodar do host: `cd packages/backend && node scripts/rotate_seed_passwords.js`.)
- [ ] Conferir que as portas internas estão fechadas: de OUTRA máquina da LAN,
      `nc -vz 192.168.1.50 6379` e `...:5432` e `...:9000` devem **falhar**;
      `...:443` e `...:4242` devem **abrir**.
- [ ] `NODE_ENV=production` ativo (`docker compose exec backend printenv NODE_ENV`).

## 6. Smoke de verificação
- [ ] `curl -sk https://192.168.1.50/healthz` → `ok`.
- [ ] `curl -sk -X POST https://192.168.1.50/api/v1/auth/login_admin -H "Content-Type: application/json" -d '{"email":"admin@clinica.com.br","password":"NOVA_SENHA"}'` → 200 (usar a senha rotacionada).
- [ ] **E2E HTTP**: `docker compose exec -T backend node scripts/e2e_http_smoke.js`
      (ajustar o admin/senha no script se rotacionou) → 13/13 PASS.
- [ ] Abrir `https://192.168.1.50` no navegador de outra máquina (aceitar o aviso de
      cert self-signed) → tela de login carrega.
- [ ] **Teleconsulta**: em 2 máquinas da LAN, médico cria sala e "paciente" entra —
      câmera/mic conectam (só funciona por HTTPS; por isso o passo 2).

## 7. Backup automático
- [ ] Rodar 1x manual: `bash infra/backup/backup.sh` → confere `backups/daily/pg_*.sql.gz`.
- [ ] Testar restore: `bash infra/backup/restore-test.sh` → "Restore VÁLIDO".
- [ ] Agendar no cron do host (não do container):
      `crontab -e` → `30 2 * * * cd /opt/ris-pacs && bash infra/backup/backup.sh >> /var/log/rispacs-backup.log 2>&1`
- [ ] (Recomendado) copiar `backups/` p/ um disco/rede externa periodicamente.

## 8. Configuração operacional (pela UI, como admin)
- [ ] Login admin (senha rotacionada) → cadastrar/ajustar **unidades reais**, **equipe**
      (papel + unidade), **turnos**, **procedimentos por unidade**, **modalidades/salas**.
- [ ] Criar as contas reais de funcionário (senha inicial entregue no balcão).
- [ ] Configurar equipamentos DICOM da unidade p/ enviar C-STORE ao servidor
      (AE title do Orthanc, IP do servidor, porta **4242**).

## 9. Antes de abrir ao público interno
- [ ] Conferir termo de consentimento LGPD no cadastro de paciente (módulo consent).
- [ ] Definir responsável pelos dados (secretaria de saúde) e quem administra o sistema.
- [ ] Combinar canal de suporte/feedback e rotina de conferência do backup diário.

---

### Referência rápida de portas (host)
| Porta | Serviço | Exposição |
|---|---|---|
| 443 | Frontend HTTPS | LAN (entrada principal) |
| 80  | Frontend | LAN (só redireciona → 443) |
| 4242 | Orthanc DICOM C-STORE | LAN (equipamentos) |
| 8042 | Orthanc UI | só 127.0.0.1 (admin no servidor) |
| 3000 | Backend API | só 127.0.0.1 (nginx faz proxy) |
| 5432 | Postgres | só 127.0.0.1 |
| 6379 / 9000 / 9001 | redis / rustfs | **fechados** (rede interna do compose) |
