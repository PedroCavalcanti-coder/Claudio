-- =============================================================================
-- RIS/PACS — Seed de DEMONSTRAÇÃO (apenas desenvolvimento / testes / treinamento)
-- Versão: 4.0
-- Requer: 001_schema.sql e seed_catalogos.sql previamente executados.
-- Idempotente: sim (ON CONFLICT com alvo explícito + WHERE NOT EXISTS).
--
-- !! NUNCA aplicar em produção !! Cria 3 unidades, ~30 usuários e 1 paciente com
-- senhas CONHECIDAS (abaixo). Em produção use `node scripts/bootstrap.js`.
--
-- Credenciais de demonstração:
--   | Portal             | Credenciais                                   | Role         |
--   |--------------------|-----------------------------------------------|--------------|
--   | Administrador      | admin@clinica.com.br / admin123456            | admin        |
--   | Radiologista       | radiologista@clinica.com.br / doctor123       | radiologist  |
--   | Médico Solicitante | solicitante@clinica.com.br / doctor123        | doctor       |
--   | Recepcionista      | recepcao / recep123                           | receptionist |
--   | Técnico            | tecnico / tec123                              | technician   |
--   | Enfermeiro         | enfermeiro / enf123                           | nurse        |
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
-- FIM DO SEED DE DEMONSTRAÇÃO
-- =============================================================================
