'use strict';
/**
 * PEP — alergias, medicamentos, anamnese/antecedentes, anexos, prescrição,
 * atestado, imunização. Mesmos padrões do ehr.controller:
 * assertClinicalAccess + criptografia PII + auditoria.
 */
const db      = require('../../config/database');
const enc     = require('../../services/encryption');
const audit   = require('../../services/audit');
const storage = require('../../config/storage');
const logger  = require('../../config/logger');
const env     = require('../../config/env');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { renderHtmlToPdf } = require('../../services/pdfRenderer');
const { success, created } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');
const { assertClinicalAccess, logClinical } = require('./ehr.access');

const A = audit.ACTIONS;
const norm = (v) => (v === undefined || v === null || v === '' ? null : v);
const esc  = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Alergias ─────────────────────────────────────────────────────────────────
async function listAllergies(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT a.id, a.allergen, a.allergen_type, a.severity, a.status,
            a.reaction_enc, a.noted_at, a.noted_by, u.name AS noted_by_name,
            a.created_at, a.updated_at
       FROM ehr.allergies a
       LEFT JOIN auth.users u ON u.id = a.noted_by
      WHERE a.patient_id = $1
      ORDER BY (a.status='active') DESC,
               array_position(ARRAY['severe','moderate','mild','unknown']::text[], a.severity::text),
               a.created_at DESC`,
    [patientId]
  );
  return success(res, rows.map((r) => ({
    id: r.id, allergen: r.allergen, allergen_type: r.allergen_type, severity: r.severity,
    status: r.status, reaction: enc.decrypt(r.reaction_enc), noted_at: r.noted_at,
    noted_by_name: r.noted_by_name, created_at: r.created_at, updated_at: r.updated_at,
  })));
}

async function createAllergy(req, res) {
  const { patient_id, allergen, allergen_type, reaction, severity, status, encounter_id } = req.body;
  await assertClinicalAccess(req, patient_id);
  const { rows } = await db.query(
    `INSERT INTO ehr.allergies
       (patient_id, allergen, allergen_type, reaction_enc, severity, status, noted_by, encounter_id)
     VALUES ($1, $2, COALESCE($3::ehr.allergy_type,'medication'), $4,
             COALESCE($5::ehr.allergy_severity,'unknown'), COALESCE($6::ehr.allergy_status,'active'), $7, $8)
     RETURNING id, allergen, allergen_type, severity, status, created_at`,
    [patient_id, allergen, norm(allergen_type), enc.encrypt(norm(reaction)),
     norm(severity), norm(status), req.user.sub, norm(encounter_id)]
  );
  await logClinical(req, A.EHR_ALLERGY_WRITE, {
    patientId: patient_id, resourceType: 'ehr_allergy', resourceId: rows[0].id,
    details: { allergen, severity: rows[0].severity },
  });
  return created(res, rows[0], 'Alergia registrada');
}

async function updateAllergy(req, res) {
  const { rows: ex } = await db.query(`SELECT patient_id FROM ehr.allergies WHERE id=$1`, [req.params.id]);
  if (!ex.length) throw new NotFoundError('Alergia');
  await assertClinicalAccess(req, ex[0].patient_id);
  const { allergen, allergen_type, reaction, severity, status } = req.body;
  await db.query(
    `UPDATE ehr.allergies SET
        allergen      = COALESCE($2, allergen),
        allergen_type = COALESCE($3::ehr.allergy_type, allergen_type),
        severity      = COALESCE($4::ehr.allergy_severity, severity),
        status        = COALESCE($5::ehr.allergy_status, status),
        reaction_enc  = CASE WHEN $6::boolean THEN $7 ELSE reaction_enc END
      WHERE id = $1`,
    [req.params.id, norm(allergen), norm(allergen_type), norm(severity), norm(status),
     reaction !== undefined, enc.encrypt(norm(reaction))]
  );
  await logClinical(req, A.EHR_ALLERGY_WRITE, {
    patientId: ex[0].patient_id, resourceType: 'ehr_allergy', resourceId: req.params.id,
  });
  return success(res, { id: req.params.id }, 'Alergia atualizada');
}

// ── Medicamentos em uso ──────────────────────────────────────────────────────
async function listMedications(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT m.id, m.name, m.dose, m.route, m.frequency, m.status, m.started_on, m.ended_on,
            m.notes_enc, m.created_at, m.updated_at, u.name AS noted_by_name
       FROM ehr.medications m
       LEFT JOIN auth.users u ON u.id = m.noted_by
      WHERE m.patient_id = $1
      ORDER BY (m.status='active') DESC, m.created_at DESC`,
    [patientId]
  );
  return success(res, rows.map((r) => ({ ...r, notes: enc.decrypt(r.notes_enc), notes_enc: undefined })));
}

async function createMedication(req, res) {
  const { patient_id, name, dose, route, frequency, status, started_on, ended_on, notes, encounter_id } = req.body;
  await assertClinicalAccess(req, patient_id);
  const { rows } = await db.query(
    `INSERT INTO ehr.medications
       (patient_id, name, dose, route, frequency, status, started_on, ended_on, notes_enc, noted_by, encounter_id)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6::ehr.med_status,'active'), $7,$8,$9,$10,$11)
     RETURNING id, name, dose, route, frequency, status, started_on, created_at`,
    [patient_id, name, norm(dose), norm(route), norm(frequency), norm(status),
     norm(started_on), norm(ended_on), enc.encrypt(norm(notes)), req.user.sub, norm(encounter_id)]
  );
  await logClinical(req, A.EHR_MEDICATION_WRITE, {
    patientId: patient_id, resourceType: 'ehr_medication', resourceId: rows[0].id, details: { name },
  });
  return created(res, rows[0], 'Medicamento registrado');
}

async function updateMedication(req, res) {
  const { rows: ex } = await db.query(`SELECT patient_id FROM ehr.medications WHERE id=$1`, [req.params.id]);
  if (!ex.length) throw new NotFoundError('Medicamento');
  await assertClinicalAccess(req, ex[0].patient_id);
  const { name, dose, route, frequency, status, started_on, ended_on, notes } = req.body;
  await db.query(
    `UPDATE ehr.medications SET
        name       = COALESCE($2, name),
        dose       = COALESCE($3, dose),
        route      = COALESCE($4, route),
        frequency  = COALESCE($5, frequency),
        status     = COALESCE($6::ehr.med_status, status),
        started_on = COALESCE($7, started_on),
        ended_on   = COALESCE($8, ended_on),
        notes_enc  = CASE WHEN $9::boolean THEN $10 ELSE notes_enc END
      WHERE id = $1`,
    [req.params.id, norm(name), norm(dose), norm(route), norm(frequency), norm(status),
     norm(started_on), norm(ended_on), notes !== undefined, enc.encrypt(norm(notes))]
  );
  await logClinical(req, A.EHR_MEDICATION_WRITE, {
    patientId: ex[0].patient_id, resourceType: 'ehr_medication', resourceId: req.params.id,
  });
  return success(res, { id: req.params.id }, 'Medicamento atualizado');
}

// ── Anamnese / antecedentes ──────────────────────────────────────────────────
async function getHistory(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT h.history_type, h.content_enc, h.updated_at, u.name AS updated_by_name
       FROM ehr.history h LEFT JOIN auth.users u ON u.id = h.updated_by
      WHERE h.patient_id = $1`,
    [patientId]
  );
  await logClinical(req, A.EHR_CLINICAL_VIEWED, { patientId, resourceType: 'ehr_history' });
  return success(res, rows.map((r) => ({
    history_type: r.history_type, content: enc.decrypt(r.content_enc),
    updated_at: r.updated_at, updated_by_name: r.updated_by_name,
  })));
}

async function upsertHistory(req, res) {
  const { patient_id, history_type, content } = req.body;
  await assertClinicalAccess(req, patient_id);
  await db.query(
    `INSERT INTO ehr.history (patient_id, history_type, content_enc, updated_by)
     VALUES ($1, $2::ehr.history_type, $3, $4)
     ON CONFLICT (patient_id, history_type)
       DO UPDATE SET content_enc = EXCLUDED.content_enc, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [patient_id, history_type, enc.encrypt(norm(content)), req.user.sub]
  );
  await logClinical(req, A.EHR_HISTORY_WRITE, {
    patientId: patient_id, resourceType: 'ehr_history', details: { history_type },
  });
  return success(res, { patient_id, history_type }, 'Antecedente salvo');
}

// ── Anexos clínicos ──────────────────────────────────────────────────────────
async function listAttachments(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT a.id, a.category, a.title, a.filename, a.mime_type, a.size_bytes,
            a.encounter_id, a.created_at, u.name AS uploaded_by_name
       FROM ehr.attachments a LEFT JOIN auth.users u ON u.id = a.uploaded_by
      WHERE a.patient_id = $1 ORDER BY a.created_at DESC`,
    [patientId]
  );
  return success(res, rows);
}

async function uploadAttachment(req, res) {
  const { patient_id, encounter_id, category, title } = req.body;
  if (!req.file) throw new AppError('Arquivo é obrigatório', 422);
  if (!patient_id) throw new AppError('patient_id é obrigatório', 422);
  await assertClinicalAccess(req, patient_id);
  const key = `attachments/${patient_id}/${crypto.randomUUID()}-${req.file.originalname}`
    .replace(/\s+/g, '_');
  await storage.upload(storage.BUCKETS.DOCUMENTS, key, req.file.buffer, req.file.mimetype, {}, req.file.size);
  const { rows } = await db.query(
    `INSERT INTO ehr.attachments
       (patient_id, encounter_id, category, title, filename, mime_type, size_bytes, storage_key, uploaded_by)
     VALUES ($1, $2, COALESCE($3::ehr.attachment_category,'document'), $4, $5, $6, $7, $8, $9)
     RETURNING id, category, title, filename, mime_type, size_bytes, created_at`,
    [patient_id, norm(encounter_id), norm(category), norm(title),
     req.file.originalname, req.file.mimetype, req.file.size, key, req.user.sub]
  );
  await logClinical(req, A.EHR_ATTACHMENT_WRITE, {
    patientId: patient_id, resourceType: 'ehr_attachment', resourceId: rows[0].id,
    details: { filename: req.file.originalname, size: req.file.size },
  });
  return created(res, rows[0], 'Anexo enviado');
}

async function downloadAttachment(req, res) {
  const { rows } = await db.query(`SELECT * FROM ehr.attachments WHERE id = $1`, [req.params.id]);
  if (!rows.length) throw new NotFoundError('Anexo');
  const att = rows[0];
  await assertClinicalAccess(req, att.patient_id);
  const body = await storage.getStream(storage.BUCKETS.DOCUMENTS, att.storage_key);
  res.setHeader('Content-Type', att.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${att.filename}"`);
  await logClinical(req, A.EHR_ATTACHMENT_VIEWED, {
    patientId: att.patient_id, resourceType: 'ehr_attachment', resourceId: att.id,
  });
  body.pipe(res);
}

// ── Documentos assinados (prescrição / atestado): HTML canônico p/ hash+PDF ────
const DOC_CSS = `body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;line-height:1.5;margin:32px}
  h1{font-size:18px;margin:0 0 4px} h2{font-size:13px;color:#444;margin:0 0 12px;font-weight:normal}
  table{width:100%;border-collapse:collapse;margin:10px 0} td,th{border-bottom:1px solid #eee;padding:5px 6px;text-align:left;vertical-align:top}
  .meta{border:1px solid #ddd;border-radius:6px;padding:8px 12px;margin:10px 0;background:#fafafa}
  .meta span{display:inline-block;margin-right:18px} .posol{color:#555;font-size:11px} pre{white-space:pre-wrap;font-family:inherit;margin:0}
  .sig{margin-top:28px;border-top:1px solid #ccc;padding-top:10px} .hash{font-size:9px;color:#777;word-break:break-all;margin:2px 0}`;

function docHeader(title, subtitle, patient, unit) {
  return `<h1>${esc(title)}</h1><h2>${esc(unit?.name || subtitle || 'Prontuário Eletrônico')}${
    unit?.cnes ? ' · CNES ' + esc(unit.cnes) : ''}</h2>
    <div class="meta">
      <span><strong>Paciente:</strong> ${esc(patient?.name)}</span>
      ${patient?.birth_date ? `<span><strong>Nasc.:</strong> ${esc(new Date(patient.birth_date).toLocaleDateString('pt-BR'))}</span>` : ''}
      ${patient?.medical_record_number ? `<span><strong>Prontuário:</strong> ${esc(patient.medical_record_number)}</span>` : ''}
    </div>`;
}
function docSignature(by, signature) {
  if (!signature?.hash) return '';
  return `<div class="sig"><p><strong>Assinado eletronicamente</strong> por ${esc(by?.name)}${
    by?.crm ? ` (CRM ${esc(by.crm)}${by.crm_uf ? '/' + esc(by.crm_uf) : ''})` : ''} em ${
    esc(new Date(signature.signed_at).toLocaleString('pt-BR'))}.</p>
    <p class="hash">Hash SHA-256: ${esc(signature.hash)}</p>
    <p class="hash">Assinatura RS256 verificável no servidor (não-ICP-Brasil).</p></div>`;
}

const RX_LABEL = { common: 'Receituário', controlled: 'Receituário de Controle Especial', antimicrobial: 'Receituário de Antimicrobiano' };
function buildRxHtml({ patient, prescriber, unit, rx_type, items, notes, signature, control }) {
  const rows = items.map((it, i) =>
    `<tr><td>${i + 1}</td><td><strong>${esc(it.drug_name)}</strong>${it.dose ? ' — ' + esc(it.dose) : ''}</td><td>${esc(it.quantity || '')}</td></tr>
     <tr><td></td><td colspan="2" class="posol">${esc([it.route, it.frequency, it.duration, it.instructions].filter(Boolean).join(' · '))}</td></tr>`
  ).join('');
  // Receituário de controle especial (Portaria 344): nº/ano impresso no topo.
  const ctrl = control && control.number
    ? `<p style="text-align:right"><strong>Receituário de Controle Especial nº ${control.number}/${control.year}</strong></p>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${DOC_CSS}</style></head><body>
    ${docHeader(RX_LABEL[rx_type] || 'Receituário', null, patient, unit)}
    ${ctrl}
    <table><thead><tr><th>#</th><th>Medicamento</th><th>Qtd.</th></tr></thead><tbody>${rows}</tbody></table>
    ${notes ? `<p><strong>Observações:</strong> ${esc(notes)}</p>` : ''}
    ${docSignature(prescriber, signature)}</body></html>`;
}

const CERT_LABEL = { medical_leave: 'Atestado Médico', attendance: 'Declaração de Comparecimento', fitness: 'Atestado de Aptidão', other: 'Declaração' };
function buildCertHtml({ patient, issuer, unit, cert_type, content, days_off, cid10_code, signature }) {
  const body = content || (cert_type === 'medical_leave' && days_off
    ? `Atesto, para os devidos fins, que o(a) paciente necessita de afastamento de suas atividades por ${days_off} dia(s).`
    : '');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${DOC_CSS}</style></head><body>
    ${docHeader(CERT_LABEL[cert_type] || 'Declaração', null, patient, unit)}
    <pre>${esc(body)}</pre>
    ${days_off ? `<p><strong>Dias de afastamento:</strong> ${days_off}</p>` : ''}
    ${cid10_code ? `<p><strong>CID-10:</strong> ${esc(cid10_code)}</p>` : ''}
    ${docSignature(issuer, signature)}</body></html>`;
}

// Matching por prefixo (não exato) contra o catálogo local de medicamentos.
async function resolveActiveIngredients(drugNames) {
  const names = [...new Set(drugNames.map((d) => String(d).trim()).filter(Boolean))];
  const out = [];
  for (const name of names) {
    const { rows } = await db.query(
      `SELECT active_ingredient FROM ris.medications_catalog
        WHERE lower($1) LIKE lower(name) || '%' OR lower(name) LIKE lower($1) || '%'
        ORDER BY length(name) ASC LIMIT 1`, [name]);
    out.push({ drug: name, ingredient: rows.length ? (rows[0].active_ingredient || null) : null });
  }
  return out;
}

// Cruza tanto o nome comercial quanto o princípio ativo resolvido (evita falso negativo).
async function checkAllergyConflicts(patientId, drugNames) {
  if (!drugNames.length) return [];
  const { rows } = await db.query(
    `SELECT allergen FROM ehr.allergies WHERE patient_id=$1 AND status='active' AND allergen_type IN ('medication','biological')`,
    [patientId]
  );
  const allergens = rows.map((r) => r.allergen.toLowerCase().trim()).filter(Boolean);
  if (!allergens.length) return [];
  const resolved = await resolveActiveIngredients(drugNames);
  const ingByDrug = Object.fromEntries(resolved.map((r) => [r.drug, (r.ingredient || '').toLowerCase()]));
  const conflicts = [];
  for (const d of drugNames) {
    const dl = String(d).toLowerCase();
    const ing = ingByDrug[String(d).trim()] || '';
    for (const al of allergens) {
      if (al.length < 3) continue;
      const byName = dl.includes(al) || al.includes(dl);
      const byActive = ing && (ing.includes(al) || al.includes(ing));
      if (byName || byActive) {
        conflicts.push({ drug: d, allergen: al, matched_by: byActive && !byName ? 'active_ingredient' : 'name', ingredient: ingByDrug[String(d).trim()] || null });
        break;
      }
    }
  }
  return conflicts;
}

async function checkInteractions(drugNames) {
  const resolved = (await resolveActiveIngredients(drugNames)).filter((r) => r.ingredient);
  if (resolved.length < 2) return [];
  const found = [];
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i].ingredient.toLowerCase().trim();
      const b = resolved[j].ingredient.toLowerCase().trim();
      if (a === b) continue;
      const [x, y] = a <= b ? [a, b] : [b, a];
      const { rows } = await db.query(
        `SELECT severity, note FROM ris.drug_interactions WHERE ingredient_a=$1 AND ingredient_b=$2 LIMIT 1`, [x, y]);
      if (rows.length) found.push({ drug_a: resolved[i].drug, drug_b: resolved[j].drug, severity: rows[0].severity, note: rows[0].note });
    }
  }
  return found;
}

// ── Prescrição eletrônica ────────────────────────────────────────────────────
// Checagem ao vivo, sem persistir — usada pelo formulário antes de salvar a prescrição.
async function drugCheck(req, res) {
  const { patient_id, drug_names } = req.body;
  const names = Array.isArray(drug_names) ? drug_names.map((d) => String(d).trim()).filter(Boolean) : [];
  let allergy_warnings = [];
  if (patient_id && names.length) {
    await assertClinicalAccess(req, patient_id);
    allergy_warnings = await checkAllergyConflicts(patient_id, names);
  }
  const interaction_warnings = names.length >= 2 ? await checkInteractions(names) : [];
  return success(res, { allergy_warnings, interaction_warnings });
}

async function listPrescriptions(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT rx.id, rx.rx_type, rx.status, rx.notes, rx.signed_at, rx.pdf_storage_key,
            rx.control_number, rx.control_year,
            rx.created_at, u.name AS prescriber_name,
            COALESCE(json_agg(json_build_object('id',i.id,'drug_name',i.drug_name,'dose',i.dose,
              'route',i.route,'frequency',i.frequency,'duration',i.duration,'quantity',i.quantity,
              'instructions',i.instructions,'administer_at_unit',i.administer_at_unit) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM ehr.prescriptions rx
       LEFT JOIN auth.users u ON u.id = rx.prescriber_id
       LEFT JOIN ehr.prescription_items i ON i.prescription_id = rx.id
      WHERE rx.patient_id = $1
      GROUP BY rx.id, u.name
      ORDER BY rx.created_at DESC`,
    [patientId]
  );
  return success(res, rows.map((r) => ({ ...r, pdf_available: !!r.pdf_storage_key, pdf_storage_key: undefined })));
}

async function createPrescription(req, res) {
  const { patient_id, encounter_id, rx_type, notes, items } = req.body;
  await assertClinicalAccess(req, patient_id);
  const rx = await db.transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO ehr.prescriptions (encounter_id, patient_id, prescriber_id, rx_type, notes)
       VALUES ($1, $2, $3, COALESCE($4::ehr.rx_type,'common'), $5)
       RETURNING id, rx_type, status, created_at`,
      [norm(encounter_id), patient_id, req.user.sub, norm(rx_type), norm(notes)]
    );
    for (const it of items) {
      await client.query(
        `INSERT INTO ehr.prescription_items
           (prescription_id, drug_name, dose, route, frequency, duration, quantity, instructions, administer_at_unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [rows[0].id, it.drug_name, norm(it.dose), norm(it.route), norm(it.frequency),
         norm(it.duration), norm(it.quantity), norm(it.instructions), !!it.administer_at_unit]
      );
    }
    return rows[0];
  });
  const drugNames = items.map((i) => i.drug_name);
  const allergy_warnings = await checkAllergyConflicts(patient_id, drugNames);
  const interaction_warnings = await checkInteractions(drugNames);
  await logClinical(req, 'EHR_PRESCRIPTION_CREATED', {
    patientId: patient_id, resourceType: 'ehr_prescription', resourceId: rx.id,
    details: { items: items.length, allergy_warnings: allergy_warnings.length, interaction_warnings: interaction_warnings.length },
  });
  return created(res, { ...rx, allergy_warnings, interaction_warnings }, 'Prescrição criada (rascunho)');
}

async function signPrescription(req, res) {
  const id = req.params.id;
  const { rows } = await db.query(
    `SELECT rx.*, p.name_encrypted, p.birth_date, p.medical_record_number,
            u.name AS prescriber_name, u.crm, u.crm_uf, u.specialty,
            hu.id AS unit_id, hu.name AS unit_name, hu.cnes AS unit_cnes
       FROM ehr.prescriptions rx
       JOIN ris.patients p ON p.id = rx.patient_id
       JOIN auth.users u ON u.id = rx.prescriber_id
       LEFT JOIN ehr.encounters e ON e.id = rx.encounter_id
       LEFT JOIN ris.health_units hu ON hu.id = e.health_unit_id
      WHERE rx.id = $1`,
    [id]
  );
  if (!rows.length) throw new NotFoundError('Prescrição');
  const rx = rows[0];
  await assertClinicalAccess(req, rx.patient_id);
  if (rx.status !== 'draft') throw new AppError('Prescrição não está em rascunho', 422);
  if (rx.prescriber_id !== req.user.sub) throw new AppError('Apenas o prescritor pode assinar', 403, 'FORBIDDEN');
  const { rows: items } = await db.query(
    `SELECT * FROM ehr.prescription_items WHERE prescription_id = $1 ORDER BY created_at`, [id]);
  if (!items.length) throw new AppError('Prescrição sem itens', 422);

  // Número sequencial (Portaria 344) por unidade/ano, atribuído só na assinatura via UPSERT atômico.
  let controlNumber = rx.control_number || null;
  let controlYear = rx.control_year || null;
  const unitIdForCtrl = rx.unit_id || req.user.health_unit_id || null;
  if (rx.rx_type === 'controlled' && !controlNumber && unitIdForCtrl) {
    controlYear = new Date().getFullYear();
    const { rows: cr } = await db.query(
      `INSERT INTO ehr.controlled_rx_counters (health_unit_id, year, last_number)
       VALUES ($1, $2, 1)
       ON CONFLICT (health_unit_id, year)
         DO UPDATE SET last_number = ehr.controlled_rx_counters.last_number + 1
       RETURNING last_number`, [unitIdForCtrl, controlYear]);
    controlNumber = cr[0].last_number;
  }
  const control = controlNumber ? { number: controlNumber, year: controlYear } : null;

  const signedAtIso = new Date().toISOString();
  const patient = { name: enc.decrypt(rx.name_encrypted), birth_date: rx.birth_date, medical_record_number: rx.medical_record_number };
  const prescriber = { name: rx.prescriber_name, crm: rx.crm, crm_uf: rx.crm_uf };
  const unit = { name: rx.unit_name, cnes: rx.unit_cnes };
  const base = { patient, prescriber, unit, rx_type: rx.rx_type, items, notes: rx.notes, control };
  const hash = crypto.createHash('sha256')
    .update(buildRxHtml({ ...base, signature: { signed_at: signedAtIso } }), 'utf8').digest('hex');
  const sjwt = jwt.sign(
    { prescriptionId: id, prescriberId: req.user.sub, patientId: rx.patient_id, hash, signedAt: signedAtIso, iss: 'ris-pacs-ehr' },
    env.JWT_PRIVATE_KEY, { algorithm: 'RS256', expiresIn: '20y' });
  let key = null;
  try {
    const buf = await renderHtmlToPdf(buildRxHtml({ ...base, signature: { signed_at: signedAtIso, hash } }));
    key = `prescriptions/${id}.pdf`;
    await storage.upload(storage.BUCKETS.DOCUMENTS, key, buf, 'application/pdf');
  } catch (err) { logger.error('[ehr] PDF prescrição falhou', { id, message: err.message }); key = null; }

  await db.query(
    `UPDATE ehr.prescriptions SET status='signed', signed_at=NOW(), signature_hash=$2,
        signature_jwt=$3, pdf_storage_key=$4, control_number=$5, control_year=$6, updated_at=NOW() WHERE id=$1`,
    [id, hash, sjwt, key, controlNumber, controlYear]);
  await logClinical(req, A.EHR_PRESCRIPTION_SIGNED, {
    patientId: rx.patient_id, resourceType: 'ehr_prescription', resourceId: id,
    details: { signature_hash: hash, pdf_stored: !!key, control_number: controlNumber },
  });
  return success(res, {
    id, status: 'signed', signed_at: signedAtIso, signature_hash: hash, pdf_available: !!key,
    control_number: controlNumber, control_year: controlYear,
  }, 'Prescrição assinada');
}

async function cancelPrescription(req, res) {
  const { rows } = await db.query(`SELECT patient_id, prescriber_id FROM ehr.prescriptions WHERE id=$1`, [req.params.id]);
  if (!rows.length) throw new NotFoundError('Prescrição');
  await assertClinicalAccess(req, rows[0].patient_id);
  if (rows[0].prescriber_id !== req.user.sub && req.user.role !== 'admin')
    throw new AppError('Apenas o prescritor pode cancelar', 403, 'FORBIDDEN');
  await db.query(`UPDATE ehr.prescriptions SET status='cancelled', updated_at=NOW() WHERE id=$1`, [req.params.id]);
  return success(res, { id: req.params.id }, 'Prescrição cancelada');
}

// ── Atestados / declarações ──────────────────────────────────────────────────
async function listCertificates(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT c.id, c.cert_type, c.status, c.days_off, c.cid10_code, c.content_enc,
            c.signed_at, c.pdf_storage_key, c.created_at, u.name AS issuer_name
       FROM ehr.certificates c LEFT JOIN auth.users u ON u.id = c.issuer_id
      WHERE c.patient_id = $1 ORDER BY c.created_at DESC`,
    [patientId]
  );
  return success(res, rows.map((r) => ({
    id: r.id, cert_type: r.cert_type, status: r.status, days_off: r.days_off, cid10_code: r.cid10_code,
    content: enc.decrypt(r.content_enc), signed_at: r.signed_at, pdf_available: !!r.pdf_storage_key,
    created_at: r.created_at, issuer_name: r.issuer_name,
  })));
}

async function createCertificate(req, res) {
  const { patient_id, encounter_id, cert_type, content, days_off, cid10_code } = req.body;
  await assertClinicalAccess(req, patient_id);
  const { rows } = await db.query(
    `INSERT INTO ehr.certificates (encounter_id, patient_id, issuer_id, cert_type, content_enc, days_off, cid10_code)
     VALUES ($1, $2, $3, COALESCE($4::ehr.cert_type,'medical_leave'), $5, $6, $7)
     RETURNING id, cert_type, status, days_off, created_at`,
    [norm(encounter_id), patient_id, req.user.sub, norm(cert_type), enc.encrypt(norm(content)),
     norm(days_off), norm(cid10_code)]
  );
  await logClinical(req, 'EHR_CERTIFICATE_CREATED', {
    patientId: patient_id, resourceType: 'ehr_certificate', resourceId: rows[0].id,
  });
  return created(res, rows[0], 'Atestado criado (rascunho)');
}

async function signCertificate(req, res) {
  const id = req.params.id;
  const { rows } = await db.query(
    `SELECT c.*, p.name_encrypted, p.birth_date, p.medical_record_number,
            u.name AS issuer_name, u.crm, u.crm_uf,
            hu.name AS unit_name, hu.cnes AS unit_cnes
       FROM ehr.certificates c
       JOIN ris.patients p ON p.id = c.patient_id
       JOIN auth.users u ON u.id = c.issuer_id
       LEFT JOIN ehr.encounters e ON e.id = c.encounter_id
       LEFT JOIN ris.health_units hu ON hu.id = e.health_unit_id
      WHERE c.id = $1`,
    [id]
  );
  if (!rows.length) throw new NotFoundError('Atestado');
  const cert = rows[0];
  await assertClinicalAccess(req, cert.patient_id);
  if (cert.status !== 'draft') throw new AppError('Atestado já assinado', 422);
  if (cert.issuer_id !== req.user.sub) throw new AppError('Apenas o emissor pode assinar', 403, 'FORBIDDEN');

  const signedAtIso = new Date().toISOString();
  const patient = { name: enc.decrypt(cert.name_encrypted), birth_date: cert.birth_date, medical_record_number: cert.medical_record_number };
  const issuer = { name: cert.issuer_name, crm: cert.crm, crm_uf: cert.crm_uf };
  const unit = { name: cert.unit_name, cnes: cert.unit_cnes };
  const base = { patient, issuer, unit, cert_type: cert.cert_type, content: enc.decrypt(cert.content_enc), days_off: cert.days_off, cid10_code: cert.cid10_code };
  const hash = crypto.createHash('sha256')
    .update(buildCertHtml({ ...base, signature: { signed_at: signedAtIso } }), 'utf8').digest('hex');
  const sjwt = jwt.sign(
    { certificateId: id, issuerId: req.user.sub, patientId: cert.patient_id, hash, signedAt: signedAtIso, iss: 'ris-pacs-ehr' },
    env.JWT_PRIVATE_KEY, { algorithm: 'RS256', expiresIn: '20y' });
  let key = null;
  try {
    const buf = await renderHtmlToPdf(buildCertHtml({ ...base, signature: { signed_at: signedAtIso, hash } }));
    key = `certificates/${id}.pdf`;
    await storage.upload(storage.BUCKETS.DOCUMENTS, key, buf, 'application/pdf');
  } catch (err) { logger.error('[ehr] PDF atestado falhou', { id, message: err.message }); key = null; }

  await db.query(
    `UPDATE ehr.certificates SET status='signed', signed_at=NOW(), signature_hash=$2,
        signature_jwt=$3, pdf_storage_key=$4, updated_at=NOW() WHERE id=$1`,
    [id, hash, sjwt, key]);
  await logClinical(req, A.EHR_CERTIFICATE_SIGNED, {
    patientId: cert.patient_id, resourceType: 'ehr_certificate', resourceId: id,
    details: { signature_hash: hash, pdf_stored: !!key },
  });
  return success(res, { id, status: 'signed', signed_at: signedAtIso, signature_hash: hash, pdf_available: !!key }, 'Atestado assinado');
}

// ── Imunização ───────────────────────────────────────────────────────────────
async function listImmunizations(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT i.id, i.vaccine, i.dose_label, i.lot, i.manufacturer, i.route, i.site, i.status,
            i.applied_at, i.scheduled_for, i.notes, i.created_at, u.name AS applied_by_name
       FROM ehr.immunizations i LEFT JOIN auth.users u ON u.id = i.applied_by
      WHERE i.patient_id = $1 ORDER BY COALESCE(i.applied_at, i.scheduled_for::timestamptz) DESC NULLS LAST, i.created_at DESC`,
    [patientId]
  );
  return success(res, rows);
}

async function createImmunization(req, res) {
  const b = req.body;
  await assertClinicalAccess(req, b.patient_id);
  const { rows } = await db.query(
    `INSERT INTO ehr.immunizations
       (patient_id, vaccine, dose_label, lot, manufacturer, route, site, status, applied_at, scheduled_for, applied_by, encounter_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8::ehr.immunization_status,'applied'),
             COALESCE($9::timestamptz, CASE WHEN $8 IS NULL OR $8='applied' THEN NOW() END), $10, $11, $12, $13)
     RETURNING id, vaccine, dose_label, status, applied_at, scheduled_for, created_at`,
    [b.patient_id, b.vaccine, norm(b.dose_label), norm(b.lot), norm(b.manufacturer), norm(b.route),
     norm(b.site), norm(b.status), norm(b.applied_at), norm(b.scheduled_for), req.user.sub,
     norm(b.encounter_id), norm(b.notes)]
  );
  await logClinical(req, A.EHR_IMMUNIZATION_WRITE, {
    patientId: b.patient_id, resourceType: 'ehr_immunization', resourceId: rows[0].id, details: { vaccine: b.vaccine },
  });
  return created(res, rows[0], 'Vacina registrada');
}

async function updateImmunization(req, res) {
  const { rows: ex } = await db.query(`SELECT patient_id FROM ehr.immunizations WHERE id=$1`, [req.params.id]);
  if (!ex.length) throw new NotFoundError('Registro de vacina');
  await assertClinicalAccess(req, ex[0].patient_id);
  const b = req.body;
  await db.query(
    `UPDATE ehr.immunizations SET
        vaccine = COALESCE($2, vaccine), dose_label = COALESCE($3, dose_label),
        lot = COALESCE($4, lot), manufacturer = COALESCE($5, manufacturer),
        route = COALESCE($6, route), site = COALESCE($7, site),
        status = COALESCE($8::ehr.immunization_status, status),
        applied_at = COALESCE($9::timestamptz, applied_at),
        scheduled_for = COALESCE($10::date, scheduled_for), notes = COALESCE($11, notes)
      WHERE id = $1`,
    [req.params.id, norm(b.vaccine), norm(b.dose_label), norm(b.lot), norm(b.manufacturer),
     norm(b.route), norm(b.site), norm(b.status), norm(b.applied_at), norm(b.scheduled_for), norm(b.notes)]
  );
  await logClinical(req, A.EHR_IMMUNIZATION_WRITE, {
    patientId: ex[0].patient_id, resourceType: 'ehr_immunization', resourceId: req.params.id,
  });
  return success(res, { id: req.params.id }, 'Vacina atualizada');
}

// PDF de documento assinado (prescrição/atestado). `table` é literal fixo.
async function streamDocPdf(table, label, req, res) {
  const { rows } = await db.query(`SELECT patient_id, pdf_storage_key FROM ehr.${table} WHERE id=$1`, [req.params.id]);
  if (!rows.length) throw new NotFoundError(label);
  await assertClinicalAccess(req, rows[0].patient_id);
  if (!rows[0].pdf_storage_key) throw new AppError('PDF não disponível (documento não assinado)', 404);
  const body = await storage.getStream(storage.BUCKETS.DOCUMENTS, rows[0].pdf_storage_key);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${label}-${req.params.id}.pdf"`);
  body.pipe(res);
}
const downloadPrescriptionPdf = (req, res) => streamDocPdf('prescriptions', 'prescricao', req, res);
const downloadCertificatePdf  = (req, res) => streamDocPdf('certificates', 'atestado', req, res);

// ── Escalas de enfermagem (Morse/Braden) ─────────────────────────────────────
// score e risk_level são calculados no cliente a partir dos itens marcados; o
// backend persiste o resultado estruturado (items + score + risk_level).
async function createNursingAssessment(req, res) {
  const { patient_id, encounter_id, scale, items, score, risk_level } = req.body;
  await assertClinicalAccess(req, patient_id);
  const { rows } = await db.query(
    `INSERT INTO ehr.nursing_assessments (patient_id, encounter_id, scale, items, score, risk_level, assessed_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
     RETURNING id, scale, score, risk_level, created_at`,
    [patient_id, norm(encounter_id), scale, JSON.stringify(items || {}), score, risk_level, req.user.sub]
  );
  await logClinical(req, 'EHR_NURSING_ASSESSMENT', {
    patientId: patient_id, resourceType: 'ehr_nursing_assessment', resourceId: rows[0].id,
    details: { scale, score, risk_level },
  });
  return created(res, rows[0], 'Avaliação de enfermagem registrada');
}

async function listNursingAssessments(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT n.id, n.scale, n.items, n.score, n.risk_level, n.created_at,
            n.encounter_id, u.name AS assessed_by_name
       FROM ehr.nursing_assessments n
       LEFT JOIN auth.users u ON u.id = n.assessed_by
      WHERE n.patient_id = $1
      ORDER BY n.created_at DESC`, [patientId]);
  return success(res, rows);
}

// ── SAE — Evolução de enfermagem ─────────────────────────────────────────────
async function createNursingEvolution(req, res) {
  const { patient_id, encounter_id, assessment, diagnoses, interventions, evaluation } = req.body;
  await assertClinicalAccess(req, patient_id);
  const diags = Array.isArray(diagnoses) ? diagnoses.filter((d) => typeof d === 'string' && d.trim()) : [];
  const { rows } = await db.query(
    `INSERT INTO ehr.nursing_evolutions
       (patient_id, encounter_id, assessment_enc, diagnoses, interventions_enc, evaluation_enc, author_id)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
     RETURNING id, diagnoses, created_at`,
    [patient_id, norm(encounter_id), enc.encrypt(norm(assessment)),
     JSON.stringify(diags), enc.encrypt(norm(interventions)), enc.encrypt(norm(evaluation)), req.user.sub]
  );
  await logClinical(req, 'EHR_NURSING_EVOLUTION', {
    patientId: patient_id, resourceType: 'ehr_nursing_evolution', resourceId: rows[0].id,
    details: { diagnoses_count: diags.length },
  });
  return created(res, rows[0], 'Evolução de enfermagem registrada');
}

async function listNursingEvolutions(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT n.id, n.assessment_enc, n.diagnoses, n.interventions_enc, n.evaluation_enc,
            n.created_at, n.encounter_id, u.name AS author_name
       FROM ehr.nursing_evolutions n
       LEFT JOIN auth.users u ON u.id = n.author_id
      WHERE n.patient_id = $1
      ORDER BY n.created_at DESC`, [patientId]);
  return success(res, rows.map((r) => ({
    id: r.id, diagnoses: r.diagnoses || [], created_at: r.created_at,
    encounter_id: r.encounter_id, author_name: r.author_name,
    assessment: enc.decrypt(r.assessment_enc),
    interventions: enc.decrypt(r.interventions_enc),
    evaluation: enc.decrypt(r.evaluation_enc),
  })));
}

// ── SADT — Solicitação de exames/laboratório ─────────────────────────────────
async function createServiceRequest(req, res) {
  const { patient_id, encounter_id, request_type, priority, clinical_indication, items } = req.body;
  await assertClinicalAccess(req, patient_id);
  const result = await db.transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO ehr.service_requests
         (patient_id, encounter_id, request_type, priority, clinical_indication, requested_by)
       VALUES ($1,$2,COALESCE($3,'lab'),COALESCE($4,'routine'),$5,$6)
       RETURNING id, request_type, priority, status, created_at`,
      [patient_id, norm(encounter_id), norm(request_type), norm(priority), norm(clinical_indication), req.user.sub]
    );
    const reqId = rows[0].id;
    for (const it of items) {
      await client.query(
        `INSERT INTO ehr.service_request_items (request_id, exam_name, code, notes)
         VALUES ($1,$2,$3,$4)`,
        [reqId, it.exam_name, norm(it.code), norm(it.notes)]
      );
    }
    return rows[0];
  });
  await logClinical(req, 'EHR_SERVICE_REQUEST_CREATED', {
    patientId: patient_id, resourceType: 'ehr_service_request', resourceId: result.id,
    details: { request_type: result.request_type, items: items.length },
  });
  return created(res, result, 'Solicitação de exames registrada');
}

async function listServiceRequests(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT r.id, r.request_type, r.priority, r.status, r.clinical_indication, r.created_at,
            r.encounter_id, u.name AS requested_by_name,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', i.id, 'exam_name', i.exam_name, 'code', i.code,
                 'notes', i.notes, 'result_status', i.result_status) ORDER BY i.exam_name)
               FROM ehr.service_request_items i WHERE i.request_id = r.id), '[]'
            ) AS items
       FROM ehr.service_requests r
       LEFT JOIN auth.users u ON u.id = r.requested_by
      WHERE r.patient_id = $1
      ORDER BY r.created_at DESC`, [patientId]);
  return success(res, rows);
}

async function updateServiceRequestStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;
  const { rows } = await db.query(
    `UPDATE ehr.service_requests SET status = $2, updated_at = NOW()
      WHERE id = $1 RETURNING id, patient_id, status`, [id, status]);
  if (!rows.length) throw new NotFoundError('Solicitação');
  await assertClinicalAccess(req, rows[0].patient_id);
  await logClinical(req, 'EHR_SERVICE_REQUEST_STATUS', {
    patientId: rows[0].patient_id, resourceType: 'ehr_service_request', resourceId: id, details: { status },
  });
  return success(res, rows[0], 'Status da solicitação atualizado');
}

// ── Farmacovigilância — evento adverso / RAM ─────────────────────────────────
async function createAdverseEvent(req, res) {
  const { patient_id, encounter_id, event_type, suspected_drug, description, severity, outcome } = req.body;
  await assertClinicalAccess(req, patient_id);
  const { rows } = await db.query(
    `INSERT INTO ehr.adverse_events
       (patient_id, encounter_id, event_type, suspected_drug, description_enc, severity, outcome, reported_by)
     VALUES ($1,$2,COALESCE($3,'adverse_drug_reaction'),$4,$5,COALESCE($6,'moderate'),COALESCE($7,'unknown'),$8)
     RETURNING id, event_type, severity, outcome, created_at`,
    [patient_id, norm(encounter_id), norm(event_type), norm(suspected_drug),
     enc.encrypt(norm(description)), norm(severity), norm(outcome), req.user.sub]
  );
  await logClinical(req, 'EHR_ADVERSE_EVENT_REPORTED', {
    patientId: patient_id, resourceType: 'ehr_adverse_event', resourceId: rows[0].id,
    details: { event_type: rows[0].event_type, severity: rows[0].severity, suspected_drug: norm(suspected_drug) },
  });
  return created(res, rows[0], 'Evento adverso notificado');
}

async function listAdverseEvents(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT a.id, a.event_type, a.suspected_drug, a.description_enc, a.severity, a.outcome,
            a.created_at, a.encounter_id, u.name AS reported_by_name
       FROM ehr.adverse_events a
       LEFT JOIN auth.users u ON u.id = a.reported_by
      WHERE a.patient_id = $1
      ORDER BY a.created_at DESC`, [patientId]);
  return success(res, rows.map((r) => ({
    id: r.id, event_type: r.event_type, suspected_drug: r.suspected_drug,
    description: enc.decrypt(r.description_enc), severity: r.severity, outcome: r.outcome,
    created_at: r.created_at, encounter_id: r.encounter_id, reported_by_name: r.reported_by_name,
  })));
}

module.exports = {
  createNursingAssessment, listNursingAssessments,
  createNursingEvolution, listNursingEvolutions,
  createServiceRequest, listServiceRequests, updateServiceRequestStatus,
  createAdverseEvent, listAdverseEvents,
  listAllergies, createAllergy, updateAllergy,
  listMedications, createMedication, updateMedication,
  getHistory, upsertHistory,
  listAttachments, uploadAttachment, downloadAttachment,
  listPrescriptions, createPrescription, signPrescription, cancelPrescription, downloadPrescriptionPdf, drugCheck,
  listCertificates, createCertificate, signCertificate, downloadCertificatePdf,
  listImmunizations, createImmunization, updateImmunization,
};
