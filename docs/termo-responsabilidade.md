# Termo de Responsabilidade e Tratamento de Dados (modelo)

> Documento **modelo** para o município adaptar com o setor jurídico e o
> Encarregado de Dados (DPO) antes do piloto. Preencher os campos entre colchetes.

## 1. Partes
- **Controlador dos dados:** Secretaria Municipal de Saúde de **[Município]**,
  CNPJ **[nº]**, responsável pelas decisões sobre o tratamento dos dados de saúde.
- **Operador / mantenedor do sistema:** **[responsável técnico/empresa]**, que opera
  o sistema RIS/PACS+PEP conforme as instruções do controlador.
- **Encarregado (DPO):** **[nome]** — contato: **[e-mail/telefone]**.

## 2. Base legal e finalidade (LGPD)
O tratamento de dados pessoais e **dados sensíveis de saúde** fundamenta-se na
**Lei nº 13.709/2018 (LGPD)**, art. 7º e art. 11 (tutela da saúde e execução de
políticas públicas). Finalidade: **prestar, documentar e gerir o atendimento** de
saúde na rede municipal. É vedado uso para finalidade diversa.

## 3. Medidas de segurança adotadas pelo sistema
- Criptografia de dados pessoais em repouso (AES-256-GCM).
- Controle de acesso por perfil (RBAC) e escopo por unidade; senha forte + bloqueio
  por tentativas.
- Comunicação por **HTTPS**; serviços internos não expostos à rede.
- **Auditoria** imutável de acessos e operações; acesso de emergência
  (“quebra de sigilo”) exige justificativa registrada.
- **Backup** diário local com teste de restauração.

## 4. Responsabilidades do controlador (município)
- Definir quem tem acesso e com qual perfil; revisar acessos periodicamente.
- Manter o servidor em ambiente físico e de rede controlado (LAN restrita).
- Guardar com segurança os segredos (chaves, senhas, backups).
- Atender aos direitos dos titulares (acesso, correção, portabilidade, informação).
- Comunicar incidentes de segurança relevantes à ANPD e aos titulares, quando exigido.

## 5. Responsabilidades dos usuários (profissionais)
- Acesso individual e intransferível; **não compartilhar** credenciais.
- Acessar apenas os dados necessários ao atendimento sob sua responsabilidade.
- Zelar pelo sigilo profissional e pela exatidão dos registros.

## 6. Direitos do titular (paciente)
Confirmação de tratamento, acesso, correção, portabilidade, informação sobre uso e
compartilhamento, nos termos da LGPD. Solicitações via unidade/DPO.

## 7. Limitações do piloto
Nesta fase **não há** integração com DataSUS/RNDS, envio de e-mail, SMS ou WhatsApp.
Confirmações são feitas por comprovante impresso e comunicação presencial.
O certificado HTTPS é auto-assinado (rede local) — aceitável para o piloto interno.

## 8. Vigência e aceite
Este termo vigora durante o piloto e deve ser revisto para a operação definitiva.

Local/Data: __________________________

Controlador (Secretaria de Saúde): __________________________

Operador/Responsável técnico: __________________________

Encarregado (DPO): __________________________
