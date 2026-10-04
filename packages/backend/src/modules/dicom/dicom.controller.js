'use strict';

const db       = require('../../config/database');
const storage  = require('../../config/storage');
const audit    = require('../../services/audit');
const logger   = require('../../config/logger');
const orthanc  = require('../../services/orthanc');
const { ingestOrthancStudy } = require('../../services/dicomIngest');
const { success } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');

// O Orthanc (Lua OnStableStudy) chama este webhook quando um estudo enviado pelo
// equipamento (C-STORE) fica estável. Responde logo e processa em segundo plano.
async function orthancWebhook(req, res) {
  const orthancStudyId = req.body?.ID || req.body?.ResourceId || req.body?.id || req.body?.studyId;
  if (!orthancStudyId || typeof orthancStudyId !== 'string') {
    throw new AppError('Corpo inválido: informe o ID do estudo no Orthanc', 400, 'INVALID_WEBHOOK_BODY');
  }
  res.status(202).json({ ok: true });
  setImmediate(() => ingestOrthancStudy(orthancStudyId).catch((err) =>
    logger.error('Erro no processamento DICOM', { orthancStudyId, error: err.message })
  ));
}

async function uploadDicom(req, res) {
  if (!req.files?.length) throw new AppError('Nenhum arquivo enviado', 400);

  const results = [];
  for (const file of req.files) {
    try {
      const r = await orthanc.post('/instances', file.buffer, {
        headers: { 'Content-Type': 'application/dicom' },
        maxBodyLength: Infinity,
      });
      results.push({ filename: file.originalname, status: 'ok', orthancId: r.data?.ID });
    } catch (err) {
      logger.error('Falha upload Orthanc', { filename: file.originalname, error: err.message });
      results.push({ filename: file.originalname, status: 'error', error: err.message });
    }
  }

  const ok = results.filter(r => r.status === 'ok').length;
  return success(res, { results, ok, failed: results.length - ok }, `${ok} arquivo(s) enviado(s)`);
}

async function uploadDicomForPatient(req, res) {
  if (!req.files?.length) throw new AppError('Nenhum arquivo enviado', 400);

  const { patientId } = req.params;

  const { rows: pRows } = await db.query(
    `SELECT id FROM ris.patients WHERE id = $1 AND is_active = TRUE`, [patientId]
  );
  if (!pRows.length) throw new NotFoundError('Paciente');

  const results = [];
  for (const file of req.files) {
    try {
      const r = await orthanc.post('/instances', file.buffer, {
        headers: { 'Content-Type': 'application/dicom' },
        maxBodyLength: Infinity,
      });
      results.push({ filename: file.originalname, status: 'ok', orthancId: r.data?.ID });
    } catch (err) {
      logger.error('Falha upload Orthanc', { filename: file.originalname, error: err.message });
      results.push({ filename: file.originalname, status: 'error', error: err.message });
    }
  }

  const ok = results.filter(r => r.status === 'ok').length;
  await audit.log({
    ...audit.fromRequest(req),
    action: 'DICOM_UPLOAD_PATIENT',
    resourceType: 'patient',
    resourceId: patientId,
    details: { filesCount: req.files.length, successCount: ok },
  });

  return success(res, { results, ok, failed: results.length - ok }, `${ok} arquivo(s) enviado(s)`);
}

async function wadoInstances(req, res) {
  const { studyUID, seriesUID } = req.params;
  const { rows } = await db.query(
    `SELECT i.id,i.sop_instance_uid,i.sop_class_uid,i.instance_number,
            i.rows,i.columns,i.number_of_frames,i.transfer_syntax_uid
     FROM pacs.instances i
     JOIN pacs.series se ON se.id=i.series_id
     JOIN pacs.studies s ON s.id=se.study_id
     WHERE s.study_instance_uid=$1 AND se.series_instance_uid=$2
     ORDER BY i.instance_number ASC`,
    [studyUID, seriesUID]
  );
  res.setHeader('Content-Type', 'application/dicom+json');
  return res.json(rows.map(r => ({
    '00080018': { vr:'UI', Value:[r.sop_instance_uid] },
    '00080016': { vr:'UI', Value:[r.sop_class_uid]    },
    '00200013': { vr:'IS', Value:[r.instance_number]  },
    '00280010': { vr:'US', Value:[r.rows]              },
    '00280011': { vr:'US', Value:[r.columns]           },
    '00280008': { vr:'IS', Value:[r.number_of_frames]  },
    '00020010': { vr:'UI', Value:[r.transfer_syntax_uid] },
    '__id':      r.id,
  })));
}

async function wadoInstance(req, res) {
  const { studyUID, seriesUID, instanceUID } = req.params;
  const { rows } = await db.query(
    `SELECT i.storage_key, i.id FROM pacs.instances i
     JOIN pacs.series se ON se.id=i.series_id
     JOIN pacs.studies s ON s.id=se.study_id
     WHERE s.study_instance_uid=$1 AND se.series_instance_uid=$2
       AND (i.sop_instance_uid=$3 OR i.id::text=$3)`,
    [studyUID, seriesUID, instanceUID]
  );
  if (!rows.length) throw new NotFoundError('Instância DICOM');

  const { storage_key, id } = rows[0];
  if (!(await storage.exists(storage.BUCKETS.DICOM, storage_key)))
    throw new AppError('Arquivo não encontrado no storage', 404, 'FILE_NOT_FOUND');

  await audit.log({ ...audit.fromRequest(req), action: audit.ACTIONS.IMAGE_VIEWED,
    resourceType:'instance', resourceId:id, details:{studyUID,seriesUID,instanceUID} });

  res.setHeader('Content-Type', 'application/dicom');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  const stream = await storage.getStream(storage.BUCKETS.DICOM, storage_key);
  stream.pipe(res);
  stream.on('error', err => {
    logger.error('Stream error', { storage_key, error: err.message });
    if (!res.headersSent) res.status(500).json({ success:false, message:'Erro ao ler DICOM' });
  });
}

async function getStudySeries(req, res) {
  const { studyUID } = req.params;
  const { rows: st } = await db.query(
    `SELECT s.id,s.study_instance_uid,s.study_date,s.modality_type,
            s.study_description,s.accession_number,s.status,
            s.number_of_series,s.number_of_instances,
            p.name_encrypted,p.medical_record_number
     FROM pacs.studies s JOIN ris.patients p ON p.id=s.patient_id
     WHERE s.study_instance_uid=$1`, [studyUID]
  );
  if (!st.length) throw new NotFoundError('Estudo');

  const { rows: seriesRows } = await db.query(
    `SELECT se.id,se.series_instance_uid,se.series_number,se.series_description,
            se.modality,se.number_of_instances,se.body_part_examined,se.protocol_name,se.thumbnail_key,
            json_agg(json_build_object(
              'id',i.id,'sop_instance_uid',i.sop_instance_uid,'instance_number',i.instance_number,
              'rows',i.rows,'columns',i.columns,'number_of_frames',i.number_of_frames
            ) ORDER BY i.instance_number ASC) AS instances
     FROM pacs.series se JOIN pacs.instances i ON i.series_id=se.id
     WHERE se.study_id=$1
     GROUP BY se.id ORDER BY se.series_number ASC`,
    [st[0].id]
  );

  const enc = require('../../services/encryption');
  const series = await Promise.all(seriesRows.map(async s => ({
    ...s,
    thumbnail_url: s.thumbnail_key
      ? await storage.getPresignedUrl(storage.BUCKETS.THUMBNAILS, s.thumbnail_key, 3600)
      : null,
  })));

  return success(res, {
    study_instance_uid: st[0].study_instance_uid,
    accession_number:   st[0].accession_number,
    study_date:         st[0].study_date,
    modality_type:      st[0].modality_type,
    study_description:  st[0].study_description,
    status:             st[0].status,
    patient_name:       enc.safeDecrypt(st[0].name_encrypted),
    patient_id:         st[0].medical_record_number,
    series,
  });
}

async function worklist(req, res) {
  const { rows } = await db.query(`SELECT * FROM ris.v_worklist_today`);
  return success(res, rows);
}

async function orthancStatus(req, res) {
  try {
    const [sys, stats] = await Promise.all([
      orthanc.get('/system'), orthanc.get('/statistics'),
    ]);
    return success(res, { orthanc: sys.data, statistics: stats.data });
  } catch (err) {
    throw new AppError('Orthanc inacessível: ' + err.message, 503, 'ORTHANC_UNAVAILABLE');
  }
}

module.exports = { orthancWebhook, uploadDicom, uploadDicomForPatient, wadoInstances, wadoInstance,
                   getStudySeries, worklist, orthancStatus };
