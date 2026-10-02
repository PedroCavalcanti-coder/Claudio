# Backend — RIS/PACS + PEP

API REST do sistema clínico, em **Node.js 20 + Express 4 + PostgreSQL**.
Única porta de entrada para os dados: aplica autenticação, RBAC, criptografia de
PII, auditoria e orquestra PACS (Orthanc), armazenamento S3 (RustFS), farmácia,
teleconsulta, mensageria e filas (Redis/Bull).

> Visão geral do sistema no [README raiz](../../README.md).
> Frontend em [`packages/frontend`](../frontend/README.md).

---

## Índice

1. [Arquitetura interna](#1-arquitetura-interna)
2. [Bootstrap e pipeline de requisição](#2-bootstrap-e-pipeline-de-requisição)
3. [Autenticação e sessão](#3-autenticação-e-sessão)
4. [RBAC — controle de acesso](#4-rbac--controle-de-acesso)
5. [Criptografia de PII](#5-criptografia-de-pii)
6. [Módulos e rotas](#6-módulos-e-rotas)
7. [Modelo de dados (schemas)](#7-modelo-de-dados-schemas)
8. [Serviços de infraestrutura](#8-serviços-de-infraestrutura)
9. [Banco de dados: local vs. gerenciado](#9-banco-de-dados-local-vs-gerenciado)
10. [Variáveis de ambiente](#10-variáveis-de-ambiente)
11. [Scripts, migrations e QA](#11-scripts-migrations-e-qa)
12. [Decisões de projeto](#12-decisões-de-projeto)

---

## 1. Arquitetura interna

Organização por **domínio** (cada módulo = um diretório com rotas + controller):

```
src/
├── app.js                  # cria o Express, middlewares globais, monta as rotas
├── config/
│   ├── database.js         # pool PG (driver `pg`) + SSL condicional + helper transaction()
│   ├── env.js               # leitura/validação de variáveis de ambiente
│   ├── permissions.js      # catálogo RBAC granular (resource:action) + matriz papel→perms
│   ├── storage.js          # cliente S3 (RustFS) + buckets
│   └── logger.js           # winston
├── middlewares/
│   ├── authenticate.js     # verifica JWT + confirma usuário no banco
│   ├── authorize.js        # requirePermission, ROUTE_PERMISSIONS, escopo por unidade
│   ├── validate.js         # validação Zod (body/query/params) + schemas comuns
│   ├── unitVisibility.js   # filtros SQL por unidade (visibilidade multi-unidade)
│   └── errorHandler.js     # tratamento central de erros (inclui FK 23503)
├── modules/<domínio>/
│   ├── <domínio>.routes.js
│   └── <domínio>.controller.js
├── services/
│   ├── encryption.js       # AES-256-GCM (_enc) + SHA-256 (_hash)
│   ├── audit.js             # gravação em audit.logs
│   ├── email.js             # Resend/Nodemailer (opcional — sem provedor, loga e avisa)
│   ├── messaging.js         # outbox de SMS/WhatsApp (fila; sem provedor fica "pending")
│   ├── pdfRenderer.js       # HTML → PDF (puppeteer)
│   ├── mwl.service.js       # Modality Worklist (.wl) para o Orthanc
│   └── notifications.js     # notificações in-app + eventos
└── utils/
    ├── response.js          # success(), created(), paginated()
    ├── errors.js             # AppError, NotFoundError…
    ├── cns.js                # validação de dígito do Cartão SUS
    └── dicomWriter.js        # encoder DICOM Part-10 (worklist)
```

Padrão de **controller**: funções `async (req, res)` que usam `db.query`/
`db.transaction`, devolvem via helpers `success/created/paginated`, lançam
`AppError` para o `errorHandler`.

---

## 2. Bootstrap e pipeline de requisição

`app.js` aplica, na ordem: `helmet` → `cors` → `express.json` (10mb) →
`cookieParser` → `compression` → `morgan` (log) → **rate-limit** no prefixo da
API. Cada módulo é montado em `${API_PREFIX}/<recurso>` (ex.: `/api/v1/patients`).
No fim, 404 e `errorHandler`.

Pipeline típico de uma rota protegida:

```
authenticate → requirePermission('recurso:ação') → validate({body,query,params})
            → controller → response helper
                         ↘ erro → errorHandler (status + código + log)
```

A rota de **sinalização da teleconsulta** (`/teleconsult/room/:token/*`) é uma
exceção proposital: **não** exige `authenticate` — o `room_token` (UUID não
adivinhável) funciona como *capability*, permitindo que o paciente participe
da sala pelo link recebido, sem ter uma conta do sistema interno.

---

## 3. Autenticação e sessão

- **Login por papel:** `/auth/login_paciente`, `/login_medico`,
  `/login_recepcao`, `/login_tecnico`, `/login_enfermeiro`, `/login_admin`
  (+ `/login` genérico). Todos sob **rate-limit** (`authLimiter`).
- **Tokens:** access token **JWT RS256** (par de chaves) + **refresh token**
  (`auth.refresh_tokens`, hash + expiração + revogação). `/auth/refresh` rotaciona;
  `/auth/logout` e `/auth/logout-all` revogam.
- **`authenticate.js`** verifica a assinatura **e confirma que o usuário existe e
  está ativo** no banco (evita token órfão após re-seed → erro de FK).
- **`/auth/me`** e **`/auth/me/permissions`** devolvem o usuário e suas permissões
  efetivas (usado pelo frontend para montar a navegação).
- **Recuperação de senha:** `/auth/forgot-password` (envia link, requer
  provedor de e-mail) + `/auth/reset-password` (token em
  `auth.password_reset_tokens`). **No piloto sem e-mail**, o caminho
  operacional é o **admin resetar a senha do funcionário**
  (`PATCH /users/:id/reset-password`) e a **recepção liberar/resetar o acesso
  do paciente** (`POST /patients/:id/portal-access`) — ambos devolvem uma
  senha temporária uma única vez, sem depender de e-mail.
- **MFA TOTP** opcional (`speakeasy`), campos `mfa_secret`/`mfa_enabled`.
- **Portal do paciente** tem auth própria (`/patient-portal/login`,
  `requirePortalAuth`) e rate-limit dedicado.

---

## 4. RBAC — controle de acesso

Duas camadas complementares:

**a) Granular — `config/permissions.js`** (fonte de verdade do backend)
- Catálogo `PERMISSIONS` de strings `resource:action`
  (ex.: `prescription:sign`, `billing:read`, `panel:view`, `pharmacy:dispense`,
  `teleconsult:manage`, `portal:grant`).
- Matriz `ROLE_PERMISSIONS` (papel → lista de permissões). `admin: ['*']`.
- **Overrides por usuário:** `auth.users.permission_overrides`
  `{ granted:[], revoked:[] }` — concede/revoga permissões pontualmente;
  **revoke vence wildcard**.
- `userCan(user, 'resource:action')`, `listEffective(user)`.
- Guard: **`requirePermission('a','b')`** (exige todas; admin faz bypass).

**b) Navegação — `middlewares/authorize.js` `ROUTE_PERMISSIONS`**
- Mapa **recurso de tela → papéis** (ex.: `painel`, `relatorios`, `faturamento`,
  `atendimento`, `medicacao`, `ehr`, `farmacia`, `teleconsulta`, `portal_grant`).
  Usado por `getEffectivePermissions()` para montar o menu do frontend
  (`can('recurso')`).

**Escopo por unidade:** `assertUnitScope` / `requireUnitScopeParam('id')` —
não-admin só age sobre a própria `health_unit_id`. Filtros de **visibilidade**
multi-unidade em `middlewares/unitVisibility.js` (`buildUnitFilter`,
`buildUnitOrReferralFilter`).

**Break-glass:** acesso clínico de emergência (`ehr:breakglass`) é registrado
(`ehr.breakglass_grants`) e auditado.

---

## 5. Criptografia de PII

`services/encryption.js`:
- **`encrypt(texto)` → BYTEA** (AES-256-GCM) gravado em colunas `*_enc`.
- **`searchHash(texto)` → CHAR(64)** (SHA-256) gravado em `*_hash` — permite
  busca por **igualdade** (ex.: CPF) sem expor texto claro em índice.
- Helpers `encryptPatientFields` / `decryptPatientFields` para o paciente
  (nome, CPF, CNS, telefone).
- A chave vem do ambiente; **o Postgres nunca vê texto claro**. Busca por nome
  parcial casa via hash do nome completo + filtro na aplicação sobre conjunto
  reduzido.
- Mensageria (`ris.message_outbox.to_enc`) usa o mesmo mecanismo para cifrar o
  destino (telefone/e-mail) da mensagem enfileirada.

---

## 6. Módulos e rotas

Prefixo `${API_PREFIX}` (ex.: `/api/v1`). Todas exigem `authenticate` salvo as
de login/portal/sala de teleconsulta. A coluna **Perm** indica a permissão
exigida (`requirePermission`) quando aplicável.

### `auth` — `/auth`
| Método | Rota | Função |
|---|---|---|
| POST | `/login_{paciente,medico,recepcao,tecnico,enfermeiro,admin}` | Login por papel |
| POST | `/login` | Login genérico |
| POST | `/refresh` | Rotaciona access token |
| POST | `/logout`, `/logout-all` | Revoga refresh |
| GET | `/me`, `/me/permissions` | Usuário + permissões efetivas |
| POST | `/forgot-password`, `/reset-password` | Recuperação de senha (requer e-mail) |
| POST | `/reactivate_paciente` | Reativa conta do paciente |

### `health-units` — `/health-units` (perm `health_units:manage` / `unit:manage`)
GET `/` · GET `/mine` · POST `/` · PATCH `/:id` · GET `/:id/modalities` ·
GET `/:id/rooms` · GET/PUT `/:id/procedures` · GET/POST `/:id/shifts` ·
PATCH/DELETE `/:id/shifts/:shiftId` · GET `/:id/staff` ·
PUT `/:id/staff/:userId/shifts` · PATCH `/:id/assign-user`.

### `users` — `/users` (perm `users:manage`)
GET `/` · GET `/:id` · POST `/` · PATCH `/:id` · PATCH `/:id/deactivate` ·
**PATCH `/:id/reset-password`** (admin gera senha temporária — caminho sem
e-mail) · **PATCH `/:id/permissions`** (overrides granular).

### `patients` — `/patients`
GET `/` (busca, perm `patients:read`) · GET `/:id` · POST `/` (`patients:create`
— agora aceita `terms_accepted`, registrado na auditoria) ·
PATCH `/:id` (`patients:update`) · DELETE `/:id` + POST `/:id/reactivate` ·
DELETE `/:id/permanent` (`patients:delete`) · GET `/:id/history` ·
GET `/:id/lgpd-export` + GET `/:id/access-log` (`patients:export`) ·
POST `/:id/merge` (`patients:merge`) ·
**POST `/:id/portal-access`** (perm `portal:grant` — libera ou reseta o
acesso ao portal de QUALQUER paciente, com senha temporária de uso único;
desacopla a conta do check-in de exame de imagem).

### `appointments` — `/appointments`
GET `/` (`appointments:read`, LEFT JOIN em procedimento — inclui consultas
sem exame) · GET `/worklist` (`worklist:read`) · GET `/:id` ·
POST `/` (`appointments:create` — **`appointment_kind`**: `imaging` exige
procedimento e valida disponibilidade; `consultation`/`teleconsultation`
exigem médico, com **auto-seleção** de plantonista) ·
POST `/walk-in` (`appointments:walkin`) · PATCH `/:id` (`appointments:update`) ·
**PATCH `/:id/checkin`** (`appointments:checkin` — valida CPF + conta do
portal + `terms_accepted`; em tipo clínico, **abre `ehr.encounters`** e
coloca na fila médica; em imagem, envia à worklist do Orthanc) ·
PATCH `/:id/cancel` (`appointments:cancel`) · GET `/:id/status` (público autenticado).

### `availability` — `/availability` (READ/WRITE = `availability:read`/`:manage`)
GET `/slots` · GET/POST `/rules` · PATCH/DELETE `/rules/:id` ·
GET/POST `/holidays` · DELETE `/holidays/:id`.

### `procedures` — `/procedures` (perm `procedures:manage`)
GET `/` · POST `/` · PATCH `/:id` · DELETE `/:id`.

### `studies` — `/studies` (perm `studies:*`)
GET `/` · GET `/pending` · GET `/:id` · GET `/:id/priors` · GET `/:id/series` ·
GET `/:id/instances/:instanceId/stream` · GET `/dicom/:studyUID/instances` ·
POST `/upload` + **`/upload/init` · `/upload/:uploadId/chunk` ·
`/upload/:uploadId/finalize` · DELETE `/upload/:uploadId`** (multi-chunk) ·
GET `/dicom/replication-status` · POST `/dicom/replicate-pending` ·
PATCH `/:id/upload-complete` · POST `/:id/secondary-capture`.

### `dicom` — `/dicom`
POST `/webhook/orthanc` (ingestão) · POST `/upload` + `/upload/:patientId` ·
GET `/wado/studies/:studyUID/series/:seriesUID/instances[/:instanceUID]` (WADO) ·
GET `/studies/:studyUID/series` · GET `/worklist` · GET `/orthanc/status`.

### `reports` — `/reports` (laudo radiológico)
GET `/cid10` (busca CID — perm `reports:read`) · GET `/` · GET `/by-study/:studyId` ·
GET `/:id` · POST `/` (`reports:create`) · PATCH `/:id` (`reports:update`) ·
POST `/:id/sign` (`reports:sign`) · POST `/:id/render-pdf` (`reports:render`) ·
POST `/:id/amend` (`reports:amend`) · DELETE `/:id` (`reports:cancel`) ·
GET `/templates` · GET `/auto-texts` · GET `/:id/pdf` · GET `/:id/download` ·
GET `/:id/summary`.

### `radiologist` — `/radiologist`
GET `/worklist` · PATCH `/worklist/:id/claim` · GET `/notifications`.

### `second-opinion` — `/second-opinion` (perm `second_opinion:manage`)
POST `/` · GET `/` · GET `/:id` · POST `/:id/review` · PATCH `/:id/recall` ·
PATCH `/:id/resolve`.

### `exam-notes` — montado na raiz (perm `exam_notes:manage`)
GET/POST/PATCH/DELETE de notas de exame.

### `referrals` — `/referrals` (perm `referrals:create`)
GET `/` · POST `/` · PATCH `/:id/decide` · PATCH `/:id/cancel` ·
**PATCH `/:id/counter-reference`** (contrarreferência).

### `ehr` — `/ehr` (PEP — núcleo clínico)
**Encontros:** POST/GET `/encounters` · GET/PATCH `/encounters/:id` ·
POST `/encounters/:id/close` · POST `/encounters/:id/notes` ·
POST `/encounters/:id/vitals` · GET `/encounters/:id/fhir` (Bundle FHIR RAC).
**Evolução SOAP:** PATCH `/clinical-notes/:id` · POST `/clinical-notes/:id/sign` ·
POST `/clinical-notes/:id/amend` · GET `/clinical-notes/:id/versions` (imutável).
**Problemas (CID):** GET `/patients/:id/problems` · POST `/problems` · PATCH `/problems/:id`.
**Vitais/Timeline/Break-glass:** GET `/patients/:id/vitals` · `/timeline` ·
POST `/patients/:id/breakglass`.
**F2/F3:** allergies, medications, history, attachments, prescriptions
(+ **POST `/drug-check`** = alergia por princípio ativo + interação ao vivo),
certificates, immunizations.
**Enfermagem:** nursing-assessments (Morse/Braden), **nursing-evolutions (SAE)**.
**SADT:** GET `/patients/:id/service-requests` · POST `/service-requests` ·
PATCH `/service-requests/:id/status`.
**Farmacovigilância:** GET `/patients/:id/adverse-events` · POST `/adverse-events`.
**Fluxo de atendimento:** POST `/episodes` (inicia + ficha diária) ·
POST `/encounters/:id/triage` · POST `/encounters/:id/advance` · GET `/queue` ·
**POST `/queue/call-next`** · **GET `/panel`** (TV) · GET `/medication-queue` ·
PATCH `/prescription-items/:id/schedule` (aprazamento) · GET `/medication-schedule` ·
POST `/medication-administrations` (MAR + "5 certos") ·
GET `/patients/:id/medication-administrations`.

### `pharmacy` — `/pharmacy` (perm `pharmacy:read`/`:stock`/`:dispense`)
**Estoque:** GET `/stock` (por unidade, busca, filtro "só baixo") ·
POST `/stock` (entrada — upsert por unidade+medicamento+lote) ·
POST `/stock/:id/movement` (saída/ajuste manual) ·
GET `/stock/:id/movements` (ledger).
**Dispensação:** GET `/patients/:id/dispensations` ·
**POST `/dispensations`** — consome a prescrição assinada e **baixa o estoque
em transação** (`FOR UPDATE`, saldo nunca fica negativo).

### `teleconsult` — `/teleconsult`
**Sessão (autenticado, perm `teleconsult:manage`):** POST `/sessions` (cria a
sala) · GET `/patients/:id/sessions` · PATCH `/sessions/:id/status`.
**Sala (SEM autenticação — capability pelo `room_token`):**
GET `/room/:token` · POST `/room/:token/signal` (offer/answer/ice/bye) ·
GET `/room/:token/signal` (polling, filtra pelo papel `host`/`guest`).

### `messaging` — `/messaging` (perm `messaging:read`/`:send`)
GET `/outbox` (fila de SMS/WhatsApp/e-mail, filtrável por status/canal) ·
POST `/outbox/:id/retry` · POST `/send` (envio manual). Sem provedor
configurado, a mensagem fica `pending` — nunca finge que foi entregue.

### `catalog` — `/catalog` (perm `catalog:read`)
GET `/cid10` · GET `/medications` (busca offline para autocompletar).

### `analytics` — `/analytics` (perm `analytics:read`)
GET `/production` · GET `/no-show` · GET `/queue` (relatórios operacionais).

### `billing` — `/billing` (perm `billing:read`)
GET `/production` · GET `/production/export` (CSV BPA-C — produção SUS).

### `consent` — `/consent`
GET `/active` · GET `/patient/:patientId/status` · POST `/sign` ·
GET/POST `/` + POST `/:id/revoke` (perm `consent:manage`).

### `notifications` — `/notifications`
GET `/` · PATCH `/:id/read` · PATCH `/read-all` ·
GET `/sla/overdue` (perm `notifications:sla`).

### `audit` — `/audit` (perm `audit:read`)
GET `/` (busca filtrada) · GET `/actions`.

### `portal` — `/portal` (acesso por token, público)
GET `/reports/:token` · `/reports/:token/pdf` · `/reports/:token/images`.

### `patient-portal` — `/patient-portal` (auth própria do paciente)
POST `/register` · `/login` · `/logout` · `/change-password` ·
GET `/exams` · `/exams/:studyId` · `/exams/:studyId/pdf` · `/exams/:studyId/status` ·
`/exams/:studyId/instances` · `/exams/:studyId/instances/:instanceId/stream` ·
GET `/clinical-summary` · **GET `/appointments`** (todos os tipos, próximos e
passados, com link da teleconsulta quando houver) · **GET `/prescriptions`**
+ **`/prescriptions/:id/pdf`** · **GET `/certificates`** + **`/certificates/:id/pdf`** ·
**GET `/teleconsult`** (sessão ativa, para o banner "Entrar na sala").

---

## 7. Modelo de dados (schemas)

Cinco namespaces no PostgreSQL. Tabelas principais:

**`auth`** — `users` (papel, CRM, `health_unit_id`, `permission_overrides`,
MFA, PII de login), `refresh_tokens`, `password_reset_tokens`.

**`ris`** — `patients` (PII cifrada + `registration_status`),
`appointments` (status, **`appointment_kind`** `imaging`|`consultation`|
`teleconsultation`, **`specialty`**, **`reason`**, **`encounter_id`** — liga o
agendamento ao atendimento clínico —, `assigned_doctor_id`, `health_unit_id`;
CHECK garante que `imaging` sempre tem `procedure_id`),
`procedures` (tuss_code, modalidade), `unit_procedures` (janela por procedimento),
`health_units` (CNES), `modalities`, `rooms`, `external_physicians`,
`availability_rules` + `holidays`, `shifts` + `user_shifts`,
`referrals` (+ contrarreferência), `reports` + `report_versions` +
`report_templates` + `auto_texts`, `cid`, `medications_catalog`,
`drug_interactions`, `consent_terms` + `patient_consents`,
`notifications` + `patient_notifications`, `patient_portal_accounts`,
`second_opinions` + `second_opinion_reviewers`, `sla_configs`,
`appointment_reminders`, `exam_notes`, **`pharmacy_stock`** (unidade ×
medicamento × lote, quantidade, mínimo, validade), **`pharmacy_movements`**
(ledger in/out/adjust), **`message_outbox`** (canal, destino cifrado, corpo,
status, tentativas).

**`pacs`** — `studies` (UIDs, `performing_physician`, `exam_quality`,
`number_of_*`, replicação), `series`, `instances`, `annotations`.

**`ehr`** — `encounters` (flow_stage, `manchester_level`, `ticket_number`/
`ticket_date`, `assigned_doctor_id`, `called_at`/`room_label`),
`clinical_notes` + `clinical_note_versions` (SOAP cifrado, imutável),
`vitals`, `problems`, `allergies`, `medications`, `history`, `attachments`,
`prescriptions` (+ `control_number`/`control_year`) + `prescription_items`
(+ `administer_at_unit`, `scheduled_times`), `certificates`, `immunizations`,
`nursing_assessments`, `nursing_evolutions` (SAE),
`service_requests` + `service_request_items` (SADT),
`adverse_events` (farmacovigilância),
`medication_administrations` (MAR + `refusal_reason` + `patient_verified`),
`breakglass_grants`, `daily_ticket_counters`, `controlled_rx_counters`,
**`dispensations`** + **`dispensation_items`** (dispensação ligada à
prescrição, com baixa de estoque), **`teleconsultations`** (`room_token`,
status, `host_id`, `encounter_id`, `appointment_id`) + **`teleconsult_signals`**
(offer/answer/ice/bye, cursor por `id` para o polling).

**`audit`** — `logs` (ação, usuário, recurso, `details` — agora inclui
`terms_accepted` nos eventos de cadastro/check-in —, IP).

> Schema completo e comentado: `migrations/001_schema.sql`. As seções
> **§16.x** a **§20** ao final concentram os patches mais recentes: fluxo de
> atendimento/fila (§16), farmácia/mensageria/teleconsulta (§17–19) e
> agendamento clínico com `appointment_kind` (§20).

---

## 8. Serviços de infraestrutura

- **PACS (Orthanc):** ingestão via webhook (`/dicom/webhook/orthanc`), WADO para
  servir instâncias, **MWL** (`mwl.service.js` gera/remove `.wl` num volume
  compartilhado; `dicomWriter.js` é o encoder Part-10). Replicação das instâncias
  para o S3 na ingestão + endpoints de backfill (`replicate-pending`).
- **Armazenamento (RustFS/S3):** `config/storage.js` — buckets para DICOM e
  documentos (PDFs de laudo/receita/atestado). Upload por stream.
- **PDF:** `services/pdfRenderer.js` (puppeteer) renderiza HTML → PDF assinado.
- **E-mail:** `services/email.js` (Resend; fallback Nodemailer) — **opcional**
  no piloto; sem domínio verificado, o boot avisa e o serviço loga o erro em
  vez de falhar silenciosamente. Compensação operacional: reset de senha pelo
  admin e comprovante impresso (ver §3 e README raiz).
- **Mensageria:** `services/messaging.js` — outbox de SMS/WhatsApp
  (`ris.message_outbox`); sem `SMS_PROVIDER`/`WHATSAPP_PROVIDER` configurado,
  a mensagem fica `pending` e é visível na tela **Mensageria**, nunca finge
  ter sido entregue.
- **Filas (Redis/Bull):** tarefas assíncronas + SLA + notificações.
- **Auditoria:** `services/audit.js` grava em `audit.logs`.

---

## 9. Banco de dados: local vs. gerenciado

O backend usa o driver **`pg`** padrão (TCP), não o `@neondatabase/serverless`
(que fala WebSocket e só funciona com o Neon). Isso permite dois modos:

- **Local (padrão do piloto):** container `postgres:16-alpine` no próprio
  `docker-compose.yml`, porta só em `127.0.0.1`, autenticação `scram-sha-256`,
  senha forte via `.env` (`POSTGRES_PASSWORD`). Não depende de internet.
- **Gerenciado (Neon/RDS/etc.):** basta apontar `DATABASE_URL` para o host
  externo — `config/database.js` detecta `neon.tech`/`rds.amazonaws.com`/
  `sslmode=require` na string de conexão e liga o SSL automaticamente
  (`{ rejectUnauthorized: false }`); sem esses indícios, roda sem SSL (padrão
  do Postgres local).

**Migração de dados existentes (Neon → local):** `scripts/migrate_org_from_neon.js`
importa `auth.users` e `ris.health_units` por **chave natural** (email para
usuários; CNES → CNPJ → nome para unidades) em vez de copiar os UUIDs do Neon
— assim os registros que já referenciam esses IDs no banco local (modalidades,
salas, procedimentos por unidade, semeados por `002_seed.sql`) continuam
válidos. É idempotente (roda de novo sem duplicar) e verifica ao final que não
sobrou nenhuma FK `health_unit_id` órfã antes de commitar.

---

## 10. Variáveis de ambiente

Principais (`config/env.js`), em `packages/backend/.env`:

| Variável | Função |
|---|---|
| `DATABASE_URL` | PostgreSQL — local (`postgresql://ris:senha@postgres:5432/ris_pacs`) ou gerenciado |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Credenciais do Postgres local (usadas pelo container e para montar a `DATABASE_URL`) |
| `DB_SSL` | Força SSL mesmo sem o host bater com os padrões conhecidos |
| `API_PREFIX` | Prefixo da API (ex.: `/api/v1`) |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | Par RS256 |
| `ENCRYPTION_KEY` | Chave AES-256-GCM da PII |
| `REDIS_URL` | Redis (filas/rate-limit) |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | RustFS |
| `ORTHANC_URL` / credenciais | Servidor PACS |
| `MWL_DIR` | Diretório das worklists `.wl` |
| `EMAIL_FROM` / `RESEND_API_KEY` | E-mail (opcional; requer domínio verificado) |
| `SMS_PROVIDER` / `WHATSAPP_PROVIDER` | Provedor de mensageria (opcional — sem eles, fila fica `pending`) |
| `BCRYPT_ROUNDS` | Custo do bcrypt |
| `NODE_ENV` | `production` no piloto (ativa cookie `secure`, reduz verbosidade de log) |

---

## 11. Scripts, migrations e QA

- **Schema:** `migrations/001_schema.sql` (idempotente, §1 a §20). **Seed:**
  `002_seed.sql` (unidades + funcionários por tipo).
- **`scripts/seed_catalog.js`** — popula CID-10, catálogo de medicamentos e
  interações (curado, idempotente; a carga oficial ANVISA/DATASUS é passo à parte).
- **`scripts/migrate_org_from_neon.js`** — importa usuários/unidades de um
  Neon existente por chave natural (ver §9).
- **`scripts/rotate_seed_passwords.js`** — troca as senhas das contas de
  demonstração (`%@clinica.com.br`, `%@rede.local`) por senhas fortes geradas
  na hora; imprime a tabela email→senha **uma única vez** (aceita `--dry` para
  simular sem gravar).
- **`scripts/e2e_http_smoke.js`** — fumaça HTTP **autenticada** (login real +
  token) contra o backend no ar: exercita farmácia (estoque + dispensação),
  teleconsulta (sessão + sala por capability + sinalização host↔guest),
  mensageria, catálogo e liberação de acesso ao portal — além dos smokes
  transacionais de schema.
- **Smokes transacionais** (`scripts/smoke_*.js`, `migrate_*.js`) — verificação
  com `BEGIN`/`ROLLBACK` das queries novas contra o schema real, sem persistir
  dados de teste.
- `package.json`: `start` (node), `dev` (nodemon), `test` (jest).

Verificação rápida sem subir o servidor: `node --check src/<arquivo>.js`.

---

## 12. Decisões de projeto

- **Organização por domínio** (rotas + controller por módulo) — fácil localizar
  e isolar regras de negócio.
- **`authenticate` confirma o usuário no banco** — depois de re-seed, um token
  válido mas órfão causaria violação de FK em qualquer escrita; a checagem força
  novo login (`SESSION_INVALID`).
- **`errorHandler` loga FK 23503** com tabela/constraint/detalhe — antes a falha
  "Referência inválida" era invisível.
- **Guard de FK antes de INSERT** (`fkExists`) no upload de estudo — anula
  referências obsoletas (equipamento/sala/unidade/técnico) em vez de quebrar.
- **UIDs sintéticos** no upload — permite reutilizar o mesmo DICOM para pacientes
  diferentes (necessário em produção de tese) sem violar a unicidade DICOM.
- **Contadores atômicos via UPSERT** (`daily_ticket_counters`,
  `controlled_rx_counters`) — sequência por unidade/dia ou unidade/ano sem corrida.
- **`FOR UPDATE SKIP LOCKED`** no *chamar próximo*; **`FOR UPDATE`** simples na
  baixa de estoque da farmácia — concorrência segura sem deadlock previsível.
- **Documentos assinados** = hash SHA-256 + JWT RS256 + PDF; notas clínicas
  **imutáveis** com versão/adendo rastreável.
- **Vocabulário controlado na aplicação** (motivos de recusa, severidade,
  escalas) em vez de novos `ENUM` no PG — evita `ALTER TYPE` fora de transação.
- **Catálogos e interações locais** — autocompletar/alerta sem API externa.
- **Postgres local por padrão** — o piloto não pode depender de internet; o
  driver `pg` (em vez do serverless da Neon) deixa a troca para um gerenciado
  transparente, bastando mudar a `DATABASE_URL`.
- **Teleconsulta sem servidor de mídia** — sinalização por REST/polling em vez
  de socket.io; mais simples de operar num piloto pequeno e sem custo de
  infraestrutura de vídeo. A sala usa *capability* (o token da URL) em vez de
  uma segunda conta de usuário para o paciente.
- **Consentimento como dado auditável, não só UI** — o aceite dos Termos vem
  no `body` da requisição (`terms_accepted`) e é persistido em `audit.logs`,
  para servir de prova em caso de disputa, e não apenas travar o botão de
  enviar no formulário.
