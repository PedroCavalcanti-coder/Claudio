# Manual rápido — Administrador

**Entrar:** `https://IP_DO_SERVIDOR` → **Acesso Administrador** → e-mail e senha.

## Configuração da rede

**1. Unidades**
Menu **Unidades** → cadastrar hospitais/postos/clínicas (nome, CNES, CNPJ, endereço).

**2. Equipe**
Menu **Equipe** → **Novo funcionário** (nome, e-mail, perfil, unidade,
CRM se médico; perfis: médico, enfermagem, recepção, técnico, radiologista, admin) → marcar o **aceite dos Termos** → Criar.
- **Resetar senha**: botão **Senha** na linha → mostra senha temporária **uma única vez** → entregue ao funcionário (ele troca no 1º acesso).
- **Acessos adicionais**: um perfil pode acumular papéis (ex.: recepção + técnico).
- **Permissões finas**: ajuste por funcionário quando necessário.

**3. Gestão da unidade**
Em cada unidade: **turnos** (escala), **equipe do turno**, **janelas de atendimento**,
**feriados**, **procedimentos oferecidos** (com dias/horários), **modalidades/salas**.

**4. Auditoria**
Menu **Auditoria** → trilha imutável de acessos e operações (LGPD).

**5. Relatórios**
Menu **Relatórios** → produção, fila, absenteísmo (no-show) e **faturamento SUS**
(extrato por competência + CSV).

## Operação / manutenção
- **Backup**: conferir diariamente que o arquivo do dia existe (ver runbook de
  implantação). Testar restore periodicamente (`infra/backup/restore-test.sh`).
- **Checklist inicial**: a tela inicial do admin lista o que falta configurar (unidade, equipe, modalidades, procedimentos, turnos). Agendar fica bloqueado em unidade incompleta.
- **Estudos não vinculados** (Estudos → aba): imagens recebidas dos aparelhos sem agendamento correspondente.
- **Certificado HTTPS**: renovar quando expirar (`infra/scripts/gen-cert.sh` + `up -d frontend`).
- Sem e-mail/SMS/DataSUS no piloto — pendências externas em `docs/pendencias.md`.
