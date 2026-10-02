# Manual rápido — Médico

**Entrar:** `https://IP_DO_SERVIDOR` → **Acesso Médico** → CPF/usuário e senha.

## Atendimento clínico

**1. Fila / chamar próximo**
Menu **Atendimento** → veja a fila (triagem → aguardando médico → em atendimento).
**Chamar próximo** → informe a sala. O paciente aparece no **Painel TV**.

**2. Consulta**
Abra o atendimento (ou o **Prontuário** do paciente). Registre a **evolução (SOAP)**;
use **autotextos** e **CID-10** (busca). Confira o **cabeçalho clínico** (alergias,
problemas, banners de risco) no topo.

**3. Prescrição**
Aba **Prescrições** → nova receita. Digite o medicamento (autocomplete) — o sistema
mostra **alertas de alergia e interação** ao vivo. Escolha comum/controlada. **Assinar**
gera o PDF (e a numeração do receituário de controle, quando aplicável).

**4. Pedido de exames (SADT) e atestados**
Aba **Exames (SADT)** para solicitar; aba **Atestados** (CID obrigatório em afastamento).
Ambos geram documento assinado.

**5. Teleconsulta**
Menu **Teleconsulta** → buscar paciente → **Nova sala** → o paciente entra pelo
**portal** (banner “Entrar na sala”). Clique **Entrar** para iniciar o vídeo.
Precisa de câmera/microfone e do acesso por HTTPS.

**6. Concluir**
Ao concluir o atendimento, a evolução/receita são assinadas e o caso fecha.
A evolução assinada é **imutável** — correções viram **adendo**.

## Observações
- Laudo de imagem: se você também for radiologista, use **Laudos**.
- Senha esquecida: peça reset ao **administrador**.
