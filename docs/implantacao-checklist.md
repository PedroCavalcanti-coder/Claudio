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
- [ ] Copiar o repositório para o servidor (`git clone`).
- [ ] **Instalação nova:** `SERVER_IP=192.168.1.50 bash scripts/setup.sh` — gera o `.env`
      com TODOS os segredos aleatórios (JWT, `ENCRYPTION_KEY`, `KEY_ENCRYPTION_KEY`,
      senhas do Postgres/RustFS/Orthanc, `ORTHANC_WEBHOOK_SECRET`) e o certificado TLS (passo 2).
- [ ] **Faça backup do `.env` em cofre/disco externo.** Sem `ENCRYPTION_KEY`/`KEY_ENCRYPTION_KEY`
      os dados pessoais cifrados não são recuperáveis — nem de um backup do banco.
      (O backend recusa subir se a `ENCRYPTION_KEY` não bater com a do banco.)
- [ ] **Migração de ambiente existente:** copie o `.env` antigo (mesmas chaves!) em vez de
      rodar o `setup.sh`. Instalação antiga com volumes de outro nome de pasta? Suba com
      `COMPOSE_PROJECT_NAME=<nome antigo>` (o compose agora fixa o projeto `ris-pacs`).
- [ ] Conferir que não sobrou `localhost` em `FRONTEND_URL` (deve ser `https://<ip>`).

## 2. Certificado TLS (obrigatório — teleconsulta exige HTTPS)
- [ ] O `setup.sh` já gera. Para regerar/renovar: `SERVER_IP=192.168.1.50 sh infra/scripts/gen-cert.sh`
      (`infra/tls/server.crt|key`, com o IP no SAN). Depois `docker compose up -d frontend`.

## 3. Banco de dados (Postgres local)
- [ ] O schema é aplicado **automaticamente no boot do backend** (`AUTO_MIGRATE`, idempotente,
      com lock) — atualizar = `git pull && docker compose up -d --build`.
- [ ] `docker compose up -d postgres` e aguardar `healthy`.
- [ ] **Banco novo:** depois do passo 4, crie o administrador e carregue os catálogos:
      `docker compose exec backend node scripts/bootstrap.js --email admin@sua-prefeitura.gov.br`
      (imprime a senha **uma vez**; o sistema exige a troca no 1º acesso).
- [ ] **Restaurar um dump** (opcional): `PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)` e
      `docker compose exec -T -e PGPASSWORD="$PW" postgres psql -U ris -d ris_pacs < dump.sql`.
- [ ] Conferir contagem: `... psql -U ris -d ris_pacs -tAc "SELECT count(*) FROM auth.users"`.

## 4. Subir a stack
- [ ] `docker compose build backend frontend`
- [ ] `docker compose up -d`
- [ ] `docker compose ps` → postgres, redis, rustfs, orthanc, backend, frontend
      running/healthy (mais os jobs one-shot `volumes-init`/`rustfs-init`, que terminam sozinhos).

## 5. Segurança pós-boot
- [ ] Instalação **nova** via `bootstrap.js` não tem contas de demonstração. Só se a base veio de
      um dump antigo com contas demo: `docker compose exec -T backend node scripts/rotate_seed_passwords.js`
      → copiar a saída (email→senha) p/ um cofre e **limpar o terminal**.
- [ ] **Dono do projeto:** se o repositório já teve credenciais do Neon no histórico (ou vai
      ficar público), **troque a senha do Neon** e, se necessário, reescreva o histórico — não é
      resolvido por código. `docs/screenshot/` (local, fora do git) deve ser revisado antes de publicar.
- [ ] Conferir que as portas internas estão fechadas: de OUTRA máquina da LAN,
      `nc -vz 192.168.1.50 6379` e `...:5432` e `...:9000` devem **falhar**;
      `...:443` e `...:4242` devem **abrir**. Restrinja a **4242 no firewall do servidor aos IPs
      dos equipamentos** (C-STORE não tem autenticação) — ex.: `ufw allow from <ip-aparelho> to any port 4242`.
- [ ] `NODE_ENV=production` ativo (`docker compose exec backend printenv NODE_ENV`).

## 6. Smoke de verificação
- [ ] `curl -sk https://192.168.1.50/healthz` → `ok`.
- [ ] `curl -sk -X POST https://192.168.1.50/api/v1/auth/login_admin -H "Content-Type: application/json" -d '{"email":"<admin do bootstrap>","password":"<senha atual>"}'` → 200.
- [ ] **E2E HTTP** (opcional; precisa de dados de demonstração e das credenciais configuradas no
      script): `scripts/e2e_http_smoke.js`. Para validar o código, o fluxo clínico completo está nos
      testes automatizados (`cd packages/backend && npm test`), não em produção.
- [ ] Abrir `https://192.168.1.50` no navegador de outra máquina (aceitar o aviso de
      cert self-signed) → tela de login carrega.
- [ ] **Teleconsulta**: em 2 máquinas da LAN, médico cria sala e "paciente" entra —
      câmera/mic conectam (só funciona por HTTPS; por isso o passo 2). **Só funciona dentro da
      LAN**: paciente em casa exige servidor TURN/STUN próprio (`ICE_SERVERS` no `.env`).

## 7. Backup automático
- [ ] Defina `BACKUP_PASSPHRASE` (backup cifrado) conforme `infra/backup/backup.sh` e guarde-a com o `.env`.
- [ ] Rodar 1x manual: `bash infra/backup/backup.sh` → confere `backups/daily/`.
- [ ] Testar restore: `bash infra/backup/restore-test.sh` → "Restore VÁLIDO".
- [ ] Agendar no cron do host (não do container):
      `crontab -e` → `30 2 * * * cd /opt/ris-pacs && bash infra/backup/backup.sh >> /var/log/rispacs-backup.log 2>&1`
- [ ] (Recomendado) copiar `backups/` p/ um disco/rede externa periodicamente.

## 8. Configuração operacional (pela UI, como admin)
- [ ] Login admin (troca de senha obrigatória no 1º acesso) → siga o **checklist de configuração
      inicial** da tela inicial do admin; cadastrar/ajustar **unidades reais**, **equipe**
      (papel + unidade), **turnos**, **procedimentos por unidade**, **modalidades/salas**.
- [ ] Criar as contas reais de funcionário (o sistema gera a senha temporária — exibida uma vez;
      o funcionário troca no 1º acesso).
- [ ] Configurar equipamentos DICOM da unidade p/ enviar C-STORE ao servidor
      (AE title do Orthanc, IP do servidor, porta **4242**). Estudos sem agendamento correspondente
      caem na aba **Estudos não vinculados** (técnico/admin vinculam ou descartam).

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
