'use strict';
/**
 * Portal do Paciente — acesso externo por CPF + senha
 * Conforme LGPD e RDC 611/2022 (ANVISA)
 */
const { Router }  = require('express');
const bcrypt       = require('bcryptjs');
const db           = require('../../config/database');
const enc          = require('../../services/encryption');
const storage      = require('../../config/storage');
const { ensurePdf } = require('../../services/documentPdf');
const audit        = require('../../services/audit');
const { success, created } = require('../../utils/response');
const { AppError, NotFoundError } = require('../../utils/errors');
const { authLimiter, portalLimiter, portalSensitiveLimiter, portalStreamLimiter } = require('../../middlewares/rateLimiter');
const { generatePortalJwt, verifyPortalJwt } = require('../../services/portalToken');
const env          = require('../../config/env');

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────
function normalizeCpf(cpf) {
  return cpf.replace(/[.-]/g, '').trim();
}

async function requirePortalAuth(req, res, next) {
  const token = req.headers['x-portal-token'] || req.cookies?.portal_token;
  if (!token) return next(new AppError('Autenticação necessária', 401));
  try {
    req.portalUser = verifyPortalJwt(token);
    next();
  } catch (e) {
    next(new AppError(e.message === 'EXPIRED' ? 'Sessão expirada' : 'Token inválido', 401));
  }
}

// ── CRIAR CONTA (check-in) ────────────────────────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
  const { cpf, password, patient_id } = req.body;
  if (!cpf || !password || !patient_id)
    throw new AppError('CPF, senha e patient_id são obrigatórios', 422);

  if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password))
    throw new AppError('Senha fraca: mínimo 8 caracteres, 1 maiúscula e 1 número', 422);

  const cpfClean = normalizeCpf(cpf);
  const cpfHash  = enc.searchHash(cpfClean);

  const { rows: pRows } = await db.query(
    `SELECT id FROM ris.patients WHERE id=$1 AND cpf_hash=$2`, [patient_id, cpfHash]
  );
  if (!pRows.length) throw new AppError('CPF não corresponde ao cadastro', 422);

  const { rows: existing } = await db.query(
    `SELECT id FROM ris.patient_portal_accounts WHERE patient_id=$1`, [patient_id]
  );
  if (existing.length) throw new AppError('Paciente já possui conta no portal', 409);

  const hash = await bcrypt.hash(password, 12);
  const { rows } = await db.query(
    `INSERT INTO ris.patient_portal_accounts (patient_id, cpf_hash, password_hash)
     VALUES ($1,$2,$3) RETURNING id, created_at`,
    [patient_id, cpfHash, hash]
  );

  await audit.log({ action:'PORTAL_ACCOUNT_CREATED', resourceType:'patient', resourceId:patient_id, ipAddress:req.ip });
  return created(res, { id: rows[0].id }, 'Conta criada com sucesso');
});

// ── LOGIN POR CPF + SENHA ────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  const { cpf, password } = req.body;
  if (!cpf || !password) throw new AppError('CPF e senha são obrigatórios', 422);

  const cpfHash = enc.searchHash(normalizeCpf(cpf));

  const { rows } = await db.query(
    `SELECT pa.*, p.name_encrypted, p.medical_record_number
     FROM ris.patient_portal_accounts pa
     JOIN ris.patients p ON p.id = pa.patient_id
     WHERE pa.cpf_hash=$1`, [cpfHash]
  );

  const account = rows[0];

  // Timing-safe: sempre rodar bcrypt mesmo se não achar conta
  if (!account) {
    await bcrypt.compare(password, '$2b$12$invalidhashfortimingattack000000000000000000');
    throw new AppError('CPF ou senha inválidos', 401);
  }

  if (!account.is_active) throw new AppError('Conta inativa', 401);
  if (account.locked_until && new Date(account.locked_until) > new Date())
    throw new AppError('Conta bloqueada temporariamente. Tente em 15 minutos.', 423);

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) {
    const attempts = account.failed_attempts + 1;
    const locked   = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
    await db.query(
      `UPDATE ris.patient_portal_accounts SET failed_attempts=$1, locked_until=$2 WHERE id=$3`,
      [attempts, locked, account.id]
    );
    throw new AppError('CPF ou senha inválidos', 401);
  }

  await db.query(
    `UPDATE ris.patient_portal_accounts
     SET failed_attempts=0, locked_until=NULL, last_login_at=NOW(), last_login_ip=$1
     WHERE id=$2`,
    [req.ip, account.id]
  );

  const token = generatePortalJwt(account.id, account.patient_id, account.health_unit_id);

  await audit.log({
    action:'PORTAL_LOGIN', resourceType:'patient', resourceId:account.patient_id,
    ipAddress:req.ip, userAgent:req.headers['user-agent'],
  });

  res.cookie('portal_token', token, {
    httpOnly: true, secure: env.NODE_ENV === 'production',
    sameSite: 'strict', maxAge: 8 * 3600 * 1000, path: '/api/v1/patient-portal',
  });

  return success(res, {
    token,
    patient: {
      id:    account.patient_id,
      name:  enc.safeDecrypt(account.name_encrypted),
      mrn:   account.medical_record_number,
    },
  }, 'Login realizado com sucesso');
});

// ── MEUS EXAMES ──────────────────────────────────────────────────────────────
router.get('/exams', portalLimiter, requirePortalAuth, async (req, res) => {
  const patientId = req.portalUser.pid;

  const { rows } = await db.query(
    `SELECT
       a.id AS appointment_id,
       a.scheduled_at,
       a.status AS appointment_status,
       proc.name AS procedure_name,
       proc.modality_type,
       s.id AS study_id,
       s.study_instance_uid,
       s.accession_number,
       s.study_date,
       s.display_status,
       s.number_of_series,
       s.number_of_instances,
       r.id AS report_id,
       r.status AS report_status,
       r.signed_at,
       r.share_token,
       u.name AS radiologist_name,
       so.id AS second_opinion_id,
       so.status AS second_opinion_status
     FROM ris.appointments a
     JOIN ris.procedures proc ON proc.id = a.procedure_id
     -- s.patient_id = a.patient_id garante que só aparece o estudo que REALMENTE
     -- pertence a este paciente (um estudo é de um único dono); evita expor/abrir
     -- no viewer um estudo cujo appointment foi religado a outro paciente.
     LEFT JOIN pacs.studies s ON s.appointment_id = a.id AND s.patient_id = a.patient_id
     LEFT JOIN ris.reports r  ON r.study_id = s.id AND r.status IN ('signed','amended')
     LEFT JOIN auth.users u   ON u.id = r.radiologist_id
     LEFT JOIN ris.second_opinions so ON so.study_id = s.id AND so.status NOT IN ('resolved','cancelled')
     WHERE a.patient_id = $1
     ORDER BY a.scheduled_at DESC
     LIMIT 50`,
    [patientId]
  );

  await audit.log({
    action:'PORTAL_EXAM_LIST', resourceType:'patient', resourceId:patientId, ipAddress:req.ip,
  });

  return success(res, rows);
});

// ── DETALHE DO EXAME + STATUS VISUAL ─────────────────────────────────────────
router.get('/exams/:studyId', portalLimiter, requirePortalAuth, async (req, res) => {
  const patientId = req.portalUser.pid;
  const { studyId } = req.params;

  const { rows } = await db.query(
    `SELECT s.*, r.status AS report_status, r.share_token, r.signed_at,
            r.findings, r.conclusion, r.recommendations, r.content_html,
            r.pdf_storage_key, u.name AS radiologist_name, u.crm, u.crm_uf,
            proc.name AS procedure_name
     FROM pacs.studies s
     JOIN ris.appointments a   ON a.id = s.appointment_id
     JOIN ris.procedures proc  ON proc.id = a.procedure_id
     LEFT JOIN ris.reports r   ON r.study_id = s.id AND r.status IN ('signed','amended')
     LEFT JOIN auth.users u    ON u.id = r.radiologist_id
     WHERE s.id=$1 AND s.patient_id=$2`,
    [studyId, patientId]
  );

  if (!rows.length) throw new NotFoundError('Exame');

  await audit.log({
    action:'PORTAL_EXAM_VIEWED', resourceType:'study', resourceId:studyId, ipAddress:req.ip,
  });

  return success(res, rows[0]);
});

// ── DOWNLOAD DO LAUDO (PDF) ───────────────────────────────────────────────────
router.get('/exams/:studyId/pdf', portalLimiter, requirePortalAuth, async (req, res) => {
  const patientId = req.portalUser.pid;
  const { studyId } = req.params;

  const { rows } = await db.query(
    `SELECT r.id FROM ris.reports r
     JOIN pacs.studies s ON s.id = r.study_id
     WHERE r.study_id=$1 AND s.patient_id=$2 AND r.status IN ('signed','amended')`,
    [studyId, patientId]
  );

  if (!rows.length)
    throw new AppError('PDF não disponível', 404, 'PDF_NOT_AVAILABLE');
  // Regera sob demanda se o PDF não foi guardado na assinatura.
  const pdf = await ensurePdf('report', rows[0].id);

  // Stream pelo backend: o RustFS só é alcançável na rede Docker, então uma
  // URL pré-assinada apontaria para um host inacessível ao navegador.
  const body = await storage.getStream(pdf.bucket, pdf.key);

  await audit.log({
    action:'PORTAL_REPORT_DOWNLOADED', resourceType:'study', resourceId:studyId, ipAddress:req.ip,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="laudo-${studyId.slice(0, 8)}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return body.pipe(res);
});

// ── STATUS VISUAL DO EXAME ────────────────────────────────────────────────────
router.get('/exams/:studyId/status', portalLimiter, requirePortalAuth, async (req, res) => {
  const patientId = req.portalUser.pid;
  const { studyId } = req.params;

  const { rows } = await db.query(
    `SELECT s.display_status, s.status AS pacs_status,
            r.status AS report_status, so.status AS second_opinion_status
     FROM pacs.studies s
     LEFT JOIN ris.reports r ON r.study_id = s.id AND r.status NOT IN ('cancelled')
     LEFT JOIN ris.second_opinions so ON so.study_id = s.id AND so.status NOT IN ('resolved','cancelled')
     WHERE s.id=$1 AND s.patient_id=$2`,
    [studyId, patientId]
  );

  if (!rows.length) throw new NotFoundError('Exame');

  const row = rows[0];

  const statusLabels = {
    scheduled:      { label: 'Agendado',          color: '#3b82f6', icon: '📅' },
    arrived:        { label: 'Paciente Chegou',    color: '#8b5cf6', icon: '🏥' },
    in_progress:    { label: 'Realizando Exame',   color: '#f59e0b', icon: '🔬' },
    processing:     { label: 'Em Processamento',   color: '#6366f1', icon: '⚙️' },
    in_report:      { label: 'Em Laudo',           color: '#0891b2', icon: '📝' },
    second_opinion: { label: 'Revisão em Andamento',color:'#7c3aed', icon: '👨‍⚕️' },
    completed:      { label: 'Finalizado',          color: '#10b981', icon: '✅' },
  };

  const current = row.second_opinion_status === 'pending' || row.second_opinion_status === 'under_review'
    ? 'second_opinion'
    : (row.display_status || 'processing');

  const steps = [
    'scheduled', 'arrived', 'in_progress', 'processing',
    'in_report', 'second_opinion', 'completed',
  ];
  const stepIdx = steps.indexOf(current);

  return success(res, {
    current_status:  current,
    label:           statusLabels[current]?.label  ?? current,
    color:           statusLabels[current]?.color  ?? '#6b7280',
    icon:            statusLabels[current]?.icon   ?? '⏳',
    is_completed:    current === 'completed',
    has_report:      row.report_status === 'signed' || row.report_status === 'amended',
    has_second_opinion: !!row.second_opinion_status,
    steps:           steps.map((s, i) => ({
      key:       s,
      label:     statusLabels[s]?.label ?? s,
      completed: i <= stepIdx,
      current:   i === stepIdx,
    })),
  });
});

// ── LISTAR INSTÂNCIAS DO ESTUDO (para o viewer lite) ─────────────────────────
router.get('/exams/:studyId/instances', portalStreamLimiter, requirePortalAuth, async (req, res) => {
  const patientId = req.portalUser.pid;
  const { studyId } = req.params;

  // Confirma posse do estudo antes de listar (evita acessar imagem de outro paciente)
  const { rows: check } = await db.query(
    `SELECT id FROM pacs.studies WHERE id=$1 AND patient_id=$2`,
    [studyId, patientId]
  );
  if (!check.length) throw new NotFoundError('Exame');

  const { rows } = await db.query(
    `SELECT i.id, i.sop_instance_uid, i.instance_number,
            se.series_number, se.series_description, se.modality
     FROM pacs.instances i
     JOIN pacs.series se ON se.id = i.series_id
     WHERE se.study_id = $1
     ORDER BY se.series_number ASC NULLS LAST, i.instance_number ASC NULLS LAST
     LIMIT 500`,
    [studyId]
  );

  await audit.log({
    action: 'PORTAL_IMAGES_ACCESSED', resourceType: 'study', resourceId: studyId, ipAddress: req.ip,
  });

  return success(res, rows);
});

// ── STREAM DE UMA INSTÂNCIA DICOM (viewer lite) ───────────────────────────────
router.get('/exams/:studyId/instances/:instanceId/stream', portalStreamLimiter, requirePortalAuth, async (req, res) => {
  const patientId = req.portalUser.pid;
  const { studyId, instanceId } = req.params;

  const { rows } = await db.query(
    `SELECT i.storage_key
     FROM pacs.instances i
     JOIN pacs.series se ON se.id = i.series_id
     JOIN pacs.studies s  ON s.id  = se.study_id
     WHERE i.id=$1 AND se.study_id=$2 AND s.patient_id=$3`,
    [instanceId, studyId, patientId]
  );
  if (!rows.length) throw new NotFoundError('Imagem');

  const { storage_key } = rows[0];
  res.setHeader('Content-Type', 'application/dicom');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  if (storage_key.startsWith('orthanc:')) {
    // Arquivo no Orthanc — proxy via REST API interna
    const axios = require('axios');
    const { ORTHANC_URL, ORTHANC_USER, ORTHANC_PASS } = require('../../config/env');
    const orthancId = storage_key.slice(8);
    const orthancResp = await axios.get(`${ORTHANC_URL}/instances/${orthancId}/file`, {
      auth: { username: ORTHANC_USER, password: ORTHANC_PASS },
      responseType: 'stream',
      timeout: 60_000,
    });
    orthancResp.data.pipe(res);
  } else {
    // Arquivo no RustFS
    const stream = await storage.getStream(storage.BUCKETS.DICOM, storage_key);
    stream.pipe(res);
  }
});

// ── LOGOUT ────────────────────────────────────────────────────────────────────
router.post('/logout', requirePortalAuth, async (req, res) => {
  await audit.log({ action:'PORTAL_LOGOUT', resourceType:'patient', resourceId:req.portalUser.pid, ipAddress:req.ip });
  res.clearCookie('portal_token', { path: '/api/v1/patient-portal' });
  return success(res, null, 'Logout realizado');
});

// ── ALTERAR SENHA ─────────────────────────────────────────────────────────────
router.post('/change-password', portalSensitiveLimiter, requirePortalAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) throw new AppError('Senhas obrigatórias', 422);
  if (new_password.length < 8 || !/[A-Z]/.test(new_password) || !/[0-9]/.test(new_password))
    throw new AppError('Nova senha fraca: mínimo 8 chars, 1 maiúscula e 1 número', 422);

  const { rows } = await db.query(
    `SELECT password_hash FROM ris.patient_portal_accounts WHERE id=$1`, [req.portalUser.sub]
  );
  if (!rows.length) throw new NotFoundError('Conta');

  const valid = await bcrypt.compare(current_password, rows[0].password_hash);
  if (!valid) throw new AppError('Senha atual incorreta', 401);

  const hash = await bcrypt.hash(new_password, 12);
  await db.query(`UPDATE ris.patient_portal_accounts SET password_hash=$1, updated_at=NOW() WHERE id=$2`,
    [hash, req.portalUser.sub]);

  await audit.log({ action:'PORTAL_PASSWORD_CHANGED', resourceType:'patient', resourceId:req.portalUser.pid, ipAddress:req.ip });
  return success(res, null, 'Senha alterada com sucesso');
});

// ── Sumário clínico do paciente (PEP, somente leitura) ──────────────────────────
// Expõe ao próprio paciente listas estruturadas: alergias, problemas ativos,
// medicamentos em uso e vacinas. NÃO expõe evoluções SOAP nem texto livre clínico
// (decisão de design: a evolução clínica fica restrita à equipe assistencial).
router.get('/clinical-summary', portalLimiter, requirePortalAuth, async (req, res) => {
  const patientId = req.portalUser.pid;
  const [allergies, problems, medications, immunizations] = await Promise.all([
    db.query(
      `SELECT allergen, allergen_type, severity FROM ehr.allergies
        WHERE patient_id=$1 AND status='active'
        ORDER BY array_position(ARRAY['severe','moderate','mild','unknown']::text[], severity::text)`, [patientId]),
    db.query(
      `SELECT title, cid10_code, is_chronic FROM ehr.problems
        WHERE patient_id=$1 AND status='active' ORDER BY is_chronic DESC, created_at DESC`, [patientId]),
    db.query(
      `SELECT name, dose, route, frequency FROM ehr.medications
        WHERE patient_id=$1 AND status='active' ORDER BY created_at DESC`, [patientId]),
    db.query(
      `SELECT vaccine, dose_label, applied_at, status FROM ehr.immunizations
        WHERE patient_id=$1 ORDER BY applied_at DESC NULLS LAST LIMIT 50`, [patientId]),
  ]);
  await audit.log({ action: 'PORTAL_CLINICAL_VIEWED', resourceType: 'patient', resourceId: patientId, ipAddress: req.ip });
  return success(res, {
    allergies: allergies.rows, problems: problems.rows,
    medications: medications.rows, immunizations: immunizations.rows,
  });
});

// ── MEUS AGENDAMENTOS (imagem + consulta + teleconsulta) ──────────────────────
// O portal era só imagem (estudos). Aqui o paciente vê TODOS os agendamentos —
// próximos e passados — inclusive consultas/teleconsultas, com o link da sala
// quando houver teleconsulta criada.
router.get('/appointments', portalLimiter, requirePortalAuth, async (req, res) => {
  const patientId = req.portalUser.pid;
  const { rows } = await db.query(
    `SELECT a.id, a.appointment_kind, a.scheduled_at, a.status, a.specialty,
            proc.name AS procedure_name, proc.modality_type,
            doc.name AS doctor_name,
            t.room_token AS tele_room_token, t.status AS tele_status
       FROM ris.appointments a
       LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id
       LEFT JOIN auth.users doc ON doc.id = a.assigned_doctor_id
       LEFT JOIN ehr.teleconsultations t
         ON t.appointment_id = a.id AND t.status IN ('created','active')
      WHERE a.patient_id = $1
      ORDER BY a.scheduled_at DESC
      LIMIT 100`,
    [patientId]
  );
  await audit.log({ action: 'PORTAL_APPOINTMENTS_LIST', resourceType: 'patient', resourceId: patientId, ipAddress: req.ip });
  return success(res, rows);
});

// ── TELECONSULTA ATIVA (sala aberta pelo médico) ──────────────────────────────
router.get('/teleconsult', portalLimiter, requirePortalAuth, async (req, res) => {
  const patientId = req.portalUser.pid;
  const { rows } = await db.query(
    `SELECT room_token, status FROM ehr.teleconsultations
      WHERE patient_id = $1 AND status IN ('created','active')
      ORDER BY created_at DESC LIMIT 1`,
    [patientId]
  );
  return success(res, rows[0] || null);
});

// ── MINHAS RECEITAS (prescrições assinadas) ───────────────────────────────────
router.get('/prescriptions', portalLimiter, requirePortalAuth, async (req, res) => {
  const patientId = req.portalUser.pid;
  const { rows } = await db.query(
    `SELECT rx.id, rx.rx_type, rx.signed_at, rx.created_at, (rx.pdf_storage_key IS NOT NULL) AS pdf_available,
            COALESCE(json_agg(json_build_object(
              'drug_name', it.drug_name, 'dose', it.dose, 'route', it.route,
              'frequency', it.frequency, 'duration', it.duration
            ) ORDER BY it.created_at) FILTER (WHERE it.id IS NOT NULL), '[]') AS items
       FROM ehr.prescriptions rx
       LEFT JOIN ehr.prescription_items it ON it.prescription_id = rx.id
      WHERE rx.patient_id = $1 AND rx.status = 'signed'
      GROUP BY rx.id
      ORDER BY rx.signed_at DESC NULLS LAST
      LIMIT 50`,
    [patientId]
  );
  await audit.log({ action: 'PORTAL_RX_LIST', resourceType: 'patient', resourceId: patientId, ipAddress: req.ip });
  return success(res, rows);
});

// ── MINHAS DECLARAÇÕES/ATESTADOS (assinados) ──────────────────────────────────
router.get('/certificates', portalLimiter, requirePortalAuth, async (req, res) => {
  const patientId = req.portalUser.pid;
  const { rows } = await db.query(
    `SELECT id, cert_type, signed_at, created_at, (pdf_storage_key IS NOT NULL) AS pdf_available
       FROM ehr.certificates
      WHERE patient_id = $1 AND status = 'signed'
      ORDER BY signed_at DESC NULLS LAST
      LIMIT 50`,
    [patientId]
  );
  await audit.log({ action: 'PORTAL_CERT_LIST', resourceType: 'patient', resourceId: patientId, ipAddress: req.ip });
  return success(res, rows);
});

// ── DOWNLOAD DE DOCUMENTO CLÍNICO (receita/atestado) — PDF ────────────────────
// Stream pelo backend (RustFS só é alcançável na rede Docker). Confere a posse.
function streamDocPdf(table, action) {
  return async (req, res) => {
    const patientId = req.portalUser.pid;
    const { rows } = await db.query(
      `SELECT id FROM ehr.${table}
        WHERE id = $1 AND patient_id = $2 AND status = 'signed'`,
      [req.params.id, patientId]
    );
    if (!rows.length)
      throw new AppError('Documento não disponível', 404, 'PDF_NOT_AVAILABLE');
    const pdf = await ensurePdf(table === 'prescriptions' ? 'prescription' : 'certificate', req.params.id);
    const body = await storage.getStream(pdf.bucket, pdf.key);
    await audit.log({ action, resourceType: table, resourceId: req.params.id, ipAddress: req.ip });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${table}-${String(req.params.id).slice(0, 8)}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return body.pipe(res);
  };
}
router.get('/prescriptions/:id/pdf', portalLimiter, requirePortalAuth, streamDocPdf('prescriptions', 'PORTAL_RX_DOWNLOADED'));
router.get('/certificates/:id/pdf', portalLimiter, requirePortalAuth, streamDocPdf('certificates', 'PORTAL_CERT_DOWNLOADED'));

module.exports = router;
