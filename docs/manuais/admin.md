# Manual rápido — Administrador

**Entrar:** `https://IP_DO_SERVIDOR` → **Acesso Administrador** → e-mail e senha.

## Configuração da rede

**1. Unidades**
Menu **Unidades** → cadastrar hospitais/postos/clínicas (nome, CNES, CNPJ, endereço).

**2. Equipe**
Menu **Equipe** → **Novo funcionário** (nome, e-mail, perfil, unidade, senha inicial,
CRM se médico) → marcar o **aceite dos Termos** → Criar.
- **Resetar senha**: botão **Senha** na linha → mostra senha temporária → entregue ao funcionário.
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
- **Rotacionar senhas de seed** no 1º dia (`scripts/rotate_seed_passwords.js`).
- **Certificado HTTPS**: renovar quando expirar (`infra/tls/gen-cert.sh` + `up -d frontend`).
- Sem e-mail/SMS/DataSUS no piloto — pendências externas em `docs/pendencias.md`.
