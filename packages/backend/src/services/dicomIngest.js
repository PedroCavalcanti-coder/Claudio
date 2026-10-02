'use strict';
/**
 * Ingestão de estudos DICOM do Orthanc no RIS/PACS.
 * --------------------------------------------------------------------
 * Dois caminhos usam este módulo:
 *   1. Upload manual pela tela (studies.controller → replicação/sincronização);
 *   2. Envio direto do EQUIPAMENTO (C-STORE na porta 4242): o Lua do Orthanc avisa
 *      `POST /dicom/webhook/orthanc` quando o estudo fica estável e
 *      `ingestOrthancStudy` vincula ao agendamento (AccessionNumber da worklist) ou
 *      ao paciente (PatientID = prontuário). Sem vínculo, o estudo vai para a FILA DE
 *      CONCILIAÇÃO (`pacs.unmatched_studies`) — nunca cria paciente com dado falso.
 */
const db       = require('../config/database');
const storage  = require('../config/storage');
const audit    = require('./audit');
const enc      = require('./encryption');
const logger   = require('../config/logger');
const orthanc  = require('./orthanc');
const mwl      = require('./mwl.service');

const MODALITIES = new Set(['CR', 'DX', 'CT', 'MR', 'US', 'NM', 'PT', 'MG', 'RF', 'OT', 'SC', 'XA']);
// Modalidade DICOM fora do enum do banco (ex.: "PX", "ES") vira NULL/OT em vez de derrubar o INSERT.
const normalizeModality = (m) => {
  const v = String(m || '').split('\\')[0].trim().toUpperCase();
  return MODALITIES.has(v) ? v : null;
};

// Sem esta cópia, o DICOM viveria só no volume SQLite local do Orthanc, sem réplica durável.
// Se a replicação falhar, cai no fallback 'orthanc:<id>' — nada quebra, só fica menos durável.
async function replicateInstanceToRustfs(orthancInstanceId, studyUID, seriesUid, sopUid, fileSize) {
  const key = `pacs-dicom/${studyUID}/${seriesUid}/${sopUid}.dcm`;
  try {
    if (!(await storage.exists(storage.BUCKETS.DICOM, key))) {
      const fileResp = await orthanc.get(`/instances/${orthancInstanceId}/file`, {
        responseType: 'stream',
        timeout: 120_000,
      });
      await storage.upload(
        storage.BUCKETS.DICOM, key, fileResp.data, 'application/dicom',
        { studyUID, seriesUID: seriesUid, sopUID: sopUid },
        Number(fileSize) || undefined,
      );
    }
    return key;
  } catch (err) {
    logger.warn('Replicação RustFS falhou — mantendo cópia no Orthanc', {
      orthancInstanceId, error: err.message,
    });
    return `orthanc:${orthancInstanceId}`;
  }
}


async function syncInstancesFromOrthanc(studyDbId, studyUID, defaultModality) {
  // 1. Busca o estudo no Orthanc pelo StudyInstanceUID
  const findRes = await orthanc.post('/tools/find', {
    Level: 'Study',
    Query: { StudyInstanceUID: studyUID },
    Expand: false,
  });
  const orthancStudyIds = findRes.data ?? [];
  if (!orthancStudyIds.length) {
    logger.warn('Estudo não encontrado no Orthanc para lazy sync', { studyUID });
    return [];
  }

  const syncedInstances = [];

  for (const orthancStudyId of orthancStudyIds) {
    const studyMeta = (await orthanc.get(`/studies/${orthancStudyId}`)).data;
    const seriesIds = studyMeta.Series ?? [];

    for (const orthancSeriesId of seriesIds) {
      const seriesMeta = (await orthanc.get(`/series/${orthancSeriesId}`)).data;
      const sTags      = seriesMeta.MainDicomTags ?? {};

      const seriesUid  = sTags.SeriesInstanceUID ?? `auto.${orthancSeriesId}`;
      const seriesNum  = parseInt(sTags.SeriesNumber, 10) || null;
      const modality   = normalizeModality(sTags.Modality) || defaultModality;
      const seriesDesc = sTags.SeriesDescription || null;

      // Upsert série
      const { rows: seriesDbRows } = await db.query(
        `INSERT INTO pacs.series
           (study_id, series_instance_uid, series_number, modality, series_description)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (series_instance_uid) DO UPDATE SET
           study_id      = EXCLUDED.study_id,
           series_number = EXCLUDED.series_number
         RETURNING id`,
        [studyDbId, seriesUid, seriesNum, modality, seriesDesc]
      );
      const seriesDbId = seriesDbRows[0].id;

      // Instâncias
      const instanceIds = seriesMeta.Instances ?? [];
      for (const orthancInstanceId of instanceIds) {
        const instMeta  = (await orthanc.get(`/instances/${orthancInstanceId}`)).data;
        const iTags     = instMeta.MainDicomTags ?? {};
        const sopUid    = iTags.SOPInstanceUID   ?? `auto.${orthancInstanceId}`;
        const instNum   = parseInt(iTags.InstanceNumber, 10) || null;
        const sopClass  = iTags.SOPClassUID      || null;
        const cols      = parseInt(iTags.Columns, 10) || null;
        const rowsVal   = parseInt(iTags.Rows, 10)    || null;
        const framesVal = parseInt(iTags.NumberOfFrames, 10) || 1;
        const fileSz    = instMeta.FileSize ?? 0;
        // #29 — replica para o RustFS (durável). Fallback: 'orthanc:<id>'.
        const storageKey = await replicateInstanceToRustfs(
          orthancInstanceId, studyUID, seriesUid, sopUid, fileSz,
        );

        const { rows: instDbRows } = await db.query(
          `INSERT INTO pacs.instances
             (series_id, study_id, sop_instance_uid, sop_class_uid, instance_number,
              storage_key, file_size_bytes, columns, rows, number_of_frames)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (sop_instance_uid) DO UPDATE SET
             storage_key = EXCLUDED.storage_key
           RETURNING id`,
          [seriesDbId, studyDbId, sopUid, sopClass, instNum,
           storageKey, fileSz, cols, rowsVal, framesVal]
        );

        syncedInstances.push({
          id:                  instDbRows[0].id,
          series_id:           seriesDbId,
          series_instance_uid: seriesUid,
          series_number:       seriesNum,
          sop_instance_uid:    sopUid,
          instance_number:     instNum,
          modality,
        });
      }
    }
  }

  // Recalcula os contadores a partir das linhas REAIS. Os triggers de INSERT
  // (increment_series_instance_count / increment_study_series_count) somam a
  // cada inserção; sem este recálculo, um lazy sync repetido infla os números
  // (ex.: 427→854). Recalcular deixa idempotente.
  await db.query(
    `UPDATE pacs.studies SET
       number_of_instances = (SELECT COUNT(*) FROM pacs.instances WHERE study_id = $1),
       number_of_series    = (SELECT COUNT(*) FROM pacs.series    WHERE study_id = $1),
       updated_at = NOW()
     WHERE id = $1`,
    [studyDbId]
  );
  await db.query(
    `UPDATE pacs.series se SET
       number_of_instances = (SELECT COUNT(*) FROM pacs.instances i WHERE i.series_id = se.id)
     WHERE se.study_id = $1`,
    [studyDbId]
  );

  logger.info('Lazy sync do Orthanc concluído', {
    studyUID, studyDbId, instances: syncedInstances.length,
  });
  return syncedInstances;
}


async function notifyUploadComplete(studyId, study) {
  await db.query(
    `INSERT INTO ris.patient_notifications
       (patient_id, type, title, body, resource_type, resource_id)
     VALUES ($1, 'IMAGES_READY', 'Imagens disponíveis', $2, 'study', $3)`,
    [
      study.patient_id,
      'Suas imagens já estão disponíveis no portal. O laudo está sendo preparado.',
      studyId,
    ]
  );

  // Envio de e-mail simulado — não há integração SMTP/SendGrid real neste ambiente
  logger.info('EMAIL (simulado) → paciente: imagens disponíveis', {
    patientId: study.patient_id,
    studyId,
    modality:  study.modality_type,
  });

  if (study.appointment_id) {
    const { rows } = await db.query(
      `SELECT requesting_user_id, proc.name AS procedure_name
       FROM ris.appointments a
       JOIN ris.procedures proc ON proc.id = a.procedure_id
       WHERE a.id = $1 AND a.requesting_user_id IS NOT NULL`,
      [study.appointment_id]
    );
    if (rows.length) {
      const { createNotification } = require('../modules/notifications/notifications.routes');
      await createNotification({
        userId:       rows[0].requesting_user_id,
        type:         'IMAGES_READY',
        title:        'Upload DICOM concluído',
        body:         `Imagens de ${rows[0].procedure_name} foram recebidas e estão prontas para laudo.`,
        resourceType: 'study',
        resourceId:   studyId,
      });
    }
  }
}


// ── Ingestão automática (C-STORE do equipamento → webhook do Orthanc) ──────────

function parseDicomDate(d) {
  if (!d || String(d).length < 8) return null;
  const v = String(d);
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}
function parseDicomTime(t) {
  if (!t) return null;
  const v = String(t).split('.')[0].padEnd(6, '0');
  return `${v.slice(0, 2)}:${v.slice(2, 4)}:${v.slice(4, 6)}`;
}

// Status em que um agendamento de imagem ainda aceita imagens (mesma regra do upload manual).
const OPEN_APPT_STATUSES = ['scheduled', 'confirmed', 'checked_in', 'in_progress'];

/**
 * Descobre paciente/agendamento de um estudo recebido do equipamento.
 *  1. AccessionNumber == accession da worklist (mwl.accessionFor) → agendamento;
 *  2. PatientID == prontuário (MRN) → paciente (+ agendamento aberto mais próximo);
 * @returns {{ patientId, appointmentId, healthUnitId, via }|null}
 */
async function matchStudy({ accession, dicomPatientId, modality, studyDate }) {
  if (accession) {
    const { rows } = await db.query(
      `SELECT a.id, a.patient_id, a.health_unit_id
         FROM ris.appointments a
        WHERE a.appointment_kind = 'imaging'
          AND upper(substr(replace(a.id::text, '-', ''), 1, 16)) = upper($1)
        LIMIT 1`,
      [String(accession).trim()]
    );
    if (rows.length) {
      return { patientId: rows[0].patient_id, appointmentId: rows[0].id,
               healthUnitId: rows[0].health_unit_id, via: 'accession' };
    }
  }

  if (dicomPatientId) {
    const { rows: pts } = await db.query(
      `SELECT id FROM ris.patients WHERE medical_record_number = $1 AND is_active = TRUE`,
      [String(dicomPatientId).trim()]
    );
    if (pts.length) {
      // Agendamento de imagem ainda aberto do paciente: o mais próximo da data do estudo,
      // preferindo o da mesma modalidade.
      const { rows: apps } = await db.query(
        `SELECT a.id, a.health_unit_id
           FROM ris.appointments a
           JOIN ris.procedures proc ON proc.id = a.procedure_id
          WHERE a.patient_id = $1 AND a.appointment_kind = 'imaging'
            AND a.status = ANY($2::ris.appointment_status[])
          ORDER BY EXISTS (SELECT 1 FROM pacs.studies s WHERE s.appointment_id = a.id) ASC,
                   (proc.modality_type::text = $3) DESC,
                   abs(extract(epoch FROM (a.scheduled_at - $4::timestamptz))) ASC
          LIMIT 1`,
        [pts[0].id, OPEN_APPT_STATUSES, modality || '', studyDate ? `${studyDate}T12:00:00Z` : new Date().toISOString()]
      );
      return { patientId: pts[0].id, appointmentId: apps[0]?.id ?? null,
               healthUnitId: apps[0]?.health_unit_id ?? null, via: 'patient_id' };
    }
  }
  return null;
}

async function recordUnmatched(info, reason) {
  await db.query(
    `INSERT INTO pacs.unmatched_studies
       (orthanc_study_id, study_instance_uid, accession_number, dicom_patient_name_enc,
        dicom_patient_id_enc, modality_type, study_description, study_date,
        number_of_instances, reason, status, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',NOW())
     ON CONFLICT (study_instance_uid) DO UPDATE SET
       orthanc_study_id = EXCLUDED.orthanc_study_id,
       number_of_instances = EXCLUDED.number_of_instances,
       -- estudo que chega de novo depois de descartado/vinculado não volta à fila sozinho
       updated_at = NOW()`,
    [info.orthancStudyId, info.studyUID, info.accession || null,
     info.patientName ? enc.encrypt(info.patientName) : null,
     info.dicomPatientId ? enc.encrypt(info.dicomPatientId) : null,
     info.modality, info.description || null, info.studyDate,
     info.instanceCount, reason]
  );
}

/**
 * Ingere um estudo que o Orthanc já guarda. Idempotente (webhook duplicado, varredura,
 * reprocessamento). `opts.patientId/appointmentId` forçam o vínculo (conciliação manual).
 * @returns {{ outcome: 'linked'|'patient_only'|'unmatched'|'already'|'busy', studyId?, unmatchedReason? }}
 */
async function ingestOrthancStudy(orthancStudyId, opts = {}) {
  const meta = (await orthanc.get(`/studies/${orthancStudyId}`)).data;
  const main = meta.MainDicomTags ?? {};
  const pTags = meta.PatientMainDicomTags ?? {};
  const studyUID = main.StudyInstanceUID;
  if (!studyUID) { logger.warn('DICOM ingest: estudo sem StudyInstanceUID', { orthancStudyId }); return { outcome: 'unmatched', unmatchedReason: 'sem StudyInstanceUID' }; }

  // Modalidade: do estudo (quando o Orthanc expõe) ou da 1ª série com modalidade conhecida.
  let modality = normalizeModality(main.ModalitiesInStudy);
  let seriesCount = (meta.Series ?? []).length;
  let instanceCount = 0;
  for (const sid of (meta.Series ?? [])) {
    try {
      const sm = (await orthanc.get(`/series/${sid}`)).data;
      instanceCount += (sm.Instances ?? []).length;
      if (!modality) modality = normalizeModality(sm.MainDicomTags?.Modality);
    } catch (err) { logger.warn('DICOM ingest: falha ao ler série', { sid, error: err.message }); }
  }

  const info = {
    orthancStudyId, studyUID, accession: (main.AccessionNumber || '').trim(),
    dicomPatientId: (pTags.PatientID || '').trim(), patientName: (pTags.PatientName || '').replace(/\^/g, ' ').trim(),
    modality, description: main.StudyDescription, studyDate: parseDicomDate(main.StudyDate),
    studyTime: parseDicomTime(main.StudyTime), seriesCount, instanceCount,
  };

  // Um processamento por estudo por vez (webhook + varredura podem coincidir).
  const lockClient = await db.getClient();
  try {
    const { rows: [lk] } = await lockClient.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [studyUID]);
    if (!lk.ok) return { outcome: 'busy' };
    try {
      return await _ingestLocked(info, opts);
    } finally {
      await lockClient.query(`SELECT pg_advisory_unlock(hashtext($1))`, [studyUID]);
    }
  } finally {
    lockClient.release();
  }
}

async function _ingestLocked(info, opts) {
  const { studyUID, orthancStudyId } = info;

  // Já existe no PACS → só atualiza o id do Orthanc e completa instâncias novas.
  const { rows: existing } = await db.query(
    `SELECT id, patient_id FROM pacs.studies WHERE study_instance_uid = $1`, [studyUID]);
  if (existing.length) {
    await db.query(`UPDATE pacs.studies SET orthanc_study_id = COALESCE(orthanc_study_id, $2) WHERE id = $1`,
      [existing[0].id, orthancStudyId]);
    await syncInstancesFromOrthanc(existing[0].id, studyUID, info.modality);
    return { outcome: 'already', studyId: existing[0].id };
  }

  let target = null;
  if (opts.patientId) {
    target = { patientId: opts.patientId, appointmentId: opts.appointmentId ?? null, healthUnitId: null, via: 'manual' };
    if (target.appointmentId) {
      const { rows } = await db.query(`SELECT health_unit_id FROM ris.appointments WHERE id = $1`, [target.appointmentId]);
      target.healthUnitId = rows[0]?.health_unit_id ?? null;
    }
  } else {
    target = await matchStudy({
      accession: info.accession, dicomPatientId: info.dicomPatientId,
      modality: info.modality, studyDate: info.studyDate,
    });
  }

  if (!target) {
    await recordUnmatched(info, info.accession
      ? 'AccessionNumber e PatientID do equipamento não correspondem a nenhum agendamento/paciente'
      : 'Equipamento enviou sem AccessionNumber e o PatientID não corresponde a nenhum paciente');
    logger.warn('DICOM ingest: estudo sem vínculo — enviado à conciliação', { studyUID, accession: info.accession });
    await audit.log({ action: 'STUDY_UNMATCHED', resourceType: 'study', resourceId: null,
      details: { studyUID, accession: info.accession, modality: info.modality } });
    return { outcome: 'unmatched' };
  }

  const now = new Date();
  const studyDate = info.studyDate || now.toISOString().slice(0, 10);
  const studyTime = info.studyTime || '00:00:00';
  const { rows: [study] } = await db.query(
    `INSERT INTO pacs.studies
       (appointment_id, patient_id, study_instance_uid, accession_number, study_date, study_time,
        modality_type, study_description, status, display_status, number_of_series,
        number_of_instances, upload_completed_at, received_at, health_unit_id, orthanc_study_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'complete','in_report',$9,$10,NOW(),NOW(),$11,$12)
     ON CONFLICT (study_instance_uid) DO UPDATE SET orthanc_study_id = EXCLUDED.orthanc_study_id
     RETURNING id`,
    [target.appointmentId, target.patientId, studyUID, info.accession ? info.accession.slice(0, 16) : '',
     studyDate, studyTime, info.modality, info.description?.slice(0, 200) || null,
     info.seriesCount, info.instanceCount, target.healthUnitId, orthancStudyId]
  );

  await syncInstancesFromOrthanc(study.id, studyUID, info.modality);

  if (target.appointmentId) {
    await db.query(
      `UPDATE ris.appointments SET status = 'in_progress', updated_at = NOW()
        WHERE id = $1 AND status = ANY($2::ris.appointment_status[])`,
      [target.appointmentId, OPEN_APPT_STATUSES]);
    mwl.removeWorklist(target.appointmentId).catch(() => {});
  }

  await db.query(
    `UPDATE pacs.unmatched_studies
        SET status = 'matched', matched_study_id = $2, resolved_by = $3, resolved_at = NOW(), updated_at = NOW()
      WHERE study_instance_uid = $1 AND status = 'pending'`, [studyUID, study.id, opts.resolvedBy ?? null]);

  await audit.log({
    userId: opts.resolvedBy ?? null, action: 'STUDY_RECEIVED', resourceType: 'study', resourceId: study.id,
    details: { studyUID, via: target.via, appointment_id: target.appointmentId, instances: info.instanceCount, modality: info.modality },
  });

  setImmediate(() => notifyUploadComplete(study.id, {
    patient_id: target.patientId, appointment_id: target.appointmentId, modality_type: info.modality,
  }).catch((err) => logger.error('DICOM ingest: erro ao notificar paciente', { error: err.message, studyId: study.id })));
  try {
    const { notify } = require('./notifications');
    setImmediate(() => notify('study.processed', { studyId: study.id }));
    setImmediate(() => notify('study.images_ready', { studyId: study.id }));
  } catch { /* notificações são best-effort */ }

  logger.info('DICOM ingest: estudo vinculado', { studyUID, studyId: study.id, via: target.via });
  return { outcome: target.appointmentId ? 'linked' : 'patient_only', studyId: study.id };
}

/**
 * Rede de segurança: estudos que estão no Orthanc mas nunca chegaram ao RIS (webhook perdido
 * porque o backend estava fora do ar). Roda no boot e periodicamente; só olha estudos
 * atualizados nas últimas `maxAgeHours` horas.
 */
async function sweepOrthanc({ maxAgeHours = 48, limit = 20 } = {}) {
  let ids;
  try { ids = (await orthanc.get('/studies', { timeout: 15000 })).data; }
  catch (err) { logger.warn('DICOM sweep: Orthanc inacessível', { error: err.message }); return { checked: 0, ingested: 0 }; }
  if (!Array.isArray(ids) || !ids.length) return { checked: 0, ingested: 0 };

  const { rows: known } = await db.query(
    `SELECT orthanc_study_id FROM pacs.studies WHERE orthanc_study_id = ANY($1)
      UNION SELECT orthanc_study_id FROM pacs.unmatched_studies WHERE orthanc_study_id = ANY($1)`, [ids]);
  const knownSet = new Set(known.map((r) => r.orthanc_study_id));
  const cutoff = Date.now() - maxAgeHours * 3600e3;
  let ingested = 0;
  for (const id of ids.filter((i) => !knownSet.has(i)).slice(0, 500)) {
    if (ingested >= limit) break;
    try {
      const m = (await orthanc.get(`/studies/${id}`)).data;
      const last = m.LastUpdate ? Date.parse(m.LastUpdate.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6Z')) : NaN;
      if (Number.isFinite(last) && last < cutoff) continue;
      const r = await ingestOrthancStudy(id);
      if (r.outcome !== 'already' && r.outcome !== 'busy') ingested++;
    } catch (err) { logger.warn('DICOM sweep: falha ao ingerir', { id, error: err.message }); }
  }
  return { checked: ids.length, ingested };
}

module.exports = {
  replicateInstanceToRustfs, syncInstancesFromOrthanc, notifyUploadComplete,
  ingestOrthancStudy, matchStudy, sweepOrthanc, normalizeModality,
};
