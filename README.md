# Sistema RIS/PACS + PEP

Sistema clínico integrado para redes municipais de saúde, reunindo **RIS**
(Radiology Information System — agenda e gestão de exames), **PACS** (Picture
Archiving and Communication System — armazenamento e visualização de imagens
DICOM) e **PEP** (Prontuário Eletrônico do Paciente — atendimento clínico,
prescrição, farmácia, teleconsulta, enfermagem). Monorepo com backend
Node/Express, frontend React e visualizador DICOM integrado, orquestrado por
Docker Compose.

> Projeto acadêmico/de tese, preparado para **piloto em rede local (LAN)**
> municipal: banco **PostgreSQL local** (containerizado), armazenamento S3
> (RustFS), servidor DICOM (Orthanc) e **HTTPS** de ponta a ponta. Sem
> dependência de serviços externos (e-mail, SMS, WhatsApp, DATASUS) — essas
> integrações têm a fatia local pronta e ficam como evolução futura (ver
> [`docs/pendencias.md`](docs/pendencias.md)).

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Arquitetura](#2-arquitetura)
3. [Stack tecnológica](#3-stack-tecnológica)
4. [Serviços e portas](#4-serviços-e-portas)
5. [Como executar](#5-como-executar)
6. [Estrutura do monorepo](#6-estrutura-do-monorepo)
7. [Papéis de usuário (RBAC)](#7-papéis-de-usuário-rbac)
8. [Mapa de funcionalidades](#8-mapa-de-funcionalidades)
9. [Mapa de páginas (para capturas de tela)](#9-mapa-de-páginas-para-capturas-de-tela)
10. [Modelo de dados](#10-modelo-de-dados-resumo)
11. [Segurança, LGPD e hardening](#11-segurança-lgpd-e-hardening)
12. [Piloto municipal](#12-piloto-municipal)
13. [Decisões de projeto](#13-decisões-de-projeto)
14. [Glossário](#14-glossário)

Documentação específica de cada pacote:
- **Backend:** [`packages/backend/README.md`](packages/backend/README.md)
- **Frontend:** [`packages/frontend/README.md`](packages/frontend/README.md)

Documentação de implantação e operação:
- **Plano do piloto:** [`docs/plano-piloto.md`](docs/plano-piloto.md)
- **Runbook de implantação (Linux/LAN):** [`docs/implantacao-checklist.md`](docs/implantacao-checklist.md)
- **Manuais por papel:** [`docs/manuais/`](docs/manuais/)
- **Termo de responsabilidade/LGPD (modelo):** [`docs/termo-responsabilidade.md`](docs/termo-responsabilidade.md)
- **Pendências (DATASUS, e-mail, SMS/WhatsApp):** [`docs/pendencias.md`](docs/pendencias.md)

---

## 1. Visão geral

O sistema cobre o ciclo completo de um atendimento de imagem **e** de um
atendimento clínico — incluindo consulta presencial e **teleconsulta**:

```
Paciente → Agendamento (exame) → Check-in → Exame (técnico) → Upload DICOM →
  Laudo (radiologista) → Portal do paciente (baixa laudo + imagens)

Paciente → Agendamento (consulta/teleconsulta) → Check-in → Fila médica →
  Consulta (presencial ou por vídeo) → Prescrição/receita → Farmácia
  (dispensação) → Portal do paciente (receita/atestado em PDF)

Recepção → Acolhimento/Triagem → Fila médica → Consulta (médico) →
  Prescrição → Medicação na unidade (enfermagem) → Alta
```

Um agendamento tem um **tipo** (`appointment_kind`): `imaging` (exame de
imagem — o modelo original do sistema), `consultation` (consulta presencial)
ou `teleconsultation` (consulta por vídeo). O check-in de um agendamento
clínico **abre um atendimento (encounter)** e coloca o paciente na fila
médica — a agenda (RIS) e o atendimento (PEP) ficam ligados pelo mesmo
registro, em vez de serem dois sistemas paralelos.

Quatro grandes domínios:

| Domínio | O que faz |
|---|---|
| **RIS** | Agenda (exame/consulta/teleconsulta), procedimentos por unidade, disponibilidade/horários, turnos, check-in, worklist, encaminhamento entre unidades |
| **PACS** | Upload de DICOM (multi-chunk), ingestão no Orthanc + replicação S3, visualizador OrthoVis, laudo assinado, segunda opinião |
| **PEP** | Atendimento (recepção→triagem→médico→medicação), evolução SOAP, prescrição eletrônica, alergias, medicamentos, anamnese, atestados, imunização, escalas e evolução de enfermagem, SADT, farmacovigilância, **farmácia (estoque + dispensação)**, **teleconsulta (vídeo P2P)** |
| **Portal** | O paciente acessa consultas/exames agendados, laudos e imagens, **receitas e atestados em PDF**, resumo clínico (alergias/problemas/medicamentos/vacinas) e **entra na teleconsulta** — deixou de ser só uma vitrine de exames de imagem |

Recursos transversais: RBAC granular, criptografia de PII, auditoria,
**consentimento auditável (LGPD)** no cadastro/check-in, painel de chamada
(TV), relatórios operacionais, faturamento SUS e **mensageria interna**
(fila de confirmações, pronta para plugar um provedor de SMS/WhatsApp).

---

## 2. Arquitetura

```
┌─────────────┐      HTTPS       ┌──────────────────┐
│  Frontend   │ ───────────────► │     Backend      │
│ React/Vite  │   /api/v1/*      │  Express (3000)  │
│ (nginx :443)│ ◄─────────────── │                  │
└──────┬──────┘                  └───────┬──────────┘
       │  OrthoVis / WebRTC              │
       │  (DICOM e vídeo no browser)     ├──► PostgreSQL (LOCAL) — dados + PII cifrada
       │                                 ├──► Redis — filas (Bull) + rate-limit
       │                                 ├──► RustFS (S3) — DICOM + PDFs (buckets)
       │                                 └──► Orthanc — servidor PACS (REST + C-STORE)
```

- **Frontend** é uma SPA servida por **nginx com HTTPS** (certificado
  auto-assinado no piloto LAN); fala só com o backend via REST (`/api/v1`,
  via proxy interno do nginx). HTTP redireciona para HTTPS. O visualizador
  **OrthoVis** decodifica DICOM no próprio browser; a **teleconsulta** usa
  `RTCPeerConnection` nativo do browser (sem biblioteca de terceiros) —
  HTTPS é **obrigatório** para a câmera/microfone funcionarem
  (`getUserMedia` só roda em contexto seguro).
- **Backend** é a única porta de entrada para os dados. Aplica autenticação,
  RBAC, criptografia, auditoria e orquestra PACS/armazenamento/filas/farmácia.
  Não é mais exposto diretamente à rede — só o nginx do frontend fala com ele.
- **PostgreSQL** roda **local** (container `postgres`, porta só em
  `127.0.0.1`) — guarda todos os dados estruturados; PII fica **cifrada** em
  colunas `*_enc` (BYTEA) com hash de busca em `*_hash`. O driver `pg` padrão
  é usado (não o `@neondatabase/serverless`), o que permite trocar para um
  Postgres gerenciado (Neon, RDS…) só mudando a `DATABASE_URL` — SSL liga
  automaticamente quando a URL aponta para um host desses.
- **RustFS** é um servidor compatível com S3 (buckets para DICOM e
  documentos), sem porta exposta ao host.
- **Orthanc** é o servidor DICOM (ingestão, worklist MWL, C-STORE) — a porta
  DICOM (4242) fica aberta na LAN para os equipamentos enviarem exames; a
  interface web (8042) só é acessível localmente no servidor.
- **Redis** roda as filas assíncronas (Bull) e o rate-limit, sem porta exposta.

---

## 3. Stack tecnológica

**Backend** (`ris-pacs-backend`)
- Node ≥ 20, **Express 4**
- **PostgreSQL** via driver `pg` (funciona local e em nuvem gerenciada)
- **Redis** via `ioredis` + filas **Bull**
- Autenticação **JWT RS256** (`jsonwebtoken` + `jose`), refresh tokens
- **bcrypt** (hash de senha), **speakeasy** (MFA TOTP)
- Validação com **Zod**
- **multer** (upload), **dicom-parser** (parse de tags)
- **puppeteer** (render de PDF de laudo/receita/atestado)
- **resend** / **nodemailer** (e-mail opcional), **winston** (logs)
- **helmet**, **cors**, **compression**, **morgan**, **express-rate-limit**
- **AWS SDK S3** (cliente para RustFS)
- Sinalização de teleconsulta via **REST + polling** (tabela própria) — sem
  socket.io/servidor de mídia; a mídia é P2P entre os dois browsers.

**Frontend** (`ris-frontend`)
- **React 19** + **Vite 8** + **TypeScript**
- **Tailwind CSS 3.4** (tema claro/escuro via CSS variables)
- **TanStack Query** (dados do servidor) + **Zustand** (estado de auth/sessão)
- **react-hook-form** + **Zod** (formulários)
- **react-router-dom** (rotas)
- **Cornerstone.js** (`@cornerstonejs/core`, `tools`, `dicom-image-loader`) +
  `dicom-parser`, `nifti-reader-js`, `jpeg-lossless-decoder-js` — visualizador
- **`RTCPeerConnection`** nativo (WebRTC) — sala de teleconsulta
- **lucide-react** (ícones), **recharts** (gráficos), **react-big-calendar**
  (agenda), **socket.io-client** (tempo real de notificações)

**Infra:** Docker Compose, **pnpm 9** (workspaces), **Postgres 16** (container),
certificado **TLS auto-assinado** (`openssl`) para o piloto LAN.

---

## 4. Serviços e portas

| Serviço | Imagem | Porta(s) no host | Exposição |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 5432 | **só 127.0.0.1** (local ao servidor) |
| `redis` | redis:7-alpine | — | **sem porta** (só rede interna do compose) |
| `rustfs` | rustfs/rustfs | — | **sem porta** (só rede interna do compose) |
| `orthanc` | jodogne/orthanc-plugins | 8042 (UI), 4242 (DICOM) | 8042 **só 127.0.0.1**; **4242 aberto na LAN** (equipamentos) |
| `backend` | build local | 3000 | **só 127.0.0.1** (nginx faz proxy) |
| `frontend` | build local (nginx) | 80, 443 | **abertos na LAN** — 80 só redireciona para 443 |

O banco **PostgreSQL é local** por padrão (container `postgres`, sem
depender de internet). Para usar um Postgres gerenciado na nuvem (Neon, RDS
etc.), basta apontar `DATABASE_URL` para lá — o driver `pg` detecta o host e
liga SSL automaticamente.

---

## 5. Como executar

Pré-requisitos: **Docker + Docker Compose**, `openssl` (para o certificado
TLS) e um `.env` na raiz (copie de `.env.example`) com `POSTGRES_PASSWORD`,
chaves `JWT_*`, `ENCRYPTION_KEY` etc.

```bash
# 1. gerar o certificado TLS (self-signed, piloto LAN)
sh infra/tls/gen-cert.sh                       # ou: SERVER_IP=192.168.x.x sh infra/tls/gen-cert.sh

# 2. subir o banco e aplicar schema/seed (primeira vez)
docker compose up -d postgres
#   ... aplicar migrations/001_schema.sql + 002_seed.sql (ver README do backend)

# 3. subir tudo
docker compose build
docker compose up -d

# logs
docker compose logs -f backend

# derrubar
docker compose down
```

Acesso: frontend em `https://localhost` (ou IP do servidor na LAN — aceite o
aviso de certificado auto-assinado), API via proxy do próprio frontend
(`/api/v1`). Orthanc e RustFS não são mais expostos publicamente; acesse via
`docker compose exec` ou `127.0.0.1` no próprio servidor.

> ⚠ **O backend e o frontend são imagens Docker (não volumes).** Após mudar
> código: `docker compose build backend && docker compose up -d backend`
> (idem para o frontend). O frontend também embute o certificado TLS na
> imagem via volume montado (`infra/tls`), não precisa rebuildar por causa dele.

### Desenvolvimento local (sem Docker para o app)

```bash
pnpm install
pnpm dev            # backend + frontend em paralelo
pnpm dev:backend    # só backend (nodemon)
pnpm dev:frontend   # só frontend (vite)
```

### Migrations e seed

O schema fica em `packages/backend/migrations/001_schema.sql` (idempotente:
`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Seed inicial em
`002_seed.sql`. Scripts utilitários em `packages/backend/scripts/` —
`seed_catalog.js` (CID-10 e medicamentos), `rotate_seed_passwords.js`
(troca as senhas de demonstração antes de operar de verdade),
`e2e_http_smoke.js` (fumaça ponta-a-ponta autenticada dos módulos novos),
`migrate_org_from_neon.js` (importa usuários/unidades de um Neon existente,
por chave natural, preservando os UUIDs locais).

---

## 6. Estrutura do monorepo

```
.
├── docker-compose.yml
├── package.json                 # workspaces pnpm + scripts docker
├── docs/                        # avaliações, pendências, planos, manuais
│   ├── manuais/                 # 1 página por papel (recepção, técnico, médico…)
│   ├── screenshot/              # fotos do sistema
│   ├── plano-piloto.md          # hardening + QA + onboarding + operação
│   ├── implantacao-checklist.md # runbook de deploy Linux/LAN
│   ├── termo-responsabilidade.md
│   └── pendencias.md            # DATASUS, e-mail, SMS/WhatsApp (bloqueios externos)
├── infra/
│   ├── tls/                     # gen-cert.sh + certificado (gitignored)
│   ├── backup/                  # backup.sh + restore-test.sh (pg_dump + volumes)
│   ├── db/                      # dump portátil (gitignored)
│   └── orthanc/                 # config do servidor DICOM
├── packages/
│   ├── backend/                 # API Express (ver README do backend)
│   │   ├── migrations/          # 001_schema.sql, 002_seed.sql
│   │   ├── scripts/             # seeds, smokes, migrações de dados
│   │   └── src/
│   │       ├── app.js           # bootstrap + montagem de rotas
│   │       ├── config/          # database, env, permissions, storage, logger
│   │       ├── middlewares/     # authenticate, authorize, validate, errorHandler
│   │       ├── modules/         # um diretório por domínio (rotas+controller)
│   │       ├── services/        # encryption, audit, email, pdf, mwl, messaging
│   │       └── utils/           # response, errors, cns, dicomWriter
│   └── frontend/                # SPA React (ver README do frontend)
│       └── src/
│           ├── App.tsx          # rotas
│           ├── api/             # cliente axios + endpoints
│           ├── components/      # UI, layout, guards, widgets clínicos
│           ├── pages/           # uma pasta por área
│           ├── orthovis/        # visualizador DICOM
│           └── stores/          # Zustand (authStore)
```

---

## 7. Papéis de usuário (RBAC)

`auth.user_role`: **admin, radiologist, technician, receptionist, doctor,
patient, nurse**.

| Papel | Acesso principal |
|---|---|
| **admin** | Tudo (bypass). Gestão da rede: unidades, equipe, auditoria |
| **receptionist** (recepção) | Agenda (exame/consulta/tele), pacientes, check-in, acolhimento+triagem, fila/chamada, sua unidade, relatórios, faturamento, **liberar acesso ao portal**, **farmácia (estoque)**, **mensageria** |
| **technician** (técnico) | Worklist, upload DICOM, estudos, procedimentos, sinais vitais, alergias/vacinas, **farmácia (estoque)** |
| **radiologist** (radiologista) | Laudos, segunda opinião, visualizador, PEP completo (autor clínico), **teleconsulta**, **liberar acesso ao portal** |
| **doctor** (médico) | Atendimento, PEP completo, prescrição, atestados, SADT, **teleconsulta**, **liberar acesso ao portal** |
| **nurse** (enfermeiro) | Triagem, medicação na unidade (MAR), escalas/evolução de enfermagem, **farmácia (estoque + dispensação)**, **liberar acesso ao portal** |
| **patient** (paciente) | Apenas o portal (`/portal_do_paciente`) — sem sistema interno |

O RBAC é **granular** (`resource:action`) com **overrides por usuário**
(granted/revoked). Detalhes no README do backend.

---

## 8. Mapa de funcionalidades

### RIS — Agenda e exames
- Agendamento com **tipo** (exame/consulta/teleconsulta), **slot picker**
  (disponibilidade por unidade/procedimento) para exames, **auto-seleção de
  médico** plantonista (obrigatória em consulta/teleconsulta), prioridade,
  indicação clínica, **comprovante imprimível** (substitui confirmação por
  SMS/e-mail no piloto).
- **Check-in** com validação de CPF + criação/validação de conta do portal +
  **aceite de termos auditável**. Em consulta/teleconsulta, o check-in **abre
  o atendimento clínico** e entra na fila médica automaticamente.
- **Atendimento avulso (walk-in)** — entra já em check-in.
- **Worklist** do técnico (exames do dia, por unidade) + MWL para o Orthanc.
- **Procedimentos por unidade** com janela de horário por procedimento.
- **Turnos** (escala) e atribuição de equipe por unidade.
- **Encaminhamento** entre unidades + **contrarreferência** (fecha o ciclo).

### PACS — Imagem e laudo
- **Upload DICOM** multi-chunk (init/chunk/finalize), parse de tags, ingestão no
  Orthanc + replicação para o S3, geração de UIDs sintéticos para reuso.
- **OrthoVis** — visualizador DICOM no browser (janelamento, zoom, medições,
  série/instância, modo streaming para estudos grandes).
- **Laudo** estruturado, **assinado** (JWT RS256) + PDF, templates por
  modalidade, autotextos, CID-10, emenda (adendo rastreável).
- **Segunda opinião** (conselho técnico entre radiologistas).
- **Captura secundária** e **status de replicação**.

### PEP — Clínico
- **Fluxo de atendimento:** recepção → triagem (sinais vitais + Manchester) →
  fila médica → consulta (presencial **ou por vídeo**) → medicação → conclusão.
- **Fila automática:** ficha diária (senha por unidade que reinicia a cada dia),
  direcionamento ao plantonista, **chamar próximo**, **painel de TV** público.
- **Evolução SOAP** assinada e versionada, autotextos, CID-10.
- **Prescrição eletrônica** (comum/controlada/antimicrobiano) com posologia
  estruturada, **numeração de receituário controlado** (Portaria 344),
  **checagem de alergia (por nome e princípio ativo) + interação** ao vivo.
- **Alergias**, **medicamentos em uso** (+ reconciliação), **anamnese**,
  **anexos**, **atestados** (CID obrigatório no afastamento), **imunização**.
- **Enfermagem:** escalas Morse/Braden, **evolução SAE**, **medicação na
  unidade** (MAR) com aprazamento, alerta de dose atrasada, **"5 certos"**.
- **SADT** (solicitação de exames/laboratório).
- **Farmacovigilância** (notificação de evento adverso/RAM).
- **Farmácia:** estoque por unidade (lote/validade/mínimo, alerta de baixa e
  vencimento) com **ledger de movimentos**; **dispensação** consome a
  prescrição assinada e baixa o estoque em transação (saldo nunca negativo).
- **Teleconsulta:** vídeo **ponto-a-ponto (P2P)** sem provedor pago — o médico
  cria a sala, o link vai ao paciente (comprovante/portal), a sinalização
  (offer/answer/ICE) trafega por REST/polling; exige HTTPS para a câmera.
- **Catálogos** locais CID-10 e medicamentos (autocompletar offline).

### Portal do paciente — agora um PEP completo (não só imagem)
- **Meus agendamentos:** exames, consultas e teleconsultas, passados e futuros.
- **Meus exames:** status (stepper), laudo assinado (PDF) e imagens (viewer leve).
- **Minhas receitas** e **meus atestados/declarações**, com **download em PDF**.
- **Resumo de saúde:** alergias, condições ativas, medicamentos em uso, vacinas.
- **Entrar na teleconsulta** — banner quando o profissional abre a sala.
- Conta **desacoplada do exame de imagem** — qualquer paciente (inclusive de
  atendimento clínico/emergência) pode ganhar acesso via **recepção/
  enfermagem/médico** (botão "Portal" no cadastro), com senha temporária
  entregue uma única vez.

### Transversais
- **Painel de chamada (TV)** — `/painel`, qualquer funcionário, LGPD-safe.
- **Relatórios operacionais** (produção, fila, no-show).
- **Faturamento SUS** — extrato de produção ambulatorial + export CSV.
- **Mensageria** — fila de confirmação de agendamento (SMS/WhatsApp),
  pronta para plugar um provedor; sem provedor, fica visível como `pending`
  (nunca finge que enviou).
- **Notificações** (in-app + SLA), **auditoria**, **consentimento (LGPD)**
  — o aceite de termos no cadastro/check-in/criação de conta é **registrado
  na auditoria** (não só um checkbox de tela).

---

## 9. Mapa de páginas (para capturas de tela)

Páginas públicas / login:

| Rota | Página | Quem |
|---|---|---|
| `/login_paciente` | Login do paciente | Paciente |
| `/login_medico` | Login do médico | Médico |
| `/login_recepcao` | Login da recepção | Recepção |
| `/login_tecnico` | Login do técnico | Técnico |
| `/login_enfermeiro` | Login do enfermeiro | Enfermeiro |
| `/login_admin` | Login do admin | Admin |
| `/reset-password` | Redefinição de senha (link e-mail) | Todos |
| `/termos` | **Termos de Uso e Política de Privacidade (LGPD)** | Público (nova aba) |
| `/portal_do_paciente` | Portal do paciente (agendamentos, laudos, receitas, atestados, sumário) | Paciente |

Tela cheia (sem sidebar):

| Rota | Página | Quem |
|---|---|---|
| `/viewer/:studyUID` | **OrthoVis** — visualizador DICOM | Radiologista/técnico |
| `/painel` | **Painel de chamada (TV)** | Qualquer funcionário |
| `/tele/:token` | **Sala de teleconsulta** (vídeo) — rota pública por *capability* do token | Médico (`?host=1`) / Paciente |

Sistema interno (dentro do layout com sidebar):

| Rota | Página | Quem |
|---|---|---|
| `/dashboard` | Dashboard | Médico/recepção/técnico/radiologista/admin |
| `/appointments` | Agendamento (exame/consulta/teleconsulta, check-in, comprovante) | Recepção/admin |
| `/patients` | Pacientes (busca, cadastro c/ aceite LGPD, mesclar, LGPD, **liberar portal**) | Recepção/radiologista/…/admin |
| `/patients/:id/chart` | **Prontuário (PEP)** — abas clínicas | Médico/técnico/radiologista/enfermeiro/admin |
| `/atendimento` | Painel de atendimento (kanban da fila) | Recepção/enfermeiro/médico/admin |
| `/atendimento/consulta/:encounterId` | Consulta médica dedicada | Médico/radiologista/admin |
| `/medicacao` | Medicação na unidade (MAR) | Enfermeiro/admin |
| `/farmacia` | **Farmácia** — estoque e dispensação | Enfermeiro/recepção/técnico/admin |
| `/teleconsulta` | **Teleconsulta** — criar sala, link, entrar | Médico/radiologista/admin |
| `/relatorios` | Relatórios + faturamento SUS | Recepção/radiologista/médico/admin |
| `/worklist` | Worklist (exames do dia) | Técnico/radiologista/admin |
| `/studies` | Estudos DICOM | Técnico/radiologista/admin |
| `/dicom-upload` | Upload de DICOM | Técnico/admin |
| `/webviewer` | Visualizador local (drop zone) | Técnico/radiologista/admin |
| `/reports` | Laudos | Radiologista/admin |
| `/second-opinion` | Conselho técnico (2ª opinião) | Radiologista/admin |
| `/referrals` | Encaminhamentos (caixa de entrada) | Recepção/médico/radiologista/técnico/admin |
| `/procedures` | Procedimentos | Técnico/admin |
| `/minha-unidade` | Gestão da própria unidade (recepção) | Recepção |
| `/admin` | Painel do administrador | Admin |
| `/admin/units` | Unidades da rede | Admin |
| `/admin/units/:id` | Gestão de uma unidade (procedimentos, turnos, equipe) | Admin/recepção |
| `/admin/staff` | Equipe (usuários, **resetar senha**, aceite de termos na criação) | Admin |
| `/admin/audit` | Auditoria | Admin |

As abas do **Prontuário (PEP)** (`/patients/:id/chart`), cada uma um print:
Linha do tempo, Atendimentos, Problemas, **Alergias**, **Farmacovig.**,
Medicamentos, Prescrições, **Exames (SADT)**, Atestados, Vacinas, Anexos,
Antecedentes, Sinais vitais, **Escalas**, **Evolução Enf.**

---

## 10. Modelo de dados (resumo)

Cinco schemas no PostgreSQL:

| Schema | Conteúdo | Tabelas-chave |
|---|---|---|
| `auth` | Identidade e sessão | `users`, `refresh_tokens`, `password_reset_tokens` |
| `ris` | Operação clínica/administrativa | `patients`, `appointments` (**`appointment_kind`, `specialty`, `reason`, `encounter_id`**), `procedures`, `health_units`, `modalities`, `rooms`, `referrals`, `reports`, `shifts`, `user_shifts`, `availability_rules`, `cid`, `medications_catalog`, `drug_interactions`, `consent_terms`, `patient_consents`, `notifications`, **`pharmacy_stock`**, **`pharmacy_movements`**, **`message_outbox`** |
| `pacs` | Imagem | `studies`, `series`, `instances`, `annotations` |
| `ehr` | Prontuário | `encounters`, `clinical_notes`, `vitals`, `problems`, `allergies`, `medications`, `prescriptions`, `prescription_items`, `certificates`, `immunizations`, `nursing_assessments`, `nursing_evolutions`, `service_requests`, `adverse_events`, `medication_administrations`, `daily_ticket_counters`, `controlled_rx_counters`, **`dispensations`**, **`dispensation_items`**, **`teleconsultations`**, **`teleconsult_signals`** |
| `audit` | Trilha | `logs` (agora inclui `details.terms_accepted` no cadastro/check-in) |

Detalhamento campo a campo no README do backend.

---

## 11. Segurança, LGPD e hardening

- **PII cifrada em repouso:** nome, CPF, telefone, CNS etc. ficam em colunas
  `*_enc` (AES-256-GCM, BYTEA). Busca por igualdade usa `*_hash` (SHA-256). A
  chave fica no ambiente do backend; o banco nunca vê texto claro.
- **HTTPS obrigatório:** nginx serve em 443 com certificado (auto-assinado no
  piloto LAN); HTTP redireciona. Cookies do portal são `secure` em produção.
- **Superfície de rede reduzida:** só o frontend (80/443) e a porta DICOM
  (4242, para equipamentos) ficam abertos na LAN. Backend, Postgres, Redis,
  RustFS e a UI do Orthanc não são expostos — o nginx é o único ponto de
  entrada da aplicação.
- **Autenticação:** JWT **RS256** (par de chaves), access token curto + refresh
  token rotacionável; logout invalida o refresh. MFA TOTP opcional.
- **RBAC granular** com overrides por usuário (`config/permissions.js`).
- **Escopo por unidade:** não-admin só gere/vê a própria unidade.
- **Break-glass:** acesso clínico de emergência é registrado e auditado.
- **Auditoria:** ações sensíveis vão para `audit.logs`.
- **Consentimento (LGPD) auditável:** o aceite dos Termos de Uso é exigido
  (checkbox + link para `/termos`) no **cadastro de paciente**, no
  **check-in** (criação da conta do portal) e na **criação de funcionário** —
  e o aceite é **gravado na auditoria** (`terms_accepted`), não é só um gate
  de tela. Export e log de acesso por paciente disponíveis.
- **Painel de TV** expõe só ficha + primeiro nome + sala (sem dado clínico).
- **Rate-limit** em login e portal.
- **Credenciais de demonstração:** o seed cria contas com senhas conhecidas
  (`admin123456` etc.) — **rotacionadas obrigatoriamente antes do piloto** via
  `scripts/rotate_seed_passwords.js`, que gera senhas fortes e as imprime uma
  única vez.
- **Backup local:** `infra/backup/backup.sh` (pg_dump + volumes do Orthanc/
  RustFS, retenção 7 diários + 4 semanais) e `infra/backup/restore-test.sh`
  (valida a restauração periodicamente, sem tocar em produção).

---

## 12. Piloto municipal

O sistema foi preparado para operar **sem** as integrações que dependem de
terceiros/credenciamento (e-mail, SMS/WhatsApp, DATASUS/RNDS/CADSUS/SISREG) —
essas ficam com a **fatia local implementada** e documentadas em
[`docs/pendencias.md`](docs/pendencias.md). Compensações adotadas:

- **Comprovante impresso** no lugar da confirmação por SMS/e-mail.
- **Reset de senha pelo administrador** (recepção/paciente) no lugar do
  link por e-mail — devolve uma senha temporária uma única vez.
- **Mensageria interna** (outbox) já pronta para plugar um provedor de
  SMS/WhatsApp quando disponível, sem mudar o restante do sistema.

O plano completo de hardening, QA e operação está em
[`docs/plano-piloto.md`](docs/plano-piloto.md); o passo a passo de deploy em
[`docs/implantacao-checklist.md`](docs/implantacao-checklist.md).

---

## 13. Decisões de projeto

- **Monorepo pnpm** — backend e frontend versionados juntos, build/deploy
  coordenados via Docker Compose.
- **Banco Postgres LOCAL** (container, não gerenciado) — elimina a
  dependência de internet para o piloto na LAN; o driver `pg` padrão permite
  trocar para um Postgres gerenciado (Neon, RDS…) só mudando `DATABASE_URL`.
  Um script (`migrate_org_from_neon.js`) importa usuários/unidades de um Neon
  existente por **chave natural** (email/CNES), preservando os UUIDs locais
  para não quebrar as FKs de dados já cadastrados.
- **PII cifrada na aplicação** (não no banco) — a chave nunca toca o Postgres;
  busca por hash evita vazar texto claro em índices.
- **RBAC em duas camadas** — `permissions.js` (granular `resource:action`,
  fonte de verdade do backend) + `authorize.js` `ROUTE_PERMISSIONS` (mapa
  papel→recurso, usado para montar a navegação do frontend).
- **Visualizador próprio (OrthoVis)** no browser — sem plugin nativo; decodifica
  DICOM via Cornerstone, com modo *streaming* para estudos grandes.
- **Teleconsulta P2P sem provedor pago** — sinalização (offer/answer/ICE) por
  REST com polling (tabela `teleconsult_signals`), em vez de socket.io ou um
  serviço de mídia; a sala é protegida por *capability* (o `room_token`, um
  UUID não adivinhável, é a credencial) — permite o paciente entrar direto do
  portal sem precisar de uma conta de sistema interno.
- **Agendamento com tipo (`appointment_kind`)** — unificou a agenda de exame
  de imagem com a de consulta/teleconsulta num único modelo; o check-in do
  tipo clínico abre automaticamente o atendimento (`encounter`) e entra na
  fila médica, eliminando o retrabalho de "agendar" e "atender" como fluxos
  desconectados.
- **Conta do portal desacoplada do exame** — antes só nascia no check-in de
  imagem; agora qualquer paciente ganha acesso via um endpoint dedicado
  (`portal-access`), usado pela recepção/enfermagem/médico.
- **Upload multi-chunk** — exames de centenas de imagens sobem por partes
  (init/chunk/finalize), resistente a falhas.
- **Documentos assinados (laudo/receita/atestado/nota)** — hash SHA-256 +
  JWT RS256 + PDF (puppeteer); notas clínicas são **imutáveis** com adendo
  rastreável (versões).
- **Catálogos locais (CID-10/medicamentos/interações)** — autocompletar
  **offline**, sem depender de API externa; a carga oficial completa
  (DATASUS/ANVISA) é um passo de dados à parte.
- **Itens de integração nacional** (CADSUS, SISREG, RNDS, faturamento BPA-MAG)
  têm a **fatia local** implementada (validação/geração/extrato); a transmissão
  exige homologação/credenciamento externo — documentado, não implementado
  no piloto.

---

## 14. Glossário

| Sigla | Significado |
|---|---|
| **RIS** | Radiology Information System — agenda/gestão de exames |
| **PACS** | Picture Archiving and Communication System — imagem |
| **PEP** | Prontuário Eletrônico do Paciente |
| **DICOM** | Padrão de imagem médica |
| **MWL** | Modality Worklist — lista de trabalho enviada à modalidade |
| **MAR** | Medication Administration Record — registro de administração |
| **SOAP** | Subjetivo/Objetivo/Avaliação/Plano (evolução) |
| **SAE** | Sistematização da Assistência de Enfermagem |
| **SADT** | Serviço de Apoio Diagnóstico e Terapêutico (pedido de exames) |
| **CID-10** | Classificação Internacional de Doenças |
| **CNS** | Cartão Nacional de Saúde (Cartão SUS) |
| **RAM** | Reação Adversa a Medicamento |
| **Manchester** | Protocolo de classificação de risco na triagem |
| **LGPD** | Lei Geral de Proteção de Dados |
| **RNDS** | Rede Nacional de Dados em Saúde |
| **BPA** | Boletim de Produção Ambulatorial (faturamento SUS) |
| **WebRTC** | Padrão de vídeo/áudio P2P no browser (usado na teleconsulta) |
| **P2P** | Peer-to-peer — comunicação direta entre dois pontos, sem servidor central de mídia |
| **LAN** | Local Area Network — rede local (piloto roda sem depender de internet) |

---

_Documento gerado a partir do código. Para detalhes de implementação, ver os
READMEs de [backend](packages/backend/README.md) e
[frontend](packages/frontend/README.md), e o plano de piloto em
[docs/plano-piloto.md](docs/plano-piloto.md)._
