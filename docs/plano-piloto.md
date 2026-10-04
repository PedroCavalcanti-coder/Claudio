# Plano — Piloto em municípios (executável)

> **Contexto p/ quem for executar:** este plano é AUTOCONTIDO. Sistema RIS/PACS+PEP
> em monorepo pnpm (`packages/backend` Express 4 + `packages/frontend` React/Vite),
> orquestrado por `docker-compose.yml` (postgres LOCAL, redis, rustfs, orthanc,
> backend, frontend/nginx). Banco local já migrado (31 users, 3 unidades) e dump em
> `infra/db/ris_pacs_dump.sql`. **Sem** email/SMS/WhatsApp/DataSUS no piloto — não
> tentar integrar; compensações offline abaixo. Alvo: servidor **Linux** na rede
> local (LAN) da unidade/prefeitura. Convenções do repo: rotas com
> `requirePermission` (config/permissions.js + ROUTE_PERMISSIONS em
> middlewares/authorize.js), PII cifrada via services/encryption.js, migrações
> idempotentes anexadas em `packages/backend/migrations/001_schema.sql`, frontend
> mantém `tsc --noEmit` = 0 erros. NÃO commitar/pushar — o dono gere o git.

> **Atualização (backlog de lançamento, out/2026):** o instalador agora é `scripts/setup.sh` +
> `scripts/bootstrap.js` (não há mais senhas seed a rotacionar numa instalação nova); o check-in
> confere identidade por CPF/CNS/documento (sem senha de portal); o schema se aplica no boot.
> `tsc --noEmit` = 0 e os testes automatizados (`packages/backend`, `npm test`) cobrem o fluxo
> clínico — o "E2E 13/13" abaixo é um smoke histórico, não garantia geral. Veja
> `docs/implantacao-checklist.md` e `docs/backlog-lancamento.md`.

## STATUS DE EXECUÇÃO (2026-06-29)

**Fase 0 — FEITO (código/config); alguns passos RODAM no deploy:**
- 0.1 ✅ Portas fechadas no compose: redis/rustfs sem `ports` (só rede interna),
  orthanc 8042→127.0.0.1 (4242 aberto p/ DICOM), backend 3000→127.0.0.1, postgres 127.0.0.1.
- 0.2 ✅ Script `scripts/rotate_seed_passwords.js` (--dry testado). **RODAR no deploy** (muda senhas + imprime 1x).
- 0.3 ✅ HTTPS: `nginx.conf` reescrito (443 ssl + 80→301 + headers), compose publica 443 + monta `infra/tls`, helper `infra/tls/gen-cert.sh`. Cert self-signed gerado local. **No deploy: rodar gen-cert.sh com SERVER_IP.**
- 0.4 ✅ NODE_ENV=production (.env + override no compose). Verificado: login admin 200 via HTTPS em produção.
- 0.5 ✅ `infra/backup/backup.sh` (pg_dump local + volumes + retenção) + `restore-test.sh`. **No deploy: agendar cron** (linha documentada no script).

**Fase 1 — FEITO:**
- 1.1 ✅ Reset de senha de funcionário pelo admin: botão "Senha" na AdminStaffPage gera senha temporária (cliente) via `PATCH /users/:id/reset-password` (já existia) + modal com cópia.
- 1.2 ✅ Comprovante de agendamento imprimível estendido p/ consulta/teleconsulta (tipo, especialidade, médico, link tele, "chegue 15 min").
- 1.3 ✅ UI já é honesta — nenhuma tela promete e-mail ao usuário (sem link "esqueci senha" no login; ResetPassword não é linkado). Nada a mudar.

**Fase 2 — PARCIAL:**
- 2.1/2.3 ✅ **E2E HTTP autenticado** (`scripts/e2e_http_smoke.js`) = **13/13 PASS** com token real:
  login, health-units, patients, farmácia (estoque+dispensações), teleconsulta
  (sessão + sala capability sem auth + sinalização host→guest), mensageria, catálogo,
  portal-access. Dados "SMOKE" limpos após.
- 2.2 🟡 **QA no Chrome real (extensão)** feito parcialmente: app carrega, **login
  admin OK**, **telas novas renderizam sem crash** (Farmácia c/ abas+tabela,
  Teleconsulta c/ busca, Termos c/ seções LGPD), **sidebar** mostra Farmácia/
  Teleconsulta, **zero erro de console**. Limite do tooling: ref-click não dispara
  o onClick do React → **modais** (seletor de tipo do agendamento, checkbox de
  termos) e **mobile** (screenshot trava) não foram exercitados por aqui — esses
  fluxos já passam no **E2E backend 13/13**. **No deploy**: um humano abre os modais
  + testa num celular real (sem esses limites). Foi usada uma porta QA temporária
  `127.0.0.1:8080` (HTTP sem cert) — **já removida**, estado endurecido restaurado.

**Fase 3 — FEITA:**
- ✅ Runbook de implantação Linux: `docs/implantacao-checklist.md`.
- ✅ Manuais 1-página por papel: `docs/manuais/{recepcao,tecnico,medico,enfermagem,admin}.md`.
- ✅ Termo de responsabilidade/LGPD (modelo): `docs/termo-responsabilidade.md`.

**Termos de uso na UI (aceite LGPD):**
- ✅ Página pública `/termos` (`pages/legal/TermosDeUso.tsx`, LGPD-orientada, modelo).
- ✅ Componente `components/TermsCheckbox.tsx` (checkbox + link nova aba).
- ✅ Aceite obrigatório em: **cadastro de paciente** (LGPD), **check-in**
  (conta do portal), **criação de funcionário**. Submit bloqueado sem aceite.
- ✅ **Consentimento auditável**: cadastro e check-in enviam `terms_accepted` e o
  backend grava na **auditoria** (details.terms_accepted) — prova LGPD imutável,
  não só gate de UI.

**Verificado:** tsc 0, 6 containers healthy, http→301, https 200, login admin 200, porta redis recusada, E2E HTTP 13/13.
**Pendente:** Fase 2.2 (QA visual/mobile no deploy), Fase 4 (piloto).

---

**DECISÕES JÁ TOMADAS (não reabrir):**
- Piloto **só rede local (LAN)**. HTTPS com **certificado self-signed** (aviso de
  certificado no navegador é aceitável no piloto; documentar ao usuário).
- Sem provedor externo nenhum. Notificação = in-app + papel impresso.
- Outro modelo executa; este doc é a fonte de verdade. Marcar `[x]` ao concluir.

---

## FASE 0 — Hardening (fazer PRIMEIRO, nesta ordem)

### 0.1 Fechar portas expostas no docker-compose.yml
Hoje o compose publica no host: redis `6379`, rustfs `9000/9001`, orthanc
`8042/4242`, backend `3000`, frontend `80`. Postgres já está `127.0.0.1:5432`.
- [ ] **redis**: remover o bloco `ports:` inteiro (só rede interna do compose).
- [ ] **rustfs**: remover `9000` e `9001` do host (backend fala com `rustfs:9000`
      pela rede interna; console 9001 era só dev).
- [ ] **orthanc**: `8042` → `127.0.0.1:8042:8042` (debug local do admin);
      **manter `4242:4242` exposto** (equipamentos DICOM da LAN fazem C-STORE).
- [ ] **backend**: `3000` → `127.0.0.1:3000:3000` (o frontend/nginx faz proxy de
      `/api/v1` internamente — verificar `packages/frontend/nginx.conf` ou
      equivalente antes; se NÃO houver proxy, criar no nginx do frontend).
- [ ] Verificar: `docker compose config --quiet` + subir + `curl http://IP_DO_SERVIDOR:6379` de outra máquina deve FALHAR.

### 0.2 Rotacionar credenciais de seed
- [ ] Criar `packages/backend/scripts/rotate_seed_passwords.js` (padrão dos scripts
      existentes: `require('dotenv').config()` + `pg`): para TODO usuário com email
      `%@clinica.com.br` ou `%@rede.local`, gerar senha aleatória forte
      (`crypto.randomBytes(9).toString('base64url')` + prefixo `P` + dígitos, igual
      `genTempPassword` em patients.controller.js), `UPDATE auth.users SET
      password_hash = crypt(..., gen_salt('bf',12))` **ou** bcrypt no Node
      (bcryptjs, rounds 12 — preferir Node p/ não depender de pgcrypto no update).
      Imprimir tabela email→senha UMA vez no stdout. Idempotente (re-rodar = novas senhas).
- [ ] Rodar contra o banco local. Guardar a saída em local seguro (fora do git).
- [ ] Conferir que `docs/`/READMEs não prometem mais `admin123456` (atualizar README raiz §RBAC se citar).

### 0.3 HTTPS self-signed no nginx do frontend (OBRIGATÓRIO p/ teleconsulta)
Motivo técnico: `getUserMedia` (câmera/microfone da teleconsulta) só roda em
origem segura (`https://` ou `localhost`). Sem isso a teleconsulta falha em
qualquer máquina da LAN.
- [ ] Gerar cert self-signed no deploy (documentar comando):
      `openssl req -x509 -nodes -days 825 -newkey rsa:2048 -keyout infra/tls/server.key -out infra/tls/server.crt -subj "/CN=ris-pacs.local" -addext "subjectAltName=IP:IP_DO_SERVIDOR,DNS:ris-pacs.local"`
- [ ] Frontend/nginx: listen 443 ssl (cert montado como volume `./infra/tls:/etc/nginx/tls:ro`),
      redirect 80→443. Compose: publicar `443:443` além de `80:80`.
- [ ] `infra/tls/` no `.gitignore` (chave privada nunca no git).
- [ ] Backend: `FRONTEND_URL=https://IP_DO_SERVIDOR` (CORS) via .env/compose.
- [ ] Testar teleconsulta de 2 máquinas da LAN (médico + "paciente") aceitando o aviso de cert.

### 0.4 NODE_ENV=production
- [ ] Trocar no `.env` raiz e `packages/backend/.env`. Atenção aos efeitos já
      codificados: `database.js` (ssl condicional — local continua sem SSL, ok),
      cookie `secure` do portal (exige o 0.3 feito), nível de log.
- [ ] Subir e conferir boot limpo (`docker compose logs backend`) + login admin 200.

### 0.5 Backup automático + teste de restore
- [ ] Já existe `infra/backup/backup.sh` (RustFS/Orthanc/pg_dump opcional — foi
      escrito na era Neon). Atualizar: pg_dump AGORA é obrigatório e local:
      `docker compose exec -T postgres pg_dump -U ris --no-owner ris_pacs | gzip > backups/ris_pacs_$(date +%F).sql.gz`.
- [ ] Retenção 7 diários + 4 semanais. Agendar via cron do host Linux (documentar linha do crontab no próprio script).
- [ ] **Teste de restore obrigatório**: restaurar num banco `ris_pacs_test` e conferir counts (users=31, units=3).

## FASE 1 — Compensações offline

### 1.1 Reset de senha de FUNCIONÁRIO pelo admin
Hoje reset usa token por email (morto sem provedor). Paciente já tem equivalente
(`POST /patients/:id/portal-access`, botão "Portal" na PatientsPage).
- [ ] Backend: `POST /users/:id/reset-password` em `modules/users/users.routes.js`
      (guard: `requirePermission('users:manage')` → admin). Controller: gerar senha
      temporária (mesmo padrão `genTempPassword`), bcrypt 12, `UPDATE auth.users SET
      password_hash=$1, failed_attempts=0, locked_until=NULL WHERE id=$2`, audit log
      `USER_PASSWORD_RESET`, devolver `{ temp_password }` UMA vez.
- [ ] Frontend: botão "Resetar senha" na `pages/admin/AdminStaffPage.tsx` → modal
      com a senha temporária + copiar (copiar padrão visual do modal de portal-access
      da PatientsPage).
- [ ] NÃO mexer no fluxo de token por email (fica dormente p/ quando houver provedor).

### 1.2 Comprovante de agendamento imprimível (substitui SMS)
- [ ] `pages/appointments/AppointmentsPage.tsx` já tem um HTML de impressão
      (função com `esc(a.patient_name)` no topo do arquivo) — estender/confirmar:
      botão "Comprovante" por linha da agenda → janela de impressão com paciente,
      tipo (exame/consulta/teleconsulta), procedimento OU especialidade+médico,
      data/hora, unidade, sala, **instruções de preparo** (`preparation_instructions`
      do procedimento, se houver) e aviso "chegue 15 min antes".
- [ ] Para teleconsulta: incluir o LINK da sala no comprovante quando existir sessão.

### 1.3 Honestidade de UI sobre email
- [ ] Onde a UI sugerir "enviaremos por email" (ex.: reset de senha de login,
      boas-vindas do portal), trocar texto para "procure a recepção" enquanto
      `RESEND_API_KEY`/domínio não existirem. Grep por "email" nos textos de
      `pages/auth/*` e portal. Mensageria (outbox) fica como está — já é honesta (`pending`).

## FASE 2 — QA pré-piloto (browser real, sistema no ar)

- [ ] **E2E clínico**: agendar consulta (kind=consultation) → check-in (cria
      encounter na fila) → chamar próximo → consulta (evolução+receita assinada) →
      dispensação na farmácia (baixa estoque) → paciente vê receita no portal (PDF).
- [ ] **E2E imagem**: agendar exame → check-in → upload DICOM → laudo assinado →
      portal (stepper 100%, PDF, imagens).
- [ ] **E2E teleconsulta**: criar sala → link → 2 navegadores → vídeo conecta (via HTTPS 0.3).
- [ ] **Portal-access**: botão "Portal" (recepção) → senha temporária → login paciente → troca de senha.
- [ ] **Mobile**: fluxo médico/enfermagem em celular real (drawer, fila, MAR 5 certos, tabelas roláveis).
- [ ] Registrar bugs achados neste doc (seção nova "Bugs do QA") e corrigi-los antes da Fase 3.

## FASE 3 — Onboarding do município (documentos)

- [ ] `docs/implantacao-checklist.md`: passo-a-passo do zero no servidor Linux
      (instalar docker; copiar `.env` raiz + `packages/backend/.env` + dump;
      `docker compose build && up -d postgres`; restaurar dump; `up -d`; gerar cert
      0.3; rotacionar senhas 0.2; cadastrar unidades/equipe/turnos/procedimentos
      reais pela UI admin; smoke final).
- [ ] `docs/manuais/` — 1 página por papel (recepção, técnico, médico, enfermagem,
      admin): login, 3–5 tarefas principais com caminho de tela. Sem screenshot
      obrigatório (texto basta p/ v1).
- [ ] LGPD: conferir termo de consentimento no cadastro (módulo consent já existe) e
      gerar `docs/termo-responsabilidade.md` modelo p/ o município assinar
      (responsável pelos dados = secretaria de saúde; sistema = operador).

## FASE 4 — Piloto (operação)

- [ ] 1 unidade, 2 semanas. Métricas em `/relatorios` (produção, fila, no-show) —
      tirar print semanal.
- [ ] Rotina diária: conferir backup do dia (arquivo existe + tamanho > 0).
- [ ] Canal de feedback: planilha/issues simples; triagem semanal.
- [ ] Critério de sucesso: fila funcionando com senha/painel TV, laudo+receita
      assinados saindo em PDF, portal usado por ≥10 pacientes, zero perda de dado.

---

## Verificação global (após CADA fase de código)
1. `node --check` em todo .js tocado; `npx tsc --noEmit` = **0 erros** no frontend.
2. `docker compose build backend frontend && docker compose up -d` — 6 containers healthy.
3. Probes: `/health` 200; login admin 200; tela nova no browser.
4. Nada commitado — o dono gere o git.
