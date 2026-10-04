const db     = require('../../config/database');
const enc    = require('../../services/encryption');
const audit  = require('../../services/audit');
const storage = require('../../config/storage');
const { ensurePdf } = require('../../services/documentPdf');
const logger = require('../../config/logger');
const env    = require('../../config/env');
const { buildUnitFilter } = require('../../middlewares/unitVisibility');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { notify } = require('../../services/notifications');
const { renderHtmlToPdf } = require('../../services/pdfRenderer');
const { buildReportHtml } = require('../../services/reportTemplate');
const { success, created, paginated, noContent } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');

async function list(req, res) {
  const { page, limit, status } = req.query;
  const offset = (page - 1) * limit;
  const params = [req.user.sub];
  const conditions = ['r.radiologist_id = $1'];

  if (status) { params.push(status); conditions.push(`r.status = $${params.length}`); }

  // Filtro multi-unidade — via study (s.health_unit_id)
  const unitFilter = buildUnitFilter(req, 's', params);
  if (unitFilter) conditions.push(unitFilter);

  const where = conditions.join(' AND ');

  const [countRes, dataRes] = await Promise.all([
    db.query(`
      SELECT COUNT(*) FROM ris.reports r
      JOIN pacs.studies s ON s.id = r.study_id
      WHERE ${where}`, params),
    db.query(`
      SELECT r.id, r.status, r.signed_at, r.created_at, r.updated_at,
             s.study_date, s.modality_type, s.accession_number,
             p.name_encrypted, p.medical_record_number
      FROM ris.reports r
      JOIN pacs.studies s ON s.id = r.study_id
      JOIN ris.patients p ON p.id = s.patient_id
      WHERE ${where}
      ORDER BY r.updated_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  const data = dataRes.rows.map(r => ({
    ...r,
    patient_name: enc.safeDecrypt(r.name_encrypted),
    name_encrypted: undefined,
  }));

  return paginated(res, { data, total: parseInt(countRes.rows[0].count), page, limit });
}

async function getById(req, res) {
  const { rows } = await db.query(
    `SELECT r.*,
            s.study_date, s.modality_type, s.accession_number, s.study_instance_uid,
            s.number_of_series, s.number_of_instances,
            p.name_encrypted, p.birth_date, p.gender, p.medical_record_number,
            u.name AS radiologist_name, u.crm, u.crm_uf,
            t.name AS template_name
     FROM ris.reports r
     JOIN pacs.studies s ON s.id = r.study_id
     JOIN ris.patients p ON p.id = s.patient_id
     JOIN auth.users u ON u.id = r.radiologist_id
     LEFT JOIN ris.report_templates t ON t.id = r.template_id
     WHERE r.id = $1`,
    [req.params.id]
  );
  if (!rows.length) throw new NotFoundError('Laudo');

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.REPORT_VIEWED,
    resourceType: 'report',
    resourceId: req.params.id,
  });

  const row = rows[0];
  return success(res, {
    ...row,
    patient_name: enc.safeDecrypt(row.name_encrypted),
    name_encrypted: undefined,
  });
}

// Busca no catálogo CID-10 (por código ou descrição). Usado pelo picker do laudo.
async function listCid10(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return success(res, []);
  const { rows } = await db.query(
    `SELECT code, description, category
       FROM ris.cid10
      WHERE code ILIKE $1 OR lower(description) LIKE lower($2)
      ORDER BY code
      LIMIT 30`,
    [`${q}%`, `%${q}%`]
  );
  return success(res, rows);
}

// Laudo ativo (não-cancelado) do estudo; retorna { report: null } quando não existe (não é erro) —
// permite o ReportModal decidir entre editar e criar.
async function getByStudy(req, res) {
  const { studyId } = req.params;
  const { rows } = await db.query(
    `SELECT r.id, r.study_id, r.status, r.technique, r.findings, r.conclusion,
            r.recommendations, r.content_html, r.content_json, r.cid10_codes, r.signed_at,
            r.signature_hash, r.pdf_storage_key, r.radiologist_id,
            u.name AS radiologist_name, u.crm, u.crm_uf
       FROM ris.reports r
  LEFT JOIN auth.users u ON u.id = r.radiologist_id
      WHERE r.study_id = $1 AND r.status <> 'cancelled'
      ORDER BY r.created_at DESC
      LIMIT 1`,
    [studyId]
  );
  return success(res, { report: rows[0] ?? null });
}

async function create(req, res) {
  const body = req.body;

  const { rows: existing } = await db.query(
    `SELECT id, status FROM ris.reports WHERE study_id = $1 AND status NOT IN ('cancelled')`,
    [body.study_id]
  );
  if (existing.length) {
    throw new AppError(
      `Já existe um laudo (${existing[0].status}) para este estudo. Use PATCH para editar.`,
      409, 'REPORT_ALREADY_EXISTS'
    );
  }

  const { rows } = await db.query(
    `INSERT INTO ris.reports
       (study_id, appointment_id, radiologist_id, template_id,
        technique, findings, conclusion, recommendations,
        content_json, content_html, report_simple)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, status, created_at`,
    [
      body.study_id,
      body.appointment_id || null,
      req.user.sub,
      body.template_id       || null,
      body.technique         || null,
      body.findings          || null,
      body.conclusion        || null,
      body.recommendations   || null,
      body.content_json ? JSON.stringify(body.content_json) : null,
      body.content_html      || null,
      body.report_simple     || null,
    ]
  );

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.REPORT_CREATED,
    resourceType: 'report',
    resourceId: rows[0].id,
    details: { study_id: body.study_id },
  });

  return created(res, rows[0], 'Laudo criado');
}

async function update(req, res) {
  const { id } = req.params;
  const body = req.body;

  // Só pode editar rascunhos/revisão do próprio radiologista
  const { rows: existing } = await db.query(
    `SELECT id, status, radiologist_id FROM ris.reports WHERE id = $1`,
    [id]
  );
  if (!existing.length) throw new NotFoundError('Laudo');
  if (!['draft','review'].includes(existing[0].status)) {
    throw new AppError('Apenas laudos em rascunho ou revisão podem ser editados', 422, 'REPORT_NOT_EDITABLE');
  }
  if (existing[0].radiologist_id !== req.user.sub && req.user.role !== 'admin') {
    throw new AppError('Você não tem permissão para editar este laudo', 403, 'FORBIDDEN');
  }

  await db.query(
    `UPDATE ris.reports
     SET technique       = COALESCE($1, technique),
         findings        = COALESCE($2, findings),
         conclusion      = COALESCE($3, conclusion),
         recommendations = COALESCE($4, recommendations),
         content_json    = COALESCE($5, content_json),
         content_html    = COALESCE($6, content_html),
         template_id     = COALESCE($7, template_id),
         report_simple   = COALESCE($8, report_simple),
         updated_at      = NOW()
     WHERE id = $9`,
    [
      body.technique, body.findings, body.conclusion, body.recommendations,
      body.content_json ? JSON.stringify(body.content_json) : null,
      body.content_html, body.template_id, body.report_simple, id,
    ]
  );

  return success(res, { id }, 'Laudo atualizado');
}

/**
 * Validação obrigatória antes da assinatura definitiva.
 * Retorna lista de problemas (strings); vazia = OK.
 */
function validateForSign(payload) {
  const errs = [];
  const { findings, conclusion, doctor_name, doctor_crm } = payload || {};
  // Nome/CRM vêm do CADASTRO do radiologista autenticado (não do cliente) — ver sign().
  // O documento legal é renderizado server-side a partir destes campos
  // estruturados — não dependemos mais do content_html enviado pelo cliente.
  if (!findings || !findings.trim())     errs.push('Achados é obrigatório');
  if (!conclusion || !conclusion.trim()) errs.push('Impressão diagnóstica é obrigatória');
  if (!doctor_name || !doctor_name.trim()) errs.push('Nome do radiologista é obrigatório');
  if (!doctor_crm || !/^\d{3,6}/.test(String(doctor_crm).trim())) errs.push('CRM válido é obrigatório — complete o cadastro do radiologista (CRM/UF)');
  return errs;
}

async function sign(req, res) {
  const { id } = req.params;
  const {
    content_html, findings, conclusion, technique, recommendations,
    digital_certificate_sn, digital_certificate_cn,
    cid10_codes,
  } = req.body || {};
  const cidList = Array.isArray(cid10_codes)
    ? cid10_codes.filter(c => c && c.code).map(c => ({ code: String(c.code), description: String(c.description || '') }))
    : [];

  const { rows } = await db.query(
    `SELECT r.id, r.status, r.radiologist_id, r.technique, r.recommendations,
            s.patient_id, s.appointment_id, s.study_date, s.modality_type, s.accession_number,
            p.name_encrypted, p.birth_date, p.gender, p.medical_record_number,
            u.name AS radiologist_name, u.crm, u.crm_uf, u.specialty,
            hu.name AS unit_name, hu.cnes AS unit_cnes,
            hu.phone AS unit_phone, hu.email AS unit_email
     FROM ris.reports r
     JOIN pacs.studies s ON s.id = r.study_id
     JOIN ris.patients p ON p.id = s.patient_id
     JOIN auth.users u   ON u.id = r.radiologist_id
     LEFT JOIN ris.health_units hu ON hu.id = s.health_unit_id
     WHERE r.id = $1`,
    [id]
  );
  if (!rows.length) throw new NotFoundError('Laudo');

  const report = rows[0];
  if (!['draft','review'].includes(report.status)) {
    throw new AppError('Laudo não pode ser assinado neste status', 422);
  }
  if (report.radiologist_id !== req.user.sub) {
    throw new AppError('Apenas o radiologista responsável pode assinar', 403, 'FORBIDDEN');
  }

  // Identidade do signatário = cadastro do usuário autenticado (nunca o que o cliente enviar).
  const doctor_name = report.radiologist_name;
  const doctor_crm  = report.crm;
  const validationErrs = validateForSign({ content_html, findings, conclusion, doctor_name, doctor_crm });
  if (validationErrs.length) {
    throw new AppError(
      `Campos obrigatórios faltando: ${validationErrs.join('; ')}`,
      422, 'VALIDATION_FAILED'
    );
  }

  const signedAtIso = new Date().toISOString();

  // Documento renderizado server-side (não a partir do content_html do cliente): o mesmo HTML é hasheado,
  // vira PDF e é servido em /download, garantindo que assinatura, PDF e visualização sejam sempre idênticos.
  const canonicalHtml = buildReportHtml({
    patient: {
      name:                  enc.decrypt(report.name_encrypted),
      birth_date:            report.birth_date,
      gender:                report.gender,
      medical_record_number: report.medical_record_number,
    },
    study: {
      study_date:       report.study_date,
      modality_type:    report.modality_type,
      accession_number: report.accession_number,
    },
    unit: {
      name:  report.unit_name,
      cnes:  report.unit_cnes,
      phone: report.unit_phone,
      email: report.unit_email,
    },
    radiologist: {
      name:      doctor_name.trim() || report.radiologist_name,
      crm:       doctor_crm.trim()  || report.crm,
      crm_uf:    report.crm_uf,
      specialty: report.specialty,
    },
    sections: {
      technique:       technique       ?? report.technique,
      findings,
      conclusion,
      recommendations: recommendations ?? report.recommendations,
    },
    cid10: cidList,
    signature: { signed_at: signedAtIso },
  });

  // Não é assinatura ICP-Brasil A1/A3; o hash SHA-256 + JWT RS256 formam um trail criptográfico verificável.
  const signatureHash = crypto.createHash('sha256').update(canonicalHtml, 'utf8').digest('hex');
  const signatureJwt = jwt.sign(
    {
      reportId:       id,
      radiologistId:  req.user.sub,
      doctorName:     doctor_name.trim(),
      doctorCrm:      doctor_crm.trim(),
      hash:           signatureHash,
      signedAt:       signedAtIso,
      iss:            'ris-pacs',
    },
    env.JWT_PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '20y' },   // CFM 1.821 exige retenção de 20 anos
  );

  const finalHtml = buildReportHtml({
    patient: {
      name:                  enc.decrypt(report.name_encrypted),
      birth_date:            report.birth_date,
      gender:                report.gender,
      medical_record_number: report.medical_record_number,
    },
    study: {
      study_date:       report.study_date,
      modality_type:    report.modality_type,
      accession_number: report.accession_number,
    },
    unit:  { name: report.unit_name, cnes: report.unit_cnes, phone: report.unit_phone, email: report.unit_email },
    radiologist: {
      name:      doctor_name.trim() || report.radiologist_name,
      crm:       doctor_crm.trim()  || report.crm,
      crm_uf:    report.crm_uf,
      specialty: report.specialty,
    },
    sections: {
      technique:       technique       ?? report.technique,
      findings,
      conclusion,
      recommendations: recommendations ?? report.recommendations,
    },
    cid10: cidList,
    signature: { signed_at: signedAtIso, hash: signatureHash },
  });

  let pdfStorageKey = null;
  let pdfBytes      = 0;
  try {
    const pdfBuffer = await renderHtmlToPdf(finalHtml);
    pdfBytes = pdfBuffer.length;
    pdfStorageKey = `reports/${id}.pdf`;
    await storage.upload(storage.BUCKETS.REPORTS, pdfStorageKey, pdfBuffer, 'application/pdf');
    logger.info('[reports] PDF gerado e armazenado', { reportId: id, bytes: pdfBytes });
  } catch (err) {
    // PDF é importante mas não-fatal: a assinatura segue e podemos regerar depois
    logger.error('[reports] falha ao gerar/armazenar PDF', { reportId: id, message: err.message });
    pdfStorageKey = null;
  }

  await db.query(
    `UPDATE ris.reports
     SET status                  = 'signed',
         content_html            = $1,
         findings                = COALESCE($2, findings),
         conclusion              = COALESCE($3, conclusion),
         technique               = COALESCE($4, technique),
         recommendations         = COALESCE($5, recommendations),
         signature_hash          = $6,
         signature_jwt           = $7,
         signature_algorithm     = 'RS256',
         digital_certificate_sn  = $8,
         digital_certificate_cn  = $9,
         pdf_storage_key         = $10,
         pdf_size_bytes          = $11,
         cid10_codes             = $12,
         signed_at               = NOW(),
         updated_at              = NOW()
     WHERE id = $13`,
    [
      finalHtml,                              // content_html = documento canônico assinado
      findings, conclusion, technique, recommendations,
      signatureHash, signatureJwt,
      digital_certificate_sn || null, digital_certificate_cn || null,
      pdfStorageKey, pdfBytes || null,
      JSON.stringify(cidList),
      id,
    ]
  );

  // Assinar o laudo conclui o agendamento vinculado (vira 'done' / "Realizado").
  if (report.appointment_id) {
    await db.query(
      `UPDATE ris.appointments SET status = 'done', updated_at = NOW()
        WHERE id = $1 AND status NOT IN ('done','cancelled','no_show')`,
      [report.appointment_id]
    );
  }

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.REPORT_SIGNED,
    resourceType: 'report',
    resourceId: id,
    details: {
      signature_hash: signatureHash,
      signature_algorithm: 'RS256',
      pdf_stored: !!pdfStorageKey,
      certificate_sn: digital_certificate_sn,
    },
  });

  // Notificações disparadas fora do ciclo de resposta (não bloqueiam o retorno da assinatura)
  setImmediate(() => _notifyReportSigned(id, report.patient_id, req.user).catch(err =>
    logger.error('Erro ao disparar notificações pós-assinatura', { error: err.message, reportId: id })
  ));
  setImmediate(() => notify('report.signed',           { reportId: id }));
  setImmediate(() => notify('report.signed.physician', { reportId: id }));

  return success(res, {
    id,
    signed_at:       signedAtIso,
    signature_hash:  signatureHash,
    pdf_available:   !!pdfStorageKey,
    pdf_size_bytes:  pdfBytes || null,
  }, 'Laudo assinado com sucesso');
}

async function amend(req, res) {
  const { id } = req.params;
  const { reason } = req.body;

  const { rows } = await db.query(
    `UPDATE ris.reports
     SET status = 'draft', updated_at = NOW()
     WHERE id = $1 AND status = 'signed' AND radiologist_id = $2
     RETURNING id`,
    [id, req.user.sub]
  );
  if (!rows.length) throw new AppError('Laudo não pode ser reaberto', 422);

  await db.query(
    `INSERT INTO ris.report_versions (report_id, version, change_reason, changed_by)
     SELECT $1, COALESCE(MAX(version),0)+1, $2, $3
     FROM ris.report_versions WHERE report_id = $1`,
    [id, reason, req.user.sub]
  );

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.REPORT_AMENDED,
    resourceType: 'report',
    resourceId: id,
    details: { reason },
  });

  return success(res, { id }, 'Laudo reaberto para emenda');
}

async function cancel(req, res) {
  const { id } = req.params;
  // Captura se o laudo estava assinado e o agendamento vinculado, ANTES de cancelar.
  const { rows: pre } = await db.query(
    `SELECT r.status, s.appointment_id
       FROM ris.reports r JOIN pacs.studies s ON s.id = r.study_id
      WHERE r.id = $1`,
    [id]
  );
  const { rowCount } = await db.query(
    `UPDATE ris.reports SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status NOT IN ('cancelled')`,
    [id]
  );
  if (!rowCount) throw new NotFoundError('Laudo');

  // Cancelar um laudo ASSINADO reverte o agendamento de 'done' (que fora marcado
  // ao assinar) para 'in_progress' — o exame existe, mas precisa de novo laudo.
  if (pre.length && pre[0].status === 'signed' && pre[0].appointment_id) {
    await db.query(
      `UPDATE ris.appointments SET status = 'in_progress', updated_at = NOW()
        WHERE id = $1 AND status = 'done'`,
      [pre[0].appointment_id]
    );
  }
  return noContent(res);
}

async function listTemplates(req, res) {
  const { rows } = await db.query(
    `SELECT id, name, modality_type, body_part, content_json, is_global
     FROM ris.report_templates
     WHERE is_active = TRUE
       AND (is_global = TRUE OR created_by = $1)
     ORDER BY name ASC`,
    [req.user.sub]
  );
  return success(res, rows);
}

async function listAutoTexts(req, res) {
  const { q, modality } = req.query;
  const params = [req.user.sub];
  const conditions = [
    `is_active = TRUE`,
    `(scope = 'global' OR (scope = 'user' AND user_id = $1))`,
  ];

  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(shortcut ILIKE $${params.length} OR title ILIKE $${params.length})`);
  }
  if (modality) {
    params.push(modality);
    conditions.push(`(modality_type IS NULL OR modality_type = $${params.length})`);
  }

  const { rows } = await db.query(
    `SELECT id, shortcut, title, content, modality_type, scope
     FROM ris.auto_texts
     WHERE ${conditions.join(' AND ')}
     ORDER BY shortcut ASC
     LIMIT 50`,
    params
  );
  return success(res, rows);
}

async function getPdf(req, res) {
  // Se o PDF não foi gerado/guardado na assinatura, é regerado do HTML assinado (content_html).
  const { bucket, key } = await ensurePdf('report', req.params.id);

  // Stream pelo backend (o navegador não alcança o host interno do storage).
  const body = await storage.getStream(bucket, key);

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.REPORT_EXPORTED,
    resourceType: 'report',
    resourceId: req.params.id,
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="laudo-${req.params.id.slice(0, 8)}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return body.pipe(res);
}

// Versão simplificada do laudo para pacientes (sem acesso à impressão clínica detalhada)
async function getSimpleReport(req, res) {
  const { rows } = await db.query(
    `SELECT r.id, r.report_simple, r.conclusion, r.signed_at, r.status,
            u.name AS radiologist_name, u.crm, u.crm_uf,
            s.study_date, s.modality_type, s.accession_number,
            p.id AS patient_id
     FROM ris.reports r
     JOIN pacs.studies s ON s.id = r.study_id
     JOIN ris.patients p ON p.id = s.patient_id
     JOIN auth.users u   ON u.id = r.radiologist_id
     WHERE r.id = $1 AND r.status IN ('signed','amended')`,
    [req.params.id]
  );
  if (!rows.length) throw new NotFoundError('Laudo');
  return success(res, {
    id:               rows[0].id,
    summary:          rows[0].report_simple || rows[0].conclusion,
    radiologist_name: rows[0].radiologist_name,
    crm:              `${rows[0].crm}/${rows[0].crm_uf}`,
    study_date:       rows[0].study_date,
    modality_type:    rows[0].modality_type,
    accession_number: rows[0].accession_number,
    signed_at:        rows[0].signed_at,
  });
}

async function download(req, res) {
  const { rows } = await db.query(
    `SELECT r.id, r.status, r.findings, r.conclusion, r.recommendations,
            r.content_html, r.report_simple, r.technique, r.cid10_codes,
            r.signed_at, r.signature_hash, r.pdf_storage_key,
            s.study_date, s.modality_type, s.accession_number, s.study_instance_uid,
            p.name_encrypted, p.birth_date, p.gender, p.medical_record_number,
            u.name AS radiologist_name, u.crm, u.crm_uf, u.specialty,
            hu.name AS unit_name, hu.cnes AS unit_cnes, hu.type AS unit_type,
            hu.phone AS unit_phone, hu.email AS unit_email, hu.address AS unit_address
     FROM ris.reports r
     JOIN pacs.studies s ON s.id = r.study_id
     JOIN ris.patients p ON p.id = s.patient_id
     JOIN auth.users u   ON u.id = r.radiologist_id
     LEFT JOIN ris.health_units hu ON hu.id = s.health_unit_id
     WHERE r.id = $1 AND r.status IN ('signed','amended')`,
    [req.params.id]
  );
  if (!rows.length) throw new NotFoundError('Laudo não encontrado ou ainda não assinado');

  const row         = rows[0];
  const patientName = enc.decrypt(row.name_encrypted);

  // O storage (RustFS) só é alcançável dentro da rede Docker, então o PDF é transmitido pelo backend em vez de URL pré-assinada.
  {
    try {
      const { bucket, key } = await ensurePdf('report', row.id);
      const body = await storage.getStream(bucket, key);
      await audit.log({
        ...audit.fromRequest(req),
        action: audit.ACTIONS.REPORT_EXPORTED,
        resourceType: 'report',
        resourceId: req.params.id,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="laudo-${row.id.slice(0, 8)}.pdf"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return body.pipe(res);
    } catch (err) {
      logger.warn('Falha ao servir PDF do storage; caindo para HTML', {
        reportId: row.id, error: err.message,
      });
    }
  }

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.REPORT_EXPORTED,
    resourceType: 'report',
    resourceId: req.params.id,
  });

  // Registros legados não têm content_html salvo; nesse caso o documento é reconstruído a partir dos campos.
  const html = (row.content_html && row.content_html.includes('<!DOCTYPE'))
    ? row.content_html
    : buildReportHtml({
        patient:     { name: patientName, birth_date: row.birth_date, gender: row.gender, medical_record_number: row.medical_record_number },
        study:       { study_date: row.study_date, modality_type: row.modality_type, accession_number: row.accession_number },
        unit:        { name: row.unit_name, cnes: row.unit_cnes, phone: row.unit_phone, email: row.unit_email },
        radiologist: { name: row.radiologist_name, crm: row.crm, crm_uf: row.crm_uf, specialty: row.specialty },
        sections:    { technique: row.technique, findings: row.findings, conclusion: row.conclusion, recommendations: row.recommendations },
        cid10:       Array.isArray(row.cid10_codes) ? row.cid10_codes : [],
        signature:   { signed_at: row.signed_at, hash: row.signature_hash },
        forPrint:    true,
      });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="laudo-${row.id.slice(0,8)}.html"`);
  return res.send(html);
}

// Dispara notificações ao paciente e ao médico solicitante após assinatura
async function _notifyReportSigned(reportId, patientId, signingUser) {
  const { createNotification } = require('../notifications/notifications.routes');

  await db.query(
    `INSERT INTO ris.patient_notifications
       (patient_id, type, title, body, resource_type, resource_id)
     VALUES ($1, 'REPORT_READY', 'Laudo disponível', $2, 'report', $3)`,
    [patientId, 'Seu laudo já está disponível no portal. Acesse para visualizar e baixar.', reportId]
  );

  // Envio de e-mail ainda não integrado (SMTP/SendGrid pendente) — por ora só loga.
  const { rows: pRows } = await db.query(
    `SELECT p.email_encrypted FROM ris.patients p WHERE p.id = $1`, [patientId]
  );
  const email = pRows[0]?.email_encrypted ? enc.safeDecrypt(pRows[0].email_encrypted, null) : null;
  logger.info('EMAIL (simulado) → paciente: laudo disponível', { patientId, email, reportId });

  const { rows: aRows } = await db.query(
    `SELECT a.requesting_user_id, proc.name AS procedure_name
     FROM ris.reports r
     JOIN pacs.studies s ON s.id = r.study_id
     JOIN ris.appointments a ON a.id = r.appointment_id
     JOIN ris.procedures proc ON proc.id = a.procedure_id
     WHERE r.id = $1 AND a.requesting_user_id IS NOT NULL`,
    [reportId]
  );
  if (aRows.length && aRows[0].requesting_user_id !== signingUser.sub) {
    await createNotification({
      userId:       aRows[0].requesting_user_id,
      type:         'REPORT_SIGNED',
      title:        'Laudo assinado',
      body:         `O laudo de ${aRows[0].procedure_name} foi assinado pelo Dr. ${signingUser.name}.`,
      resourceType: 'report',
      resourceId:   reportId,
    });
  }

  await db.query(
    `UPDATE pacs.studies
     SET display_status = 'completed', updated_at = NOW()
     WHERE id = (SELECT study_id FROM ris.reports WHERE id = $1)`,
    [reportId]
  );

  logger.info('Notificações pós-assinatura enviadas', { reportId, patientId });
}

/**
 * Renderiza um PDF de PREVIEW do laudo (rascunho) e devolve o binário.
 * Não persiste nada; o sign() faz o documento legal definitivo.
 *
 * Dois modos:
 *   1) cliente envia content_html (ex.: "Exportar Completo" com capturas) →
 *      renderiza esse HTML como veio;
 *   2) sem content_html → reconstrói o documento canônico server-side a partir
 *      dos campos estruturados do laudo (mesma aparência do PDF assinado).
 */
async function renderPdf(req, res) {
  const { id } = req.params;
  const { content_html } = req.body || {};

  const { rows } = await db.query(
    `SELECT r.id, r.radiologist_id, r.status, r.technique, r.findings,
            r.conclusion, r.recommendations,
            s.study_date, s.modality_type, s.accession_number,
            p.name_encrypted, p.birth_date, p.gender, p.medical_record_number,
            u.name AS radiologist_name, u.crm, u.crm_uf, u.specialty,
            hu.name AS unit_name, hu.cnes AS unit_cnes, hu.phone AS unit_phone, hu.email AS unit_email
       FROM ris.reports r
       JOIN pacs.studies s ON s.id = r.study_id
       JOIN ris.patients p ON p.id = s.patient_id
       JOIN auth.users u   ON u.id = r.radiologist_id
       LEFT JOIN ris.health_units hu ON hu.id = s.health_unit_id
      WHERE r.id = $1`,
    [id]
  );
  if (!rows.length) throw new NotFoundError('Laudo');
  if (rows[0].radiologist_id !== req.user.sub && req.user.role !== 'admin') {
    throw new AppError('Sem permissão para renderizar este laudo', 403);
  }
  const row = rows[0];

  let html = content_html;
  if (!html || html.length < 100) {
    html = buildReportHtml({
      patient:     { name: enc.decrypt(row.name_encrypted), birth_date: row.birth_date, gender: row.gender, medical_record_number: row.medical_record_number },
      study:       { study_date: row.study_date, modality_type: row.modality_type, accession_number: row.accession_number },
      unit:        { name: row.unit_name, cnes: row.unit_cnes, phone: row.unit_phone, email: row.unit_email },
      radiologist: { name: row.radiologist_name, crm: row.crm, crm_uf: row.crm_uf, specialty: row.specialty },
      sections:    { technique: row.technique, findings: row.findings, conclusion: row.conclusion, recommendations: row.recommendations },
      signature:   { signed_at: new Date().toISOString() },
    });
  }

  const pdf = await renderHtmlToPdf(html);

  await audit.log({
    ...audit.fromRequest(req),
    action:       'REPORT_PDF_RENDERED',
    resourceType: 'report',
    resourceId:   id,
    details:      { bytes: pdf.length, status: rows[0].status },
  }).catch(() => { /* best-effort */ });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="laudo-${id}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.send(pdf);
}

module.exports = { list, getById, getByStudy, create, update, sign, amend, cancel, listTemplates, listAutoTexts, getPdf, getSimpleReport, download, renderPdf, listCid10 };
