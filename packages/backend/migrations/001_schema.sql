-- =============================================================================
-- RIS/PACS — Schema Consolidado PostgreSQL 16
-- Versão: 3.0 (estado final — todas as migrations 001→019 dobradas)
-- Conformidade: LGPD · CFM 1.821/2007 · ANVISA · DICOM 3.0
-- Este arquivo CRIA toda a estrutura. Os DADOS ficam em 002_seed.sql.
-- Idempotente: sim (IF NOT EXISTS + OR REPLACE + DO/EXCEPTION).
--
-- Notas de consolidação:
--   * O módulo de faturamento (schema billing.*) foi removido — o sistema é
--     destinado ao SUS municipal, sem cobrança/convênio. Nenhuma coluna
--     insurance_* permanece.
--   * accession_number NÃO é único (o identificador real é study_instance_uid).
--   * CPF é opcional; o identificador universal é o CNS. Exige-se ao menos um.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSÕES
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ---------------------------------------------------------------------------
-- 1. SCHEMAS
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS ris;
CREATE SCHEMA IF NOT EXISTS pacs;
CREATE SCHEMA IF NOT EXISTS audit;

-- ---------------------------------------------------------------------------
-- 2. TIPOS ENUMERADOS
-- ---------------------------------------------------------------------------

-- Auth
DO $$ BEGIN
  CREATE TYPE auth.user_role AS ENUM (
    'admin', 'radiologist', 'technician', 'receptionist', 'doctor', 'patient', 'nurse'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RIS
DO $$ BEGIN
  CREATE TYPE ris.appointment_status AS ENUM (
    'scheduled', 'confirmed', 'checked_in', 'in_progress', 'done', 'cancelled', 'no_show'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ris.gender AS ENUM ('M', 'F', 'O');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ris.modality_type AS ENUM (
    'CR', 'DX', 'CT', 'MR', 'US', 'NM', 'PT', 'MG', 'RF', 'OT', 'SC', 'XA'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ris.report_status AS ENUM (
    'draft', 'review', 'signed', 'amended', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ris.exam_status_display AS ENUM (
    'scheduled', 'arrived', 'in_progress', 'processing',
    'in_report', 'second_opinion', 'completed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ris.second_opinion_reason AS ENUM (
    'technical_quality', 'diagnostic_doubt', 'complex_case', 'peer_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ris.second_opinion_status AS ENUM (
    'pending', 'under_review', 'patient_recalled', 'resolved', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ris.notification_channel AS ENUM ('email', 'sms', 'push', 'in_app');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ris.notification_status AS ENUM ('pending', 'sent', 'failed', 'read');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- Status de atendimento do paciente (não confundir com appointment_status)
  CREATE TYPE ris.patient_current_status AS ENUM (
    'registered', 'esperando o exame', 'in_exam', 'done'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ris.referral_status AS ENUM (
    'pending',     -- aguardando aceite na unidade/usuário destino
    'accepted',    -- aceito; paciente pode ser atendido lá
    'completed',   -- atendimento realizado (fecha o ciclo)
    'declined',    -- recusado pelo destino
    'cancelled'    -- cancelado pelo solicitante
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PACS
DO $$ BEGIN
  CREATE TYPE pacs.study_status AS ENUM (
    'pending', 'receiving', 'received', 'incomplete', 'complete', 'archived', 'deleted'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pacs.exam_quality AS ENUM ('adequate', 'limited', 'repeat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3. SCHEMA: auth
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth.users (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 VARCHAR(200)  NOT NULL,
  email                VARCHAR(254)  NOT NULL,
  password_hash        CHAR(60)      NOT NULL,
  role                 auth.user_role NOT NULL,
  crm                  VARCHAR(20),
  crm_uf               CHAR(2),
  specialty            VARCHAR(100),
  username             VARCHAR(50)   UNIQUE,
  cpf_hash             CHAR(64),
  health_unit_id       UUID,                          -- FK adicionada após ris.health_units
  is_active            BOOLEAN       NOT NULL DEFAULT TRUE,
  email_opt_out        BOOLEAN       NOT NULL DEFAULT FALSE,
  is_network_resource  BOOLEAN       NOT NULL DEFAULT FALSE,
  shared_specialties   TEXT[]        NOT NULL DEFAULT '{}',
  extra_roles          TEXT[]        NOT NULL DEFAULT '{}',
  permission_overrides JSONB         NOT NULL DEFAULT '{"granted":[],"revoked":[]}'::jsonb,
  mfa_secret           TEXT,
  mfa_enabled          BOOLEAN       NOT NULL DEFAULT FALSE,
  failed_attempts      SMALLINT      NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  last_login_ip        INET,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_users_email UNIQUE (email),
  CONSTRAINT chk_crm_required CHECK (
    role NOT IN ('radiologist', 'doctor') OR crm IS NOT NULL
  )
);

COMMENT ON TABLE  auth.users                      IS 'Usuários do sistema RIS/PACS';
COMMENT ON COLUMN auth.users.password_hash        IS 'Bcrypt hash com custo 12';
COMMENT ON COLUMN auth.users.mfa_secret           IS 'Segredo TOTP — armazenar criptografado';
COMMENT ON COLUMN auth.users.is_network_resource  IS 'TRUE = recurso compartilhado da rede; atende pacientes de qualquer unidade sem referral.';
COMMENT ON COLUMN auth.users.shared_specialties   IS 'Especialidades em que o usuário atua como recurso de rede.';
COMMENT ON COLUMN auth.users.extra_roles          IS 'Papéis adicionais (perfil customizado por composição). authorize() aceita role-base + extra_roles.';
COMMENT ON COLUMN auth.users.permission_overrides IS 'RBAC granular: {granted:[],revoked:[]} de permissões resource:action além do papel-base.';

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   CHAR(64)    NOT NULL,
  device_info  JSONB,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_token_hash UNIQUE (token_hash)
);

CREATE TABLE IF NOT EXISTS auth.password_reset_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash  CHAR(64)    NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. SCHEMA: ris
-- ---------------------------------------------------------------------------

-- 4.1 Unidades de Saúde (tenants) ---------------------------------------------

CREATE TABLE IF NOT EXISTS ris.health_units (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(200) NOT NULL,
  cnpj        VARCHAR(18)  UNIQUE,
  cnes        VARCHAR(7),
  type        VARCHAR(30)  NOT NULL DEFAULT 'clinic',
  address     JSONB,
  phone       VARCHAR(20),
  email       VARCHAR(254),
  logo_url    TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Unicidade de nome case/espaço-insensível (colapsa espaços internos).
CREATE UNIQUE INDEX IF NOT EXISTS uq_health_units_name_ci
  ON ris.health_units (lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))));

-- Agora que health_units existe, adicionar FK em auth.users
DO $$ BEGIN
  ALTER TABLE auth.users
    ADD CONSTRAINT fk_users_health_unit
    FOREIGN KEY (health_unit_id) REFERENCES ris.health_units(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4.2 Pacientes ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.patients (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name_encrypted        BYTEA         NOT NULL,
  name_search_hash      CHAR(64)      NOT NULL,
  birth_date            DATE          NOT NULL,
  gender                ris.gender,
  cpf_encrypted         BYTEA,                        -- opcional (SUS): ver chk_patient_identifier
  cpf_hash              CHAR(64),
  cns_encrypted         BYTEA,                        -- Cartão Nacional de Saúde (PII)
  cns_hash              CHAR(64),
  rg_encrypted          BYTEA,
  phone_encrypted       BYTEA,
  email_encrypted       BYTEA,
  address               JSONB,
  medical_record_number VARCHAR(20)   NOT NULL,
  blood_type            VARCHAR(3),
  allergies             TEXT,
  notes                 TEXT,
  current_status        ris.patient_current_status NOT NULL DEFAULT 'registered',
  health_unit_id        UUID          REFERENCES ris.health_units(id) ON DELETE SET NULL,
  is_active             BOOLEAN       NOT NULL DEFAULT TRUE,
  deactivated_at        TIMESTAMPTZ,
  created_by            UUID          REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_patient_cpf_hash UNIQUE (cpf_hash),
  CONSTRAINT uq_medical_record   UNIQUE (medical_record_number),
  CONSTRAINT chk_patient_identifier CHECK (cpf_hash IS NOT NULL OR cns_hash IS NOT NULL)
);

COMMENT ON COLUMN ris.patients.name_encrypted   IS 'Nome completo — AES-256-GCM (LGPD)';
COMMENT ON COLUMN ris.patients.cpf_encrypted    IS 'CPF (opcional) — AES-256-GCM (LGPD)';
COMMENT ON COLUMN ris.patients.cns_encrypted    IS 'CNS (Cartão Nacional de Saúde) — AES-256-GCM (LGPD)';
COMMENT ON COLUMN ris.patients.name_search_hash IS 'Hash SHA-256 do nome normalizado para busca';
COMMENT ON COLUMN ris.patients.cpf_hash         IS 'Hash SHA-256 do CPF para busca/unicidade';
COMMENT ON COLUMN ris.patients.cns_hash         IS 'Hash SHA-256 do CNS para busca/unicidade';
COMMENT ON COLUMN ris.patients.current_status   IS 'Status de atendimento atual (registered, esperando o exame, in_exam)';
COMMENT ON COLUMN ris.patients.deactivated_at   IS 'Quando o paciente foi inativado. NULL = ativo. Exclusão definitiva é manual via admin.';

-- 4.3 Modalidades / equipamentos ----------------------------------------------

CREATE TABLE IF NOT EXISTS ris.modalities (
  id              UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(150)      NOT NULL,
  dicom_ae_title  VARCHAR(16)       NOT NULL,
  modality_type   ris.modality_type NOT NULL,
  manufacturer    VARCHAR(100),
  model           VARCHAR(100),
  location        VARCHAR(100),
  ip_address      INET,
  port            INTEGER           NOT NULL DEFAULT 104,
  health_unit_id  UUID              REFERENCES ris.health_units(id) ON DELETE SET NULL,
  is_active       BOOLEAN           NOT NULL DEFAULT TRUE,
  notes           TEXT,
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_dicom_ae_title UNIQUE (dicom_ae_title),
  CONSTRAINT chk_port_range CHECK (port BETWEEN 1 AND 65535)
);

-- 4.4 Salas -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.rooms (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  modality_id     UUID         REFERENCES ris.modalities(id),
  health_unit_id  UUID         REFERENCES ris.health_units(id) ON DELETE SET NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 4.5 Procedimentos (TUSS/CBHPM) ----------------------------------------------

CREATE TABLE IF NOT EXISTS ris.procedures (
  id                       UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  tuss_code                VARCHAR(20)       NOT NULL,
  cbhpm_code               VARCHAR(10),
  name                     VARCHAR(300)      NOT NULL,
  name_abbrev              VARCHAR(100),
  modality_type            ris.modality_type,
  body_part                VARCHAR(100),
  duration_minutes         INTEGER           NOT NULL DEFAULT 30,
  requires_fasting         BOOLEAN           NOT NULL DEFAULT FALSE,
  fasting_hours            SMALLINT,
  requires_contrast        BOOLEAN           NOT NULL DEFAULT FALSE,
  requires_referral        BOOLEAN           NOT NULL DEFAULT FALSE,
  preparation_instructions TEXT,
  is_active                BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tuss_code UNIQUE (tuss_code)
);

-- 4.6 Procedimentos oferecidos por unidade (+ janela por procedimento) --------

CREATE TABLE IF NOT EXISTS ris.unit_procedures (
  health_unit_id UUID NOT NULL REFERENCES ris.health_units(id) ON DELETE CASCADE,
  procedure_id   UUID NOT NULL REFERENCES ris.procedures(id)   ON DELETE CASCADE,
  weekdays       SMALLINT[]  NOT NULL DEFAULT '{}',  -- 0=domingo … 6=sábado; {} = todos
  start_time     TIME,                               -- NULL = sem limite inferior
  end_time       TIME,                               -- NULL = sem limite superior
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (health_unit_id, procedure_id)
);

COMMENT ON TABLE  ris.unit_procedures            IS 'Procedimentos oferecidos por unidade. Se a unidade tem linhas, só esses são oferecidos; sem linhas = todos (retrocompat).';
COMMENT ON COLUMN ris.unit_procedures.weekdays   IS 'Dias da semana (0-6) em que o procedimento é realizado na unidade. {} = todos os dias.';
COMMENT ON COLUMN ris.unit_procedures.start_time IS 'Início da janela do procedimento (NULL = sem limite).';
COMMENT ON COLUMN ris.unit_procedures.end_time   IS 'Fim da janela do procedimento (NULL = sem limite).';

-- 4.7 Médicos Solicitantes Externos -------------------------------------------

CREATE TABLE IF NOT EXISTS ris.external_physicians (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(200) NOT NULL,
  crm           VARCHAR(20)  NOT NULL,
  crm_uf        CHAR(2)      NOT NULL,
  specialty     VARCHAR(100),
  phone         VARCHAR(20),
  email         VARCHAR(254),
  email_opt_out BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_external_crm UNIQUE (crm, crm_uf)
);

-- 4.8 Agendamentos ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.appointments (
  id                       UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id               UUID                    NOT NULL REFERENCES ris.patients(id),
  procedure_id             UUID                    NOT NULL REFERENCES ris.procedures(id),
  modality_id              UUID                    REFERENCES ris.modalities(id),
  room_id                  UUID                    REFERENCES ris.rooms(id),
  requesting_user_id       UUID                    REFERENCES auth.users(id),
  requesting_physician_id  UUID                    REFERENCES ris.external_physicians(id),
  scheduled_at             TIMESTAMPTZ             NOT NULL,
  duration_minutes         INTEGER                 NOT NULL DEFAULT 30,
  status                   ris.appointment_status  NOT NULL DEFAULT 'scheduled',
  priority                 SMALLINT                NOT NULL DEFAULT 0,
  clinical_indication      TEXT,
  preparation_confirmed    BOOLEAN                 NOT NULL DEFAULT FALSE,
  notes                    TEXT,
  portal_access_granted    BOOLEAN                 NOT NULL DEFAULT FALSE,
  health_unit_id           UUID                    REFERENCES ris.health_units(id) ON DELETE SET NULL,
  checked_in_at            TIMESTAMPTZ,
  checked_in_by            UUID                    REFERENCES auth.users(id),
  cancelled_at             TIMESTAMPTZ,
  cancelled_by             UUID                    REFERENCES auth.users(id),
  cancellation_reason      TEXT,
  created_by               UUID                    REFERENCES auth.users(id),
  created_at               TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_requesting CHECK (
    requesting_user_id IS NOT NULL OR requesting_physician_id IS NOT NULL
  )
);

-- 4.9 Lembretes de Agendamento ------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.appointment_reminders (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  UUID        NOT NULL REFERENCES ris.appointments(id) ON DELETE CASCADE,
  channel         VARCHAR(10) NOT NULL CHECK (channel IN ('sms', 'email', 'whatsapp')),
  sent_at         TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  response_code   VARCHAR(50),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4.10 Encaminhamentos entre unidades (referência/contrarreferência) ----------

CREATE TABLE IF NOT EXISTS ris.referrals (
  id              UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID                  NOT NULL REFERENCES ris.patients(id)      ON DELETE CASCADE,
  from_unit_id    UUID                  NOT NULL REFERENCES ris.health_units(id),
  to_unit_id      UUID                  NOT NULL REFERENCES ris.health_units(id),
  to_user_id      UUID                  REFERENCES auth.users(id) ON DELETE SET NULL,
  specialty       VARCHAR(100),
  reason          TEXT                  NOT NULL,
  status          ris.referral_status   NOT NULL DEFAULT 'pending',
  decided_at      TIMESTAMPTZ,
  decided_by      UUID                  REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_notes  TEXT,
  created_by      UUID                  NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_referral_units_different CHECK (from_unit_id <> to_unit_id)
);

COMMENT ON TABLE ris.referrals IS
  'Encaminhamento formal de paciente entre unidades. Sem um referral aceito (ou is_network_resource), médico fora da unidade do paciente não pode atendê-lo.';

-- Contrarreferência: resposta clínica do destino fechando o ciclo (status='completed').
ALTER TABLE ris.referrals
  ADD COLUMN IF NOT EXISTS counter_reference   TEXT,
  ADD COLUMN IF NOT EXISTS counter_referred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS counter_referred_by UUID REFERENCES auth.users(id);

-- 4.11 Disponibilidade de agendamento + feriados ------------------------------

CREATE TABLE IF NOT EXISTS ris.availability_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_unit_id UUID NOT NULL REFERENCES ris.health_units(id) ON DELETE CASCADE,
  modality_id    UUID REFERENCES ris.modalities(id) ON DELETE CASCADE,  -- NULL = unidade inteira
  weekday        SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),     -- 0=domingo … 6=sábado
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  slot_minutes   INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 240),
  capacity       INTEGER NOT NULL DEFAULT 1  CHECK (capacity >= 1),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT availability_rules_time_chk CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS ris.holidays (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_unit_id UUID REFERENCES ris.health_units(id) ON DELETE CASCADE,  -- NULL = global
  holiday_date   DATE NOT NULL,
  description    VARCHAR(160) NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ris.availability_rules IS
  'Disponibilidade de agendamento: janelas por dia da semana + capacidade. modality_id NULL = unidade inteira.';
COMMENT ON TABLE ris.holidays IS
  'Dias sem atendimento. health_unit_id NULL = feriado global.';

-- 4.12 Turnos de trabalho por unidade + atribuição de equipe ------------------

CREATE TABLE IF NOT EXISTS ris.shifts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_unit_id UUID NOT NULL REFERENCES ris.health_units(id) ON DELETE CASCADE,
  name           VARCHAR(80) NOT NULL,
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ris.user_shifts (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_id   UUID NOT NULL REFERENCES ris.shifts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, shift_id)
);

COMMENT ON TABLE ris.shifts      IS 'Turnos de trabalho nomeados por unidade. Horários livres, definidos pelo gestor.';
COMMENT ON TABLE ris.user_shifts IS 'Atribuição de funcionários a turnos da sua unidade.';

-- 4.13 Catálogo CID-10 --------------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.cid10 (
  code        VARCHAR(10) PRIMARY KEY,
  description TEXT        NOT NULL,
  category    VARCHAR(120)
);

-- ---------------------------------------------------------------------------
-- 5. SCHEMA: pacs
-- ---------------------------------------------------------------------------

-- 5.1 Estudos DICOM -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS pacs.studies (
  id                        UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id            UUID                    REFERENCES ris.appointments(id),
  patient_id                UUID                    NOT NULL REFERENCES ris.patients(id),
  study_instance_uid        VARCHAR(64)             NOT NULL,
  accession_number          VARCHAR(16)             NOT NULL,   -- NÃO único (ver 010): study_instance_uid é o id real
  study_date                DATE                    NOT NULL,
  study_time                TIME                    NOT NULL,
  modality_type             ris.modality_type,
  study_description         VARCHAR(200),
  referring_physician_name  VARCHAR(200),
  number_of_series          INTEGER                 NOT NULL DEFAULT 0,
  number_of_instances       INTEGER                 NOT NULL DEFAULT 0,
  size_bytes                BIGINT                  NOT NULL DEFAULT 0,
  storage_prefix            TEXT,
  status                    pacs.study_status       NOT NULL DEFAULT 'pending',
  display_status            ris.exam_status_display NOT NULL DEFAULT 'processing',
  received_at               TIMESTAMPTZ,
  upload_completed_at       TIMESTAMPTZ,
  -- contexto da realização (capturado no upload)
  equipment_id              UUID                    REFERENCES ris.modalities(id) ON DELETE SET NULL,
  room_id                   UUID                    REFERENCES ris.rooms(id)      ON DELETE SET NULL,
  technician_user_id        UUID                    REFERENCES auth.users(id)     ON DELETE SET NULL,
  performing_physician      VARCHAR(160),
  exam_quality              pacs.exam_quality,
  operator_notes            TEXT,
  health_unit_id            UUID                    REFERENCES ris.health_units(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_study_instance_uid UNIQUE (study_instance_uid)
);

COMMENT ON COLUMN pacs.studies.storage_prefix       IS 'Prefixo do objeto no storage: pacs-dicom/{study_uid}/';
COMMENT ON COLUMN pacs.studies.performing_physician IS 'Médico executor/responsável pela realização do exame.';
COMMENT ON COLUMN pacs.studies.exam_quality         IS 'Avaliação técnica do exame realizado: adequate | limited | repeat.';
COMMENT ON COLUMN pacs.studies.operator_notes       IS 'Complicações/intercorrências e observações livres do operador.';

-- 5.2 Séries ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pacs.series (
  id                   UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id             UUID              NOT NULL REFERENCES pacs.studies(id) ON DELETE CASCADE,
  series_instance_uid  VARCHAR(64)       NOT NULL,
  series_number        INTEGER,
  modality             ris.modality_type,
  series_description   VARCHAR(200),
  body_part_examined   VARCHAR(100),
  protocol_name        VARCHAR(100),
  series_date          DATE,
  series_time          TIME,
  number_of_instances  INTEGER           NOT NULL DEFAULT 0,
  size_bytes           BIGINT            NOT NULL DEFAULT 0,
  thumbnail_key        TEXT,
  created_at           TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_series_instance_uid UNIQUE (series_instance_uid)
);

-- 5.3 Instâncias (imagens individuais) ----------------------------------------

CREATE TABLE IF NOT EXISTS pacs.instances (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id           UUID        NOT NULL REFERENCES pacs.series(id) ON DELETE CASCADE,
  study_id            UUID        NOT NULL REFERENCES pacs.studies(id) ON DELETE CASCADE,
  sop_instance_uid    VARCHAR(64) NOT NULL,
  sop_class_uid       VARCHAR(64),
  instance_number     INTEGER,
  storage_key         TEXT        NOT NULL,
  file_size_bytes     BIGINT      NOT NULL DEFAULT 0,
  transfer_syntax_uid VARCHAR(64),
  columns             INTEGER,
  rows                INTEGER,
  number_of_frames    INTEGER     NOT NULL DEFAULT 1,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sop_instance_uid UNIQUE (sop_instance_uid)
);

-- 5.4 Anotações do Viewer -----------------------------------------------------

CREATE TABLE IF NOT EXISTS pacs.annotations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id         UUID        NOT NULL REFERENCES pacs.studies(id) ON DELETE CASCADE,
  series_id        UUID        REFERENCES pacs.series(id),
  instance_id      UUID        REFERENCES pacs.instances(id),
  user_id          UUID        NOT NULL REFERENCES auth.users(id),
  tool_type        VARCHAR(50) NOT NULL,
  annotation_data  JSONB       NOT NULL,
  is_visible       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5.5 Notas clínicas de exame (referencia pacs.studies) -----------------------

CREATE TABLE IF NOT EXISTS ris.exam_notes (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id    UUID         NOT NULL REFERENCES pacs.studies(id) ON DELETE CASCADE,
  user_id     UUID                  REFERENCES auth.users(id) ON DELETE SET NULL,
  title       VARCHAR(200),
  content     TEXT         NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  ris.exam_notes       IS 'Notas clínicas persistidas do radiologista durante a análise do estudo (separado de ris.reports).';
COMMENT ON COLUMN ris.exam_notes.title IS 'Título opcional. Se vazio, frontend exibe primeira linha.';

-- ---------------------------------------------------------------------------
-- 6. LAUDOS (ris.reports) — requer pacs.studies
-- ---------------------------------------------------------------------------

-- 6.1 Templates de Laudo ------------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.report_templates (
  id             UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(200)      NOT NULL,
  modality_type  ris.modality_type,
  procedure_id   UUID              REFERENCES ris.procedures(id),
  body_part      VARCHAR(100),
  content_json   JSONB             NOT NULL,
  is_global      BOOLEAN           NOT NULL DEFAULT TRUE,
  created_by     UUID              REFERENCES auth.users(id),
  is_active      BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- 6.2 Auto-textos (macros) ----------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.auto_texts (
  id             UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  shortcut       VARCHAR(30)       NOT NULL,
  title          VARCHAR(200)      NOT NULL,
  content        TEXT              NOT NULL,
  modality_type  ris.modality_type,
  scope          VARCHAR(10)       NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'user')),
  user_id        UUID              REFERENCES auth.users(id),
  is_active      BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_autotext_shortcut_user UNIQUE NULLS NOT DISTINCT (shortcut, user_id)
);

-- 6.3 Laudos ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.reports (
  id                      UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id                UUID               NOT NULL REFERENCES pacs.studies(id),
  appointment_id          UUID               REFERENCES ris.appointments(id),
  radiologist_id          UUID               NOT NULL REFERENCES auth.users(id),
  template_id             UUID               REFERENCES ris.report_templates(id),
  status                  ris.report_status  NOT NULL DEFAULT 'draft',
  content_json            JSONB,
  content_html            TEXT,
  technique               TEXT,
  findings                TEXT,
  conclusion              TEXT,
  recommendations         TEXT,
  report_simple           TEXT,
  cid10_codes             JSONB              NOT NULL DEFAULT '[]'::jsonb,
  signed_at               TIMESTAMPTZ,
  signature_hash          CHAR(64),
  signature_jwt           TEXT,
  signature_algorithm     VARCHAR(20),
  digital_certificate_sn  VARCHAR(100),
  digital_certificate_cn  VARCHAR(200),
  pdf_storage_key         TEXT,
  pdf_size_bytes          INTEGER,
  share_token             UUID               DEFAULT gen_random_uuid(),
  share_expires_at        TIMESTAMPTZ        DEFAULT (NOW() + INTERVAL '90 days'),
  created_at              TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_share_token UNIQUE (share_token)
);

COMMENT ON COLUMN ris.reports.signature_hash      IS 'Hash SHA-256 do content_html no momento da assinatura — verificação de integridade.';
COMMENT ON COLUMN ris.reports.signature_jwt       IS 'JWT RS256 assinado no momento da assinatura. Payload: { reportId, radiologistId, hash, signedAt, iss, iat }.';
COMMENT ON COLUMN ris.reports.signature_algorithm IS 'Algoritmo usado: RS256 (atual). ICP-Brasil A1/A3 futuro.';

-- 6.4 Histórico de versões do laudo -------------------------------------------

CREATE TABLE IF NOT EXISTS ris.report_versions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID        NOT NULL REFERENCES ris.reports(id) ON DELETE CASCADE,
  version       SMALLINT    NOT NULL,
  content_json  JSONB,
  content_html  TEXT,
  changed_by    UUID        REFERENCES auth.users(id),
  change_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 7. FLUXO LGPD / WORKFLOW
-- ---------------------------------------------------------------------------

-- 7.1 TCLE --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.consent_terms (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  version      VARCHAR(10)  NOT NULL UNIQUE,
  title        VARCHAR(200) NOT NULL,
  content_html TEXT         NOT NULL,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ris.patient_consents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID        NOT NULL REFERENCES ris.patients(id),
  term_id          UUID        NOT NULL REFERENCES ris.consent_terms(id),
  appointment_id   UUID        REFERENCES ris.appointments(id),
  signed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_by_cpf    CHAR(64),
  ip_address       INET,
  user_agent       TEXT,
  method           VARCHAR(20) NOT NULL DEFAULT 'digital',
  signature_data   TEXT,
  witness_user_id  UUID        REFERENCES auth.users(id),
  revoked_at       TIMESTAMPTZ,
  revoked_by       UUID        REFERENCES auth.users(id),
  CONSTRAINT uq_patient_consent_term UNIQUE (patient_id, term_id)
);

-- 7.2 Portal do Paciente ------------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.patient_portal_accounts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID        NOT NULL UNIQUE REFERENCES ris.patients(id),
  cpf_hash        CHAR(64)    NOT NULL UNIQUE,
  password_hash   CHAR(60)    NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  email_opt_out   BOOLEAN     NOT NULL DEFAULT FALSE,
  failed_attempts SMALLINT    NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  last_login_ip   INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7.3 Segunda Opinião ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.second_opinions (
  id                    UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id              UUID                      NOT NULL REFERENCES pacs.studies(id),
  report_id             UUID                      REFERENCES ris.reports(id),
  requesting_user_id    UUID                      NOT NULL REFERENCES auth.users(id),
  reason                ris.second_opinion_reason NOT NULL,
  description           TEXT                      NOT NULL,
  status                ris.second_opinion_status NOT NULL DEFAULT 'pending',
  resolution            TEXT,
  joint_report          BOOLEAN                   NOT NULL DEFAULT FALSE,
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID                      REFERENCES auth.users(id),
  sla_deadline          TIMESTAMPTZ,
  patient_notified_at   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ               NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ris.second_opinion_reviewers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  second_opinion_id UUID        NOT NULL REFERENCES ris.second_opinions(id) ON DELETE CASCADE,
  reviewer_id       UUID        NOT NULL REFERENCES auth.users(id),
  opinion_text      TEXT,
  opinion_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_reviewer_opinion UNIQUE (second_opinion_id, reviewer_id)
);

-- 7.4 SLA Configs -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.sla_configs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  priority         INTEGER     NOT NULL,
  modality_type    VARCHAR(10),
  report_hours     INTEGER     NOT NULL,
  second_op_hours  INTEGER     NOT NULL DEFAULT 48,
  alert_at_percent INTEGER     NOT NULL DEFAULT 80,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sla_priority_modality UNIQUE NULLS NOT DISTINCT (priority, modality_type)
);

-- 7.5 Notificações de Staff ---------------------------------------------------

CREATE TABLE IF NOT EXISTS ris.notifications (
  id                        UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID                     REFERENCES auth.users(id),
  portal_account_id         UUID                     REFERENCES ris.patient_portal_accounts(id),
  type                      VARCHAR(50)              NOT NULL,
  title                     VARCHAR(200)             NOT NULL,
  body                      TEXT                     NOT NULL,
  resource_type             VARCHAR(50),
  resource_id               UUID,
  channel                   ris.notification_channel NOT NULL DEFAULT 'in_app',
  status                    ris.notification_status  NOT NULL DEFAULT 'pending',
  recipient_email_encrypted BYTEA,
  retry_count               SMALLINT                 NOT NULL DEFAULT 0,
  next_retry_at             TIMESTAMPTZ,
  provider_message_id       VARCHAR(100),
  sent_at                   TIMESTAMPTZ,
  read_at                   TIMESTAMPTZ,
  error_message             TEXT,
  created_at                TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN ris.notifications.recipient_email_encrypted IS 'Email do destinatário criptografado AES-256-GCM (sem portal_account ou médico externo).';
COMMENT ON COLUMN ris.notifications.retry_count               IS 'Quantas vezes o worker tentou enviar (0 a 3).';
COMMENT ON COLUMN ris.notifications.next_retry_at             IS 'Quando o worker pode tentar de novo. NULL = imediato.';
COMMENT ON COLUMN ris.notifications.provider_message_id       IS 'ID retornado pelo provedor (Resend) para tracking externo.';

-- 7.6 Notificações de Pacientes (Portal) --------------------------------------

CREATE TABLE IF NOT EXISTS ris.patient_notifications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID        NOT NULL REFERENCES ris.patients(id) ON DELETE CASCADE,
  type          VARCHAR(50) NOT NULL,
  title         VARCHAR(200) NOT NULL,
  body          TEXT,
  resource_type VARCHAR(50),
  resource_id   UUID,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 8. SCHEMA: audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit.logs (
  id             BIGSERIAL   PRIMARY KEY,
  user_id        UUID,
  user_email     VARCHAR(254),
  user_role      VARCHAR(50),
  action         VARCHAR(100) NOT NULL,
  resource_type  VARCHAR(50),
  resource_id    UUID,
  ip_address     INET,
  user_agent     TEXT,
  details        JSONB,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE audit.logs IS
  'Log imutável de auditoria — sem UPDATE ou DELETE (LGPD Art. 37 + CFM 1.821/2007)';

ALTER TABLE audit.logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY audit_insert_only ON audit.logs
    FOR INSERT WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY audit_select_admin ON audit.logs
    FOR SELECT USING (current_user = 'ris_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 9. ÍNDICES DE PERFORMANCE
-- ---------------------------------------------------------------------------

-- auth
CREATE INDEX IF NOT EXISTS idx_users_email         ON auth.users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_active   ON auth.users(role, is_active);
CREATE INDEX IF NOT EXISTS idx_users_health_unit   ON auth.users(health_unit_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cpf_hash ON auth.users(cpf_hash) WHERE cpf_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_network_resource ON auth.users(is_network_resource) WHERE is_network_resource = TRUE;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON auth.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON auth.refresh_tokens(token_hash);

-- ris.patients
CREATE INDEX IF NOT EXISTS idx_patients_cpf_hash    ON ris.patients(cpf_hash);
CREATE INDEX IF NOT EXISTS idx_patients_name_hash   ON ris.patients(name_search_hash);
CREATE INDEX IF NOT EXISTS idx_patients_birth       ON ris.patients(birth_date);
CREATE INDEX IF NOT EXISTS idx_patients_mrn         ON ris.patients(medical_record_number);
CREATE INDEX IF NOT EXISTS idx_patients_health_unit ON ris.patients(health_unit_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_cns_hash ON ris.patients(cns_hash) WHERE cns_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patients_deactivated
  ON ris.patients (deactivated_at DESC NULLS LAST) WHERE is_active = FALSE;

-- ris.modalities / rooms
CREATE INDEX IF NOT EXISTS idx_modalities_health_unit ON ris.modalities(health_unit_id);
CREATE INDEX IF NOT EXISTS idx_rooms_health_unit      ON ris.rooms(health_unit_id);

-- ris.appointments
CREATE INDEX IF NOT EXISTS idx_appt_patient   ON ris.appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_scheduled ON ris.appointments(scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_appt_modality  ON ris.appointments(modality_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appt_status    ON ris.appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_status_priority
  ON ris.appointments(status, priority DESC, scheduled_at ASC)
  WHERE status NOT IN ('cancelled', 'no_show', 'done');

-- ris.referrals
CREATE INDEX IF NOT EXISTS idx_referrals_patient        ON ris.referrals(patient_id);
CREATE INDEX IF NOT EXISTS idx_referrals_to_unit_status ON ris.referrals(to_unit_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_to_user        ON ris.referrals(to_user_id) WHERE to_user_id IS NOT NULL;

-- ris.availability_rules / holidays
CREATE INDEX IF NOT EXISTS idx_avail_rules_lookup
  ON ris.availability_rules (health_unit_id, weekday) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_holidays_date ON ris.holidays (holiday_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_unit_date
  ON ris.holidays (health_unit_id, holiday_date) WHERE health_unit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_global_date
  ON ris.holidays (holiday_date) WHERE health_unit_id IS NULL;

-- ris.shifts
CREATE INDEX IF NOT EXISTS idx_shifts_unit       ON ris.shifts (health_unit_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_user_shifts_shift ON ris.user_shifts (shift_id);

-- ris.exam_notes
CREATE INDEX IF NOT EXISTS idx_exam_notes_study       ON ris.exam_notes (study_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_notes_content_trgm ON ris.exam_notes USING gin (content gin_trgm_ops);

-- ris.cid10
CREATE INDEX IF NOT EXISTS idx_cid10_desc_trgm ON ris.cid10 USING gin (lower(description) gin_trgm_ops);

-- pacs.studies
CREATE INDEX IF NOT EXISTS idx_studies_uid         ON pacs.studies(study_instance_uid);
CREATE INDEX IF NOT EXISTS idx_studies_accession   ON pacs.studies(accession_number);
CREATE INDEX IF NOT EXISTS idx_studies_patient     ON pacs.studies(patient_id);
CREATE INDEX IF NOT EXISTS idx_studies_date_status ON pacs.studies(study_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_studies_appointment ON pacs.studies(appointment_id);
CREATE INDEX IF NOT EXISTS idx_studies_equipment   ON pacs.studies(equipment_id);
CREATE INDEX IF NOT EXISTS idx_studies_room        ON pacs.studies(room_id);
CREATE INDEX IF NOT EXISTS idx_studies_technician  ON pacs.studies(technician_user_id);

-- pacs.series / instances
CREATE INDEX IF NOT EXISTS idx_series_study      ON pacs.series(study_id);
CREATE INDEX IF NOT EXISTS idx_series_uid        ON pacs.series(series_instance_uid);
CREATE INDEX IF NOT EXISTS idx_instances_series  ON pacs.instances(series_id);
CREATE INDEX IF NOT EXISTS idx_instances_study   ON pacs.instances(study_id);
CREATE INDEX IF NOT EXISTS idx_instances_sop_uid ON pacs.instances(sop_instance_uid);

-- ris.reports
CREATE INDEX IF NOT EXISTS idx_reports_study       ON ris.reports(study_id);
CREATE INDEX IF NOT EXISTS idx_reports_radiologist ON ris.reports(radiologist_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_status      ON ris.reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_share_token ON ris.reports(share_token);
CREATE INDEX IF NOT EXISTS idx_reports_cid10       ON ris.reports USING gin (cid10_codes);

-- audit
CREATE INDEX IF NOT EXISTS idx_audit_user_action ON audit.logs(user_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource    ON audit.logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_created     ON audit.logs(created_at DESC);

-- ris.notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON ris.notifications(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_portal
  ON ris.notifications(portal_account_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unique_active
  ON ris.notifications (type, resource_type, resource_id, channel)
  WHERE status IN ('pending', 'sent');
CREATE INDEX IF NOT EXISTS idx_notifications_pending
  ON ris.notifications (status, next_retry_at NULLS FIRST, created_at)
  WHERE status = 'pending';

-- ris.patient_notifications
CREATE INDEX IF NOT EXISTS idx_patient_notif_patient
  ON ris.patient_notifications(patient_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 10. SEQUÊNCIAS
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS pacs.accession_number_seq START 100000 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS ris.medical_record_seq    START 10000  INCREMENT 1;

-- ---------------------------------------------------------------------------
-- 11. FUNÇÕES E TRIGGERS
-- ---------------------------------------------------------------------------

-- 11.1 Atualizar updated_at automaticamente -----------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_patients_updated_at
    BEFORE UPDATE ON ris.patients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON ris.appointments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_studies_updated_at
    BEFORE UPDATE ON pacs.studies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_reports_updated_at
    BEFORE UPDATE ON ris.reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 11.2 Versionar laudo a cada UPDATE ------------------------------------------

CREATE OR REPLACE FUNCTION version_report()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_max SMALLINT;
BEGIN
  IF OLD.content_json IS DISTINCT FROM NEW.content_json
     OR OLD.content_html IS DISTINCT FROM NEW.content_html THEN
    SELECT COALESCE(MAX(version), 0) INTO v_max
      FROM ris.report_versions WHERE report_id = OLD.id;
    INSERT INTO ris.report_versions
      (report_id, version, content_json, content_html, changed_by, change_reason)
    VALUES
      (OLD.id, v_max + 1, OLD.content_json, OLD.content_html, NEW.radiologist_id, 'auto');
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_report_versioning
    BEFORE UPDATE ON ris.reports
    FOR EACH ROW EXECUTE FUNCTION version_report();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 11.3 Contadores de study ao inserir série -----------------------------------

CREATE OR REPLACE FUNCTION increment_study_series_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pacs.studies
    SET number_of_series = number_of_series + 1,
        updated_at = NOW()
  WHERE id = NEW.study_id;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_series_inserted
    AFTER INSERT ON pacs.series
    FOR EACH ROW EXECUTE FUNCTION increment_study_series_count();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 11.4 Contadores ao inserir instância ----------------------------------------

CREATE OR REPLACE FUNCTION increment_series_instance_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pacs.series
    SET number_of_instances = number_of_instances + 1,
        size_bytes = size_bytes + NEW.file_size_bytes
  WHERE id = NEW.series_id;
  UPDATE pacs.studies
    SET number_of_instances = number_of_instances + 1,
        size_bytes = size_bytes + NEW.file_size_bytes,
        updated_at = NOW()
  WHERE id = NEW.study_id;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_instance_inserted
    AFTER INSERT ON pacs.instances
    FOR EACH ROW EXECUTE FUNCTION increment_series_instance_count();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 11.5 Gerar accession number sequencial --------------------------------------

CREATE OR REPLACE FUNCTION generate_accession_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.accession_number IS NULL OR NEW.accession_number = '' THEN
    NEW.accession_number := TO_CHAR(NOW(), 'YYYYMMDD')
                            || LPAD(nextval('pacs.accession_number_seq')::TEXT, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_generate_accession
    BEFORE INSERT ON pacs.studies
    FOR EACH ROW EXECUTE FUNCTION generate_accession_number();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 11.6 Gerar número de prontuário sequencial ----------------------------------

CREATE OR REPLACE FUNCTION generate_medical_record_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.medical_record_number IS NULL OR NEW.medical_record_number = '' THEN
    NEW.medical_record_number := 'MR-' || LPAD(nextval('ris.medical_record_seq')::TEXT, 7, '0');
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_generate_mrn
    BEFORE INSERT ON ris.patients
    FOR EACH ROW EXECUTE FUNCTION generate_medical_record_number();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 12. PERMISSÕES (roles do banco — opcionais; aplicadas se existirem)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ris_api') THEN
    GRANT USAGE ON SCHEMA auth, ris, pacs, audit TO ris_api;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO ris_api;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ris  TO ris_api;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pacs TO ris_api;
    GRANT INSERT, SELECT ON audit.logs TO ris_api;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ris  TO ris_api;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pacs TO ris_api;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ris_readonly') THEN
    GRANT USAGE ON SCHEMA ris, pacs TO ris_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA ris  TO ris_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA pacs TO ris_readonly;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ris_admin') THEN
    GRANT USAGE ON SCHEMA auth, ris, pacs, audit TO ris_admin;
    GRANT ALL ON ALL TABLES IN SCHEMA auth, ris, pacs TO ris_admin;
    GRANT INSERT, SELECT ON audit.logs TO ris_admin;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA ris, pacs TO ris_admin;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 13. VIEWS ÚTEIS
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW ris.v_worklist_today AS
SELECT
  a.id                AS appointment_id,
  a.scheduled_at,
  a.status,
  a.priority,
  p.birth_date,
  p.medical_record_number,
  p.gender,
  proc.name           AS procedure_name,
  proc.tuss_code,
  proc.duration_minutes,
  m.name              AS modality_name,
  m.dicom_ae_title,
  m.modality_type,
  r.name              AS room_name,
  a.clinical_indication,
  s.id                AS study_id,
  s.study_instance_uid,
  s.accession_number,
  s.status            AS study_status,
  a.health_unit_id    AS health_unit_id
FROM ris.appointments a
JOIN ris.patients   p    ON p.id   = a.patient_id
JOIN ris.procedures proc ON proc.id = a.procedure_id
LEFT JOIN ris.modalities m ON m.id = a.modality_id
LEFT JOIN ris.rooms      r ON r.id = a.room_id
LEFT JOIN pacs.studies   s ON s.appointment_id = a.id
WHERE a.scheduled_at::DATE = CURRENT_DATE
  AND a.status NOT IN ('cancelled', 'no_show')
ORDER BY a.priority DESC, a.scheduled_at ASC;

CREATE OR REPLACE VIEW ris.v_pending_reports AS
SELECT
  s.id                AS study_id,
  s.study_instance_uid,
  s.accession_number,
  s.study_date,
  s.study_description,
  s.modality_type,
  s.number_of_series,
  s.number_of_instances,
  s.size_bytes,
  s.received_at,
  s.status            AS study_status,
  p.medical_record_number,
  p.birth_date,
  p.gender,
  proc.name           AS procedure_name,
  rep.id              AS report_id,
  rep.status          AS report_status,
  rep.updated_at      AS report_updated_at,
  u.name              AS radiologist_name,
  EXTRACT(EPOCH FROM (NOW() - s.received_at)) / 3600 AS hours_waiting,
  s.health_unit_id    AS health_unit_id
FROM pacs.studies s
JOIN ris.patients p ON p.id = s.patient_id
LEFT JOIN ris.appointments a ON a.id = s.appointment_id
LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id
LEFT JOIN ris.reports rep ON rep.study_id = s.id AND rep.status NOT IN ('cancelled')
LEFT JOIN auth.users u ON u.id = rep.radiologist_id
WHERE s.status IN ('received', 'complete')
  AND (rep.id IS NULL OR rep.status IN ('draft', 'review'))
ORDER BY a.priority DESC, s.received_at ASC;

CREATE OR REPLACE VIEW ris.v_daily_production AS
SELECT
  DATE(a.scheduled_at)        AS day,
  m.modality_type,
  COUNT(*)                    AS total_appointments,
  COUNT(*) FILTER (WHERE a.status = 'done')      AS completed,
  COUNT(*) FILTER (WHERE a.status = 'cancelled') AS cancelled,
  COUNT(*) FILTER (WHERE a.status = 'no_show')   AS no_show,
  COUNT(r.id) FILTER (WHERE r.status = 'signed')            AS signed_reports,
  COUNT(r.id) FILTER (WHERE r.status IN ('draft','review')) AS pending_reports
FROM ris.appointments a
LEFT JOIN ris.modalities m ON m.id = a.modality_id
LEFT JOIN pacs.studies s ON s.appointment_id = a.id
LEFT JOIN ris.reports r ON r.study_id = s.id
GROUP BY DATE(a.scheduled_at), m.modality_type
ORDER BY day DESC, m.modality_type;

-- `s.*` congela a lista de colunas: um ALTER TABLE posterior em pacs.studies faria o
-- CREATE OR REPLACE falhar na reaplicação. DROP + CREATE mantém o schema idempotente.
DROP VIEW IF EXISTS ris.v_radiologist_studies;
CREATE VIEW ris.v_radiologist_studies AS
SELECT s.*, u.id AS assigned_radiologist_id
FROM pacs.studies s
LEFT JOIN ris.reports r ON r.study_id = s.id AND r.status NOT IN ('cancelled')
LEFT JOIN auth.users u ON u.id = r.radiologist_id;

-- =============================================================================
-- 14. PEP — Prontuário Eletrônico do Paciente (schema `ehr`, Fase 1 / MVP)
--
-- Camada clínica longitudinal sobre o RIS/PACS: atendimentos, evolução SOAP
-- assinada/versionada, lista de problemas (CID-10), sinais vitais e break-glass.
-- Ver docs/pep-design.md.
--
--   · schema próprio `ehr` (não estende `ris`).
--   · acesso global + break-glass (enforce na aplicação, igual ris/pacs — sem RLS).
--   · assinatura RS256 no servidor (igual ris.reports); ICP-Brasil/SBIS em F4.
--   · texto clínico livre = PII → colunas `_enc` BYTEA (AES-256-GCM, services/encryption).
--   · evolução assinada é imutável → emenda gera nova versão (snapshot na aplicação).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS ehr;

-- 14.1 Enums ------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE ehr.encounter_type AS ENUM
  ('ambulatorial','urgencia','retorno','teleconsulta'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.encounter_status AS ENUM
  ('open','closed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.note_status AS ENUM
  ('draft','signed','amended'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.problem_status AS ENUM
  ('active','resolved','inactive'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 14.2 Atendimento clínico (≠ ris.appointments, que é só a agenda) ------------
CREATE TABLE IF NOT EXISTS ehr.encounters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID NOT NULL REFERENCES ris.patients(id),
  professional_id     UUID NOT NULL REFERENCES auth.users(id),
  health_unit_id      UUID REFERENCES ris.health_units(id) ON DELETE SET NULL,
  appointment_id      UUID REFERENCES ris.appointments(id),         -- liga ao RIS (opcional)
  encounter_type      ehr.encounter_type   NOT NULL DEFAULT 'ambulatorial',
  status              ehr.encounter_status NOT NULL DEFAULT 'open',
  chief_complaint_enc BYTEA,                                         -- queixa principal (PII)
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at           TIMESTAMPTZ,
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_enc_patient ON ehr.encounters(patient_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_enc_unit    ON ehr.encounters(health_unit_id, status);
CREATE INDEX IF NOT EXISTS idx_enc_prof    ON ehr.encounters(professional_id, started_at DESC);

-- 14.3 Evolução SOAP (assinada, versionada — igual ris.reports) ---------------
CREATE TABLE IF NOT EXISTS ehr.clinical_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id    UUID NOT NULL REFERENCES ehr.encounters(id) ON DELETE CASCADE,
  patient_id      UUID NOT NULL REFERENCES ris.patients(id),
  author_id       UUID NOT NULL REFERENCES auth.users(id),
  subjective_enc  BYTEA,           -- S — subjetivo (queixa/história relatada)
  objective_enc   BYTEA,           -- O — objetivo (exame físico/achados)
  assessment_enc  BYTEA,           -- A — avaliação (hipóteses/diagnóstico)
  plan_enc        BYTEA,           -- P — plano (conduta)
  cid10_codes     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{code, description}]
  status          ehr.note_status NOT NULL DEFAULT 'draft',
  signed_at       TIMESTAMPTZ,
  signature_hash  CHAR(64),        -- SHA-256 do conteúdo assinado
  signature_jwt   TEXT,            -- JWT RS256 (igual laudo)
  pdf_storage_key TEXT,            -- chave no RustFS (bucket DOCUMENTS)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_note_encounter ON ehr.clinical_notes(encounter_id);
CREATE INDEX IF NOT EXISTS idx_note_patient   ON ehr.clinical_notes(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_author    ON ehr.clinical_notes(author_id);

-- Versões: a cada emenda de uma nota assinada, o estado anterior é snapshotado
-- pela aplicação (não por trigger — o ciclo draft→signed→amended exige controle
-- explícito de change_reason; ver modules/ehr).
CREATE TABLE IF NOT EXISTS ehr.clinical_note_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id       UUID NOT NULL REFERENCES ehr.clinical_notes(id) ON DELETE CASCADE,
  version       SMALLINT NOT NULL,
  snapshot      JSONB,           -- {subjective,objective,assessment,plan,cid10_codes,signature_hash}
  changed_by    UUID REFERENCES auth.users(id),
  change_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (note_id, version)
);

-- 14.4 Lista de problemas (CID-10) --------------------------------------------
CREATE TABLE IF NOT EXISTS ehr.problems (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL REFERENCES ris.patients(id),
  cid10_code    VARCHAR(10) REFERENCES ris.cid10(code),
  title         VARCHAR(200) NOT NULL,
  status        ehr.problem_status NOT NULL DEFAULT 'active',
  is_chronic    BOOLEAN NOT NULL DEFAULT FALSE,
  onset_date    DATE,
  resolved_date DATE,
  encounter_id  UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  noted_by      UUID REFERENCES auth.users(id),
  notes_enc     BYTEA,           -- observação livre (PII)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_problem_patient ON ehr.problems(patient_id, status);

-- 14.5 Sinais vitais ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS ehr.vitals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id   UUID REFERENCES ehr.encounters(id) ON DELETE CASCADE,
  patient_id     UUID NOT NULL REFERENCES ris.patients(id),
  measured_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  measured_by    UUID REFERENCES auth.users(id),
  systolic       SMALLINT,        -- PA sistólica (mmHg)
  diastolic      SMALLINT,        -- PA diastólica (mmHg)
  heart_rate     SMALLINT,        -- FC (bpm)
  resp_rate      SMALLINT,        -- FR (irpm)
  temp_c         NUMERIC(4,1),    -- temperatura (°C)
  spo2           SMALLINT,        -- saturação O2 (%)
  weight_kg      NUMERIC(5,2),
  height_cm      NUMERIC(5,1),
  bmi            NUMERIC(5,2) GENERATED ALWAYS AS (
                   CASE WHEN height_cm > 0 AND weight_kg IS NOT NULL
                        THEN round((weight_kg / ((height_cm/100.0)^2))::numeric, 2) END) STORED,
  pain_scale     SMALLINT CHECK (pain_scale BETWEEN 0 AND 10),
  glucose_mgdl   SMALLINT,        -- glicemia capilar (mg/dL)
  notes          TEXT,            -- anotação técnica curta (não-PII)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vitals_patient ON ehr.vitals(patient_id, measured_at DESC);

-- 14.6 Break-glass (quebra de sigilo justificada) -----------------------------
-- Profissional sem vínculo registra justificativa e ganha acesso temporário;
-- o evento é auditado e (F4) dispara alerta ao admin.
CREATE TABLE IF NOT EXISTS ehr.breakglass_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  patient_id  UUID NOT NULL REFERENCES ris.patients(id),
  reason      TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '12 hours')
);
CREATE INDEX IF NOT EXISTS idx_bg_active ON ehr.breakglass_grants(user_id, patient_id, expires_at);

-- 14.7 Triggers updated_at (set_updated_at() definida em 12.1) -----------------
DO $$ BEGIN
  CREATE TRIGGER trg_encounters_updated_at
    BEFORE UPDATE ON ehr.encounters
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_clinical_notes_updated_at
    BEFORE UPDATE ON ehr.clinical_notes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_problems_updated_at
    BEFORE UPDATE ON ehr.problems
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- 15. PEP — Fase 2/3 (alergias, medicamentos, anamnese, anexos, prescrição,
--     atestados, imunização). Mesmos princípios do §14: PII clínica em `_enc`,
--     documentos legais (prescrição/atestado) assinados RS256+PDF, audit total.
-- =============================================================================

-- 15.0 Enums --------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE ehr.allergy_type AS ENUM
  ('medication','food','environmental','biological','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.allergy_severity AS ENUM
  ('mild','moderate','severe','unknown'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.allergy_status AS ENUM
  ('active','inactive','resolved'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.med_status AS ENUM
  ('active','suspended','completed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.history_type AS ENUM
  ('personal','familial','surgical','habits','gyneco_obstetric','allergic','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.attachment_category AS ENUM
  ('exam_external','document','image','referral','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.rx_status AS ENUM
  ('draft','signed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.rx_type AS ENUM
  ('common','controlled','antimicrobial'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.cert_type AS ENUM
  ('medical_leave','attendance','fitness','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.cert_status AS ENUM
  ('draft','signed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.immunization_status AS ENUM
  ('applied','scheduled','delayed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 15.1 Alergias e reações adversas (safety — alerta no prontuário) --------------
CREATE TABLE IF NOT EXISTS ehr.allergies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL REFERENCES ris.patients(id),
  allergen      VARCHAR(200) NOT NULL,                      -- substância/agente
  allergen_type ehr.allergy_type     NOT NULL DEFAULT 'medication',
  reaction_enc  BYTEA,                                      -- reação descrita (PII)
  severity      ehr.allergy_severity NOT NULL DEFAULT 'unknown',
  status        ehr.allergy_status   NOT NULL DEFAULT 'active',
  noted_by      UUID REFERENCES auth.users(id),
  encounter_id  UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  noted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_allergy_patient  ON ehr.allergies(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_allergy_allergen ON ehr.allergies(patient_id, lower(allergen));

-- 15.2 Medicamentos em uso ------------------------------------------------------
CREATE TABLE IF NOT EXISTS ehr.medications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID NOT NULL REFERENCES ris.patients(id),
  name         VARCHAR(200) NOT NULL,
  dose         VARCHAR(80),
  route        VARCHAR(40),
  frequency    VARCHAR(80),
  status       ehr.med_status NOT NULL DEFAULT 'active',
  started_on   DATE,
  ended_on     DATE,
  notes_enc    BYTEA,
  noted_by     UUID REFERENCES auth.users(id),
  encounter_id UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_med_patient ON ehr.medications(patient_id, status);

-- 15.3 Anamnese / antecedentes (1 registro ativo por tipo, texto livre PII) -----
CREATE TABLE IF NOT EXISTS ehr.history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID NOT NULL REFERENCES ris.patients(id),
  history_type ehr.history_type NOT NULL,
  content_enc  BYTEA,
  updated_by   UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, history_type)
);

-- 15.4 Anexos clínicos (exames externos, documentos) ----------------------------
CREATE TABLE IF NOT EXISTS ehr.attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID NOT NULL REFERENCES ris.patients(id),
  encounter_id UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  category     ehr.attachment_category NOT NULL DEFAULT 'document',
  title        VARCHAR(200),
  filename     VARCHAR(255) NOT NULL,
  mime_type    VARCHAR(100),
  size_bytes   BIGINT,
  storage_key  TEXT NOT NULL,                               -- chave RustFS (bucket DOCUMENTS)
  uploaded_by  UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attach_patient ON ehr.attachments(patient_id, created_at DESC);

-- 15.5 Prescrição eletrônica (assinada RS256+PDF, igual evolução) ----------------
CREATE TABLE IF NOT EXISTS ehr.prescriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id    UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  patient_id      UUID NOT NULL REFERENCES ris.patients(id),
  prescriber_id   UUID NOT NULL REFERENCES auth.users(id),
  rx_type         ehr.rx_type   NOT NULL DEFAULT 'common',
  status          ehr.rx_status NOT NULL DEFAULT 'draft',
  notes           TEXT,
  signed_at       TIMESTAMPTZ,
  signature_hash  CHAR(64),
  signature_jwt   TEXT,
  pdf_storage_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rx_patient ON ehr.prescriptions(patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ehr.prescription_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES ehr.prescriptions(id) ON DELETE CASCADE,
  drug_name       VARCHAR(200) NOT NULL,
  dose            VARCHAR(80),
  route           VARCHAR(40),
  frequency       VARCHAR(80),
  duration        VARCHAR(80),
  quantity        VARCHAR(80),
  instructions    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rx_item_rx ON ehr.prescription_items(prescription_id);

-- 15.6 Atestados / declarações (assinados RS256+PDF) ----------------------------
CREATE TABLE IF NOT EXISTS ehr.certificates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id    UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  patient_id      UUID NOT NULL REFERENCES ris.patients(id),
  issuer_id       UUID NOT NULL REFERENCES auth.users(id),
  cert_type       ehr.cert_type   NOT NULL DEFAULT 'medical_leave',
  status          ehr.cert_status NOT NULL DEFAULT 'draft',
  content_enc     BYTEA,                                     -- corpo do atestado (PII)
  days_off        SMALLINT,                                  -- dias de afastamento
  cid10_code      VARCHAR(10) REFERENCES ris.cid10(code),    -- opcional (a pedido do paciente)
  signed_at       TIMESTAMPTZ,
  signature_hash  CHAR(64),
  signature_jwt   TEXT,
  pdf_storage_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cert_patient ON ehr.certificates(patient_id, created_at DESC);

-- 15.7 Imunização / carteira vacinal --------------------------------------------
CREATE TABLE IF NOT EXISTS ehr.immunizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID NOT NULL REFERENCES ris.patients(id),
  vaccine       VARCHAR(120) NOT NULL,
  dose_label    VARCHAR(60),                                 -- ex.: "1ª dose", "reforço"
  lot           VARCHAR(60),
  manufacturer  VARCHAR(120),
  route         VARCHAR(40),
  site          VARCHAR(40),                                 -- local de aplicação
  status        ehr.immunization_status NOT NULL DEFAULT 'applied',
  applied_at    TIMESTAMPTZ,
  scheduled_for DATE,
  applied_by    UUID REFERENCES auth.users(id),
  encounter_id  UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_imm_patient ON ehr.immunizations(patient_id, applied_at DESC);

-- 15.8 Triggers updated_at ------------------------------------------------------
DO $$ BEGIN CREATE TRIGGER trg_allergies_updated_at      BEFORE UPDATE ON ehr.allergies      FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_medications_updated_at    BEFORE UPDATE ON ehr.medications    FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_history_updated_at        BEFORE UPDATE ON ehr.history        FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_prescriptions_updated_at  BEFORE UPDATE ON ehr.prescriptions  FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TRIGGER trg_certificates_updated_at   BEFORE UPDATE ON ehr.certificates   FOR EACH ROW EXECUTE FUNCTION set_updated_at(); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- 16. Fluxo de Atendimento (atendimento comum: recepção→triagem→clínico→medicação)
--
--   · Papel `nurse` (enfermeiro) adicionado ao enum auth.user_role na §1 (fresh
--     installs). Em bancos EXISTENTES o upgrade do enum é feito por
--     `ALTER TYPE auth.user_role ADD VALUE` aplicado FORA de transação
--     (ALTER TYPE ADD VALUE não roda em bloco de transação) — ver o script de
--     migração; por isso NÃO consta aqui no corpo idempotente.
--   · NÃO há papel de "acolhimento/triagem": a recepção (receptionist) faz o
--     acolhimento e a triagem (medições) com `episode:manage` + `vitals:write`.
--     `triage` é apenas um `flow_stage` (etapa do fluxo), não um papel.
--   · O atendimento avança por `flow_stage`; medicamentos marcados para serem
--     administrados na unidade entram na fila do enfermeiro (MAR).
-- =============================================================================

DO $$ BEGIN CREATE TYPE ehr.flow_stage AS ENUM
  ('reception','triage','waiting_doctor','in_consultation','medication','completed','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ehr.admin_status AS ENUM
  ('administered','refused','not_administered'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ris.registration_status AS ENUM
  ('complete','pending'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 16.1 Paciente: status de cadastro (emergência = pending, completar depois) ----
ALTER TABLE ris.patients
  ADD COLUMN IF NOT EXISTS registration_status ris.registration_status NOT NULL DEFAULT 'complete';

-- 16.2 Encounter: estágio do fluxo + emergência -------------------------------
ALTER TABLE ehr.encounters
  ADD COLUMN IF NOT EXISTS flow_stage   ehr.flow_stage NOT NULL DEFAULT 'reception',
  ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN        NOT NULL DEFAULT FALSE;
-- Classificação de risco (Protocolo de Manchester): cor define prioridade na fila.
-- red>orange>yellow>green>blue. NULL = ainda não classificado.
ALTER TABLE ehr.encounters
  ADD COLUMN IF NOT EXISTS manchester_level VARCHAR(10);
CREATE INDEX IF NOT EXISTS idx_enc_flow ON ehr.encounters(health_unit_id, flow_stage);

-- 16.3 Item de prescrição: administrar na unidade (entra na fila do enfermeiro) -
ALTER TABLE ehr.prescription_items
  ADD COLUMN IF NOT EXISTS administer_at_unit BOOLEAN NOT NULL DEFAULT FALSE;
-- Aprazamento: horários do dia em que a dose deve ser administrada (["08:00","14:00",...]).
-- Vazio/null = sem aprazamento (item entra na fila de dose única, como antes).
ALTER TABLE ehr.prescription_items
  ADD COLUMN IF NOT EXISTS scheduled_times JSONB;

-- 16.4 MAR — registro de administração de medicamento (enfermeiro) -------------
CREATE TABLE IF NOT EXISTS ehr.medication_administrations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_item_id UUID REFERENCES ehr.prescription_items(id) ON DELETE SET NULL,
  patient_id           UUID NOT NULL REFERENCES ris.patients(id),
  encounter_id         UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  drug_name            VARCHAR(200) NOT NULL,
  dose                 VARCHAR(80),
  route                VARCHAR(40),
  site                 VARCHAR(40),
  status               ehr.admin_status NOT NULL DEFAULT 'administered',
  -- motivo estruturado quando NÃO administrado/recusado (vocabulário controlado
  -- na aplicação — padrão p/ auditoria). Ver ehr.flow.controller REFUSAL_REASONS.
  refusal_reason       VARCHAR(40),
  administered_by      UUID REFERENCES auth.users(id),
  administered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- coluna adicionada p/ bancos já existentes (idempotente)
ALTER TABLE ehr.medication_administrations
  ADD COLUMN IF NOT EXISTS refusal_reason VARCHAR(40);
-- "5 certos" da medicação (#5 Nível 4): enfermeiro confirma identidade do paciente
-- + os 5 certos antes de administrar. patient_verified = identidade conferida.
ALTER TABLE ehr.medication_administrations
  ADD COLUMN IF NOT EXISTS patient_verified BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_medadmin_patient ON ehr.medication_administrations(patient_id, administered_at DESC);
CREATE INDEX IF NOT EXISTS idx_medadmin_item    ON ehr.medication_administrations(prescription_item_id);

-- 16.5 Escalas de enfermagem (Morse=queda, Braden=lesão por pressão) ----------
-- scale/risk_level como VARCHAR (vocabulário controlado na app — sem enum PG).
-- items = respostas marcadas {chave_item: valor_pontos}; score/risk_level calculados.
CREATE TABLE IF NOT EXISTS ehr.nursing_assessments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID NOT NULL REFERENCES ris.patients(id),
  encounter_id UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  scale        VARCHAR(20) NOT NULL,        -- 'morse' | 'braden'
  items        JSONB NOT NULL DEFAULT '{}'::jsonb,
  score        SMALLINT NOT NULL,
  risk_level   VARCHAR(20) NOT NULL,        -- baixo | moderado | alto | muito_alto | sem_risco
  assessed_by  UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nursing_patient ON ehr.nursing_assessments(patient_id, created_at DESC);

-- 16.6 Fila automática — médico designado no agendamento (#10) -----------------
-- Médico INTERNO designado ao agendamento (auth.users role='doctor'). Distinto de
-- requesting_physician_id, que é o médico EXTERNO solicitante (ris.external_physicians).
-- NULL = não designado (recepção não escolheu e não havia plantonista elegível).
ALTER TABLE ris.appointments
  ADD COLUMN IF NOT EXISTS assigned_doctor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appt_doctor ON ris.appointments(assigned_doctor_id, scheduled_at);

-- 16.7 Fila do PEP — fichas diárias + chamada (#11) ----------------------------
-- ticket_number: senha sequencial por unidade que REINICIA a cada dia (ticket_date).
-- assigned_doctor_id: plantonista direcionado (round-robin) ao iniciar o atendimento.
-- called_at/room_label: chamada do paciente para o consultório (exibido no painel).
ALTER TABLE ehr.encounters
  ADD COLUMN IF NOT EXISTS ticket_number      INTEGER,
  ADD COLUMN IF NOT EXISTS ticket_date        DATE,
  ADD COLUMN IF NOT EXISTS assigned_doctor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS called_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS room_label         VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_enc_ticket ON ehr.encounters(health_unit_id, ticket_date, ticket_number);

-- Contador diário de fichas por unidade — fonte sequencial atômica (UPSERT).
-- Uma linha por (unidade, dia); last_number incrementa via ON CONFLICT.
CREATE TABLE IF NOT EXISTS ehr.daily_ticket_counters (
  health_unit_id UUID    NOT NULL REFERENCES ris.health_units(id) ON DELETE CASCADE,
  ticket_date    DATE    NOT NULL,
  last_number    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (health_unit_id, ticket_date)
);
COMMENT ON TABLE ehr.daily_ticket_counters IS 'Sequência diária de fichas por unidade (reinicia por dia). Incremento atômico via UPSERT.';

-- 16.8 SAE — Evolução de enfermagem (#2 Nível 3) ------------------------------
-- Sistematização da Assistência de Enfermagem: avaliação (dados), diagnósticos
-- de enfermagem (NANDA/CIPE — texto controlado na app), condutas/prescrição de
-- enfermagem e evolução do cuidado. Texto clínico cifrado (BYTEA _enc) igual à
-- evolução SOAP; diagnoses em JSONB (rótulos/códigos) igual cid10_codes.
CREATE TABLE IF NOT EXISTS ehr.nursing_evolutions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID NOT NULL REFERENCES ris.patients(id),
  encounter_id      UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  assessment_enc    BYTEA,                              -- avaliação/dados (PII)
  diagnoses         JSONB NOT NULL DEFAULT '[]'::jsonb, -- ["Risco de queda", ...]
  interventions_enc BYTEA,                              -- condutas de enfermagem (PII)
  evaluation_enc    BYTEA,                              -- evolução (resposta ao cuidado) (PII)
  author_id         UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nursing_evo_patient ON ehr.nursing_evolutions(patient_id, created_at DESC);
COMMENT ON TABLE ehr.nursing_evolutions IS 'SAE — evolução de enfermagem (avaliação, diagnósticos, condutas, evolução).';

-- 16.9 SADT — Solicitação de exames / laboratório (#4 Nível 3) -----------------
-- Pedido médico de exames (laboratório/imagem/outros). Espelha o padrão de
-- prescrição (cabeçalho + itens); itens em texto (igual prescription_items).
-- Sem assinatura/PDF (fora de escopo). status acompanha o ciclo do pedido.
CREATE TABLE IF NOT EXISTS ehr.service_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          UUID NOT NULL REFERENCES ris.patients(id),
  encounter_id        UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  request_type        VARCHAR(20) NOT NULL DEFAULT 'lab',      -- lab | imaging | other
  priority            VARCHAR(10) NOT NULL DEFAULT 'routine',  -- routine | urgent
  clinical_indication TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'requested',-- requested|in_progress|completed|cancelled
  requested_by        UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ehr.service_request_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    UUID NOT NULL REFERENCES ehr.service_requests(id) ON DELETE CASCADE,
  exam_name     VARCHAR(200) NOT NULL,
  code          VARCHAR(40),                                   -- TUSS/SIGTAP opcional
  notes         VARCHAR(500),
  result_status VARCHAR(20) NOT NULL DEFAULT 'pending'         -- pending|collected|resulted
);
CREATE INDEX IF NOT EXISTS idx_svcreq_patient ON ehr.service_requests(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_svcreq_items   ON ehr.service_request_items(request_id);
COMMENT ON TABLE ehr.service_requests IS 'SADT — solicitação de exames/laboratório (pedido médico, sem assinatura).';

-- 16.10 Receituário de Controle Especial — numeração (#7 Nível 3) -------------
-- Portaria 344/98: prescrição de controlado exige numeração própria. Aqui geramos
-- um número sequencial por UNIDADE e ANO, atribuído na ASSINATURA da prescrição
-- com rx_type='controlled'. (Layout/talão impresso e notificação de receita ficam
-- fora do escopo — assinatura/carimbo não são relevantes neste sistema.)
ALTER TABLE ehr.prescriptions
  ADD COLUMN IF NOT EXISTS control_number INTEGER,
  ADD COLUMN IF NOT EXISTS control_year   INTEGER;
CREATE TABLE IF NOT EXISTS ehr.controlled_rx_counters (
  health_unit_id UUID    NOT NULL REFERENCES ris.health_units(id) ON DELETE CASCADE,
  year           INTEGER NOT NULL,
  last_number    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (health_unit_id, year)
);
COMMENT ON TABLE ehr.controlled_rx_counters IS 'Sequência anual do receituário de controle especial por unidade (Portaria 344). UPSERT atômico.';

-- 16.11 Catálogo de medicamentos (#9 Nível 3) ---------------------------------
-- Base local p/ autocompletar prescrição + checagem de alergia por princípio
-- ativo. Seed curado in-repo (comuns na atenção primária); a carga oficial
-- completa da ANVISA Dados Abertos é um passo de dados à parte (CSV). CID-10 já
-- existe em ris.cid10 (seed ampliado no mesmo script de seed do catálogo).
CREATE TABLE IF NOT EXISTS ris.medications_catalog (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(200) NOT NULL,          -- nome comercial/usual
  active_ingredient VARCHAR(200),                  -- princípio ativo
  form             VARCHAR(80),                    -- apresentação (comp., sol., etc.)
  controlled       BOOLEAN NOT NULL DEFAULT FALSE, -- sujeito a controle especial
  anvisa_reg       VARCHAR(40),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_med_name_form UNIQUE (name, form)
);
CREATE INDEX IF NOT EXISTS idx_med_name   ON ris.medications_catalog (lower(name));
CREATE INDEX IF NOT EXISTS idx_med_active ON ris.medications_catalog (lower(active_ingredient));
COMMENT ON TABLE ris.medications_catalog IS 'Catálogo local de medicamentos (autocompletar/alergia por princípio ativo). Seed curado; import ANVISA completo é passo de dados externo.';

-- 16.12 Interações medicamentosas (#1 Nível 4) --------------------------------
-- Pares de princípios ativos com risco. Sem API BR gratuita (RxNav descontinuou,
-- PharmaDB é pago) → base local curada. Pares normalizados (lower, a<=b) p/ evitar
-- duplicidade de direção. severity: mild|moderate|severe.
CREATE TABLE IF NOT EXISTS ris.drug_interactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_a VARCHAR(200) NOT NULL,
  ingredient_b VARCHAR(200) NOT NULL,
  severity     VARCHAR(20)  NOT NULL DEFAULT 'moderate',
  note         TEXT,
  CONSTRAINT uq_interaction UNIQUE (ingredient_a, ingredient_b),
  CONSTRAINT chk_interaction_order CHECK (ingredient_a <= ingredient_b)
);
CREATE INDEX IF NOT EXISTS idx_interaction_a ON ris.drug_interactions (ingredient_a);
CREATE INDEX IF NOT EXISTS idx_interaction_b ON ris.drug_interactions (ingredient_b);
COMMENT ON TABLE ris.drug_interactions IS 'Interações por princípio ativo (base local curada). Pares lower + a<=b.';

-- 16.13 Farmacovigilância — evento adverso (#7 Nível 4) -----------------------
-- Notificação de reação adversa a medicamento / evento adverso. Texto cifrado
-- (descrição = dado clínico). Vocabulário controlado na app (sem enum PG).
CREATE TABLE IF NOT EXISTS ehr.adverse_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES ris.patients(id),
  encounter_id    UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  event_type      VARCHAR(30) NOT NULL DEFAULT 'adverse_drug_reaction', -- adverse_drug_reaction|allergy|medication_error|other
  suspected_drug  VARCHAR(200),
  description_enc  BYTEA,                              -- relato do evento (PII)
  severity        VARCHAR(20) NOT NULL DEFAULT 'moderate', -- mild|moderate|severe|life_threatening
  outcome         VARCHAR(20) NOT NULL DEFAULT 'unknown',  -- recovered|recovering|sequelae|death|unknown
  reported_by     UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adverse_patient ON ehr.adverse_events(patient_id, created_at DESC);
COMMENT ON TABLE ehr.adverse_events IS 'Farmacovigilância — notificação de evento adverso/RAM (notificação externa VigiMed fica fora do escopo).';

-- =============================================================================
-- 17. Farmácia — estoque por unidade + dispensação ligada à prescrição (#5 Nível 4)
--
--   · Estoque por UNIDADE × medicamento (lote/validade). Toda alteração de saldo
--     passa por um MOVIMENTO (ledger) — entrada, saída ou ajuste — auditável.
--   · A dispensação consome itens da prescrição (assinada) e BAIXA o estoque
--     (movimento de saída), em transação. Saldo nunca fica negativo.
--   · Sem papel `pharmacist` no enum: em postos pequenos a enfermagem/recepção
--     opera a farmácia. RBAC via permissões pharmacy:read|stock|dispense.
-- =============================================================================

-- 17.1 Estoque — saldo por unidade × medicamento (lote) ------------------------
CREATE TABLE IF NOT EXISTS ris.pharmacy_stock (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  health_unit_id UUID NOT NULL REFERENCES ris.health_units(id) ON DELETE CASCADE,
  medication_id  UUID REFERENCES ris.medications_catalog(id) ON DELETE SET NULL,
  drug_name      VARCHAR(200) NOT NULL,                  -- denormalizado p/ exibição
  lot            VARCHAR(60) NOT NULL DEFAULT '',        -- '' = sem lote (UNIQUE precisa NOT NULL)
  expiry_date    DATE,
  unit_label     VARCHAR(30) NOT NULL DEFAULT 'un',      -- comp | mL | ampola | un...
  quantity       NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_level      NUMERIC(12,2) NOT NULL DEFAULT 0,       -- alerta de estoque baixo
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stock_unit_drug_lot UNIQUE (health_unit_id, drug_name, lot),
  CONSTRAINT chk_stock_qty_nonneg CHECK (quantity >= 0)
);
CREATE INDEX IF NOT EXISTS idx_stock_unit ON ris.pharmacy_stock(health_unit_id, lower(drug_name));
COMMENT ON TABLE ris.pharmacy_stock IS 'Estoque de farmácia por unidade × medicamento (lote/validade). Saldo nunca negativo.';

-- 17.2 Movimentos de estoque (ledger) -----------------------------------------
CREATE TABLE IF NOT EXISTS ris.pharmacy_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id        UUID NOT NULL REFERENCES ris.pharmacy_stock(id) ON DELETE CASCADE,
  health_unit_id  UUID NOT NULL REFERENCES ris.health_units(id) ON DELETE CASCADE,
  movement_type   VARCHAR(12) NOT NULL,        -- in | out | adjust
  quantity        NUMERIC(12,2) NOT NULL,      -- sempre positivo; o tipo define o sinal
  balance_after   NUMERIC(12,2) NOT NULL,
  reason          VARCHAR(120),
  dispensation_id UUID,                          -- ref. dispensação (saída), se houver
  moved_by        UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_movement_stock ON ris.pharmacy_movements(stock_id, created_at DESC);
COMMENT ON TABLE ris.pharmacy_movements IS 'Ledger de estoque: entrada/saída/ajuste com saldo resultante. Auditável.';

-- 17.3 Dispensação (cabeçalho) — ligada à prescrição --------------------------
CREATE TABLE IF NOT EXISTS ehr.dispensations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID NOT NULL REFERENCES ris.patients(id),
  encounter_id    UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  prescription_id UUID REFERENCES ehr.prescriptions(id) ON DELETE SET NULL,
  health_unit_id  UUID NOT NULL REFERENCES ris.health_units(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'dispensed',  -- dispensed | partial | cancelled
  notes           VARCHAR(500),
  dispensed_by    UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disp_patient ON ehr.dispensations(patient_id, created_at DESC);
COMMENT ON TABLE ehr.dispensations IS 'Dispensação de medicamentos (consome prescrição + baixa estoque em transação).';

-- 17.4 Dispensação (itens) ----------------------------------------------------
CREATE TABLE IF NOT EXISTS ehr.dispensation_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispensation_id      UUID NOT NULL REFERENCES ehr.dispensations(id) ON DELETE CASCADE,
  prescription_item_id UUID REFERENCES ehr.prescription_items(id) ON DELETE SET NULL,
  stock_id             UUID REFERENCES ris.pharmacy_stock(id) ON DELETE SET NULL,
  drug_name            VARCHAR(200) NOT NULL,
  quantity             NUMERIC(12,2) NOT NULL,
  unit_label           VARCHAR(30) NOT NULL DEFAULT 'un'
);
CREATE INDEX IF NOT EXISTS idx_disp_item ON ehr.dispensation_items(dispensation_id);

-- =============================================================================
-- 18. Notificações externas — fila de envio (e-mail/SMS/WhatsApp) (#8 Nível 4)
--
--   · Outbox provider-agnóstico: confirmação de agendamento e avisos saem como
--     uma linha aqui; um adapter (services/messaging.js) tenta entregar. Sem
--     credencial de provedor (Twilio/Meta/Zenvia), fica `pending` e é logado.
--   · destino/corpo cifrados (telefone = PII).
-- =============================================================================
CREATE TABLE IF NOT EXISTS ris.message_outbox (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel        VARCHAR(12) NOT NULL,            -- sms | whatsapp | email
  to_enc         BYTEA,                            -- destino (telefone/e-mail) cifrado
  to_hash        CHAR(64),                         -- hash p/ dedupe/busca
  body           VARCHAR(1000) NOT NULL,
  template       VARCHAR(40),                      -- appointment_confirm | ...
  ref_type       VARCHAR(30),                      -- appointment | ...
  ref_id         UUID,
  status         VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending | sent | failed
  provider       VARCHAR(40),
  error          VARCHAR(300),
  attempts       SMALLINT NOT NULL DEFAULT 0,
  health_unit_id UUID REFERENCES ris.health_units(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON ris.message_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_ref    ON ris.message_outbox(ref_type, ref_id);
COMMENT ON TABLE ris.message_outbox IS 'Fila de mensagens externas (SMS/WhatsApp/e-mail). Entrega depende de credencial de provedor.';

-- =============================================================================
-- 19. Teleconsulta — sessão de vídeo (WebRTC) por atendimento (#6 Nível 4)
--
--   · Sinalização WebRTC sobre o socket.io já existente; mídia P2P (STUN público).
--     Sem provedor pago: sala identificada por `room_token` (UUID), 1 médico + 1
--     paciente. Reaproveita encounter_type='teleconsulta'.
-- =============================================================================
CREATE TABLE IF NOT EXISTS ehr.teleconsultations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id  UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL,
  patient_id    UUID NOT NULL REFERENCES ris.patients(id),
  appointment_id UUID REFERENCES ris.appointments(id) ON DELETE SET NULL,
  room_token    UUID NOT NULL DEFAULT gen_random_uuid(),
  status        VARCHAR(12) NOT NULL DEFAULT 'created', -- created | active | ended | cancelled
  host_id       UUID REFERENCES auth.users(id),         -- médico que abriu a sala
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tele_room UNIQUE (room_token)
);
CREATE INDEX IF NOT EXISTS idx_tele_patient ON ehr.teleconsultations(patient_id, created_at DESC);
COMMENT ON TABLE ehr.teleconsultations IS 'Sessão de teleconsulta (WebRTC P2P). Sinalização por REST/polling (sem socket.io). Sala por room_token.';

-- 19.1 Sinalização WebRTC (offer/answer/ICE) — troca por polling REST -----------
-- Sem socket.io: cada par publica seus sinais aqui e lê os do outro par usando o
-- id como cursor. Efêmero — pode ser limpo após a sessão encerrar.
CREATE TABLE IF NOT EXISTS ehr.teleconsult_signals (
  id          BIGSERIAL PRIMARY KEY,
  room_token  UUID NOT NULL,
  sender      VARCHAR(8) NOT NULL,    -- host | guest
  kind        VARCHAR(10) NOT NULL,   -- offer | answer | ice | bye
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tele_signal ON ehr.teleconsult_signals(room_token, id);

-- =============================================================================
-- 20. Agendamento clínico — consulta / teleconsulta (não só exame de imagem)
--
--   · Até aqui todo `ris.appointments` era de IMAGEM (procedure_id NOT NULL,
--     tipado por modality_type DICOM). Agora o agendamento ganha um KIND:
--     imaging | consultation | teleconsultation.
--   · Consulta/teleconsulta NÃO têm procedimento de imagem → procedure_id passa a
--     ser NULL-ável; em troca guardam specialty/reason e o médico (assigned_doctor).
--   · O check-in de uma consulta abre/liga um `ehr.encounters` (encounter_id),
--     unindo agenda (RIS) e atendimento (PEP).
-- =============================================================================
ALTER TABLE ris.appointments
  ADD COLUMN IF NOT EXISTS appointment_kind VARCHAR(16) NOT NULL DEFAULT 'imaging',
  ADD COLUMN IF NOT EXISTS specialty        VARCHAR(80),
  ADD COLUMN IF NOT EXISTS reason           TEXT,
  ADD COLUMN IF NOT EXISTS encounter_id     UUID REFERENCES ehr.encounters(id) ON DELETE SET NULL;

-- procedure_id deixa de ser obrigatório (consulta/teleconsulta não têm). Imagem
-- continua exigindo procedure_id por validação na aplicação (não no banco).
ALTER TABLE ris.appointments ALTER COLUMN procedure_id DROP NOT NULL;

-- Integridade: imagem tem procedimento; clínico tem médico designado.
DO $$ BEGIN
  ALTER TABLE ris.appointments ADD CONSTRAINT chk_appt_kind CHECK (
    (appointment_kind = 'imaging' AND procedure_id IS NOT NULL)
    OR (appointment_kind IN ('consultation','teleconsultation'))
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_appt_kind ON ris.appointments(appointment_kind, scheduled_at);

-- =============================================================================
-- 21. Correções pré-lançamento (auditoria 2026-10-02)
-- =============================================================================

-- 21.1 Status do paciente em consulta/teleconsulta ----------------------------
-- O check-in clínico grava 'aguardando atendimento' em ris.patients.current_status;
-- o valor não existia no enum (500 no check-in). Comando solto, fora de DO: o novo
-- valor só pode ser USADO após o commit, então nada nesta migração o referencia.
ALTER TYPE ris.patient_current_status ADD VALUE IF NOT EXISTS 'aguardando atendimento';

-- 21.2 Estudos que chegam do equipamento (C-STORE) ----------------------------
-- O Orthanc avisa o backend (Lua OnStableStudy → webhook) e o RIS vincula o estudo
-- ao agendamento pelo AccessionNumber da worklist ou ao paciente pelo PatientID.
-- orthanc_study_id: id do estudo no Orthanc (varredura de segurança sabe o que já entrou).
ALTER TABLE pacs.studies ADD COLUMN IF NOT EXISTS orthanc_study_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_studies_orthanc ON pacs.studies(orthanc_study_id);

-- 21.3 Fila de conciliação — estudo sem agendamento/paciente correspondente ----
-- Nunca se cria paciente com CPF falso para "encaixar" um estudo: ele espera aqui
-- até o técnico vincular a um paciente (ou descartar). Dados do DICOM são PII →
-- nome e PatientID ficam cifrados.
CREATE TABLE IF NOT EXISTS pacs.unmatched_studies (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  orthanc_study_id       VARCHAR(64)  NOT NULL,
  study_instance_uid     VARCHAR(64)  NOT NULL,
  accession_number       VARCHAR(64),
  dicom_patient_name_enc BYTEA,
  dicom_patient_id_enc   BYTEA,
  modality_type          ris.modality_type,
  study_description      VARCHAR(200),
  study_date             DATE,
  number_of_instances    INTEGER      NOT NULL DEFAULT 0,
  reason                 TEXT,
  status                 VARCHAR(12)  NOT NULL DEFAULT 'pending',
  matched_study_id       UUID         REFERENCES pacs.studies(id) ON DELETE SET NULL,
  resolved_by            UUID         REFERENCES auth.users(id)   ON DELETE SET NULL,
  resolved_at            TIMESTAMPTZ,
  received_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_unmatched_study_uid UNIQUE (study_instance_uid),
  CONSTRAINT chk_unmatched_status CHECK (status IN ('pending', 'matched', 'discarded'))
);
CREATE INDEX IF NOT EXISTS idx_unmatched_status ON pacs.unmatched_studies(status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_unmatched_orthanc ON pacs.unmatched_studies(orthanc_study_id);

-- 21.4 Senha provisória: troca obrigatória no 1º acesso ------------------------
-- Admin cria/reseta a conta com senha gerada pelo backend → o funcionário é obrigado a
-- trocá-la ao entrar (POST /auth/change-password limpa a marca).
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS password_changed_at  TIMESTAMPTZ;

-- 21.5 Check-in: como a identidade foi conferida -------------------------------
-- cpf | cns | document (conferência visual de documento com foto). O check-in não cria mais
-- conta do portal nem exige senha.
ALTER TABLE ris.appointments
  ADD COLUMN IF NOT EXISTS identity_verified_by VARCHAR(16),
  ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ;

-- 21.6 Anonimização de paciente (LGPD art. 16 × guarda de prontuário) -----------
-- Prontuário/laudo assinado deve ser guardado por 20 anos (CFM 1.821/2007; LGPD art. 16, I
-- permite reter por obrigação legal). Em vez de apagar o registro clínico, o cadastro é
-- ANONIMIZADO: identificadores zerados, vínculo clínico preservado por pseudônimo.
ALTER TABLE ris.patients ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

-- 21.7 Canário da chave de criptografia -----------------------------------------
-- Linha única cifrada com ENCRYPTION_KEY. No boot a API tenta decifrá-la: chave errada no .env
-- (deploy com .env trocado) faz o sistema recusar subir com mensagem clara, em vez de
-- listar tudo como "[ilegível]" e gravar dados novos com a chave errada.
CREATE TABLE IF NOT EXISTS ris.system_canary (
  id         SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  value_enc  BYTEA       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 21.8 Busca de paciente por nome parcial (blind index por palavra) ---------------
-- O nome é cifrado; antes só casava o nome COMPLETO exato (ou parcial + data de nascimento). Aqui
-- cada palavra do nome (sem acento, minúscula) vira HMAC-SHA256 — também dos prefixos de 3+
-- letras — guardados SEM o nome em claro. Sem a ENCRYPTION_KEY o índice não permite ataque de
-- dicionário. "silva" / "mar sil" encontram "Maria da Silva".
CREATE TABLE IF NOT EXISTS ris.patient_name_tokens (
  patient_id UUID     NOT NULL REFERENCES ris.patients(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  PRIMARY KEY (patient_id, token_hash)
);
CREATE INDEX IF NOT EXISTS idx_patient_name_tokens ON ris.patient_name_tokens(token_hash);

-- =============================================================================
-- FIM DO SCHEMA
-- =============================================================================
