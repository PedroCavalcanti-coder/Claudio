'use strict';
/**
 * DICOM Modality Worklist (MWL) — #25 (real).
 * --------------------------------------------------------------------
 * Gera um arquivo DICOM `.wl` por agendamento e grava em MWL_DIR. O plugin
 * Worklists do Orthanc serve esses arquivos às modalidades via C-FIND, para que
 * o técnico não digite os dados do paciente no equipamento.
 *
 * Produz DICOM Part-10 real (Explicit VR LE) com os atributos da MWL e a
 * Scheduled Procedure Step Sequence.
 *
 * Referência: DICOM PS3.4 Annex K (Basic Worklist Management).
 */
const fs     = require('fs');
const fsp     = require('fs/promises');
const path   = require('path');
const crypto = require('crypto');
const db     = require('../config/database');
const env    = require('../config/env');
const enc    = require('./encryption');
const logger = require('../config/logger');
const { buildPart10 } = require('../utils/dicomWriter');

// Accession determinístico por agendamento (≤16 chars, A-Z0-9) — também o nome do .wl.
function accessionFor(appointmentId) {
  return appointmentId.replace(/-/g, '').slice(0, 16).toUpperCase();
}
const wlPath = (accession) => path.join(env.MWL_DIR, `${accession}.wl`);

function dicomDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth()+1).padStart(2,'0')}${String(dt.getUTCDate()).padStart(2,'0')}`;
}
function dicomTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${String(dt.getUTCHours()).padStart(2,'0')}${String(dt.getUTCMinutes()).padStart(2,'0')}${String(dt.getUTCSeconds()).padStart(2,'0')}`;
}
// '2.25.<uint>' — UID derivado de bytes aleatórios (OID raiz 2.25, sem registro).
function genUID() {
  const n = BigInt('0x' + crypto.randomBytes(12).toString('hex'));
  return `2.25.${n.toString()}`;
}

/**
 * Gera/atualiza o arquivo .wl do agendamento. Retorna o caminho ou null.
 */
async function writeWorklist(appointmentId) {
  const { rows } = await db.query(
    `SELECT a.id, a.scheduled_at, a.priority, a.clinical_indication,
            p.birth_date, p.gender, p.name_encrypted, p.medical_record_number,
            proc.name AS procedure_name, proc.tuss_code, proc.modality_type, proc.body_part,
            m.dicom_ae_title, m.name AS modality_name
       FROM ris.appointments a
       JOIN ris.patients   p    ON p.id = a.patient_id
       JOIN ris.procedures proc ON proc.id = a.procedure_id
       LEFT JOIN ris.modalities m ON m.id = a.modality_id
      WHERE a.id = $1`,
    [appointmentId]
  );
  if (!rows.length) { logger.warn('MWL: agendamento não encontrado', { appointmentId }); return null; }
  const r = rows[0];

  const patientName = (enc.decrypt(r.name_encrypted) ?? 'UNKNOWN').replace(/ /g, '^'); // SOBRENOME^NOME
  const accession   = accessionFor(r.id);
  const modality    = r.modality_type ?? 'OT';
  const aeTitle     = r.dicom_ae_title ?? 'UNKNOWN_AE';

  // dataset em ORDEM ASCENDENTE de tag (requisito DICOM)
  const dataset = [
    { tag: [0x0008, 0x0050], vr: 'SH', value: accession },                 // AccessionNumber
    { tag: [0x0008, 0x0090], vr: 'PN', value: '' },                        // ReferredPhysicianName
    { tag: [0x0008, 0x1030], vr: 'LO', value: r.procedure_name ?? '' },    // StudyDescription
    { tag: [0x0010, 0x0010], vr: 'PN', value: patientName },               // PatientName
    { tag: [0x0010, 0x0020], vr: 'LO', value: r.medical_record_number ?? '' }, // PatientID
    { tag: [0x0010, 0x0030], vr: 'DA', value: dicomDate(r.birth_date) },   // PatientBirthDate
    { tag: [0x0010, 0x0040], vr: 'CS', value: r.gender === 'F' ? 'F' : r.gender === 'M' ? 'M' : 'O' }, // PatientSex
    { tag: [0x0032, 0x1060], vr: 'LO', value: r.procedure_name ?? '' },    // RequestedProcedureDescription
    { tag: [0x0040, 0x0100], vr: 'SQ', value: [[                            // ScheduledProcedureStepSequence
      { tag: [0x0008, 0x0060], vr: 'CS', value: modality },                // Modality
      { tag: [0x0040, 0x0001], vr: 'AE', value: aeTitle },                 // ScheduledStationAETitle
      { tag: [0x0040, 0x0002], vr: 'DA', value: dicomDate(r.scheduled_at) }, // SPS StartDate
      { tag: [0x0040, 0x0003], vr: 'TM', value: dicomTime(r.scheduled_at) }, // SPS StartTime
      { tag: [0x0040, 0x0006], vr: 'PN', value: '' },                      // ScheduledPerformingPhysicianName
      { tag: [0x0040, 0x0007], vr: 'LO', value: r.procedure_name ?? '' },  // SPS Description
      { tag: [0x0040, 0x0009], vr: 'SH', value: accession },               // SPS ID
    ]] },
    { tag: [0x0040, 0x1001], vr: 'SH', value: r.tuss_code ?? accession },  // RequestedProcedureID
  ];

  const file = buildPart10(dataset, { sopInstanceUID: genUID() });

  await fsp.mkdir(env.MWL_DIR, { recursive: true });
  await fsp.writeFile(wlPath(accession), file);

  logger.info('MWL: worklist .wl gravada', {
    appointmentId, accession, modality, aeTitle, file: wlPath(accession), bytes: file.length,
  });
  return wlPath(accession);
}

/** Remove o .wl do agendamento (no cancelamento/conclusão). Idempotente. */
async function removeWorklist(appointmentId) {
  try {
    await fsp.unlink(wlPath(accessionFor(appointmentId)));
    logger.info('MWL: worklist removida', { appointmentId });
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn('MWL: falha ao remover worklist', { appointmentId, error: err.message });
  }
}

module.exports = {
  writeWorklist,
  removeWorklist,
  sendWorklistEntry: writeWorklist,   // alias de compatibilidade (check-in já chama isto)
  accessionFor,
  _wlPath: wlPath,
};
