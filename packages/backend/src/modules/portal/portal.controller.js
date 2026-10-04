const db = require('../../config/database');
const enc = require('../../services/encryption');
const audit = require('../../services/audit');
const storage = require('../../config/storage');
const { ensurePdf } = require('../../services/documentPdf');
const { success } = require('../../utils/response');
const { AppError, NotFoundError } = require('../../utils/errors');

// Acesso público via share_token — sem autenticação de usuário (link compartilhável do laudo)
async function resolveToken(token) {
  const { rows } = await db.query(
    `SELECT r.id, r.status, r.findings, r.conclusion, r.recommendations,
            r.content_html, r.signed_at, r.pdf_storage_key,
            r.share_expires_at, r.signature_hash,
            s.study_date, s.modality_type, s.study_description,
            s.study_instance_uid, s.accession_number,
            s.number_of_series, s.number_of_instances,
            p.name_encrypted, p.birth_date, p.gender, p.medical_record_number,
            u.name AS radiologist_name, u.crm, u.crm_uf,
            proc.name AS procedure_name
     FROM ris.reports r
     JOIN pacs.studies s ON s.id = r.study_id
     JOIN ris.patients p ON p.id = s.patient_id
     JOIN auth.users u ON u.id = r.radiologist_id
     LEFT JOIN ris.appointments a ON a.id = r.appointment_id
     LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id
     WHERE r.share_token = $1`,
    [token]
  );

  if (!rows.length) throw new NotFoundError('Laudo');

  const report = rows[0];

  if (report.status !== 'signed') {
    throw new AppError('Laudo ainda não está disponível', 403, 'REPORT_NOT_SIGNED');
  }
  if (report.share_expires_at && new Date(report.share_expires_at) < new Date()) {
    throw new AppError('Link expirado. Solicite um novo link à clínica.', 410, 'LINK_EXPIRED');
  }

  return report;
}

async function getByToken(req, res) {
  const report = await resolveToken(req.params.token);

  await audit.log({
    action: audit.ACTIONS.PORTAL_ACCESSED,
    resourceType: 'report',
    resourceId: report.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: { token: req.params.token, access: 'view' },
  });

  return success(res, {
    report: {
      id:              report.id,
      signed_at:       report.signed_at,
      findings:        report.findings,
      conclusion:      report.conclusion,
      recommendations: report.recommendations,
      content_html:    report.content_html,
      signature_hash:  report.signature_hash,
      radiologist:     { name: report.radiologist_name, crm: `${report.crm}/${report.crm_uf}` },
    },
    study: {
      study_date:       report.study_date,
      modality_type:    report.modality_type,
      study_description:report.study_description,
      accession_number: report.accession_number,
      procedure_name:   report.procedure_name,
    },
    patient: {
      name:                 enc.decrypt(report.name_encrypted),
      birth_date:           report.birth_date,
      gender:               report.gender,
      medical_record_number:report.medical_record_number,
    },
  });
}

async function getPdfByToken(req, res) {
  const report = await resolveToken(req.params.token);

  // Stream pelo backend (URL pré-assinada apontaria para o host interno do RustFS, inalcançável
  // pelo navegador) e regera o PDF sob demanda se ele não foi guardado na assinatura.
  const { bucket, key } = await ensurePdf('report', report.id);
  const body = await storage.getStream(bucket, key);

  await audit.log({
    action: audit.ACTIONS.REPORT_EXPORTED,
    resourceType: 'report',
    resourceId: report.id,
    ipAddress: req.ip,
    details: { via: 'portal_token' },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="laudo-${String(report.id).slice(0, 8)}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return body.pipe(res);
}

async function getImagesByToken(req, res) {
  const report = await resolveToken(req.params.token);

  const { rows: series } = await db.query(
    `SELECT se.id, se.series_instance_uid, se.series_number, se.series_description,
            se.modality, se.number_of_instances, se.thumbnail_key,
            json_agg(json_build_object(
              'id', i.id,
              'sop_instance_uid', i.sop_instance_uid,
              'instance_number', i.instance_number,
              'rows', i.rows,
              'columns', i.columns,
              'number_of_frames', i.number_of_frames
            ) ORDER BY i.instance_number) AS instances
     FROM pacs.series se
     JOIN pacs.instances i ON i.series_id = se.id
     WHERE se.study_id = (
       SELECT study_id FROM ris.reports WHERE share_token = $1
     )
     GROUP BY se.id
     ORDER BY se.series_number`,
    [req.params.token]
  );

  const seriesWithThumbnails = await Promise.all(
    series.map(async (s) => ({
      ...s,
      thumbnail_url: s.thumbnail_key
        ? await storage.getPresignedUrl(storage.BUCKETS.THUMBNAILS, s.thumbnail_key, 3600)
        : null,
    }))
  );

  await audit.log({
    action: audit.ACTIONS.IMAGE_VIEWED,
    resourceType: 'study',
    ipAddress: req.ip,
    details: { via: 'portal_token', token: req.params.token },
  });

  return success(res, {
    study_instance_uid: (await db.query(
      `SELECT s.study_instance_uid FROM pacs.studies s JOIN ris.reports r ON r.study_id = s.id WHERE r.share_token = $1`,
      [req.params.token]
    )).rows[0]?.study_instance_uid,
    series: seriesWithThumbnails,
    wado_url: `/api/v1/portal/wado/${req.params.token}`,
  });
}

module.exports = { getByToken, getPdfByToken, getImagesByToken };
