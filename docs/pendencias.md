# Pendências

Itens **em aberto** do projeto. Nenhum é resolvível só por código — dependem de
**credenciamento (DATASUS)**, **domínio/DNS** ou **credencial de provedor externo**.
Tudo que era resolvível por código já foi feito (backlog clínico concluído; histórico
nas READMEs e na memória do projeto).

Convenção: `[ ]` aberto · `[x]` feito.

> **2026-06-21** — migrações Neon §17–19 (farmácia/mensageria/teleconsulta) aplicadas
> + smoke transacional verde; backend e frontend rebuildados e no ar (5 containers
> healthy). Restam só os bloqueios externos abaixo.

---

## 1. DATASUS — sem acesso (credenciamento / homologação)

Não há acesso ao DATASUS. Cada item tem a **fatia local pronta**; falta a integração
externa autenticada.

- [ ] **CADSUS / CNS** — local: validação de dígito do CNS + campo CNS no cadastro/
  emergência. Falta: consulta on-line ao CADSUS (credencial DATASUS + certificado
  ICP-Brasil). Plugar em `patients.controller.js` (criação/merge).
- [ ] **SISREG** — local: encaminhamento entre unidades + contrarreferência. Falta:
  marcação de vaga regulada fora da rede (acesso credenciado SISREG III).
- [ ] **Faturamento BPA-MAG / APAC / TISS** — local: módulo `billing` com extrato de
  produção ambulatorial por competência + export CSV (BPA-C). Falta: arquivo
  BPA-MAG (largura fixa) e TISS XML — exigem a tabela **SIGTAP** (DATASUS) para
  mapear procedimento→código SUS + homologação no SIA. Plugar em `billing.controller.js`.
- [ ] **RENAME / REMUME oficial** — local: catálogo `ris.medications_catalog` com seed
  curado + autocomplete. Falta: CSV oficial RENAME (MS/CONITEC) + REMUME municipal e
  marcar os itens padronizados (coluna `rename_listed` + script de carga idempotente).
- [ ] **RNDS** — local: geração do Bundle FHIR R4 (RAC) por atendimento (`ehr.fhir.js`).
  Falta: transmissão autenticada à RNDS (certificado ICP-Brasil do estabelecimento +
  credenciamento DATASUS) — novo `services/rnds.js`.

## 2. E-mail ao paciente (Resend) — domínio não verificado

- [ ] Código OK (`services/email.js` dispara e loga erro; o boot avisa quando o
  domínio é gratuito). Causa: `EMAIL_FROM` usa domínio não verificado →
  Resend `403 domain not verified`. **Não é DATASUS.** Ação do dono da conta:
  verificar um domínio próprio em https://resend.com/domains e setar `EMAIL_FROM`
  (ou `onboarding@resend.dev` só para teste); reiniciar o backend.

## 3. SMS / WhatsApp — sem provedor

- [ ] Confirmação de agendamento é **gerada e enfileirada** (`ris.message_outbox`,
  destino cifrado; tela **Mensageria** com fila + reenvio + envio manual).
  **Não é DATASUS.** Falta credencial de provedor no `.env` do backend + implementar
  o SDK no ponto de extensão de `services/messaging.js` (`tryDeliver`):
  - SMS: `SMS_PROVIDER` (ex.: Twilio/Zenvia) + chave/token.
  - WhatsApp: `WHATSAPP_PROVIDER` (ex.: Meta Cloud API/Zenvia) + token.
  - Sem provedor, a mensagem fica `pending` — sem falso "enviado".

---

## QA em runtime (não bloqueia)

- [ ] Conferir no navegador as telas novas (**Farmácia**, **Teleconsulta**) e a
  responsividade mobile. Camada de dados (backend + Neon) já verificada por smoke
  transacional (ROLLBACK, sem poluir dados).
