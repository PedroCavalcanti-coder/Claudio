# Backlog de lançamento — RIS/PACS + PEP (status de execução)

Execução do backlog de auditoria (2026-10-02, commit `cea6313`). `[x]` = feito no código com teste/verificação; observações em uma linha.

**Ressalvas:** (1) nada de Docker pôde rodar no ambiente de desenvolvimento — compose validado só com `docker compose config`; backup/restore em containers, `volumes-init` e a substituição de `${ENV}` no Orthanc 1.12.11 devem ser conferidos no deploy. (2) Ações exclusivas do dono: trocar a senha do Neon (e reescrever histórico se o repo ficar público), agendar o cron de backup, gerar o certificado com o IP real, revisar `docs/screenshot/` (um print do portal mostra um nome de paciente). (3) Integrações externas (DATASUS, e-mail, SMS/WhatsApp) seguem fora de escopo.


## P0

- [x] **P0-1** · Check-in de consulta/teleconsulta dá erro 500 (enum inexistente) — enum `aguardando atendimento` adicionado ao schema (§21.1); teste de check-in de consulta.
- [x] **P0-2** · Check-in de consulta com "motivo" quebra (variável `enc` sombreada) — variável `enc` sombreada corrigida no `checkIn` reescrito; coberto por teste.
- [x] **P0-3** · Recepção não consegue cadastrar paciente (403) — recepção/enfermagem com `patients:create` (permissions.js + UI); teste na matriz de permissões.
- [x] **P0-4** · Buckets do RustFS nunca são criados → todo PDF/anexo falha — `ensureBuckets` com retry no boot + recria bucket em NoSuchBucket no upload; testes de storage.
- [x] **P0-5** · Credenciais do RustFS: variáveis do compose não existem no `.env.example` — chaves RustFS no `.env.example`/`setup.sh`; compose usa `:?` p/ falhar cedo.
- [x] **P0-6** · Exames enviados pelo equipamento (C-STORE) nunca entram no RIS — `dicomIngest.ingestOrthancStudy` + Lua `OnStableStudy` → webhook 202; varredura periódica; verificado com Orthanc 1.12.2 real (C-STORE→webhook).
- [x] **P0-7** · Webhook DICOM cria paciente "temporário" com CPF fixo → 2º falha — sem paciente temporário: casa por accession/MRN, senão vai p/ `pacs.unmatched_studies` (aba 'Estudos não vinculados', vincular/descartar).
- [x] **P0-8** · Limite de requisições derruba Painel TV, teleconsulta e portal — limiter por identidade, rotas de alto volume isentas, teto configurável (`RATE_LIMIT_MAX` etc.); teste de rate-limit.
- [x] **P0-9** · Instalação nova depende do dump (não versionado) ou do Neon — `scripts/setup.sh` (gera .env + cert) + `scripts/bootstrap.js` (admin + catálogos); schema aplicado no boot; seed dividido em catálogos/demo.
- [x] **P0-10** · `infra/tls/gen-cert.sh` não está no git — `infra/scripts/gen-cert.sh` versionado e chamado pelo setup.sh.
- [x] **P0-11** · Backup não salva as chaves e perde as imagens dependendo da pasta — backup cifrado inclui .env/chaves e volumes por nome fixo (`name: ris-pacs`); `restore-test.sh`. Caminho Docker não executável aqui — dono valida no deploy.

## P1

- [x] **P1-1** · Assinar laudo pela tela **Laudos** sempre falha (422) — payload de assinatura do laudo corrigido na ReportsPage; teste de laudos.
- [x] **P1-2** · Busca de paciente quebrada em Farmácia, Atendimento e Teleconsulta — busca de paciente (hash/blind index de nome) usada por Farmácia/Atendimento/Teleconsulta.
- [x] **P1-3** · Permissões da UI × backend desalinhadas (telas abrem e dão 403) — matriz única `PAGES`/`canAccessPage` + `granular_permissions` no login/UI; teste da matriz.
- [x] **P1-4** · Check-in exige CPF + senha do portal (paciente sem CPF não faz check-in) — check-in por CPF/CNS/documento sem senha do portal; portal opcional.
- [x] **P1-5** · Bloqueio por tentativas de senha no check-in nunca persiste — sem bloqueio por senha no check-in; limiter de login conta falhas por ip|identificador.
- [x] **P1-6** · Webhook do Orthanc sem autenticação, exposto pelo nginx — `ORTHANC_WEBHOOK_SECRET` obrigatório no webhook; nginx devolve 404 no caminho público.
- [x] **P1-7** · Worklist DICOM (MWL) não funciona e data/hora saem em UTC — MWL com data/hora local, nome DICOM, plugin Worklists habilitado e limpeza; verificado via C-FIND.
- [x] **P1-8** · Farmácia permite dispensar a mesma receita várias vezes — `assertDispensable` (quantidade prescrita, dispensa única) com override + justificativa; testes.
- [x] **P1-9** · Documento assinado fica sem PDF para sempre se a geração falhar — `documentPdf.ensurePdf` regenera sob demanda validando signature_hash; rota de PDF da evolução.
- [x] **P1-10** · Exclusão permanente de paciente falha e conflita com retenção legal — hard delete só sem vínculos clínicos; caso contrário anonimização (retenção legal); testes.
- [x] **P1-11** · Credencial do banco Neon vazada no repositório (GitHub) — credencial removida do código/docs, `.gitleaks.toml` + gitleaks no CI. **DONO:** trocar a senha do Neon e reescrever histórico se o repo for público.
- [x] **P1-12** · Médico pode ser agendado duas vezes no mesmo horário — checagem de conflito médico/horário com advisory lock; `allow_overbooking` explícito; teste.
- [x] **P1-13** · Funcionário não consegue trocar a própria senha — `POST /auth/change-password`, troca obrigatória no 1º acesso e página `/trocar_senha`; testes.
- [x] **P1-14** · Dependências com vulnerabilidades conhecidas — `npm audit` limpo no backend (puppeteer ^25); resíduo aceito no frontend (js-yaml/uuid via Cornerstone, sem correção upstream); CI falha só em critical.

## P2

- [x] **P2-1** · Build do frontend ignora erros de TypeScript (21 erros) — `tsc --noEmit` = 0 erros e build roda tsc; vite build OK.
- [x] **P2-2** · Uma linha que não decifra derruba a lista inteira (500) — `safeDecrypt` p/ listagens ('[ilegível]'), `decrypt` estrito em documentos assinados; canário da ENCRYPTION_KEY no boot.
- [x] **P2-3** · Busca de paciente por nome parcial só funciona com data de nascimento — índice de tokens de nome (HMAC blind index) com backfill; busca por nome parcial sem data.
- [x] **P2-4** · Logs: nada no `docker logs` e arquivos crescem sem limite — logger sempre no console; arquivos rotativos opcionais (`LOG_TO_FILE`/`LOG_DIR`); `x-logging` no compose.
- [x] **P2-5** · Auditoria "imutável" não é garantida no banco — triggers `audit.forbid_change` bloqueiam UPDATE/DELETE em `audit.logs`; teste.
- [x] **P2-6** · Teleconsulta: STUN do Google e uso fora da LAN — STUN do Google removido; `ICE_SERVERS` configurável e servido pela API; docs avisam LAN-only. Serviço coturn no compose NÃO adicionado.
- [x] **P2-7** · `GET /appointments/:id/status` dá 404 para consulta — `getStatus` com LEFT JOIN e rótulos clínicos.
- [x] **P2-8** · Bugs pequenos de API — itens da lista corrigidos (commit `fix(P2-7,P2-8)`); teste misc-fixes.
- [x] **P2-9** · Primeiro acesso / configuração inicial guiada — checklist de configuração inicial no AdminHome + bloqueio `UNIT_SETUP_INCOMPLETE` ao agendar em unidade incompleta.
- [x] **P2-10** · Documentação desatualizada / contraditória — README, implantação, plano-piloto, manuais e compose atualizados; compose legado do Orthanc removido; scripts legados em `scripts/legacy/`.
- [ ] **P2-11** · QA de usabilidade mobile e modais (humano, no deploy) — **HUMANO — NÃO FEITO:** QA visual mobile/modais no deploy.

## P3

- [x] **P3-1** · Testes automatizados reais + CI — jest com DB `_test` isolado, S3/Orthanc falsos; 20 suites/138 testes incl. fluxo clínico E2E; CI GitHub Actions (lint, testes, tsc, build, audit, compose, gitleaks).
- [x] **P3-2** · ESLint: 470 erros — ESLint backend 0 problemas; frontend 0 erros (~460 warnings restantes).
- [x] **P3-3** · Limpeza — limpeza feita (scripts legados, compose órfão, sw.js com cache versionado). Pendente: unificar zod v3/v4 (adiado); revisão de `docs/screenshot/` (dono).
