-- =============================================================================
-- RIS/PACS — Seed de Dados Iniciais
-- Versão: 3.0 (consolidado — apenas DADOS; a estrutura vive em 001_schema.sql)
-- Requer: 001_schema.sql previamente executado.
-- Idempotente: sim (ON CONFLICT com alvo explícito + WHERE NOT EXISTS).
--
-- Credenciais de teste (TROCAR EM PRODUÇÃO):
--   | Portal             | Credenciais                                   | Role         |
--   |--------------------|-----------------------------------------------|--------------|
--   | Administrador      | admin@clinica.com.br / admin123456            | admin        |
--   | Radiologista       | radiologista@clinica.com.br / doctor123       | radiologist  |
--   | Médico Solicitante | solicitante@clinica.com.br / doctor123        | doctor       |
--   | Recepcionista      | recepcao / recep123                           | receptionist |
--   | Técnico            | tecnico / tec123                              | technician   |
--   | Paciente (portal)  | CPF 11122233344 / paciente123                 | patient      |
--   | Equipe da rede     | <papel><n>.<unidade>@rede.local / senha123    | vários       |
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. UNIDADES DE SAÚDE (Principal + 2 da rede)
-- ---------------------------------------------------------------------------

INSERT INTO ris.health_units (name, type)
  SELECT 'Unidade Principal', 'clinic'
  WHERE NOT EXISTS (SELECT 1 FROM ris.health_units WHERE name = 'Unidade Principal');
INSERT INTO ris.health_units (name, type)
  SELECT 'UPA Centro', 'upa'
  WHERE NOT EXISTS (SELECT 1 FROM ris.health_units WHERE name = 'UPA Centro');
INSERT INTO ris.health_units (name, type)
  SELECT 'Hospital Regional', 'hospital'
  WHERE NOT EXISTS (SELECT 1 FROM ris.health_units WHERE name = 'Hospital Regional');

-- ---------------------------------------------------------------------------
-- 2. MODALIDADES DE EXEMPLO (genéricas)
-- ---------------------------------------------------------------------------

INSERT INTO ris.modalities (name, dicom_ae_title, modality_type, location)
VALUES
  ('Tomógrafo 1',            'CT_SALA1', 'CT', 'Sala 1'),
  ('Raio-X Digital 1',       'DX_SALA2', 'DX', 'Sala 2'),
  ('Ultrassom 1',            'US_SALA3', 'US', 'Sala 3'),
  ('Ressonância Magnética',  'MR_SALA4', 'MR', 'Sala 4')
ON CONFLICT (dicom_ae_title) DO NOTHING;

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

-- ---------------------------------------------------------------------------
-- 9. USUÁRIOS BASE + PACIENTE DE TESTE
-- ---------------------------------------------------------------------------

DO $$ DECLARE
  v_unit_id UUID;
BEGIN
  SELECT id INTO v_unit_id FROM ris.health_units WHERE name = 'Unidade Principal' LIMIT 1;
  IF v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Unidade Principal não encontrada. Execute 001_schema.sql e a seção 1 antes.';
  END IF;

  -- Admin
  INSERT INTO auth.users (name, email, password_hash, role, health_unit_id, is_active)
  VALUES (
    'Administrador do Sistema',
    'admin@clinica.com.br',
    crypt('admin123456', gen_salt('bf', 12)),
    'admin', NULL, TRUE
  )
  ON CONFLICT (email) DO UPDATE
    SET password_hash  = EXCLUDED.password_hash,
        health_unit_id = NULL,
        is_active      = TRUE,
        updated_at     = NOW();

  -- Radiologista
  INSERT INTO auth.users (
    name, username, email, password_hash, role,
    crm, crm_uf, specialty, cpf_hash,
    health_unit_id, is_active
  )
  VALUES (
    'Dr. Radiologista Teste', 'dr_radio',
    'radiologista@clinica.com.br',
    crypt('doctor123', gen_salt('bf', 12)),
    'radiologist', '123456', 'SP', 'Radiologia Geral',
    encode(digest('12345678901', 'sha256'), 'hex'),
    v_unit_id, TRUE
  )
  ON CONFLICT (email) DO UPDATE
    SET password_hash  = EXCLUDED.password_hash,
        cpf_hash       = EXCLUDED.cpf_hash,
        crm            = EXCLUDED.crm,
        crm_uf         = EXCLUDED.crm_uf,
        specialty      = EXCLUDED.specialty,
        health_unit_id = EXCLUDED.health_unit_id,
        is_active      = TRUE,
        updated_at     = NOW();

  -- Médico Solicitante
  INSERT INTO auth.users (
    name, username, email, password_hash, role,
    crm, crm_uf, specialty, cpf_hash,
    health_unit_id, is_active
  )
  VALUES (
    'Dr. Solicitante Teste', 'dr_solicitante',
    'solicitante@clinica.com.br',
    crypt('doctor123', gen_salt('bf', 12)),
    'doctor', '654321', 'SP', 'Cardiologia',
    encode(digest('98765432100', 'sha256'), 'hex'),
    v_unit_id, TRUE
  )
  ON CONFLICT (email) DO UPDATE
    SET password_hash  = EXCLUDED.password_hash,
        cpf_hash       = EXCLUDED.cpf_hash,
        crm            = EXCLUDED.crm,
        crm_uf         = EXCLUDED.crm_uf,
        specialty      = EXCLUDED.specialty,
        health_unit_id = EXCLUDED.health_unit_id,
        is_active      = TRUE,
        updated_at     = NOW();

  -- Recepcionista
  INSERT INTO auth.users (name, username, email, password_hash, role, health_unit_id, is_active)
  VALUES (
    'Recepcionista Teste', 'recepcao',
    'recepcao@clinica.com.br',
    crypt('recep123', gen_salt('bf', 12)),
    'receptionist', v_unit_id, TRUE
  )
  ON CONFLICT (username) DO UPDATE
    SET password_hash  = EXCLUDED.password_hash,
        email          = EXCLUDED.email,
        health_unit_id = EXCLUDED.health_unit_id,
        is_active      = TRUE,
        updated_at     = NOW();

  -- Técnico
  INSERT INTO auth.users (name, username, email, password_hash, role, health_unit_id, is_active)
  VALUES (
    'Técnico de Radiologia Teste', 'tecnico',
    'tecnico@clinica.com.br',
    crypt('tec123', gen_salt('bf', 12)),
    'technician', v_unit_id, TRUE
  )
  ON CONFLICT (username) DO UPDATE
    SET password_hash  = EXCLUDED.password_hash,
        email          = EXCLUDED.email,
        health_unit_id = EXCLUDED.health_unit_id,
        is_active      = TRUE,
        updated_at     = NOW();

  -- Enfermeiro (aplica medicação na unidade + medições)
  INSERT INTO auth.users (name, username, email, password_hash, role, health_unit_id, is_active)
  VALUES (
    'Enfermeiro Teste', 'enfermeiro',
    'enfermeiro@clinica.com.br',
    crypt('enf123', gen_salt('bf', 12)),
    'nurse', v_unit_id, TRUE
  )
  ON CONFLICT (username) DO UPDATE
    SET password_hash  = EXCLUDED.password_hash,
        email          = EXCLUDED.email,
        health_unit_id = EXCLUDED.health_unit_id,
        is_active      = TRUE,
        updated_at     = NOW();

  -- (Sem usuário de "acolhimento/triagem": a recepção faz o acolhimento e as
  --  medições da triagem com episode:manage + vitals:write — ver login_recepcao.)

  -- Paciente de teste (dados placeholder — não é PII real)
  WITH ins_patient AS (
    INSERT INTO ris.patients (
      name_encrypted, name_search_hash,
      birth_date, gender,
      cpf_encrypted, cpf_hash,
      medical_record_number,
      health_unit_id, is_active
    )
    VALUES (
      '\x50424b503416c3a1205465737465'::bytea,
      encode(digest('paciente teste', 'sha256'), 'hex'),
      '1985-06-15', 'M',
      '\x50424b503411223344'::bytea,
      encode(digest('11122233344', 'sha256'), 'hex'),
      'MR-0001000',
      v_unit_id, TRUE
    )
    ON CONFLICT (cpf_hash) DO UPDATE
      SET name_encrypted   = EXCLUDED.name_encrypted,
          name_search_hash = EXCLUDED.name_search_hash,
          birth_date       = EXCLUDED.birth_date,
          gender           = EXCLUDED.gender,
          health_unit_id   = EXCLUDED.health_unit_id,
          is_active        = TRUE,
          updated_at       = NOW()
    RETURNING id, cpf_hash
  )
  INSERT INTO ris.patient_portal_accounts (patient_id, cpf_hash, password_hash, is_active)
  SELECT
    id,
    cpf_hash,
    crypt('paciente123', gen_salt('bf', 12)),
    TRUE
  FROM ins_patient
  ON CONFLICT (patient_id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        is_active     = TRUE,
        updated_at    = NOW();
END $$;

-- ---------------------------------------------------------------------------
-- 10. EQUIPE DA REDE (2 de cada papel por unidade) + modalidades/sala por unidade
--     Senha padrão da equipe: senha123
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  uname  TEXT;
  uid    UUID;
  slug   TEXT;
  rkey   TEXT;
  i      INT;
  rlabel TEXT;
  crmv   TEXT;
  roles  TEXT[] := ARRAY['receptionist','technician','radiologist','doctor'];
  unames TEXT[] := ARRAY['Unidade Principal','UPA Centro','Hospital Regional'];
BEGIN
  FOREACH uname IN ARRAY unames LOOP
    SELECT id INTO uid FROM ris.health_units WHERE name = uname LIMIT 1;
    CONTINUE WHEN uid IS NULL;
    slug := regexp_replace(lower(uname), '[^a-z0-9]+', '', 'g');

    FOREACH rkey IN ARRAY roles LOOP
      rlabel := CASE rkey
        WHEN 'receptionist' THEN 'Recepção'
        WHEN 'technician'   THEN 'Técnico'
        WHEN 'radiologist'  THEN 'Radiologista'
        ELSE 'Médico' END;
      FOR i IN 1..2 LOOP
        IF rkey IN ('radiologist','doctor') THEN
          crmv := lpad((floor(random()*900000)+100000)::int::text, 6, '0');
          INSERT INTO auth.users (name, username, email, password_hash, role, crm, crm_uf, specialty, health_unit_id, is_active)
          VALUES (
            rlabel||' '||i||' — '||uname,
            rkey||i||'_'||slug,
            rkey||i||'.'||slug||'@rede.local',
            crypt('senha123', gen_salt('bf', 12)),
            rkey::auth.user_role, crmv, 'SP',
            CASE rkey WHEN 'radiologist' THEN 'Radiologia Geral' ELSE 'Clínica Geral' END,
            uid, TRUE
          )
          ON CONFLICT (email) DO UPDATE
            SET health_unit_id = EXCLUDED.health_unit_id, is_active = TRUE, updated_at = NOW();
        ELSE
          INSERT INTO auth.users (name, username, email, password_hash, role, health_unit_id, is_active)
          VALUES (
            rlabel||' '||i||' — '||uname,
            rkey||i||'_'||slug,
            rkey||i||'.'||slug||'@rede.local',
            crypt('senha123', gen_salt('bf', 12)),
            rkey::auth.user_role, uid, TRUE
          )
          ON CONFLICT (email) DO UPDATE
            SET health_unit_id = EXCLUDED.health_unit_id, is_active = TRUE, updated_at = NOW();
        END IF;
      END LOOP;
    END LOOP;

    -- Modalidades (raio-X + ultrassom) e uma sala por unidade
    INSERT INTO ris.modalities (name, dicom_ae_title, modality_type, location, health_unit_id, port)
      SELECT 'Raio-X — '||uname, 'DX_'||upper(substr(slug,1,8)), 'DX', uname, uid, 104
      WHERE NOT EXISTS (SELECT 1 FROM ris.modalities WHERE dicom_ae_title = 'DX_'||upper(substr(slug,1,8)));
    INSERT INTO ris.modalities (name, dicom_ae_title, modality_type, location, health_unit_id, port)
      SELECT 'Ultrassom — '||uname, 'US_'||upper(substr(slug,1,8)), 'US', uname, uid, 104
      WHERE NOT EXISTS (SELECT 1 FROM ris.modalities WHERE dicom_ae_title = 'US_'||upper(substr(slug,1,8)));
    INSERT INTO ris.rooms (name, health_unit_id)
      SELECT 'Sala 1 — '||uname, uid
      WHERE NOT EXISTS (SELECT 1 FROM ris.rooms WHERE name = 'Sala 1 — '||uname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 11. PROCEDIMENTOS POR UNIDADE — cada unidade oferece um subconjunto distinto
-- ---------------------------------------------------------------------------

DO $$
DECLARE up_principal UUID; up_upa UUID; up_hosp UUID;
BEGIN
  SELECT id INTO up_principal FROM ris.health_units WHERE name='Unidade Principal'  LIMIT 1;
  SELECT id INTO up_upa       FROM ris.health_units WHERE name='UPA Centro'         LIMIT 1;
  SELECT id INTO up_hosp      FROM ris.health_units WHERE name='Hospital Regional'  LIMIT 1;

  IF up_principal IS NOT NULL THEN
    INSERT INTO ris.unit_procedures (health_unit_id, procedure_id)
      SELECT up_principal, id FROM ris.procedures ON CONFLICT DO NOTHING;            -- todos
  END IF;
  IF up_upa IS NOT NULL THEN
    INSERT INTO ris.unit_procedures (health_unit_id, procedure_id)
      SELECT up_upa, id FROM ris.procedures WHERE modality_type IN ('CR','US') ON CONFLICT DO NOTHING;
  END IF;
  IF up_hosp IS NOT NULL THEN
    INSERT INTO ris.unit_procedures (health_unit_id, procedure_id)
      SELECT up_hosp, id FROM ris.procedures WHERE modality_type IN ('CT','CR','MG','US') ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- =============================================================================
-- FIM DO SEED
-- =============================================================================
