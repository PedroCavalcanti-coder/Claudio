'use strict';
/**
 * PEP — Prontuário Eletrônico do Paciente (Fase 1 / MVP).
 * Atendimentos (encounters), evolução SOAP assinada/versionada, lista de
 * problemas (CID-10), sinais vitais, timeline e break-glass.
 *
 * Padrões reusados do RIS:
 *   · criptografia PII (services/encryption) nas colunas *_enc;
 *   · assinatura RS256 + hash SHA-256 + PDF (igual ris.reports);
 *   · auditoria (services/audit) em todo acesso/operação clínica;
 *   · controle de acesso global + break-glass (ehr.access).
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
const { ensurePdf } = require('../../services/documentPdf');
const { success, created } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');
const { assertClinicalAccess, logClinical } = require('./ehr.access');
const { buildRacBundle } = require('./ehr.fhir');

const A = audit.ACTIONS;
const SIGNED = ['signed', 'amended'];

// ── Helpers ──────────────────────────────────────────────────────────────────
const norm = (v) => (v === undefined || v === null || v === '' ? null : v);
const esc  = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function loadEncounterOr404(id) {
  const { rows } = await db.query(`SELECT * FROM ehr.encounters WHERE id = $1`, [id]);
  if (!rows.length) throw new NotFoundError('Atendimento');
  return rows[0];
}

async function loadNoteOr404(id) {
  const { rows } = await db.query(`SELECT * FROM ehr.clinical_notes WHERE id = $1`, [id]);
  if (!rows.length) throw new NotFoundError('Evolução');
  return rows[0];
}

function decryptNote(row) {
  return {
    id: row.id,
    encounter_id: row.encounter_id,
    patient_id: row.patient_id,
    author_id: row.author_id,
    subjective: enc.safeDecrypt(row.subjective_enc),
    objective:  enc.safeDecrypt(row.objective_enc),
    assessment: enc.safeDecrypt(row.assessment_enc),
    plan:       enc.safeDecrypt(row.plan_enc),
    cid10_codes: row.cid10_codes || [],
    status: row.status,
    signed_at: row.signed_at,
    signature_hash: row.signature_hash,
    pdf_available: !!row.pdf_storage_key,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Documento canônico da evolução (fonte única para hash, PDF e arquivo).
function buildNoteHtml({ patient, author, unit, encounter, soap, cid10, signature }) {
  const section = (label, body) => body && String(body).trim()
    ? `<h3>${esc(label)}</h3><pre>${esc(body)}</pre>` : '';
  const cidRows = (cid10 || []).length
    ? `<p class="cid"><strong>CID-10:</strong> ${cid10.map(c =>
        `${esc(c.code)}${c.description ? ' — ' + esc(c.description) : ''}`).join(' · ')}</p>` : '';
  const sig = signature?.hash
    ? `<div class="sig"><p><strong>Assinado eletronicamente</strong> por ${esc(author?.name)}${
        author?.crm ? ` (CRM ${esc(author.crm)}${author.crm_uf ? '/' + esc(author.crm_uf) : ''})` : ''} em ${
        esc(new Date(signature.signed_at).toLocaleString('pt-BR'))}.</p>
       <p class="hash">Hash SHA-256: ${esc(signature.hash)}</p>
       <p class="hash">Assinatura RS256 — verificável no servidor (não-ICP-Brasil).</p></div>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;line-height:1.5;margin:32px}
    h1{font-size:18px;margin:0 0 4px} h2{font-size:13px;color:#444;margin:0 0 12px;font-weight:normal}
    h3{font-size:12px;margin:14px 0 2px;color:#0b5} pre{white-space:pre-wrap;font-family:inherit;margin:0}
    .meta{border:1px solid #ddd;border-radius:6px;padding:8px 12px;margin:10px 0;background:#fafafa}
    .meta span{display:inline-block;margin-right:18px} .cid{margin-top:12px}
    .sig{margin-top:24px;border-top:1px solid #ccc;padding-top:10px} .hash{font-size:9px;color:#777;word-break:break-all;margin:2px 0}
  </style></head><body>
    <h1>Evolução Clínica</h1>
    <h2>${esc(unit?.name || 'Prontuário Eletrônico do Paciente')}${unit?.cnes ? ' · CNES ' + esc(unit.cnes) : ''}</h2>
    <div class="meta">
      <span><strong>Paciente:</strong> ${esc(patient?.name)}</span>
      ${patient?.medical_record_number ? `<span><strong>Prontuário:</strong> ${esc(patient.medical_record_number)}</span>` : ''}
      ${patient?.birth_date ? `<span><strong>Nasc.:</strong> ${esc(new Date(patient.birth_date).toLocaleDateString('pt-BR'))}</span>` : ''}
      <span><strong>Atendimento:</strong> ${esc(encounter?.encounter_type)} — ${esc(new Date(encounter?.started_at).toLocaleString('pt-BR'))}</span>
    </div>
    ${section('Subjetivo (S)', soap.subjective)}
    ${section('Objetivo (O)', soap.objective)}
    ${section('Avaliação (A)', soap.assessment)}
    ${section('Plano (P)', soap.plan)}
    ${cidRows}
    ${sig}
  </body></html>`;
}

// ── Encounters ───────────────────────────────────────────────────────────────
async function createEncounter(req, res) {
  const { patient_id, encounter_type, chief_complaint, appointment_id, health_unit_id } = req.body;

  const { rows: pat } = await db.query(`SELECT id FROM ris.patients WHERE id = $1`, [patient_id]);
  if (!pat.length) throw new NotFoundError('Paciente');

  // Criar um atendimento ESTABELECE o vínculo clínico — não exige vínculo prévio.
  const unitId = health_unit_id ?? req.user.health_unit_id ?? null;
  const { rows } = await db.query(
    `INSERT INTO ehr.encounters
       (patient_id, professional_id, health_unit_id, appointment_id,
        encounter_type, chief_complaint_enc, created_by)
     VALUES ($1, $2, $3, $4, COALESCE($5::ehr.encounter_type,'ambulatorial'), $6, $2)
     RETURNING id, patient_id, encounter_type, status, started_at`,
    [patient_id, req.user.sub, unitId, appointment_id || null,
     norm(encounter_type), enc.encrypt(norm(chief_complaint))]
  );

  req.clinicalAccess = { mode: 'bond' };
  await logClinical(req, A.EHR_ENCOUNTER_CREATED, {
    patientId: patient_id, resourceType: 'ehr_encounter', resourceId: rows[0].id,
  });
  return created(res, rows[0], 'Atendimento aberto');
}

async function listEncounters(req, res) {
  const { patient_id } = req.query;
  await assertClinicalAccess(req, patient_id);
  const { rows } = await db.query(
    `SELECT e.id, e.encounter_type, e.status, e.started_at, e.closed_at,
            e.professional_id, u.name AS professional_name,
            e.health_unit_id, hu.name AS unit_name,
            (SELECT COUNT(*) FROM ehr.clinical_notes n WHERE n.encounter_id = e.id) AS notes_count
       FROM ehr.encounters e
       LEFT JOIN auth.users u       ON u.id = e.professional_id
       LEFT JOIN ris.health_units hu ON hu.id = e.health_unit_id
      WHERE e.patient_id = $1
      ORDER BY e.started_at DESC`,
    [patient_id]
  );
  return success(res, rows);
}

async function getEncounter(req, res) {
  const e = await loadEncounterOr404(req.params.id);
  await assertClinicalAccess(req, e.patient_id);

  const [notes, vitals] = await Promise.all([
    db.query(`SELECT * FROM ehr.clinical_notes WHERE encounter_id = $1 ORDER BY created_at ASC`, [e.id]),
    db.query(`SELECT * FROM ehr.vitals WHERE encounter_id = $1 ORDER BY measured_at ASC`, [e.id]),
  ]);

  await logClinical(req, A.EHR_ENCOUNTER_VIEWED, {
    patientId: e.patient_id, resourceType: 'ehr_encounter', resourceId: e.id,
  });
  return success(res, {
    id: e.id,
    patient_id: e.patient_id,
    professional_id: e.professional_id,
    health_unit_id: e.health_unit_id,
    appointment_id: e.appointment_id,
    encounter_type: e.encounter_type,
    status: e.status,
    chief_complaint: enc.safeDecrypt(e.chief_complaint_enc),
    started_at: e.started_at,
    closed_at: e.closed_at,
    notes: notes.rows.map(decryptNote),
    vitals: vitals.rows,
  });
}

async function updateEncounter(req, res) {
  const e = await loadEncounterOr404(req.params.id);
  await assertClinicalAccess(req, e.patient_id);
  if (e.status !== 'open') throw new AppError('Atendimento fechado não pode ser editado', 422);

  const { encounter_type, chief_complaint } = req.body;
  await db.query(
    `UPDATE ehr.encounters
        SET encounter_type      = COALESCE($2::ehr.encounter_type, encounter_type),
            chief_complaint_enc = CASE WHEN $3::boolean THEN $4 ELSE chief_complaint_enc END
      WHERE id = $1`,
    [e.id, norm(encounter_type), chief_complaint !== undefined, enc.encrypt(norm(chief_complaint))]
  );
  await logClinical(req, A.EHR_ENCOUNTER_UPDATED, {
    patientId: e.patient_id, resourceType: 'ehr_encounter', resourceId: e.id,
  });
  return success(res, { id: e.id }, 'Atendimento atualizado');
}

async function closeEncounter(req, res) {
  const e = await loadEncounterOr404(req.params.id);
  await assertClinicalAccess(req, e.patient_id);
  await db.query(
    `UPDATE ehr.encounters SET status = 'closed', closed_at = NOW()
      WHERE id = $1 AND status = 'open'`,
    [e.id]
  );
  await logClinical(req, A.EHR_ENCOUNTER_CLOSED, {
    patientId: e.patient_id, resourceType: 'ehr_encounter', resourceId: e.id,
  });
  return success(res, { id: e.id }, 'Atendimento encerrado');
}

// ── Clinical notes (evolução SOAP) ───────────────────────────────────────────
function normalizeCid(arr) {
  return Array.isArray(arr)
    ? arr.filter(c => c && c.code).map(c => ({ code: String(c.code), description: String(c.description || '') }))
    : [];
}

async function createNote(req, res) {
  const e = await loadEncounterOr404(req.params.id);
  await assertClinicalAccess(req, e.patient_id);
  if (e.status !== 'open') throw new AppError('Não é possível evoluir um atendimento fechado', 422);

  const { subjective, objective, assessment, plan, cid10_codes } = req.body;
  const cid = normalizeCid(cid10_codes);
  const { rows } = await db.query(
    `INSERT INTO ehr.clinical_notes
       (encounter_id, patient_id, author_id, subjective_enc, objective_enc,
        assessment_enc, plan_enc, cid10_codes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING id, status, created_at`,
    [e.id, e.patient_id, req.user.sub,
     enc.encrypt(norm(subjective)), enc.encrypt(norm(objective)),
     enc.encrypt(norm(assessment)), enc.encrypt(norm(plan)), JSON.stringify(cid)]
  );
  await logClinical(req, A.EHR_NOTE_CREATED, {
    patientId: e.patient_id, resourceType: 'ehr_clinical_note', resourceId: rows[0].id,
  });
  return created(res, rows[0], 'Evolução criada (rascunho)');
}

async function updateNote(req, res) {
  const n = await loadNoteOr404(req.params.id);
  await assertClinicalAccess(req, n.patient_id);
  if (n.status !== 'draft') throw new AppError('Evolução assinada não pode ser editada; use emenda', 422);
  if (n.author_id !== req.user.sub && req.user.role !== 'admin')
    throw new AppError('Apenas o autor pode editar a evolução', 403, 'FORBIDDEN');

  const { subjective, objective, assessment, plan, cid10_codes } = req.body;
  // Atualização parcial campo-a-campo preservando o que não veio no corpo.
  await db.query(
    `UPDATE ehr.clinical_notes SET
        subjective_enc = CASE WHEN $2::boolean THEN $3 ELSE subjective_enc END,
        objective_enc  = CASE WHEN $4::boolean THEN $5 ELSE objective_enc  END,
        assessment_enc = CASE WHEN $6::boolean THEN $7 ELSE assessment_enc END,
        plan_enc       = CASE WHEN $8::boolean THEN $9 ELSE plan_enc       END,
        cid10_codes    = CASE WHEN $10::boolean THEN $11::jsonb ELSE cid10_codes END
      WHERE id = $1`,
    [n.id,
     subjective !== undefined, enc.encrypt(norm(subjective)),
     objective  !== undefined, enc.encrypt(norm(objective)),
     assessment !== undefined, enc.encrypt(norm(assessment)),
     plan       !== undefined, enc.encrypt(norm(plan)),
     cid10_codes !== undefined, JSON.stringify(normalizeCid(cid10_codes))]
  );
  void setEnc;
  await logClinical(req, A.EHR_NOTE_UPDATED, {
    patientId: n.patient_id, resourceType: 'ehr_clinical_note', resourceId: n.id,
  });
  return success(res, { id: n.id }, 'Evolução atualizada');
}

async function signNote(req, res) {
  const id = req.params.id;
  const { rows } = await db.query(
    `SELECT n.*, e.encounter_type, e.started_at, e.health_unit_id,
            p.name_encrypted, p.birth_date, p.gender, p.medical_record_number,
            au.name AS author_name, au.crm, au.crm_uf, au.specialty,
            hu.name AS unit_name, hu.cnes AS unit_cnes
       FROM ehr.clinical_notes n
       JOIN ehr.encounters e   ON e.id = n.encounter_id
       JOIN ris.patients p     ON p.id = n.patient_id
       JOIN auth.users au      ON au.id = n.author_id
       LEFT JOIN ris.health_units hu ON hu.id = e.health_unit_id
      WHERE n.id = $1`,
    [id]
  );
  if (!rows.length) throw new NotFoundError('Evolução');
  const n = rows[0];
  await assertClinicalAccess(req, n.patient_id);
  if (n.status !== 'draft') throw new AppError('Evolução não está em rascunho', 422);
  if (n.author_id !== req.user.sub) throw new AppError('Apenas o autor pode assinar', 403, 'FORBIDDEN');

  const soap = {
    subjective: enc.decrypt(n.subjective_enc),
    objective:  enc.decrypt(n.objective_enc),
    assessment: enc.decrypt(n.assessment_enc),
    plan:       enc.decrypt(n.plan_enc),
  };
  if (!soap.subjective && !soap.objective && !soap.assessment && !soap.plan)
    throw new AppError('Evolução vazia não pode ser assinada', 422);

  const signedAtIso = new Date().toISOString();
  const patient = { name: enc.decrypt(n.name_encrypted), birth_date: n.birth_date,
                    gender: n.gender, medical_record_number: n.medical_record_number };
  const author  = { name: n.author_name, crm: n.crm, crm_uf: n.crm_uf, specialty: n.specialty };
  const unit    = { name: n.unit_name, cnes: n.unit_cnes };
  const encounter = { encounter_type: n.encounter_type, started_at: n.started_at };
  const cid = n.cid10_codes || [];

  const canonicalHtml = buildNoteHtml({ patient, author, unit, encounter, soap, cid10: cid,
    signature: { signed_at: signedAtIso } });
  const signatureHash = crypto.createHash('sha256').update(canonicalHtml, 'utf8').digest('hex');
  const signatureJwt = jwt.sign(
    { noteId: id, encounterId: n.encounter_id, authorId: req.user.sub,
      patientId: n.patient_id, hash: signatureHash, signedAt: signedAtIso, iss: 'ris-pacs-ehr' },
    env.JWT_PRIVATE_KEY,
    { algorithm: 'RS256', expiresIn: '20y' }   // CFM 1.821 — retenção de 20 anos
  );

  const finalHtml = buildNoteHtml({ patient, author, unit, encounter, soap, cid10: cid,
    signature: { signed_at: signedAtIso, hash: signatureHash } });

  let pdfStorageKey = null;
  try {
    const pdfBuffer = await renderHtmlToPdf(finalHtml);
    pdfStorageKey = `clinical-notes/${id}.pdf`;
    await storage.upload(storage.BUCKETS.DOCUMENTS, pdfStorageKey, pdfBuffer, 'application/pdf');
  } catch (err) {
    logger.error('[ehr] falha ao gerar/armazenar PDF da evolução', { noteId: id, message: err.message });
    pdfStorageKey = null;
  }

  // Nota revisada (já teve emenda) é marcada como 'amended'; senão 'signed'.
  const { rows: hadVer } = await db.query(
    `SELECT 1 FROM ehr.clinical_note_versions WHERE note_id = $1 LIMIT 1`, [id]);
  const finalStatus = hadVer.length ? 'amended' : 'signed';

  await db.query(
    `UPDATE ehr.clinical_notes
        SET status = $2::ehr.note_status, signed_at = NOW(), signature_hash = $3,
            signature_jwt = $4, pdf_storage_key = $5, updated_at = NOW()
      WHERE id = $1`,
    [id, finalStatus, signatureHash, signatureJwt, pdfStorageKey]
  );
  await logClinical(req, A.EHR_NOTE_SIGNED, {
    patientId: n.patient_id, resourceType: 'ehr_clinical_note', resourceId: id,
    details: { signature_hash: signatureHash, pdf_stored: !!pdfStorageKey, status: finalStatus },
  });
  return success(res, { id, status: finalStatus, signed_at: signedAtIso,
    signature_hash: signatureHash, pdf_available: !!pdfStorageKey }, 'Evolução assinada');
}

async function amendNote(req, res) {
  const id = req.params.id;
  const { reason } = req.body;
  const n = await loadNoteOr404(id);
  await assertClinicalAccess(req, n.patient_id);
  if (!SIGNED.includes(n.status)) throw new AppError('Só evolução assinada pode ser emendada', 422);
  if (n.author_id !== req.user.sub) throw new AppError('Apenas o autor pode emendar', 403, 'FORBIDDEN');

  await db.transaction(async (client) => {
    // Snapshot do estado assinado ANTES de reabrir (imutabilidade legal).
    const { rows: vmax } = await client.query(
      `SELECT COALESCE(MAX(version),0) + 1 AS v FROM ehr.clinical_note_versions WHERE note_id = $1`, [id]);
    await client.query(
      `INSERT INTO ehr.clinical_note_versions (note_id, version, snapshot, changed_by, change_reason)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [id, vmax[0].v, JSON.stringify({
        subjective: enc.decrypt(n.subjective_enc), objective: enc.decrypt(n.objective_enc),
        assessment: enc.decrypt(n.assessment_enc), plan: enc.decrypt(n.plan_enc),
        cid10_codes: n.cid10_codes || [], signature_hash: n.signature_hash, signed_at: n.signed_at,
      }), req.user.sub, reason]
    );
    // Reabre como rascunho para edição; limpa a assinatura anterior.
    await client.query(
      `UPDATE ehr.clinical_notes
          SET status = 'draft', signed_at = NULL, signature_hash = NULL,
              signature_jwt = NULL, pdf_storage_key = NULL, updated_at = NOW()
        WHERE id = $1`, [id]);
  });

  await logClinical(req, A.EHR_NOTE_AMENDED, {
    patientId: n.patient_id, resourceType: 'ehr_clinical_note', resourceId: id, details: { reason },
  });
  return success(res, { id }, 'Evolução reaberta para emenda');
}

// Trilha de adendos: versões assinadas anteriores (imutabilidade rastreável).
async function listNoteVersions(req, res) {
  const id = req.params.id;
  const n = await loadNoteOr404(id);
  await assertClinicalAccess(req, n.patient_id);
  const { rows } = await db.query(
    `SELECT v.version, v.change_reason, v.changed_by, u.name AS changed_by_name,
            v.created_at, v.snapshot
       FROM ehr.clinical_note_versions v
       LEFT JOIN auth.users u ON u.id = v.changed_by
      WHERE v.note_id = $1
      ORDER BY v.version DESC`, [id]);
  return success(res, rows);
}

// ── Problemas (CID-10) ───────────────────────────────────────────────────────
async function listProblems(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT pr.id, pr.cid10_code, c.description AS cid10_description, pr.title, pr.status,
            pr.is_chronic, pr.onset_date, pr.resolved_date, pr.encounter_id,
            pr.noted_by, u.name AS noted_by_name, pr.created_at, pr.updated_at
       FROM ehr.problems pr
       LEFT JOIN ris.cid10 c ON c.code = pr.cid10_code
       LEFT JOIN auth.users u ON u.id = pr.noted_by
      WHERE pr.patient_id = $1
      ORDER BY (pr.status = 'active') DESC, pr.is_chronic DESC, pr.created_at DESC`,
    [patientId]
  );
  return success(res, rows);
}

async function createProblem(req, res) {
  const { patient_id, cid10_code, title, status, is_chronic, onset_date, notes, encounter_id } = req.body;
  await assertClinicalAccess(req, patient_id);
  const { rows } = await db.query(
    `INSERT INTO ehr.problems
       (patient_id, cid10_code, title, status, is_chronic, onset_date, encounter_id, noted_by, notes_enc)
     VALUES ($1, $2, $3, COALESCE($4::ehr.problem_status,'active'), COALESCE($5,false), $6, $7, $8, $9)
     RETURNING id, title, status, is_chronic, onset_date, created_at`,
    [patient_id, norm(cid10_code), title, norm(status), is_chronic ?? null,
     norm(onset_date), norm(encounter_id), req.user.sub, enc.encrypt(norm(notes))]
  );
  await logClinical(req, A.EHR_PROBLEM_CREATED, {
    patientId: patient_id, resourceType: 'ehr_problem', resourceId: rows[0].id,
  });
  return created(res, rows[0], 'Problema adicionado');
}

async function updateProblem(req, res) {
  const { rows: ex } = await db.query(`SELECT patient_id FROM ehr.problems WHERE id = $1`, [req.params.id]);
  if (!ex.length) throw new NotFoundError('Problema');
  await assertClinicalAccess(req, ex[0].patient_id);

  const { cid10_code, title, status, is_chronic, onset_date, resolved_date, notes } = req.body;
  await db.query(
    `UPDATE ehr.problems SET
        cid10_code    = COALESCE($2, cid10_code),
        title         = COALESCE($3, title),
        status        = COALESCE($4, status),
        is_chronic    = COALESCE($5, is_chronic),
        onset_date    = COALESCE($6, onset_date),
        resolved_date = COALESCE($7, resolved_date),
        notes_enc     = CASE WHEN $8::boolean THEN $9 ELSE notes_enc END
      WHERE id = $1`,
    [req.params.id, norm(cid10_code), norm(title), norm(status), is_chronic ?? null,
     norm(onset_date), norm(resolved_date), notes !== undefined, enc.encrypt(norm(notes))]
  );
  await logClinical(req, A.EHR_PROBLEM_UPDATED, {
    patientId: ex[0].patient_id, resourceType: 'ehr_problem', resourceId: req.params.id,
  });
  return success(res, { id: req.params.id }, 'Problema atualizado');
}

// ── Sinais vitais ────────────────────────────────────────────────────────────
const VITAL_FIELDS = ['systolic', 'diastolic', 'heart_rate', 'resp_rate', 'temp_c',
  'spo2', 'weight_kg', 'height_cm', 'pain_scale', 'glucose_mgdl', 'notes'];

async function createVitals(req, res) {
  const e = await loadEncounterOr404(req.params.id);
  await assertClinicalAccess(req, e.patient_id);

  const cols = ['encounter_id', 'patient_id', 'measured_by'];
  const vals = [e.id, e.patient_id, req.user.sub];
  for (const f of VITAL_FIELDS) {
    if (req.body[f] !== undefined && req.body[f] !== null && req.body[f] !== '') {
      cols.push(f); vals.push(req.body[f]);
    }
  }
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await db.query(
    `INSERT INTO ehr.vitals (${cols.join(', ')}) VALUES (${ph})
     RETURNING id, measured_at, systolic, diastolic, heart_rate, resp_rate,
               temp_c, spo2, weight_kg, height_cm, bmi, pain_scale, glucose_mgdl`,
    vals
  );
  await logClinical(req, A.EHR_VITALS_RECORDED, {
    patientId: e.patient_id, resourceType: 'ehr_vitals', resourceId: rows[0].id,
  });
  return created(res, rows[0], 'Sinais vitais registrados');
}

async function listVitals(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);
  const { rows } = await db.query(
    `SELECT id, encounter_id, measured_at, measured_by, systolic, diastolic, heart_rate,
            resp_rate, temp_c, spo2, weight_kg, height_cm, bmi, pain_scale, glucose_mgdl, notes
       FROM ehr.vitals WHERE patient_id = $1 ORDER BY measured_at DESC LIMIT 200`,
    [patientId]
  );
  return success(res, rows);
}

// ── Timeline (agrega encounters + evoluções + estudos + laudos + vitais) ──────
async function timeline(req, res) {
  const patientId = req.params.id;
  await assertClinicalAccess(req, patientId);

  const [enc_, notes, studies, reports, vitals] = await Promise.all([
    db.query(`SELECT e.id, e.encounter_type, e.status, e.started_at, u.name AS professional_name
                FROM ehr.encounters e LEFT JOIN auth.users u ON u.id = e.professional_id
               WHERE e.patient_id = $1`, [patientId]),
    db.query(`SELECT n.id, n.encounter_id, n.status, n.created_at, n.signed_at, au.name AS author_name
                FROM ehr.clinical_notes n LEFT JOIN auth.users au ON au.id = n.author_id
               WHERE n.patient_id = $1`, [patientId]),
    db.query(`SELECT id, modality_type, study_date, status, accession_number
                FROM pacs.studies WHERE patient_id = $1`, [patientId]),
    db.query(`SELECT r.id, r.status, r.signed_at, r.created_at, s.modality_type
                FROM ris.reports r JOIN pacs.studies s ON s.id = r.study_id
               WHERE s.patient_id = $1 AND r.status <> 'cancelled'`, [patientId]),
    db.query(`SELECT id, encounter_id, measured_at FROM ehr.vitals WHERE patient_id = $1`, [patientId]),
  ]);

  const events = [
    ...enc_.rows.map(r => ({ type: 'encounter', id: r.id, at: r.started_at,
      title: r.encounter_type, status: r.status, actor: r.professional_name })),
    ...notes.rows.map(r => ({ type: 'note', id: r.id, encounter_id: r.encounter_id,
      at: r.signed_at || r.created_at, status: r.status, actor: r.author_name })),
    ...studies.rows.map(r => ({ type: 'study', id: r.id, at: r.study_date,
      title: r.modality_type, status: r.status, ref: r.accession_number })),
    ...reports.rows.map(r => ({ type: 'report', id: r.id, at: r.signed_at || r.created_at,
      title: r.modality_type, status: r.status })),
    ...vitals.rows.map(r => ({ type: 'vitals', id: r.id, encounter_id: r.encounter_id, at: r.measured_at })),
  ].filter(ev => ev.at)
   .sort((a, b) => new Date(b.at) - new Date(a.at));

  await logClinical(req, A.EHR_TIMELINE_VIEWED, { patientId, resourceType: 'ehr_timeline' });
  return success(res, events);
}

// ── Break-glass ──────────────────────────────────────────────────────────────
async function breakGlass(req, res) {
  const patientId = req.params.id;
  const { reason } = req.body;
  const { rows: pat } = await db.query(`SELECT id FROM ris.patients WHERE id = $1`, [patientId]);
  if (!pat.length) throw new NotFoundError('Paciente');

  const { rows } = await db.query(
    `INSERT INTO ehr.breakglass_grants (user_id, patient_id, reason)
     VALUES ($1, $2, $3) RETURNING id, expires_at`,
    [req.user.sub, patientId, reason]
  );
  // Auditoria de quebra de sigilo — evento sensível.
  await audit.log({
    ...audit.fromRequest(req),
    action: A.EHR_BREAKGLASS,
    resourceType: 'ehr_breakglass',
    resourceId: rows[0].id,
    details: { patient_id: patientId, reason, expires_at: rows[0].expires_at },
  });
  logger.warn('[ehr] BREAK-GLASS acionado', { userId: req.user.sub, patientId, reason });
  return created(res, { id: rows[0].id, expires_at: rows[0].expires_at },
    'Acesso de emergência concedido (12h). Evento auditado.');
}

// ── RNDS / FHIR (stub) ───────────────────────────────────────────────────────
// Exporta o atendimento como Bundle FHIR R4 (RAC). Não transmite ao DATASUS.
async function exportEncounterFhir(req, res) {
  const e = await loadEncounterOr404(req.params.id);
  await assertClinicalAccess(req, e.patient_id);
  const [pat, prac, notesQ, probsQ, unitQ] = await Promise.all([
    db.query(`SELECT id, name_encrypted, birth_date, gender FROM ris.patients WHERE id=$1`, [e.patient_id]),
    db.query(`SELECT id, name FROM auth.users WHERE id=$1`, [e.professional_id]),
    db.query(`SELECT * FROM ehr.clinical_notes WHERE encounter_id=$1 AND status IN ('signed','amended') ORDER BY created_at`, [e.id]),
    db.query(`SELECT id, cid10_code, title, status FROM ehr.problems WHERE patient_id=$1`, [e.patient_id]),
    e.health_unit_id ? db.query(`SELECT name FROM ris.health_units WHERE id=$1`, [e.health_unit_id]) : Promise.resolve({ rows: [] }),
  ]);
  const patient = {
    id: pat.rows[0].id, name: enc.safeDecrypt(pat.rows[0].name_encrypted),
    birth_date: pat.rows[0].birth_date, gender: pat.rows[0].gender,
  };
  const bundle = buildRacBundle({
    encounter: e, patient, practitioner: prac.rows[0], unit: unitQ.rows[0],
    notes: notesQ.rows.map(decryptNote), problems: probsQ.rows,
  });
  await logClinical(req, 'EHR_FHIR_EXPORT', { patientId: e.patient_id, resourceType: 'ehr_encounter', resourceId: e.id });
  res.setHeader('Content-Type', 'application/fhir+json');
  return res.json(bundle);
}

// PDF da evolução assinada (gerado sob demanda se faltar no storage)
async function downloadNotePdf(req, res) {
  const { rows } = await db.query(`SELECT patient_id FROM ehr.clinical_notes WHERE id = $1`, [req.params.id]);
  if (!rows.length) throw new NotFoundError('Evolução');
  await assertClinicalAccess(req, rows[0].patient_id);
  const { bucket, key } = await ensurePdf('note', req.params.id);
  const body = await storage.getStream(bucket, key);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="evolucao-${req.params.id}.pdf"`);
  body.pipe(res);
}

module.exports = {
  downloadNotePdf,
  buildNoteHtml,   // reutilizado na regeneração de PDF (services/documentPdf)
  createEncounter, listEncounters, getEncounter, updateEncounter, closeEncounter,
  createNote, updateNote, signNote, amendNote, listNoteVersions,
  listProblems, createProblem, updateProblem,
  createVitals, listVitals,
  timeline, breakGlass, exportEncounterFhir,
};
