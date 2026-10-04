'use strict';
/**
 * PDF de documento assinado, GARANTIDO sob demanda.
 * --------------------------------------------------------------------
 * Ao assinar receita/atestado/evolução/laudo o PDF é gerado e guardado no RustFS — mas se o
 * Puppeteer ou o storage falharem naquele instante, o documento fica assinado SEM PDF. Aqui o
 * PDF é regenerado a partir dos dados assinados (mesmo template) quando alguém o pede:
 *
 *   · laudo: o HTML canônico assinado já está em `ris.reports.content_html`;
 *   · receita / atestado / evolução: o HTML é reconstruído com o MESMO `signed_at` do momento
 *     da assinatura (vem no payload do JWT) e conferido contra `signature_hash`. Divergência
 *     (dado cadastral alterado depois) é registrada em log, mas o PDF é entregue assim mesmo.
 *
 * `ensurePdf(kind, id)` devolve { bucket, key } de um PDF que existe de fato no storage.
 */
const crypto = require('crypto');
const db = require('../config/database');
const storage = require('../config/storage');
const enc = require('./encryption');
const logger = require('../config/logger');
const { renderHtmlToPdf } = require('./pdfRenderer');
const { AppError, NotFoundError } = require('../utils/errors');

const inflight = new Map();   // kind:id → Promise (não gera o mesmo PDF duas vezes ao mesmo tempo)

function signedAtFromJwt(jwtStr) {
  try {
    return JSON.parse(Buffer.from(String(jwtStr).split('.')[1], 'base64url').toString()).signedAt || null;
  } catch { return null; }
}
const sha = (html) => crypto.createHash('sha256').update(html, 'utf8').digest('hex');

// ── Montagem do HTML por tipo ──────────────────────────────────────────────────
const KINDS = {
  report: {
    bucket: () => storage.BUCKETS.REPORTS,
    key: (id) => `reports/${id}.pdf`,
    async load(id) {
      const { rows } = await db.query(
        `SELECT pdf_storage_key, status, content_html FROM ris.reports WHERE id = $1`, [id]);
      if (!rows.length) throw new NotFoundError('Laudo');
      const r = rows[0];
      if (!['signed', 'amended'].includes(r.status)) throw new AppError('PDF disponível apenas para laudos assinados', 422);
      if (!r.content_html) throw new AppError('Laudo sem documento assinado para regerar o PDF', 409, 'NO_SIGNED_HTML');
      return { pdfKey: r.pdf_storage_key, html: r.content_html };
    },
    table: 'ris.reports',
  },

  prescription: {
    bucket: () => storage.BUCKETS.DOCUMENTS,
    key: (id) => `prescriptions/${id}.pdf`,
    async load(id) {
      const { rows } = await db.query(
        `SELECT rx.*, p.name_encrypted, p.birth_date, p.medical_record_number,
                u.name AS prescriber_name, u.crm, u.crm_uf,
                hu.name AS unit_name, hu.cnes AS unit_cnes
           FROM ehr.prescriptions rx
           JOIN ris.patients p ON p.id = rx.patient_id
           JOIN auth.users u ON u.id = rx.prescriber_id
           LEFT JOIN ehr.encounters e ON e.id = rx.encounter_id
           LEFT JOIN ris.health_units hu ON hu.id = e.health_unit_id
          WHERE rx.id = $1`, [id]);
      if (!rows.length) throw new NotFoundError('Prescrição');
      const rx = rows[0];
      if (rx.status !== 'signed') throw new AppError('PDF disponível apenas para documento assinado', 404, 'NOT_SIGNED');
      const { rows: items } = await db.query(
        `SELECT * FROM ehr.prescription_items WHERE prescription_id = $1 ORDER BY created_at`, [id]);
      const { buildRxHtml } = require('../modules/ehr/ehr.clinical.controller');
      const base = {
        patient: { name: enc.decrypt(rx.name_encrypted), birth_date: rx.birth_date, medical_record_number: rx.medical_record_number },
        prescriber: { name: rx.prescriber_name, crm: rx.crm, crm_uf: rx.crm_uf },
        unit: { name: rx.unit_name, cnes: rx.unit_cnes },
        rx_type: rx.rx_type, items, notes: rx.notes,
        control: rx.control_number ? { number: rx.control_number, year: rx.control_year } : null,
      };
      return build(rx, (sig) => buildRxHtml({ ...base, signature: sig }));
    },
    table: 'ehr.prescriptions',
  },

  certificate: {
    bucket: () => storage.BUCKETS.DOCUMENTS,
    key: (id) => `certificates/${id}.pdf`,
    async load(id) {
      const { rows } = await db.query(
        `SELECT c.*, p.name_encrypted, p.birth_date, p.medical_record_number,
                u.name AS issuer_name, u.crm, u.crm_uf,
                hu.name AS unit_name, hu.cnes AS unit_cnes
           FROM ehr.certificates c
           JOIN ris.patients p ON p.id = c.patient_id
           JOIN auth.users u ON u.id = c.issuer_id
           LEFT JOIN ehr.encounters e ON e.id = c.encounter_id
           LEFT JOIN ris.health_units hu ON hu.id = e.health_unit_id
          WHERE c.id = $1`, [id]);
      if (!rows.length) throw new NotFoundError('Atestado');
      const c = rows[0];
      if (c.status !== 'signed') throw new AppError('PDF disponível apenas para documento assinado', 404, 'NOT_SIGNED');
      const { buildCertHtml } = require('../modules/ehr/ehr.clinical.controller');
      const base = {
        patient: { name: enc.decrypt(c.name_encrypted), birth_date: c.birth_date, medical_record_number: c.medical_record_number },
        issuer: { name: c.issuer_name, crm: c.crm, crm_uf: c.crm_uf },
        unit: { name: c.unit_name, cnes: c.unit_cnes },
        cert_type: c.cert_type, content: enc.decrypt(c.content_enc), days_off: c.days_off, cid10_code: c.cid10_code,
      };
      return build(c, (sig) => buildCertHtml({ ...base, signature: sig }));
    },
    table: 'ehr.certificates',
  },

  note: {
    bucket: () => storage.BUCKETS.DOCUMENTS,
    key: (id) => `clinical-notes/${id}.pdf`,
    async load(id) {
      const { rows } = await db.query(
        `SELECT n.*, e.encounter_type, e.started_at,
                p.name_encrypted, p.birth_date, p.gender, p.medical_record_number,
                au.name AS author_name, au.crm, au.crm_uf, au.specialty,
                hu.name AS unit_name, hu.cnes AS unit_cnes
           FROM ehr.clinical_notes n
           JOIN ehr.encounters e ON e.id = n.encounter_id
           JOIN ris.patients p ON p.id = n.patient_id
           JOIN auth.users au ON au.id = n.author_id
           LEFT JOIN ris.health_units hu ON hu.id = e.health_unit_id
          WHERE n.id = $1`, [id]);
      if (!rows.length) throw new NotFoundError('Evolução');
      const n = rows[0];
      if (!['signed', 'amended'].includes(n.status)) throw new AppError('PDF disponível apenas para evolução assinada', 404, 'NOT_SIGNED');
      const { buildNoteHtml } = require('../modules/ehr/ehr.controller');
      const base = {
        patient: { name: enc.decrypt(n.name_encrypted), birth_date: n.birth_date, gender: n.gender, medical_record_number: n.medical_record_number },
        author: { name: n.author_name, crm: n.crm, crm_uf: n.crm_uf, specialty: n.specialty },
        unit: { name: n.unit_name, cnes: n.unit_cnes },
        encounter: { encounter_type: n.encounter_type, started_at: n.started_at },
        soap: { subjective: enc.decrypt(n.subjective_enc), objective: enc.decrypt(n.objective_enc),
                assessment: enc.decrypt(n.assessment_enc), plan: enc.decrypt(n.plan_enc) },
        cid10: n.cid10_codes || [],
      };
      return build(n, (sig) => buildNoteHtml({ ...base, signature: sig }));
    },
    table: 'ehr.clinical_notes',
  },
};

// Reconstrói o HTML assinado com o signed_at ORIGINAL e confere o hash.
function build(row, htmlFor) {
  const signedAt = signedAtFromJwt(row.signature_jwt) || new Date(row.signed_at).toISOString();
  const hash = row.signature_hash ? String(row.signature_hash).trim() : null;
  const reproduced = sha(htmlFor({ signed_at: signedAt })) === hash;
  if (hash && !reproduced) {
    logger.warn('[pdf] documento regerado difere do hash assinado (dado alterado após a assinatura?)', { id: row.id });
  }
  return { pdfKey: row.pdf_storage_key, html: htmlFor({ signed_at: signedAt, hash }) };
}

async function generate(kind, id) {
  const def = KINDS[kind];
  if (!def) throw new Error(`tipo de documento desconhecido: ${kind}`);
  const bucket = def.bucket();
  const { pdfKey, html } = await def.load(id);
  if (pdfKey && await storage.exists(bucket, pdfKey)) return { bucket, key: pdfKey };

  logger.warn('[pdf] documento assinado sem PDF no storage — regenerando sob demanda', { kind, id });
  let buf;
  try { buf = await renderHtmlToPdf(html); }
  catch (err) { throw new AppError('Não foi possível gerar o PDF agora. Tente novamente em instantes.', 503, 'PDF_RENDER_FAILED'); }
  const key = def.key(id);
  try { await storage.upload(bucket, key, buf, 'application/pdf'); }
  catch (err) { throw new AppError('Armazenamento indisponível para salvar o PDF. Tente novamente em instantes.', 503, 'STORAGE_UNAVAILABLE'); }
  const extra = kind === 'report' ? ', pdf_size_bytes = $3' : '';
  await db.query(`UPDATE ${def.table} SET pdf_storage_key = $2${extra} WHERE id = $1`,
    kind === 'report' ? [id, key, buf.length] : [id, key]);
  return { bucket, key };
}

/** PDF existente (ou regerado) de um documento assinado. */
function ensurePdf(kind, id) {
  const k = `${kind}:${id}`;
  if (!inflight.has(k)) inflight.set(k, generate(kind, id).finally(() => inflight.delete(k)));
  return inflight.get(k);
}

module.exports = { ensurePdf };
