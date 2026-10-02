# Frontend — RIS/PACS + PEP

SPA do sistema clínico em **React 19 + Vite 8 + TypeScript**, com visualizador
DICOM integrado (**OrthoVis**) e sala de **teleconsulta** (WebRTC nativo).
Consome apenas a API REST do backend (`/api/v1`, via proxy do próprio nginx).
Servida por **nginx com HTTPS** em produção (porta 443; 80 só redireciona).

> Visão geral do sistema no [README raiz](../../README.md).
> Backend em [`packages/backend`](../backend/README.md).

---

## Índice

1. [Arquitetura](#1-arquitetura)
2. [Roteamento e guards](#2-roteamento-e-guards)
3. [Estado, dados e API](#3-estado-dados-e-api)
4. [RBAC no cliente](#4-rbac-no-cliente)
5. [Páginas (detalhe para capturas)](#5-páginas-detalhe-para-capturas)
6. [OrthoVis — visualizador DICOM](#6-orthovis--visualizador-dicom)
7. [Teleconsulta — sala de vídeo (WebRTC)](#7-teleconsulta--sala-de-vídeo-webrtc)
8. [Design system e responsividade](#8-design-system-e-responsividade)
9. [Componentes-chave](#9-componentes-chave)
10. [Build e execução](#10-build-e-execução)
11. [Decisões de projeto](#11-decisões-de-projeto)

---

## 1. Arquitetura

```
src/
├── App.tsx                 # rotas + providers (QueryClient, Toaster, CookieConsent)
├── api/
│   ├── client.ts           # axios + interceptors (token, refresh, erros)
│   └── endpoints.ts        # objetos por domínio (authApi, ehrApi, pharmacyApi, teleconsultApi…)
├── stores/
│   └── authStore.ts        # Zustand: user, token, permissions, can(), hasRole()
├── components/
│   ├── layout/              # AppLayout, Sidebar, Topbar
│   ├── auth/RoleGuard.tsx   # guarda por recurso/role
│   ├── ui/                  # Spinner, Modal, Field, Select, Toast, ConfirmDialog…
│   ├── CatalogInput.tsx     # autocomplete CID/medicamentos
│   ├── DrugSafetyBanner.tsx # alerta de alergia + interação ao vivo
│   ├── SoapTemplates.tsx    # autotexto SOAP
│   ├── GlobalSearch.tsx     # busca global (Ctrl/Cmd+K)
│   ├── TermsCheckbox.tsx    # aceite de Termos/LGPD (checkbox + link p/ /termos)
│   └── posology.tsx         # datalists de via/frequência/duração
├── pages/<área>/            # uma pasta por área, incluindo farmacia/, teleconsulta/, legal/ (ver §5)
├── orthovis/                # visualizador DICOM (ver §6)
└── utils/format.ts          # formatação de data, status, erros
```

- **Dados do servidor:** TanStack Query (cache, refetch, polling).
- **Estado de sessão:** Zustand (`authStore`, persistido).
- **Formulários:** react-hook-form + Zod (`zodResolver`).
- **Tema:** Tailwind + CSS variables (claro/escuro/sépia).

---

## 2. Roteamento e guards

`App.tsx` define quatro grupos de rotas:

- **Públicas/login** — `PublicOnlyRoute` (redireciona se já autenticado);
  inclui `/termos` (Termos de Uso/LGPD, sem guard nenhum — página institucional).
- **Tela cheia** (fora do `AppLayout`) — `/viewer/:studyUID` (OrthoVis) e
  `/painel` (TV), sob `PrivateRoute`; **`/tele/:token`** (sala de teleconsulta)
  é **totalmente pública** — o acesso é por *capability* do próprio token da
  URL, não por login (permite o paciente entrar sem conta de sistema interno).
- **Sistema interno** — `PrivateRoute` → `AppLayout` (sidebar) → cada rota
  embrulhada em **`RoleGuard resource="…"`**.

Guards:
- **`PrivateRoute`** — exige autenticação; senão vai para `/login_paciente`.
- **`PublicOnlyRoute`** — se autenticado, manda paciente ao portal e funcionário
  ao destino.
- **`RoleGuard`** — `can(resource)` (e opcionalmente `hasRole`); paciente nunca
  entra no sistema interno. Fallback: redirect ou bloqueio visual.
- **`DashboardRedirect`** — a raiz `/` redireciona para a primeira rota acessível
  conforme o papel (admin→`/admin`, enfermeiro→`/medicacao`, etc.).

---

## 3. Estado, dados e API

- **`api/client.ts`** — instância axios com `baseURL` da API; interceptor injeta
  o access token, trata 401 (refresh) e normaliza erros.
- **`api/endpoints.ts`** — um objeto por domínio: `authApi`, `patientsApi`,
  `appointmentsApi`, `studiesApi`, `reportsApi`, `ehrApi`, `catalogApi`,
  `analyticsApi`, `billingApi`, `availabilityApi`, `healthUnitsApi`, `usersApi`,
  `lookupsApi`, **`pharmacyApi`** (estoque/dispensação), **`teleconsultApi`**
  (sessão + sala + sinalização), **`messagingApi`** (outbox), etc. Cada método
  devolve a Promise do axios; os componentes usam `select: (r) => r.data.data`
  para desembrulhar o envelope `{ success, data }`.
- **Padrão de leitura:** `useQuery({ queryKey, queryFn, select })`; mutações com
  `useMutation` + `invalidateQueries`. Polling onde faz sentido (fila, painel,
  medicação, sinalização da teleconsulta, banner de sala ativa no portal).

---

## 4. RBAC no cliente

- No login, o backend devolve `user.permissions` — um mapa **recurso → bool**
  (derivado de `ROUTE_PERMISSIONS`). Fica no `authStore`.
- **`can(resource)`** decide visibilidade de menu e acesso de rota (via
  `RoleGuard`). **`hasRole(...)`** checa papel.
- A **Sidebar** filtra os itens por `can()` + flags (`adminOnly`,
  `nonAdminOnly`, `external` para abrir em nova aba — ex.: Painel TV). Inclui
  agora **Farmácia** e **Teleconsulta**.
- O RBAC do cliente é só de **UX**; a autorização real é sempre no backend.

---

## 5. Páginas (detalhe para capturas)

### Login e público
- **`auth/LoginPaciente|LoginMedico|LoginRecepcao|LoginTecnico|LoginAdmin`** —
  telas de login por papel (o enfermeiro reusa o portal de funcionário).
- **`auth/ResetPassword`** — redefinição via token do e-mail (fluxo dormente
  no piloto sem provedor; o caminho operacional é o admin resetar pelo painel).
- **`legal/TermosDeUso`** — página pública `/termos`: Termos de Uso e Política
  de Privacidade (modelo LGPD); aberta em nova aba pelos checkboxes de aceite.
- **`portal/PortalDoPaciente`** — área do paciente, agora um **PEP completo**
  do ponto de vista do paciente: **próximos agendamentos** (exame, consulta e
  teleconsulta), **banner de teleconsulta ativa** ("Entrar na sala"), lista de
  exames com status (stepper), download de laudo (PDF) e imagens
  (DicomViewerLite), **receitas** e **atestados** com download em PDF, e
  sumário clínico (alergias/condições/medicamentos/vacinas).

### Sistema interno
- **`dashboard/DashboardPage`** — visão geral por papel (indicadores, atalhos).
  Não quebra para radiologista/médico (cada papel vê o que lhe cabe).
- **`appointments/AppointmentsPage`** — agenda: lista filtrável (mostra tipo —
  exame/consulta/teleconsulta — e médico designado), **criar agendamento**
  com seletor de **tipo**: exame de imagem (procedimento + **slot picker** de
  horários) ou consulta/teleconsulta (especialidade + médico, obrigatório —
  auto-seleção de plantonista se não escolhido); **check-in** (CPF + senha +
  **aceite de termos**), **comprovante imprimível** (adaptado por tipo,
  inclui link da telesala quando aplicável), cancelar.
- **`patients/PatientsPage`** — busca (nome parcial + nascimento), cadastro
  (com **aceite de Termos/LGPD** obrigatório), edição (CNS/CPF), **mesclar
  pacientes**, export/log LGPD, **botão "Portal"** (libera/reseta o acesso ao
  portal do paciente, mostra a senha temporária uma única vez).
- **`patients/PatientChartPage` + `PatientChartF2`** — **Prontuário (PEP)** com
  abas: Linha do tempo, Atendimentos, Problemas (CID), Alergias, **Farmacovig.**,
  Medicamentos, Prescrições, **Exames (SADT)**, Atestados, Vacinas, Anexos,
  Antecedentes, Sinais vitais (gráfico), **Escalas** (Morse/Braden),
  **Evolução Enf. (SAE)**. Banners de alergia/risco no topo.
- **`atendimento/AtendimentoPage`** — **painel de fila** (kanban por estágio:
  triagem → médico → consulta → medicação), iniciar atendimento (paciente ou
  emergência), triagem (sinais vitais + escala de dor + Manchester),
  **chamar próximo**, atalho para o **Painel TV**, ficha diária nos cards.
- **`atendimento/AtendimentoConsultaPage`** — consulta médica dedicada: alergias,
  evolução, **receita** com `CatalogInput` + `DrugSafetyBanner`, concluir.
- **`atendimento/MedicacaoPage`** — **medicação na unidade (MAR)**: fila de
  administração, doses aprazadas (alerta de atraso), registrar administração com
  **checklist dos "5 certos"**.
- **`farmacia/FarmaciaPage`** — **Farmácia**: aba **Estoque** (busca, filtro
  "só baixo", entrada, saída/ajuste, histórico de movimentos, alerta de
  validade) e aba **Dispensação** (busca paciente → prescrições assinadas →
  seleciona itens + item de estoque → dispensa, baixando o saldo).
- **`teleconsulta/TeleconsultaPage`** — painel do profissional: busca paciente,
  **cria a sala** (nova sessão), copia/compartilha o link, **entra** como
  anfitrião (`?host=1`), encerra a sessão.
- **`teleconsulta/TeleRoomPage`** — **sala de vídeo** (`/tele/:token`, tela
  cheia, rota pública): captura câmera/microfone, conecta via
  `RTCPeerConnection`, controles de mudo/câmera/encerrar; distingue anfitrião
  (`?host=1`) de convidado (paciente).
- **`painel/PainelPage`** — **Painel de chamada (TV)**, tela cheia: ficha sendo
  chamada (grande), próximos, plantão, relógio. LGPD: só ficha + 1º nome + sala.
- **`relatorios/RelatoriosPage`** — relatórios operacionais (produção, no-show,
  fila) + **Faturamento SUS** (extrato por competência + export CSV).
- **`worklist/WorklistPage`** — exames do dia (técnico/radiologista).
- **`studies/StudiesPage`** — lista de estudos DICOM; abre o OrthoVis.
- **`studies/DicomUploadPage`** — upload de DICOM por agendamento (multi-chunk).
- **`viewer/WebviewerPage`** + **`viewer/DicomViewerPage`** — visualizador local
  (drop zone) e viewer auxiliar.
- **`reports/ReportsPage`** — laudos: criar/editar, **assinar**, PDF, emenda,
  CID, autotextos, templates.
- **`second-opinion/SecondOpinionPage`** — conselho técnico (2ª opinião).
- **`referrals/ReferralsInboxPage`** — encaminhamentos recebidos/enviados,
  decidir, **contrarreferenciar**.
- **`procedures/ProceduresPage`** — catálogo de procedimentos.
- **Admin:** `admin/AdminHomePage`, `AdminUnitsPage`, `admin/UnitManagePage`
  (procedimentos, turnos, equipe da unidade), `AdminStaffPage` (usuários,
  permissões, **criação com aceite de termos**, **botão "Senha" para resetar**
  a senha de um funcionário e mostrar a temporária uma vez), `AdminAuditPage`
  (auditoria).
- **`notifications/NotificationsPanel`** — sino de notificações (in-app).

---

## 6. OrthoVis — visualizador DICOM

`src/orthovis/` — viewer próprio, roda em tela cheia (`/viewer/:studyUID`):
- **Cornerstone.js** (core + tools + dicom-image-loader) decodifica DICOM no
  browser; suporta JPEG lossless e NIfTI.
- **`store.ts`** (Zustand) — estado do viewer (série/instância, ferramenta ativa,
  janelamento, `reportLocked`).
- **Modo streaming** para estudos grandes: LRU de fatias axiais em resolução
  cheia + volume reduzido (evita estourar memória).
- **Ferramentas:** janelamento, zoom, pan, medições, navegação série/instância.
- **`reportLocked`** — quando o laudo está assinado, o viewer entra em
  **somente leitura** (ferramentas de imagem somem; só navegação + presets), com
  badge "Laudo assinado".

---

## 7. Teleconsulta — sala de vídeo (WebRTC)

`src/pages/teleconsulta/TeleRoomPage.tsx` — sala P2P (ponto-a-ponto), sem
biblioteca de terceiros e sem servidor de mídia:

- **Captura local:** `navigator.mediaDevices.getUserMedia({ video, audio })`.
- **Conexão:** `RTCPeerConnection` nativo do browser, com STUN público para
  travessia de NAT. **Não há TURN** — em redes com NAT simétrico rígido, a
  conexão pode falhar; adequado para o cenário-alvo (LAN da unidade / redes
  domésticas comuns).
- **Sinalização:** como não há socket.io/WebSocket dedicado, o offer/answer/
  ICE trafega por **REST com polling curto** contra
  `teleconsultApi.postSignal`/`getSignals` (endpoints do backend descritos no
  README do backend, §6). Cada lado publica seus sinais e lê os do outro
  filtrando pelo papel (`host`/`guest`) e por um cursor de `id`.
- **Papéis:** o profissional entra com `?host=1` (cria a *offer*); o paciente
  (padrão, sem esse parâmetro) responde com a *answer*. A UI mostra estados de
  "conectando", "aguardando o outro lado" e "conectado", além de controles de
  mudo/câmera/encerrar.
- **Segurança de acesso:** a sala não pede login — o `room_token` da URL (um
  UUID não adivinhável, gerado pelo backend ao criar a sessão) **é** a
  credencial. Por isso a rota `/tele/:token` é pública no roteador.
- **Pré-requisito:** `getUserMedia` só funciona em **contexto seguro**
  (HTTPS ou `localhost`) — por isso o frontend roda atrás de HTTPS mesmo no
  piloto LAN (certificado auto-assinado; ver README raiz §11).

---

## 8. Design system e responsividade

- **Tailwind + CSS variables** (`index.css`) — paleta `navy`/`slate`/`cyan`,
  três temas (escuro, claro, sépia) trocando as variáveis.
- Classes utilitárias do projeto: `card`, `btn-primary`, `btn-ghost`,
  `btn-danger`, `input`, `label`, `badge` (+ `badge-success/danger/warning/
  neutral`), `sidebar-link`.
- Ícones **lucide-react**; gráficos **recharts**; agenda **react-big-calendar**.
- Componentes de UI em `components/ui` (Spinner, Modal, Field, Select,
  EmptyState, Toast, ConfirmDialog, Alert).
- **Responsividade:** sidebar vira *drawer* com hambúrguer/backdrop abaixo de
  768px; conteúdo principal usa padding responsivo (`p-4 sm:p-6`); tabelas
  largas ganham rolagem horizontal automática (`overflow-x-auto`) abaixo de
  640px, em vez de espremer colunas. As telas mais recentes (Farmácia,
  Teleconsulta) foram desenhadas mobile-first desde o início.

---

## 9. Componentes-chave

- **`CatalogInput`** — input com `datalist` que busca CID-10 ou medicamentos
  (`/catalog/*`, debounce); usado na prescrição, consulta e SADT.
- **`DrugSafetyBanner`** — chama `/ehr/drug-check` (debounce) e mostra, ao vivo,
  **alergia (nome/princípio ativo)** e **interação** medicamentosa por gravidade.
- **`SoapTemplateBar`** — insere modelos de texto na evolução SOAP.
- **`GlobalSearch`** — paleta de comando (Ctrl/Cmd+K) para achar paciente.
- **`RoleGuard`** — gate de rota por recurso/role.
- **`StatusStepper`** (portal) — linha do tempo do exame para o paciente.
- **`TermsCheckbox`** — checkbox de aceite + link para `/termos` (nova aba);
  reutilizado no cadastro de paciente, no check-in e na criação de
  funcionário. O `value` do aceite é enviado ao backend como `terms_accepted`
  e vira **prova auditável** (ver README do backend, §4/§6), não é decorativo.

---

## 10. Build e execução

```bash
pnpm dev        # vite (HMR) — dev local
pnpm build      # tsc -b && vite build (gera dist/)
pnpm preview    # serve o build
pnpm lint       # eslint
```

Em produção o `dist/` é servido por **nginx com HTTPS** na imagem Docker do
frontend — o certificado (`infra/tls/`, na raiz do repo) é montado como
volume, não embutido na imagem, então trocar o certificado não exige rebuild.
A baseline de tipos é **0 erro** (`tsc --noEmit`); manter assim ao alterar.

> ⚠ O frontend é buildado na imagem Docker — após mudar UI, rebuild da imagem
> (`docker compose build frontend && up -d frontend`).

---

## 11. Decisões de projeto

- **Visualizador próprio (OrthoVis)** no browser — sem plugin nativo nem
  dependência de servidor de imagem para exibir; *streaming* para estudos
  grandes.
- **Teleconsulta com WebRTC nativo, sem biblioteca** — a API do browser já
  cobre o necessário para um caso de uso simples (1 profissional + 1
  paciente); evita uma dependência extra e o custo de aprendê-la, num
  contexto onde não há orçamento para servidor de mídia.
- **Sala de teleconsulta pública (capability por token)** — em vez de criar
  uma segunda forma de autenticação para o paciente, o link em si é a
  permissão; simplifica o fluxo de entrada e casa com o portal (o paciente já
  chega pelo banner autenticado do portal, ou recebe o link no comprovante).
- **RBAC de UX vindo do backend** — o menu e os guards usam o mapa de permissões
  que o backend calcula; nunca se decide acesso só no cliente.
- **TanStack Query + Zustand** — dados do servidor (cache/refetch) separados do
  estado de sessão (auth), cada um na ferramenta certa.
- **Autocomplete e alertas clínicos ao vivo** (`CatalogInput`,
  `DrugSafetyBanner`) — padronizam a entrada e trazem segurança medicamentosa
  sem travar o fluxo (alertam, não bloqueiam).
- **Painel TV em rota separada e nova aba** — fica em tela cheia num monitor sem
  prender a sessão do operador; expõe só dado não sensível (LGPD).
- **Telas de login por papel** — cada perfil tem sua porta de entrada; o backend
  valida o papel no login correspondente.
- **Tema por CSS variables** — troca de tema sem recompilar componentes.
- **Consentimento reutilizável (`TermsCheckbox`)** — um único componente,
  reaproveitado em três formulários diferentes, garante que o texto e o
  comportamento do aceite (bloquear envio, abrir termos em nova aba) não
  divirjam entre as telas.
