# Sistema de E-mails Transacionais — Especificação Técnica

**Versão:** 1.0
**Status:** Proposta — aguardando aprovação para implementação
**Stack:** Resend SaaS (HTTPS) · Bull Queue (Redis) · PostgreSQL · `services/email.js` (já existe)

---

## 1. Visão geral

### 1.1 Princípios

| # | Princípio | Por quê |
|---|---|---|
| 1 | **Envio fora do request HTTP** | Falha de email não pode quebrar fluxo clínico. Toda emissão entra em fila Bull com retry. |
| 2 | **Idempotência por evento** | Mesmo evento disparado N vezes (race condition, reentrada) gera 1 email. Garantido por chave única `(type, resource_type, resource_id)` em `ris.notifications`. |
| 3 | **Audit-first** | Cada email registra em `audit.logs` antes do envio. Auditoria LGPD/CFM exige rastro mesmo se o provedor falhar. |
| 4 | **Opt-out respeitado** | `auth.users.email_opt_out` (a criar) ou flag em `ris.patient_portal_accounts.email_opt_out`. Marketing **nunca**, transacional **sim** mas anotado. |
| 5 | **Conteúdo sem PII além do mínimo** | Nome do paciente OK, CPF/RG nunca. Detalhes clínicos sensíveis só com link autenticado pro portal. |
| 6 | **Template-driven, não string-concatenation** | Cada tipo de email = 1 template HTML + 1 schema de variáveis. Falha de variável = erro de build, não runtime. |

### 1.2 Quem recebe o quê

| # | Evento | Destinatário primário | Por quê |
|---|---|---|---|
| 1 | Cadastro de paciente | **Paciente** | Boas-vindas, instruções de acesso ao portal |
| 2 | Criação de agendamento | **Paciente** | Confirmação + preparo + .ics |
| 3 | Check-in | **Paciente** | Confirmação de presença + tempo estimado |
| 4 | Exame disponível | **Médico solicitante** *(não paciente)* | Médico precisa do alerta pra revisar. Paciente vê pelo portal. |
| 5 | Laudo postado | **Paciente** + **médico solicitante** *(em CC ou email separado)* | Paciente acessa o laudo. Médico solicitante recebe pra dar continuidade clínica. |

> ⚠️ **Atenção ao item 4**: o pedido original menciona "ao paciente" pra todos os eventos. Mas "exame disponibilizado para o médico" semanticamente é **para o médico solicitante** — não paciente. Se você quiser que o paciente também receba ("seu exame foi processado"), vira evento separado: `study.processed`.

---

## 2. Anatomia técnica

```
┌─────────────────┐     publica      ┌─────────────────┐     consome     ┌─────────────────┐
│  Controller     │ ───────────────> │  Bull Queue     │ ───────────────>│  Worker email   │
│  (ação do user) │   addJob()       │  (Redis)        │   processJob()  │  (services/...) │
└─────────────────┘                  └─────────────────┘                 └─────────────────┘
                                                                                  │
                                                                       chama      ▼
                                                          ┌──────────────────────────────┐
                                                          │  resend.emails.send()        │
                                                          │  → HTTPS api.resend.com      │
                                                          └──────────────────────────────┘
                                                                                  │
                                                                        sucesso/erro │
                                                                                  ▼
                                                          ┌──────────────────────────────┐
                                                          │  ris.notifications UPDATE    │
                                                          │  status=sent|failed, sent_at │
                                                          │  + audit.logs                │
                                                          └──────────────────────────────┘
```

### 2.1 Componentes a criar

| Caminho | Responsabilidade |
|---|---|
| `packages/backend/src/services/email.js` ✅ *já existe* | Wrapper Resend |
| `packages/backend/src/services/notifications.js` 🆕 | API de alto nível: `notify(eventType, data)` → enfileira |
| `packages/backend/src/queues/emailQueue.js` 🆕 | Bull queue + processador |
| `packages/backend/src/templates/email/*.html` 🆕 | Templates por tipo |
| `packages/backend/src/templates/email/render.js` 🆕 | Mustache-like rendering com escape HTML |
| `packages/backend/src/modules/notifications/notifications.controller.js` *(amplia o existente)* | Endpoint admin pra reenviar / listar status |

### 2.2 API interna proposta

```js
// services/notifications.js
notify('patient.created',         { patientId })
notify('appointment.created',     { appointmentId })
notify('appointment.checked_in',  { appointmentId })
notify('study.images_ready',      { studyId })
notify('report.signed',           { reportId })
```

Internamente:
1. **Carrega dados** (paciente, appointment, etc) com PII descriptografado
2. **Verifica idempotência**: já existe `notifications` com `(type, resource_id, channel='email', status IN ('pending','sent'))`? Se sim, no-op
3. **Cria registro** em `ris.notifications` com `status='pending'`
4. **Enfileira** job no Bull com `notification.id` como payload
5. **Worker** consome, renderiza template, chama `sendEmail()`, atualiza status

---

## 3. Schema de dados

### 3.1 Tabela canônica — `ris.notifications` *(já existe, suficiente)*

```sql
ris.notifications (
  id                UUID PK,
  user_id           UUID,                          -- destinatário se for staff
  portal_account_id UUID,                          -- destinatário se for paciente com portal
  type              VARCHAR(50) NOT NULL,          -- ex.: 'patient.created'
  title             VARCHAR(200) NOT NULL,
  body              TEXT NOT NULL,                 -- conteúdo plain pra fallback in-app
  resource_type     VARCHAR(50),                   -- 'patient' | 'appointment' | 'study' | 'report'
  resource_id       UUID,
  channel           ris.notification_channel NOT NULL,  -- 'email'
  status            ris.notification_status  NOT NULL,  -- 'pending'|'sent'|'failed'|'read'
  sent_at           TIMESTAMPTZ,
  read_at           TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL
)
```

### 3.2 Mudanças propostas na migration

```sql
-- 1) Índice único pra idempotência (apenas pra emails ainda não enviados ou enviados com sucesso)
CREATE UNIQUE INDEX idx_notifications_unique_active
  ON ris.notifications (type, resource_type, resource_id, channel)
  WHERE status IN ('pending', 'sent');

-- 2) Coluna pra destinatário paciente sem portal_account
ALTER TABLE ris.notifications
  ADD COLUMN IF NOT EXISTS recipient_email_encrypted BYTEA,
  ADD COLUMN IF NOT EXISTS retry_count SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(100);  -- ID retornado pelo Resend

-- 3) Opt-out
ALTER TABLE ris.patient_portal_accounts
  ADD COLUMN IF NOT EXISTS email_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS email_opt_out BOOLEAN NOT NULL DEFAULT FALSE;
```

---

## 4. Eventos — especificação por tipo

### Evento 1: `patient.created`

| Campo | Valor |
|---|---|
| **Disparado por** | `POST /api/v1/patients` → `patients.controller.js#create`, ao final da transação |
| **Destinatário** | Paciente — `email_encrypted` decifrado |
| **Pré-condição** | `email_encrypted IS NOT NULL` AND `email_opt_out = FALSE` (no portal_account se existir) |
| **Assunto** | `Bem-vindo(a) à {clinic_name}` |
| **Variáveis necessárias** | `patient.name`, `patient.medical_record_number`, `clinic.name`, `portal.login_url`, `portal.cpf_hint` |
| **CTAs** | "Acessar portal do paciente" (se portal foi criado) |
| **Anexos** | Nenhum |
| **Idempotência** | `type='patient.created'`, `resource_id=patient.id`. Reemissão só por endpoint admin manual. |
| **SLA** | Best effort. Falha não bloqueia cadastro. |
| **Retry** | 3 tentativas, backoff exponencial (1min, 5min, 30min) |

### Evento 2: `appointment.created`

| Campo | Valor |
|---|---|
| **Disparado por** | `POST /api/v1/appointments` → `appointments.controller.js#create`, ao final da transação |
| **Destinatário** | Paciente |
| **Pré-condição** | Mesmas anteriores |
| **Assunto** | `Confirmação de {procedure_name} — {scheduled_date}` |
| **Variáveis** | `patient.name`, `appointment.scheduled_at` (com timezone), `procedure.name`, `procedure.preparation_notes` (jejum etc), `clinic.address`, `appointment.checkin_qr_url` (opcional) |
| **CTAs** | "Adicionar ao calendário" (anexo `.ics`), "Ver no portal" |
| **Anexos** | `appointment.ics` — vCalendar gerado on-the-fly |
| **Idempotência** | `type='appointment.created'`, `resource_id=appointment.id` |
| **Reenvio** | Quando `appointment` é reagendado: novo evento `appointment.rescheduled` (fora do escopo desta fase) |

### Evento 3: `appointment.checked_in`

| Campo | Valor |
|---|---|
| **Disparado por** | `PATCH /api/v1/appointments/:id/checkin` → após `status='checked_in'` ser persistido |
| **Destinatário** | Paciente |
| **Pré-condição** | Email presente, opt-out OFF. Paciente acabou de fazer check-in presencial — email serve como **confirmação documental** + próximos passos. |
| **Assunto** | `Check-in confirmado — {procedure_name}` |
| **Variáveis** | `patient.name`, `procedure.name`, `appointment.checked_in_at`, `room.name`, `estimated_wait_minutes` (calculado pela fila do dia, opcional) |
| **CTAs** | "Acompanhar status em tempo real" (link pro portal com `PatientStatusPage`) |
| **Idempotência** | `type='appointment.checked_in'`, `resource_id=appointment.id` |
| **Observação** | Email parece redundante (paciente está fisicamente lá), mas:<br>(a) serve como recibo documental<br>(b) familiares recebem visibilidade<br>(c) compliance ANVISA exige notificação ao paciente em cada mudança de status do atendimento |

### Evento 4: `study.images_ready`

| Campo | Valor |
|---|---|
| **Disparado por** | `PATCH /api/v1/studies/:id/upload-complete` → após `studies.status='complete'` |
| **Destinatário** | **Médico solicitante** (`ris.external_physicians.email` via `appointment.requesting_physician_id`) |
| **Pré-condição** | `appointment.requesting_physician_id` presente AND `external_physicians.email` presente |
| **Assunto** | `Exame de {patient.name} disponível para análise — {procedure_name}` |
| **Variáveis** | `physician.name`, `patient.name`, `patient.medical_record_number`, `procedure.name`, `study.study_date`, `study.accession_number`, `viewer.link` (URL autenticada com token de single-use) |
| **CTAs** | "Abrir no visualizador" |
| **Idempotência** | `type='study.images_ready'`, `resource_id=study.id` |
| **Segurança** | Link de viewer NÃO inclui token na URL após primeiro acesso — autentica via fluxo OAuth-like de "magic link" (a especificar separadamente). |
| **Observação** | Se o radiologista interno (`requesting_user_id`) for quem pediu (médico do RIS), notificação é **in-app** (`channel='in_app'`), não email. |

### Evento 5: `report.signed`

| Campo | Valor |
|---|---|
| **Disparado por** | `POST /api/v1/reports/:id/sign` → após `reports.status='signed'` |
| **Destinatário** | **Paciente** (primário) + **médico solicitante** (secundário, email separado) |
| **Pré-condição** | Email presente, opt-out OFF |
| **Assunto paciente** | `Seu laudo de {procedure_name} está disponível` |
| **Variáveis** | `patient.name`, `procedure.name`, `report.signed_at`, `radiologist.name`, `portal.report_url` (autenticado), `portal.login_hint` (último login que ele usou, se houver) |
| **CTAs** | "Ver laudo no portal" |
| **Anexos** | **NÃO** enviar PDF do laudo por email. Razão: LGPD/CFM exigem que dado clínico sensível seja acessado em ambiente autenticado, não em mailbox de paciente que pode estar em equipamento compartilhado. |
| **Assunto médico** | `Laudo finalizado — {patient.name} — {procedure_name}` |
| **Idempotência** | `type='report.signed'` + `resource_id=report.id` para paciente; `type='report.signed.physician'` + `resource_id=report.id` para médico (mesmo recurso, tipos distintos pra rastrear separadamente) |
| **Laudo emendado** (`status='amended'`) | Disparar `type='report.amended'` para ambos. |

---

## 5. Templates HTML — estrutura padrão

```
packages/backend/src/templates/email/
├── _layout.html              ← header/footer comum + CSS inline
├── _components/
│   ├── button.html
│   ├── data-row.html
│   └── footer-legal.html
├── patient_created.html
├── appointment_created.html
├── appointment_checked_in.html
├── study_images_ready.html       ← destinatário médico
├── report_signed_patient.html
└── report_signed_physician.html
```

**Princípios dos templates**:
- HTML "email-safe" (tabelas, CSS inline, sem flexbox/grid)
- Largura máxima 600px
- Modo dark/light suportado via `@media (prefers-color-scheme: dark)`
- Fallback `<plaintext>` automático para clientes que recusam HTML
- Texto alternativo em **toda** imagem
- Sem hosting externo de imagens — tudo embutido como `data:` URI ou hospedado em domínio próprio

---

## 6. Tratamento de falhas

### 6.1 Política de retry

| Tentativa | Atraso após anterior | Marcação no DB |
|---|---|---|
| 1 (imediata) | — | `status='pending'`, `retry_count=0` |
| 2 | 1 min | `retry_count=1`, `next_retry_at` |
| 3 | 5 min | `retry_count=2` |
| 4 | 30 min | `retry_count=3` |
| **Dead letter** | — | `status='failed'`, `error_message` |

### 6.2 Tipos de erro e ação

| Erro Resend | Ação |
|---|---|
| `400 invalid_to` (email malformado) | NÃO retry. Marca `failed`. Cria alerta in-app pro admin. |
| `403 forbidden` (domínio não verificado) | NÃO retry. Marca `failed`. Alerta crítico. |
| `429 rate_limited` | Retry com backoff aumentado |
| `5xx`, timeout, ECONNRESET | Retry padrão |

### 6.3 Dead letter queue

Falhas terminais vão pra `ris.notifications` com `status='failed'`. Endpoint admin `GET /api/v1/admin/notifications/failed` lista. Reenvio manual via `POST /api/v1/admin/notifications/:id/resend`.

---

## 7. LGPD / Compliance

| Item | Tratamento |
|---|---|
| **Consentimento** | Implícito por contrato de atendimento (transacional, não marketing). Documentado no termo de uso. |
| **Opt-out** | Flag `email_opt_out` por paciente. Link "Não receber estes emails" no footer aciona endpoint `POST /api/v1/portal/preferences/opt-out-email` que precisa de token de uso único (anti-CSRF). |
| **Retenção** | `ris.notifications` retém indefinidamente como auditoria. Conteúdo (body) **não** inclui PII além de nome + número de prontuário. |
| **PII no email** | Nome OK, número de prontuário OK. CPF, telefone, endereço NUNCA. Resultados clínicos NUNCA — só link autenticado. |
| **Direito ao apagamento** | Quando paciente é inativado em cascata (já implementado), `ris.notifications` NÃO é apagado (auditoria) — mas `body` pode ser truncado/anonimizado em job batch posterior. |
| **Logs do Resend** | Mensagem fica em logs do Resend por 30 dias. Em settings do Resend, ativar "Suppress full HTML content from logs". |

---

## 8. Observabilidade

### 8.1 Métricas (Prometheus-style)

```
email_sent_total{event_type, status="sent|failed"}
email_send_duration_seconds{event_type}
email_queue_depth
email_retry_total{event_type, attempt}
```

### 8.2 Alertas

| Condição | Severidade | Canal |
|---|---|---|
| `email_queue_depth > 100` por 5 min | warn | Slack/in-app admin |
| Taxa de falha > 5% em 1h | crit | Email para admin + Slack |
| `403 forbidden` do Resend | crit | Imediato |
| `next_retry_at` ficou > 1h no passado | warn | Sinal de worker travado |

### 8.3 Logs estruturados

Já temos `logger.info('[email]', ...)` em `services/email.js`. Padronizar campos: `event_type`, `notification_id`, `resource_type`, `resource_id`, `provider_message_id`, `duration_ms`, `attempt`.

---

## 9. Endpoints expostos

| Método | Rota | Quem usa | O que faz |
|---|---|---|---|
| `GET` | `/api/v1/notifications/me` | Usuário logado | Lista próprias notificações |
| `PATCH` | `/api/v1/notifications/:id/read` | Usuário logado | Marca `read_at` |
| `GET` | `/api/v1/admin/notifications` *(novo)* | Admin | Lista todas com filtro por status/type/data |
| `POST` | `/api/v1/admin/notifications/:id/resend` *(novo)* | Admin | Reenfileira notificação `failed` |
| `POST` | `/api/v1/portal/preferences/opt-out-email` *(novo)* | Paciente via magic link | Marca `email_opt_out=true` |

---

## 10. Checklist de implementação

```
INFRAESTRUTURA
[ ] 1. Verificar domínio no Resend (DKIM, SPF, DMARC)
[ ] 2. Configurar RESEND_API_KEY em .env
[ ] 3. EMAIL_FROM com domínio próprio verificado

SCHEMA
[ ] 4. Migration 003: índice único idempotência + colunas extras + opt-out
[ ] 5. Migration aplicada no Neon

BACKEND
[ ] 6. services/notifications.js (API notify())
[ ] 7. queues/emailQueue.js (Bull)
[ ] 8. templates/email/* (6 templates HTML + layout + render helper)
[ ] 9. Worker rodando (npm script novo: pnpm worker:email)
[ ] 10. Atualizar Dockerfile pra rodar worker em container separado OU embutido

INTEGRAÇÃO POR EVENTO
[ ] 11. patients.controller#create → notify('patient.created')
[ ] 12. appointments.controller#create → notify('appointment.created')
[ ] 13. appointments.controller#checkIn → notify('appointment.checked_in')
[ ] 14. studies.controller#uploadComplete → notify('study.images_ready')
[ ] 15. reports.controller#sign → notify('report.signed') × 2 destinatários

ADMIN
[ ] 16. Endpoint admin/notifications + tela em /settings

QUALIDADE
[ ] 17. Tests: cada notify() dispara 1 row em ris.notifications com idempotência
[ ] 18. Tests: worker processa e marca sent
[ ] 19. Tests: retry funciona em erro 5xx
[ ] 20. Logs estruturados + métricas
```

---

## 11. Pontos abertos pra decisão

1. **Worker como container separado** ou **embutido no backend**?
   - Separado é mais profissional (escala independente, deploy independente)
   - Embutido é mais simples (1 container, 1 processo `node` com `Bull` consumindo na mesma instância do API)
2. **Magic link de viewer** (Evento 4): implementar como token de uso único expirando em 24h, ou link permanente com auth via cookie?
3. **`.ics` anexo** (Evento 2): gerar inline com biblioteca leve (`ics` npm) ou usar serviço externo?
4. **Multi-idioma**: por enquanto só PT-BR ou já preparar `i18n` desde o template?
5. **Reenvio automático após falha de provedor**: depois das 4 tentativas dá `failed`. Tem que ter retentativa manual via admin, OU criar job noturno que tenta de novo após 24h?

---

**Fim da especificação.** Pronta para revisão técnica e aprovação. Após aprovação, implementação estimada em 2-3 dias de engenharia sênior (assumindo schema + Resend já configurados, que já estão).
