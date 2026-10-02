'use strict';

const db       = require('../../config/database');
const storage  = require('../../config/storage');
const audit    = require('../../services/audit');
const logger   = require('../../config/logger');
const orthanc  = require('../../services/orthanc');
const { success } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');

function parseDicomDate(d) {
  if (!d || d.length < 8) return new Date().toISOString().slice(0, 10);
  return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
}
function parseDicomTime(t) {
  if (!t || t.length < 6) return '00:00:00';
  return `${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`;
}

async function orthancWebhook(req, res) {
  res.status(200).json({ ok: true });
  setImmediate(() => processOrthancEvent(req.body).catch(err =>
    logger.error('Erro no processamento DICOM', { error: err.message })
  ));
}

async function processOrthancEvent(body) {
  logger.info('Webhook Orthanc', { body: JSON.stringify(body).slice(0, 200) });

  const orthancStudyId = body?.ID || body?.ResourceId || body?.id || body?.studyId;
  if (!orthancStudyId) { logger.warn('Webhook sem ID'); return; }

  let studyMeta;
  try {
    studyMeta = (await orthanc.get(`/studies/${orthancStudyId}`)).data;
  } catch (err) {
    logger.error('Orthanc: falha ao buscar estudo', { error: err.message });
    return;
  }

  const mainTags    = studyMeta.MainDicomTags            ?? {};
  const patientTags = studyMeta.PatientMainDicomTags     ?? {};
  const studyUID    = mainTags.StudyInstanceUID;
  const accession   = mainTags.AccessionNumber           ?? '';
  const studyDate   = parseDicomDate(mainTags.StudyDate);
  const studyTime   = parseDicomTime(mainTags.StudyTime);
  const modality    = (mainTags.ModalitiesInStudy ?? 'OT').split('\\')[0];
  const description = mainTags.StudyDescription          ?? '';
  const patientName = patientTags.PatientName            ?? '';
  const patientId   = patientTags.PatientID              ?? '';

  if (!studyUID) { logger.warn('Sem StudyInstanceUID'); return; }
  logger.info('Processando', { studyUID, modality });

  let patientDbId = null;
  if (patientId) {
    const { rows } = await db.query(
      `SELECT id FROM ris.patients WHERE medical_record_number = $1`, [patientId]
    );
    patientDbId = rows[0]?.id ?? null;
  }

  if (!patientDbId) {
    logger.warn('Paciente não encontrado, criando temporário', { patientId });
    const enc = require('../../services/encryption');
    const name = patientName || `DICOM:${studyUID.slice(-8)}`;
    const { rows } = await db.query(
      `INSERT INTO ris.patients (name_encrypted, name_search_hash, birth_date, gender, cpf_encrypted, cpf_hash)
       VALUES ($1,$2,'1900-01-01','O',$3,$4) RETURNING id`,
      [enc.encrypt(name), enc.searchHash(name), enc.encrypt('00000000000'), enc.searchHash('00000000000')]
    );
    patientDbId = rows[0].id;
  }

  await db.query(
    `INSERT INTO pacs.studies
       (patient_id,study_instance_uid,accession_number,study_date,study_time,
        modality_type,study_description,storage_prefix,status,received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'receiving',NOW())
     ON CONFLICT (study_instance_uid) DO UPDATE
       SET status='receiving', received_at=NOW(), updated_at=NOW()`,
    [patientDbId,studyUID,accession,studyDate,studyTime,modality,description,`pacs-dicom/${studyUID}/`]
  );

  const { rows: sRows } = await db.query(
    `SELECT id FROM pacs.studies WHERE study_instance_uid=$1`, [studyUID]
  );
  const studyDbId = sRows[0].id;

  let totalInstances = 0;
  for (const orthancSeriesId of (studyMeta.Series ?? [])) {
    let seriesMeta;
    try { seriesMeta = (await orthanc.get(`/series/${orthancSeriesId}`)).data; }
    catch (e) { logger.warn('Falha série', { orthancSeriesId, e: e.message }); continue; }

    const sTags = seriesMeta.MainDicomTags ?? {};

    await db.query(
      `INSERT INTO pacs.series (study_id,series_instance_uid,series_number,modality,series_description,body_part_examined,protocol_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (series_instance_uid) DO NOTHING`,
      [studyDbId,sTags.SeriesInstanceUID,parseInt(sTags.SeriesNumber)||0,sTags.Modality??modality,
       sTags.SeriesDescription??'',sTags.BodyPartExamined??'',sTags.ProtocolName??'']
    );

    const { rows: srRows } = await db.query(
      `SELECT id FROM pacs.series WHERE series_instance_uid=$1`, [sTags.SeriesInstanceUID]
    );
    const seriesDbId = srRows[0]?.id;
    if (!seriesDbId) continue;

    for (const orthancInstanceId of (seriesMeta.Instances ?? [])) {
      let instMeta;
      try { instMeta = (await orthanc.get(`/instances/${orthancInstanceId}`)).data; }
      catch (e) { logger.warn('Falha instância', { orthancInstanceId, e: e.message }); continue; }

      const iTags  = instMeta.MainDicomTags ?? {};
      const sopUID = iTags.SOPInstanceUID;
      if (!sopUID) continue;

      const storageKey = `pacs-dicom/${studyUID}/${sTags.SeriesInstanceUID}/${sopUID}.dcm`;

      if (!(await storage.exists(storage.BUCKETS.DICOM, storageKey))) {
        try {
          const stream = await orthanc.get(`/instances/${orthancInstanceId}/file`, { responseType: 'stream' });
          await storage.upload(storage.BUCKETS.DICOM, storageKey, stream.data, 'application/dicom',
            { studyUID, seriesUID: sTags.SeriesInstanceUID, sopUID });
        } catch (e) {
          logger.error('Falha upload RustFS', { sopUID, e: e.message });
          continue;
        }
      }

      await db.query(
        `INSERT INTO pacs.instances
           (series_id,study_id,sop_instance_uid,sop_class_uid,instance_number,
            storage_key,transfer_syntax_uid,columns,rows,number_of_frames,file_size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0)
         ON CONFLICT (sop_instance_uid) DO NOTHING`,
        [seriesDbId,studyDbId,sopUID,iTags.SOPClassUID??'',parseInt(iTags.InstanceNumber)||0,
         storageKey,instMeta.TransferSyntaxUID??'',parseInt(iTags.Columns)||0,
         parseInt(iTags.Rows)||0,parseInt(iTags.NumberOfFrames)||1]
      );
      totalInstances++;
    }
  }

  await db.query(
    `UPDATE pacs.studies SET status='complete', updated_at=NOW(),
       number_of_series=(SELECT COUNT(*) FROM pacs.series WHERE study_id=$1),
       number_of_instances=(SELECT COUNT(*) FROM pacs.instances WHERE study_id=$1)
     WHERE id=$1`, [studyDbId]
  );
  await db.query(
    `UPDATE pacs.series se
     SET number_of_instances=(SELECT COUNT(*) FROM pacs.instances i WHERE i.series_id=se.id)
     WHERE se.study_id=$1`, [studyDbId]
  );

  logger.info('Estudo processado', { studyUID, studyDbId, totalInstances });
  await audit.log({ action:'STUDY_RECEIVED', resourceType:'study', resourceId:studyDbId,
    details:{ studyUID, totalInstances, modality } });
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
    patient_name:       enc.decrypt(st[0].name_encrypted),
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
