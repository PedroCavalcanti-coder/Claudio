-- =============================================================================
-- RIS/PACS — Seed de CATÁLOGOS (produção)
-- Versão: 4.0 — dados de referência necessários em QUALQUER instalação
-- Requer: 001_schema.sql previamente executado.
-- Idempotente: sim (ON CONFLICT com alvo explícito + WHERE NOT EXISTS).
--
-- Contém SOMENTE catálogos: procedimentos-base (TUSS), templates de laudo,
-- auto-textos, SLA, TCLE (LGPD) e CID-10. NÃO cria unidades, usuários, pacientes
-- nem senhas — o primeiro administrador nasce em `scripts/bootstrap.js` (senha
-- aleatória impressa uma única vez). Dados de demonstração: `seed_demo.sql`.
--
-- Atenção: o TCLE usa o contato `dpo@clinica.com.br` como exemplo — troque pelo
-- e-mail do encarregado (DPO) do município antes do uso real.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 3. PROCEDIMENTOS (TUSS)
-- ---------------------------------------------------------------------------

INSERT INTO ris.procedures
  (tuss_code, name, modality_type, duration_minutes,
   requires_fasting, requires_contrast, requires_referral, is_active)
VALUES
  ('4.03.04.01-2', 'Radiografia de Tórax (PA e Perfil)',               'CR', 15, FALSE, FALSE, FALSE, TRUE),
  ('4.06.01.02-0', 'Tomografia Computadorizada de Crânio',              'CT', 30, FALSE, FALSE, TRUE,  TRUE),
  ('4.08.01.01-3', 'Ultrassonografia Abdominal Total',                  'US', 30, TRUE,  FALSE, FALSE, TRUE),
  ('4.07.05.03-5', 'Ressonância Magnética de Joelho (com contraste)',   'MR', 45, FALSE, TRUE,  TRUE,  TRUE),
  ('4.02.01.01-0', 'Mamografia Digital Bilateral',                      'MG', 20, FALSE, FALSE, FALSE, TRUE)
ON CONFLICT (tuss_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. TEMPLATES DE LAUDO
-- ---------------------------------------------------------------------------

INSERT INTO ris.report_templates (name, modality_type, content_json, is_global)
SELECT name, modality_type::ris.modality_type, content_json::jsonb, is_global
FROM (VALUES
  ('Template Genérico CT', 'CT',
   '{"sections": [
     {"id": "technique",       "label": "Técnica",       "type": "text", "required": true},
     {"id": "findings",        "label": "Achados",       "type": "text", "required": true},
     {"id": "conclusion",      "label": "Conclusão",     "type": "text", "required": true},
     {"id": "recommendations", "label": "Recomendações", "type": "text", "required": false}
   ]}',
   TRUE),
  ('Template Genérico RX', 'DX',
   '{"sections": [
     {"id": "technique",  "label": "Técnica",   "type": "text", "required": true},
     {"id": "findings",   "label": "Achados",   "type": "text", "required": true},
     {"id": "conclusion", "label": "Conclusão", "type": "text", "required": true}
   ]}',
   TRUE)
) AS t(name, modality_type, content_json, is_global)
WHERE NOT EXISTS (
  SELECT 1 FROM ris.report_templates rt WHERE rt.name = t.name
);

-- ---------------------------------------------------------------------------
-- 5. AUTO-TEXTOS
-- ---------------------------------------------------------------------------

INSERT INTO ris.auto_texts (shortcut, title, content, modality_type, scope)
VALUES
  ('/normal_ct_torax', 'Tórax CT Normal',
   'Pulmões com expansibilidade normal, sem áreas de consolidação, derrame pleural ou pneumotórax. Mediastino centrado. Estruturas vasculares de calibre preservado. Não há linfadenopatias mediastinais ou hilares. Coração de dimensões normais.',
   'CT', 'global'),
  ('/normal_rx_torax', 'Tórax RX Normal',
   'Campos pulmonares sem opacidades. Seios costofrênicos livres. Mediastino sem alargamento. Área cardíaca dentro dos limites da normalidade.',
   'DX', 'global'),
  ('/normal_us_abdom', 'Abdome US Normal',
   'Fígado de dimensões e ecotextura normais, sem lesões focais. Vesícula biliar de paredes finas, sem cálculos. Vias biliares não dilatadas. Pâncreas com ecotextura homogênea. Baço de tamanho normal. Rins com diferenciação corticomedular preservada, sem litíase ou hidronefrose. Não há líquido livre na cavidade abdominal.',
   'US', 'global')
ON CONFLICT (shortcut, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. SLA PADRÃO
-- ---------------------------------------------------------------------------

INSERT INTO ris.sla_configs (priority, modality_type, report_hours, second_op_hours)
VALUES
  (0, NULL, 48, 96),
  (1, NULL, 12, 24),
  (2, NULL,  2,  4)
ON CONFLICT (priority, modality_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. TCLE PADRÃO (LGPD)
-- ---------------------------------------------------------------------------

INSERT INTO ris.consent_terms (version, title, content_html)
VALUES (
  '2024-01',
  'Termo de Consentimento Livre e Esclarecido — Tratamento de Dados de Saúde',
  '<h2>TCLE — Tratamento de Dados Pessoais Sensíveis de Saúde</h2>
  <p>Em conformidade com a <strong>Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018)</strong>, Art. 11, este termo formaliza seu consentimento para o tratamento de seus dados pessoais sensíveis de saúde.</p>
  <h3>1. Dados Coletados</h3>
  <p>Nome completo, CPF/CNS, data de nascimento, dados de contato, histórico de exames radiológicos, imagens médicas (DICOM) e laudos diagnósticos.</p>
  <h3>2. Finalidade</h3>
  <p>Realização de exames de imagem, emissão de laudos e cumprimento de obrigações legais no âmbito do SUS.</p>
  <h3>3. Compartilhamento</h3>
  <p>Seus dados poderão ser compartilhados com o médico solicitante e, quando exigido por lei, com autoridades competentes.</p>
  <h3>4. Armazenamento</h3>
  <p>As imagens e laudos são mantidos por no mínimo <strong>20 anos</strong>, conforme RDC 611/2022 da ANVISA e Resolução CFM nº 1.821/2007.</p>
  <h3>5. Seus Direitos</h3>
  <p>Você tem direito ao acesso, correção, portabilidade e eliminação dos seus dados, nos termos da LGPD.</p>
  <h3>6. Contato com o DPO</h3>
  <p>Dúvidas: <strong>dpo@clinica.com.br</strong></p>'
)
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. CID-10 — subconjunto representativo (diagnóstico por imagem)
-- ---------------------------------------------------------------------------

INSERT INTO ris.cid10 (code, description, category) VALUES
  ('A15.0', 'Tuberculose pulmonar, com confirmação por exame microscópico', 'Doenças infecciosas'),
  ('C34.9', 'Neoplasia maligna dos brônquios ou pulmão, não especificada', 'Neoplasias'),
  ('C50.9', 'Neoplasia maligna da mama, não especificada', 'Neoplasias'),
  ('C61',   'Neoplasia maligna da próstata', 'Neoplasias'),
  ('C71.9', 'Neoplasia maligna do encéfalo, não especificada', 'Neoplasias'),
  ('D24',   'Neoplasia benigna da mama', 'Neoplasias'),
  ('E66.9', 'Obesidade não especificada', 'Endócrinas/metabólicas'),
  ('I10',   'Hipertensão essencial (primária)', 'Aparelho circulatório'),
  ('I21.9', 'Infarto agudo do miocárdio não especificado', 'Aparelho circulatório'),
  ('I63.9', 'Infarto cerebral não especificado', 'Aparelho circulatório'),
  ('I64',   'Acidente vascular cerebral não especificado', 'Aparelho circulatório'),
  ('J18.9', 'Pneumonia não especificada', 'Aparelho respiratório'),
  ('J44.9', 'Doença pulmonar obstrutiva crônica não especificada', 'Aparelho respiratório'),
  ('J90',   'Derrame pleural não classificado em outra parte', 'Aparelho respiratório'),
  ('J93.9', 'Pneumotórax não especificado', 'Aparelho respiratório'),
  ('K35.8', 'Apendicite aguda, outra e não especificada', 'Aparelho digestivo'),
  ('K80.2', 'Calculose da vesícula biliar sem colecistite', 'Aparelho digestivo'),
  ('N20.0', 'Calculose do rim', 'Aparelho geniturinário'),
  ('N20.1', 'Calculose do ureter', 'Aparelho geniturinário'),
  ('M16.9', 'Coxartrose não especificada', 'Sistema osteomuscular'),
  ('M17.9', 'Gonartrose não especificada', 'Sistema osteomuscular'),
  ('M51.1', 'Transtornos de discos lombares com radiculopatia', 'Sistema osteomuscular'),
  ('M54.5', 'Dor lombar baixa', 'Sistema osteomuscular'),
  ('R07.4', 'Dor torácica não especificada', 'Sintomas e sinais'),
  ('R10.4', 'Dor abdominal, outra e não especificada', 'Sintomas e sinais'),
  ('R51',   'Cefaleia', 'Sintomas e sinais'),
  ('R91',   'Achados anormais de exame de imagem do pulmão', 'Sintomas e sinais'),
  ('R93.1', 'Achados anormais de exame de imagem do coração/circulação', 'Sintomas e sinais'),
  ('S06.0', 'Concussão cerebral', 'Traumatismos'),
  ('S22.0', 'Fratura de vértebra torácica', 'Traumatismos'),
  ('S32.0', 'Fratura de vértebra lombar', 'Traumatismos'),
  ('S42.0', 'Fratura da clavícula', 'Traumatismos'),
  ('S52.5', 'Fratura da extremidade distal do rádio', 'Traumatismos'),
  ('S72.0', 'Fratura do colo do fêmur', 'Traumatismos'),
  ('S82.6', 'Fratura do maléolo lateral', 'Traumatismos'),
  ('Z00.0', 'Exame médico geral', 'Fatores de saúde'),
  ('Z01.6', 'Exame radiológico não classificado em outra parte', 'Fatores de saúde')
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- FIM DO SEED DE CATÁLOGOS
-- =============================================================================
