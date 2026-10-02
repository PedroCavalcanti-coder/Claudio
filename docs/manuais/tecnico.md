# Manual rápido — Técnico (imagem)

**Entrar:** `https://IP_DO_SERVIDOR` → **Acesso Técnico** → usuário e senha.

## Tarefas

**1. Worklist do dia**
Menu **Worklist** → exames agendados/check-in do dia na sua unidade.

**2. Realizar o exame no equipamento**
O equipamento DICOM envia as imagens ao servidor (C-STORE, porta 4242) OU você
faz o upload manual (abaixo). Preencher os **Detalhes da realização**
(data/hora, médico executante, qualidade, intercorrências).

**3. Upload DICOM**
Menu **Upload DICOM** → identificar o **paciente** → escolher o **agendamento** →
selecionar os arquivos `.dcm` → enviar. Estudos grandes sobem em blocos; aguarde
a barra concluir. Depois, o exame aparece em **Estudos**.

**4. Conferir estudos**
Menu **Estudos** → abre o **visualizador (OrthoVis)** para checar as imagens.

**5. Procedimentos**
Menu **Procedimentos** → catálogo (código, modalidade, preparo). Ajustes de
catálogo normalmente com o administrador.

## Observações
- Se o upload “deu certo” mas não aparece em Estudos, confira se escolheu o
  agendamento certo do paciente.
- Cadastro rápido de paciente também é permitido ao técnico (Pacientes → Novo).
- Sinais vitais básicos podem ser registrados no prontuário quando necessário.
