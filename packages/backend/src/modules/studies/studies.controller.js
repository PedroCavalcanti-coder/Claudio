const { Readable } = require('stream');
const db          = require('../../config/database');
const env         = require('../../config/env');
const enc         = require('../../services/encryption');
const { buildUnitFilter, buildUnitOrReferralFilter } = require('../../middlewares/unitVisibility');
const audit       = require('../../services/audit');
const storage     = require('../../config/storage');
const logger      = require('../../config/logger');
const orthanc     = require('../../services/orthanc');
const uploadSession = require('../../services/uploadSession');
const { notify } = require('../../services/notifications');
const { success, created, paginated } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');
// Replicação Orthanc→RustFS, sincronização de séries/instâncias e aviso ao paciente
// são compartilhados com a ingestão automática (C-STORE do equipamento).
const {
  replicateInstanceToRustfs: _replicateInstanceToRustfs,
  syncInstancesFromOrthanc:  _syncInstancesFromOrthanc,
  notifyUploadComplete:      _notifyUploadComplete,
  ingestOrthancStudy,
} = require('../../services/dicomIngest');

// Tamanho de bloco é uma sugestão ao cliente, não um limite rígido do servidor
const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

async function list(req, res) {
  const { status, modality, date, date_from, date_to, page, limit } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  const conditions = [];

  if (status)    { params.push(status);    conditions.push(`s.status = $${params.length}`); }
  // Multi-unidade: visível se estudo é da minha unidade OU paciente foi encaminhado (referral aceito)
  const visFilter = buildUnitOrReferralFilter(req, 's', 's.patient_id', params);
  if (visFilter) conditions.push(visFilter);
  // Radiologista só vê estudos com laudo próprio, exceto os já concluídos (visão geral)
  if (req.user?.role === 'radiologist') {
    params.push(req.user.sub);
    conditions.push(`(s.id IN (SELECT study_id FROM ris.reports WHERE radiologist_id = $${params.length}) OR s.status = 'complete')`);
  }
  if (modality)  { params.push(modality);  conditions.push(`s.modality_type = $${params.length}`); }
  if (date)      { params.push(date);      conditions.push(`s.study_date = $${params.length}`); }
  if (date_from) { params.push(date_from); conditions.push(`s.study_date >= $${params.length}`); }
  if (date_to)   { params.push(date_to);   conditions.push(`s.study_date <= $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const baseQuery = `
    FROM pacs.studies s
    JOIN ris.patients p ON p.id = s.patient_id
    LEFT JOIN ris.appointments a ON a.id = s.appointment_id
    LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id
    LEFT JOIN ris.reports r ON r.study_id = s.id AND r.status NOT IN ('cancelled')
    LEFT JOIN auth.users u ON u.id = r.radiologist_id
    ${where}`;

  const [countRes, dataRes] = await Promise.all([
    db.query(`SELECT COUNT(*) ${baseQuery}`, params),
    db.query(`
      SELECT s.id, s.study_instance_uid, s.accession_number,
             s.study_date, s.study_time, s.modality_type, s.study_description,
             s.number_of_series, s.number_of_instances, s.size_bytes,
             s.status, s.display_status, s.received_at, s.upload_completed_at,
             p.id AS patient_id, p.birth_date, p.gender, p.medical_record_number,
             p.name_encrypted,
             proc.name AS procedure_name,
             r.id AS report_id, r.status AS report_status,
             u.name AS radiologist_name
      ${baseQuery}
      ORDER BY s.study_date DESC, COALESCE(s.upload_completed_at, s.received_at) DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  const data = dataRes.rows.map(r => ({
    ...r,
    patient_name: enc.decrypt(r.name_encrypted),
    name_encrypted: undefined,
  }));

  return paginated(res, { data, total: parseInt(countRes.rows[0].count), page, limit });
}

// ── Conciliação: estudos do equipamento sem agendamento/paciente correspondente ──
async function listUnmatched(req, res) {
  const status = ['pending', 'matched', 'discarded'].includes(req.query.status) ? req.query.status : 'pending';
  const { rows } = await db.query(
    `SELECT id, orthanc_study_id, study_instance_uid, accession_number, dicom_patient_name_enc,
            dicom_patient_id_enc, modality_type, study_description, study_date, number_of_instances,
            reason, status, matched_study_id, received_at, resolved_at
       FROM pacs.unmatched_studies
      WHERE status = $1
      ORDER BY received_at DESC
      LIMIT 200`, [status]);
  return success(res, rows.map((r) => ({
    ...r,
    dicom_patient_name: enc.safeDecrypt(r.dicom_patient_name_enc),
    dicom_patient_id:   enc.safeDecrypt(r.dicom_patient_id_enc),
    dicom_patient_name_enc: undefined,
    dicom_patient_id_enc:   undefined,
  })));
}

// Vincula um estudo órfão a um paciente (e, opcionalmente, a um agendamento de imagem dele).
async function matchUnmatched(req, res) {
  const { patient_id, appointment_id } = req.body;
  const { rows } = await db.query(
    `SELECT id, orthanc_study_id, status FROM pacs.unmatched_studies WHERE id = $1`, [req.params.id]);
  if (!rows.length) throw new NotFoundError('Estudo pendente de conciliação');
  if (rows[0].status !== 'pending') throw new AppError('Este estudo já foi resolvido', 409, 'ALREADY_RESOLVED');

  const { rows: pt } = await db.query(`SELECT id FROM ris.patients WHERE id = $1 AND is_active = TRUE`, [patient_id]);
  if (!pt.length) throw new NotFoundError('Paciente');
  if (appointment_id) {
    const { rows: ap } = await db.query(
      `SELECT id FROM ris.appointments WHERE id = $1 AND patient_id = $2 AND appointment_kind = 'imaging'`,
      [appointment_id, patient_id]);
    if (!ap.length) throw new AppError('Agendamento não pertence a este paciente (ou não é de imagem)', 422, 'APPOINTMENT_MISMATCH');
  }

  const result = await ingestOrthancStudy(rows[0].orthanc_study_id, {
    patientId: patient_id, appointmentId: appointment_id ?? null, resolvedBy: req.user.sub,
  });
  if (result.outcome === 'busy') throw new AppError('Estudo em processamento; tente novamente em instantes', 409, 'BUSY');

  await audit.log({
    ...audit.fromRequest(req),
    action: 'STUDY_RECONCILED', resourceType: 'study', resourceId: result.studyId ?? null,
    details: { unmatched_id: req.params.id, patient_id, appointment_id: appointment_id ?? null },
  });
  return success(res, { study_id: result.studyId, outcome: result.outcome }, 'Estudo vinculado ao paciente');
}

async function discardUnmatched(req, res) {
  const { rowCount } = await db.query(
    `UPDATE pacs.unmatched_studies
        SET status = 'discarded', resolved_by = $2, resolved_at = NOW(), updated_at = NOW(),
            reason = COALESCE($3, reason)
      WHERE id = $1 AND status = 'pending'`,
    [req.params.id, req.user.sub, req.body?.reason ?? null]);
  if (!rowCount) throw new NotFoundError('Estudo pendente de conciliação');
  await audit.log({ ...audit.fromRequest(req), action: 'STUDY_RECONCILE_DISCARDED', resourceType: 'study',
    resourceId: null, details: { unmatched_id: req.params.id, reason: req.body?.reason ?? null } });
  return success(res, { id: req.params.id }, 'Estudo descartado da fila (permanece no Orthanc)');
}

// Priors: paciente é global entre unidades, então o radiologista pode comparar com exames de outras unidades
async function priors(req, res) {
  const { rows: cur } = await db.query(
    `SELECT patient_id FROM pacs.studies WHERE id = $1`, [req.params.id]
  );
  if (!cur.length) throw new NotFoundError('Estudo');
  const { rows } = await db.query(
    `SELECT s.id, s.study_instance_uid, s.study_date, s.study_time,
            s.modality_type, s.accession_number, s.study_description,
            s.number_of_instances,
            r.status AS report_status
       FROM pacs.studies s
       LEFT JOIN ris.reports r ON r.study_id = s.id AND r.status NOT IN ('cancelled')
      WHERE s.patient_id = $1 AND s.id <> $2
      ORDER BY s.study_date DESC, s.study_time DESC
      LIMIT 50`,
    [cur[0].patient_id, req.params.id]
  );
  return success(res, rows);
}

async function pending(req, res) {
  const params = [];
  const unitFilter = buildUnitFilter(req, 'v', params);
  const where = unitFilter ? `WHERE ${unitFilter}` : '';
  const { rows } = await db.query(
    `SELECT * FROM ris.v_pending_reports v ${where} LIMIT 100`,
    params
  );
  return success(res, rows);
}

async function getById(req, res) {
  const visParams = [req.params.id];
  const visFilter = buildUnitOrReferralFilter(req, 's', 's.patient_id', visParams);
  const visClause = visFilter ? ` AND ${visFilter}` : '';

  const { rows } = await db.query(
    `SELECT s.*, p.name_encrypted, p.birth_date, p.gender, p.medical_record_number,
            a.id AS appointment_id, proc.name AS procedure_name,
            r.id AS report_id, r.status AS report_status,
            tu.name AS technician_name, hu.name AS realized_unit_name,
            eq.name AS equipment_name, rm.name AS room_name
     FROM pacs.studies s
     JOIN ris.patients p ON p.id = s.patient_id
     LEFT JOIN ris.appointments a ON a.id = s.appointment_id
     LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id
     LEFT JOIN ris.reports r ON r.study_id = s.id AND r.status NOT IN ('cancelled')
     LEFT JOIN auth.users tu ON tu.id = s.technician_user_id
     LEFT JOIN ris.health_units hu ON hu.id = s.health_unit_id
     LEFT JOIN ris.modalities eq ON eq.id = s.equipment_id
     LEFT JOIN ris.rooms rm ON rm.id = s.room_id
     WHERE s.id = $1${visClause}`,
    visParams
  );
  if (!rows.length) throw new NotFoundError('Estudo');

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.STUDY_VIEWED,
    resourceType: 'study',
    resourceId: req.params.id,
  });

  const row = rows[0];
  return success(res, {
    ...row,
    patient_name: enc.decrypt(row.name_encrypted),
    name_encrypted: undefined,
  });
}

async function series(req, res) {
  const { rows } = await db.query(
    `SELECT se.*, COUNT(i.id)::int AS instance_count
     FROM pacs.series se
     LEFT JOIN pacs.instances i ON i.series_id = se.id
     WHERE se.study_id = $1
     GROUP BY se.id
     ORDER BY se.series_number ASC`,
    [req.params.id]
  );
  return success(res, rows);
}

async function streamInstance(req, res) {
  const { id, instanceId } = req.params;

  const { rows } = await db.query(
    `SELECT i.storage_key, i.study_id
     FROM pacs.instances i
     JOIN pacs.series se ON se.id = i.series_id
     WHERE i.id = $1 AND se.study_id = $2`,
    [instanceId, id]
  );
  if (!rows.length) throw new NotFoundError('Instância DICOM');

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.IMAGE_VIEWED,
    resourceType: 'instance',
    resourceId: instanceId,
    details: { study_id: id },
  });

  const { storage_key } = rows[0];

  res.setHeader('Content-Type', 'application/dicom');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  // Permite que o OrthoVis (porta diferente) carregue o arquivo sem bloqueio CORB
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  if (storage_key.startsWith('orthanc:')) {
    const orthancInstanceId = storage_key.slice(8);
    try {
      const orthancResp = await orthanc.get(`/instances/${orthancInstanceId}/file`, {
        responseType: 'stream',
        timeout: 60_000,
      });
      orthancResp.data.pipe(res);
    } catch (err) {
      logger.error('Falha ao fazer stream do Orthanc', {
        orthancInstanceId,
        message:    err.message,
        code:       err.code,
        cause:      err.cause?.message ?? err.cause?.code,
        status:     err.response?.status,
        statusText: err.response?.statusText,
        baseURL:    err.config?.baseURL,
        url:        err.config?.url,
      });
      throw new AppError('Falha ao recuperar imagem do Orthanc', 502, 'ORTHANC_STREAM_ERROR');
    }
  } else {
    const stream = await storage.getStream(storage.BUCKETS.DICOM, storage_key);
    stream.pipe(res);
  }
}

async function uploadComplete(req, res) {
  const { id } = req.params;

  const { rows } = await db.query(
    `UPDATE pacs.studies
     SET status              = 'complete',
         upload_completed_at = NOW(),
         display_status      = 'in_report',
         updated_at          = NOW()
     WHERE id = $1 AND status NOT IN ('complete','archived','deleted')
     RETURNING id, patient_id, appointment_id, modality_type`,
    [id]
  );
  if (!rows.length) throw new NotFoundError('Estudo (ou já marcado como completo)');

  const study = rows[0];

  await audit.log({
    userId:       req.user?.sub,
    userRole:     req.user?.role,
    action:       'STUDY_UPLOAD_COMPLETE',
    resourceType: 'study',
    resourceId:   id,
    ipAddress:    req.ip,
  });

  setImmediate(() => _notifyUploadComplete(id, study).catch(err =>
    logger.error('Erro ao notificar upload completo', { error: err.message, studyId: id })
  ));
  setImmediate(() => notify('study.processed',    { studyId: id }));
  setImmediate(() => notify('study.images_ready', { studyId: id }));

  return success(res, { id, status: 'complete', upload_completed_at: new Date() }, 'Estudo marcado como completo');
}

// Helpers de upload compartilhados entre upload direto e upload em blocos
async function _loadUploadAppointment(appointment_id) {
  const { rows: apRows } = await db.query(
    `SELECT a.id, a.patient_id, a.status, a.health_unit_id, a.modality_id, a.room_id,
            proc.modality_type, proc.name AS procedure_name
     FROM ris.appointments a
     JOIN ris.procedures proc ON proc.id = a.procedure_id
     WHERE a.id = $1`,
    [appointment_id]
  );
  if (!apRows.length) throw new NotFoundError('Agendamento');
  const appt = apRows[0];
  // Não exigimos check-in formal da recepção: o técnico que sobe as imagens é quem realiza o exame
  const UPLOADABLE_STATUSES = ['scheduled', 'confirmed', 'checked_in', 'in_progress'];
  if (!UPLOADABLE_STATUSES.includes(appt.status)) {
    throw new AppError(
      `Agendamento está "${appt.status}". Não é possível enviar imagens para agendamentos cancelados, concluídos ou com falta.`,
      400, 'INVALID_APPOINTMENT_STATUS'
    );
  }
  return appt;
}

// Não escreve a resposta HTTP — apenas retorna o resultado, para ser reusada por upload direto e em blocos.
async function _ingestDicomUpload({ req, appt, appointment_id, fileSources, ctx }) {
  const {
    accession_number, study_date,
    bodyHealthUnitId, equipment_id, room_id, bodyTechId, operator_notes,
    performed_at, performing_physician, exam_quality,
  } = ctx;

  try {
    await orthanc.get('/system', { timeout: 5000 });
  } catch (connErr) {
    const detail = connErr.code === 'ECONNREFUSED'
      ? `Porta recusada em ${env.ORTHANC_URL}. Verifique se o Docker/Orthanc está rodando.`
      : connErr.message;
    throw new AppError(
      `Orthanc inacessível (${env.ORTHANC_URL}): ${detail}`,
      503, 'ORTHANC_UNAVAILABLE'
    );
  }

  // Envio via stream (não buffer) para manter RAM constante independente do tamanho do arquivo
  const orthancStudyIds   = new Set();
  const failedFiles       = [];
  const failureReasons    = [];

  for (const src of fileSources) {
    try {
      const r = await orthanc.post('/instances', src.openStream(), {
        headers: {
          'Content-Type':   'application/dicom',
          'Accept':         'application/json',
        },
        maxBodyLength:    Infinity,
        maxContentLength: Infinity,
      });
      if (r.data?.ParentStudy) orthancStudyIds.add(r.data.ParentStudy);
      logger.info('Orthanc aceitou instância', {
        filename:    src.originalname,
        instanceId:  r.data?.ID,
        parentStudy: r.data?.ParentStudy,
        status:      r.data?.Status,
      });
    } catch (err) {
      const orthancBody    = err.response?.data ?? {};
      const orthancMessage = orthancBody.Message || orthancBody.Details ||
                             orthancBody.OrthancError || err.message;
      const httpStatus     = err.response?.status ?? 'sem resposta';

      logger.error('Falha upload Orthanc', {
        filename:     src.originalname,
        httpStatus,
        orthancError: JSON.stringify(orthancBody),
        axiosError:   err.message,
      });

      failedFiles.push(src.originalname);
      failureReasons.push(`[${src.originalname}] HTTP ${httpStatus}: ${orthancMessage}`);
    }
  }

  if (orthancStudyIds.size === 0) {
    const reasons = failureReasons.length
      ? `\n${failureReasons.join('\n')}`
      : '';
    throw new AppError(
      `Orthanc rejeitou todos os arquivos.${reasons}`,
      422, 'ORTHANC_UPLOAD_FAILED'
    );
  }

  let studyInstanceUID  = null;
  let numberOfSeries    = 0;
  let extractedModality = null;
  let extractedDate     = null;
  let extractedTime     = null;

  try {
    const orthancStudyId = [...orthancStudyIds][0];
    const meta = (await orthanc.get(`/studies/${orthancStudyId}`)).data;

    const mainTags = meta.MainDicomTags ?? {};
    studyInstanceUID  = mainTags.StudyInstanceUID ?? null;
    numberOfSeries    = (meta.Series ?? []).length;
    extractedModality = (mainTags.ModalitiesInStudy ?? '').split('\\')[0] || null;

    // Data: YYYYMMDD → YYYY-MM-DD
    const d = mainTags.StudyDate ?? '';
    if (d.length === 8) {
      extractedDate = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
    }

    // Hora: HHMMSS[.ffffff] → HH:MM:SS
    const t = (mainTags.StudyTime ?? '').split('.')[0].padEnd(6, '0');
    if (t.length >= 6) {
      extractedTime = `${t.slice(0,2)}:${t.slice(2,4)}:${t.slice(4,6)}`;
    }

    logger.info('Metadados Orthanc obtidos', { orthancStudyId, studyInstanceUID, extractedModality });
  } catch (err) {
    logger.warn('Falha ao buscar metadados do Orthanc — usando fallback', { error: err.message });
  }

  if (!studyInstanceUID) {
    studyInstanceUID = `2.25.${Date.now()}${Math.floor(Math.random() * 10000)}`;
  }

  // Cenário de demo/tese: o mesmo arquivo DICOM pode ser reenviado para OUTRO paciente. Como
  // StudyInstanceUID é UNIQUE na tabela, geramos um UID sintético nesse caso e criamos um estudo
  // independente por paciente; as imagens seguem compartilhadas no Orthanc (dedup por UID real).
  let reuseToken = '';
  {
    const { rows: dup } = await db.query(
      `SELECT patient_id FROM pacs.studies WHERE study_instance_uid = $1 LIMIT 1`,
      [studyInstanceUID]
    );
    if (dup.length && dup[0].patient_id !== appt.patient_id) {
      reuseToken = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
      studyInstanceUID = `2.25.${reuseToken}`;
    }
  }

  const now = new Date();
  // A data/hora informada pela REALIZAÇÃO (performed_at) tem prioridade sobre a
  // extraída do DICOM e sobre study_date isolado.
  const perf = performed_at ? new Date(performed_at) : null;
  const perfDate = perf && !isNaN(perf) ? perf.toISOString().slice(0,10) : null;
  const perfTime = perf && !isNaN(perf)
    ? `${String(perf.getHours()).padStart(2,'0')}:${String(perf.getMinutes()).padStart(2,'0')}:${String(perf.getSeconds()).padStart(2,'0')}`
    : null;
  const effectiveStudyDate = perfDate || study_date || extractedDate || now.toISOString().slice(0, 10);
  const effectiveStudyTime = perfTime || extractedTime ||
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const effectiveModality  = appt.modality_type || extractedModality || null;
  const numberOfInstances  = fileSources.length - failedFiles.length;
  if (numberOfSeries === 0) numberOfSeries = 1;

  // Contexto efetivo da realização — body > appointment > req.user
  const effectiveHealthUnitId   = bodyHealthUnitId   || appt.health_unit_id  || req.user.health_unit_id || null;
  const effectiveEquipmentId    = equipment_id       || appt.modality_id     || null;
  const effectiveRoomId         = room_id            || appt.room_id         || null;
  const effectiveTechnicianId   = bodyTechId         || req.user.sub         || null;
  const effectiveOperatorNotes  = operator_notes     || null;
  const effectivePhysician      = performing_physician || null;
  const effectiveExamQuality    = exam_quality        || null;

  // Defensivo: NUNCA derrubar o upload por uma referência de CONTEXTO inválida
  // (equipamento/sala/unidade/técnico apontando p/ linha removida → FK 23503,
  // que virava "Referência inválida"). O estudo é o essencial; o contexto é
  // complementar — anula o que não existir.
  const fkExists = async (table, id) => {
    if (!id) return false;
    const { rows } = await db.query(`SELECT 1 FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
    return rows.length > 0;
  };
  const safeHealthUnitId = (await fkExists('ris.health_units', effectiveHealthUnitId)) ? effectiveHealthUnitId : null;
  const safeEquipmentId  = (await fkExists('ris.modalities',   effectiveEquipmentId))  ? effectiveEquipmentId  : null;
  const safeRoomId       = (await fkExists('ris.rooms',        effectiveRoomId))       ? effectiveRoomId       : null;
  const safeTechnicianId = (await fkExists('auth.users',       effectiveTechnicianId)) ? effectiveTechnicianId : null;

  const { rows: studyRows } = await db.query(
    `INSERT INTO pacs.studies
       (appointment_id, patient_id, study_instance_uid, accession_number,
        study_date, study_time, modality_type, status, display_status,
        number_of_series, number_of_instances, upload_completed_at,
        health_unit_id, equipment_id, room_id, technician_user_id, operator_notes,
        performing_physician, exam_quality, orthanc_study_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'complete','in_report',$8,$9,NOW(),$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (study_instance_uid) DO UPDATE SET
       appointment_id      = EXCLUDED.appointment_id,
       status              = 'complete',
       display_status      = 'in_report',
       number_of_series    = GREATEST(pacs.studies.number_of_series, EXCLUDED.number_of_series),
       number_of_instances = GREATEST(pacs.studies.number_of_instances, EXCLUDED.number_of_instances),
       upload_completed_at = NOW(),
       study_date          = EXCLUDED.study_date,
       study_time          = EXCLUDED.study_time,
       health_unit_id      = COALESCE(EXCLUDED.health_unit_id,      pacs.studies.health_unit_id),
       equipment_id        = COALESCE(EXCLUDED.equipment_id,        pacs.studies.equipment_id),
       room_id             = COALESCE(EXCLUDED.room_id,             pacs.studies.room_id),
       technician_user_id  = COALESCE(EXCLUDED.technician_user_id,  pacs.studies.technician_user_id),
       operator_notes      = COALESCE(EXCLUDED.operator_notes,      pacs.studies.operator_notes),
       performing_physician= COALESCE(EXCLUDED.performing_physician, pacs.studies.performing_physician),
       exam_quality        = COALESCE(EXCLUDED.exam_quality,        pacs.studies.exam_quality),
       orthanc_study_id    = COALESCE(EXCLUDED.orthanc_study_id,    pacs.studies.orthanc_study_id),
       updated_at          = NOW()
     RETURNING id, study_instance_uid, status, created_at`,
    [
      appointment_id,
      appt.patient_id,
      studyInstanceUID,
      accession_number || null,
      effectiveStudyDate,
      effectiveStudyTime,
      effectiveModality,
      numberOfSeries,
      numberOfInstances,
      safeHealthUnitId,
      safeEquipmentId,
      safeRoomId,
      safeTechnicianId,
      effectiveOperatorNotes,
      effectivePhysician,
      effectiveExamQuality,
      [...orthancStudyIds][0] ?? null,
    ]
  );
  const study = studyRows[0];

  // Cria pacs.series/pacs.instances a partir dos metadados do Orthanc — necessário para o OrthoVis fazer streaming
  try {
    let seriesIdx = 0;
    for (const orthancStudyId of orthancStudyIds) {
      const studyMeta  = (await orthanc.get(`/studies/${orthancStudyId}`)).data;
      const seriesIds  = studyMeta.Series ?? [];

      for (const orthancSeriesId of seriesIds) {
        const seriesMeta = (await orthanc.get(`/series/${orthancSeriesId}`)).data;
        const sTags      = seriesMeta.MainDicomTags ?? {};

        seriesIdx++;
        // reuse (tese): UID sintético por upload p/ não colidir com o estudo do outro paciente.
        const seriesUid  = reuseToken
          ? `2.25.${reuseToken}.${seriesIdx}`
          : (sTags.SeriesInstanceUID ?? `auto.${orthancSeriesId}`);
        const seriesNum  = parseInt(sTags.SeriesNumber, 10) || null;
        const modality   = sTags.Modality || effectiveModality;
        const seriesDesc = sTags.SeriesDescription || null;

        // Upsert série (pode já existir se o mesmo DICOM for re-enviado)
        const { rows: seriesDbRows } = await db.query(
          `INSERT INTO pacs.series
             (study_id, series_instance_uid, series_number, modality, series_description)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (series_instance_uid) DO UPDATE SET
             study_id       = EXCLUDED.study_id,
             series_number  = EXCLUDED.series_number
           RETURNING id`,
          [study.id, seriesUid, seriesNum, modality, seriesDesc]
        );
        const seriesDbId = seriesDbRows[0].id;

        const instanceIds = seriesMeta.Instances ?? [];
        let instIdx = 0;
        for (const orthancInstanceId of instanceIds) {
          const instMeta = (await orthanc.get(`/instances/${orthancInstanceId}`)).data;
          const iTags    = instMeta.MainDicomTags ?? {};

          instIdx++;
          const sopUid     = reuseToken
            ? `2.25.${reuseToken}.${seriesIdx}.${instIdx}`
            : (iTags.SOPInstanceUID ?? `auto.${orthancInstanceId}`);
          const instNum    = parseInt(iTags.InstanceNumber, 10) || null;
          const sopClass   = iTags.SOPClassUID || null;
          const cols       = parseInt(iTags.Columns, 10) || null;
          const rowsVal    = parseInt(iTags.Rows, 10) || null;
          const framesVal  = parseInt(iTags.NumberOfFrames, 10) || 1;
          const fileSz     = instMeta.FileSize ?? 0;

          const storageKey = await _replicateInstanceToRustfs(
            orthancInstanceId, studyInstanceUID, seriesUid, sopUid, fileSz,
          );

          await db.query(
            `INSERT INTO pacs.instances
               (series_id, study_id, sop_instance_uid, sop_class_uid, instance_number,
                storage_key, file_size_bytes, columns, rows, number_of_frames)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (sop_instance_uid) DO UPDATE SET
               storage_key = EXCLUDED.storage_key`,
            [seriesDbId, study.id, sopUid, sopClass, instNum,
             storageKey, fileSz, cols, rowsVal, framesVal]
          );
        }
        logger.info('Série e instâncias criadas', {
          studyId: study.id, seriesUid, instances: instanceIds.length,
        });
      }
    }
  } catch (err) {
    // Não aborta o upload — o estudo existe, mas sem registros de instâncias
    logger.warn('Falha ao criar pacs.series/instances', { error: err.message, studyId: study.id });
  }

  // Recalcula a partir das linhas reais: o upsert usa GREATEST(antigo, novo), que diverge do valor
  // real se o finalize rodar mais de uma vez (retentativa/timeout) — isto mantém a operação idempotente.
  await db.query(
    `UPDATE pacs.studies SET
       number_of_instances = (SELECT COUNT(*) FROM pacs.instances WHERE study_id = $1),
       number_of_series    = (SELECT COUNT(*) FROM pacs.series    WHERE study_id = $1),
       updated_at = NOW()
     WHERE id = $1`,
    [study.id]
  );

  await db.query(
    `UPDATE ris.appointments SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
    [appointment_id]
  );
  // Exame recebido: a entrada na worklist do equipamento deixa de fazer sentido.
  require('../../services/mwl.service').removeWorklist(appointment_id).catch(() => {});

  await audit.log({
    ...audit.fromRequest(req),
    action: 'STUDY_UPLOADED',
    resourceType: 'study',
    resourceId: study.id,
    details: {
      appointment_id,
      files_sent:         numberOfInstances,
      files_failed:       failedFiles.length,
      orthanc_study_ids:  [...orthancStudyIds],
      study_instance_uid: studyInstanceUID,
    },
  });

  setImmediate(() => _notifyUploadComplete(study.id, {
    patient_id:     appt.patient_id,
    appointment_id,
    modality_type:  effectiveModality,
  }).catch(err =>
    logger.error('Erro ao notificar paciente pós-upload', { error: err.message, studyId: study.id })
  ));

  // Contagens reais (pós-recálculo) para a resposta — não o nº de arquivos enviados.
  const { rows: cnt } = await db.query(
    `SELECT number_of_instances, number_of_series FROM pacs.studies WHERE id = $1`,
    [study.id]
  );

  return {
    id:                 study.id,
    study_instance_uid: study.study_instance_uid,
    status:             study.status,
    files_uploaded:     cnt[0]?.number_of_instances ?? numberOfInstances,
    files_failed:       failedFiles.length,
    series_count:       cnt[0]?.number_of_series ?? numberOfSeries,
    orthanc_study_ids:  [...orthancStudyIds],
  };
}

// Legado/back-compat: multer.memoryStorage() ainda bufferiza em RAM; para estudos grandes
// o fluxo recomendado é o upload em blocos (init/chunk/finalize) abaixo.
async function uploadDicom(req, res) {
  const files = req.files;
  if (!files || !files.length) throw new AppError('Nenhum arquivo enviado', 400);

  const {
    appointment_id, accession_number, study_date,
    health_unit_id: bodyHealthUnitId, equipment_id, room_id,
    technician_user_id: bodyTechId, operator_notes,
  } = req.body;
  if (!appointment_id) throw new AppError('appointment_id é obrigatório', 400);

  for (const file of files) {
    const isDicom = file.originalname.toLowerCase().endsWith('.dcm') ||
                    file.mimetype === 'application/dicom';
    if (!isDicom) {
      throw new AppError(
        `Arquivo "${file.originalname}" não é DICOM. Apenas .dcm é aceito.`,
        400, 'INVALID_FILE_TYPE'
      );
    }
  }

  const appt = await _loadUploadAppointment(appointment_id);

  const fileSources = files.map(f => ({
    originalname: f.originalname,
    openStream:   () => Readable.from(f.buffer),
  }));

  const result = await _ingestDicomUpload({
    req, appt, appointment_id, fileSources,
    ctx: { accession_number, study_date, bodyHealthUnitId, equipment_id, room_id, bodyTechId, operator_notes },
  });

  return created(res, result, `Upload enviado ao Orthanc: ${result.files_uploaded} arquivo(s)${
    result.files_failed ? `, ${result.files_failed} com falha` : ''
  }`);
}

// Upload em blocos: init → chunk → finalize

// Abre uma sessão de upload. Body validado por uploadInitSchema (rotas).
async function uploadInit(req, res) {
  const {
    appointment_id, accession_number, study_date,
    health_unit_id, equipment_id, room_id, operator_notes, files,
    performed_at, complications, performing_physician, exam_quality,
  } = req.body;

  const appt = await _loadUploadAppointment(appointment_id);

  const session = await uploadSession.create({
    ownerSub: req.user.sub,
    meta: { appointment_id, accession_number, study_date, health_unit_id, equipment_id, room_id, operator_notes,
            performed_at, complications, performing_physician, exam_quality },
    files,
  });

  await audit.log({
    ...audit.fromRequest(req),
    action: 'STUDY_UPLOAD_INIT',
    resourceType: 'appointment',
    resourceId: appointment_id,
    details: { upload_id: session.uploadId, files: files.length, patient_id: appt.patient_id },
  });

  return created(res, {
    upload_id:  session.uploadId,
    files:      session.files.length,
    chunk_size: UPLOAD_CHUNK_SIZE,
  }, 'Sessão de upload criada');
}

// Recebe um bloco (raw binary, application/octet-stream) e anexa em disco.
// Query: ?fileIndex=N  — o cliente envia os blocos de cada arquivo em ordem.
async function uploadChunk(req, res) {
  const { uploadId } = req.params;
  const fileIndex = parseInt(req.query.fileIndex, 10);

  const session = await uploadSession.load(uploadId);
  if (!session) throw new NotFoundError('Sessão de upload');
  if (session.ownerSub !== req.user.sub) {
    throw new AppError('Sessão de upload pertence a outro usuário', 403, 'FORBIDDEN');
  }
  if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= session.files.length) {
    throw new AppError('fileIndex inválido', 400, 'INVALID_FILE_INDEX');
  }

  const received = await uploadSession.appendChunk(uploadId, fileIndex, req);
  return success(res, { upload_id: uploadId, file_index: fileIndex, received }, 'Bloco recebido');
}

// Verifica integridade (size + sha256) e ingere no Orthanc/PACS.
async function uploadFinalize(req, res) {
  const { uploadId } = req.params;

  const session = await uploadSession.load(uploadId);
  if (!session) throw new NotFoundError('Sessão de upload');
  if (session.ownerSub !== req.user.sub) {
    throw new AppError('Sessão de upload pertence a outro usuário', 403, 'FORBIDDEN');
  }

  // Verifica integridade (size + sha256) antes de tocar no Orthanc — evita ingerir upload corrompido
  const check = await uploadSession.verify(uploadId);
  if (!check.ok) {
    throw new AppError(
      'Falha na verificação de integridade do upload. Reenvie os arquivos indicados.',
      422, 'UPLOAD_VERIFICATION_FAILED', check.failures
    );
  }

  // Re-valida o agendamento pois seu status pode ter mudado entre o init e o finalize
  const {
    appointment_id, accession_number, study_date,
    health_unit_id, equipment_id, room_id, operator_notes,
    performed_at, complications, performing_physician, exam_quality,
  } = session.meta;
  const appt = await _loadUploadAppointment(appointment_id);

  const fileSources = session.files.map(f => ({
    originalname: f.name,
    openStream:   () => uploadSession.openFileStream(uploadId, f.index),
  }));

  const result = await _ingestDicomUpload({
    req, appt, appointment_id, fileSources,
    ctx: {
      accession_number, study_date,
      bodyHealthUnitId: health_unit_id, equipment_id, room_id,
      bodyTechId: undefined,
      // Complicações têm prioridade sobre operator_notes (mesmo campo no banco)
      operator_notes: complications || operator_notes,
      performed_at, performing_physician, exam_quality,
    },
  });

  // Só limpa os arquivos temporários após ingestão bem-sucedida (permite reenvio em caso de falha)
  await uploadSession.cleanup(uploadId);

  return created(res, { ...result, verified: true }, `Upload finalizado e verificado: ${result.files_uploaded} arquivo(s)${
    result.files_failed ? `, ${result.files_failed} com falha` : ''
  }`);
}

// Cancela uma sessão (remove arquivos temporários).
async function uploadAbort(req, res) {
  const { uploadId } = req.params;
  const session = await uploadSession.load(uploadId);
  if (session && session.ownerSub !== req.user.sub) {
    throw new AppError('Sessão de upload pertence a outro usuário', 403, 'FORBIDDEN');
  }
  await uploadSession.cleanup(uploadId);
  return success(res, { upload_id: uploadId }, 'Sessão de upload cancelada');
}

// Status: quantas instâncias já estão no RustFS (durável) vs. só no Orthanc.
async function replicationStatus(req, res) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE storage_key LIKE 'orthanc:%')::int AS orthanc_only,
       COUNT(*) FILTER (WHERE storage_key NOT LIKE 'orthanc:%')::int AS durable,
       COUNT(*)::int AS total
     FROM pacs.instances`
  );
  const r = rows[0];
  return success(res, {
    durable:      r.durable,
    orthanc_only: r.orthanc_only,
    total:        r.total,
    pct_durable:  r.total ? Math.round((r.durable / r.total) * 100) : 100,
  }, `${r.durable}/${r.total} instâncias com cópia durável no RustFS`);
}

// Backfill: replica instâncias 'orthanc:%' existentes para o RustFS (lote).
// Pode ser chamado por um cron de ops para auto-cura progressiva do PACS.
async function replicatePending(req, res) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 2000);
  const { rows } = await db.query(
    `SELECT i.id, i.storage_key, i.sop_instance_uid, i.file_size_bytes,
            se.series_instance_uid, s.study_instance_uid
       FROM pacs.instances i
       JOIN pacs.series  se ON se.id = i.series_id
       JOIN pacs.studies s  ON s.id  = i.study_id
      WHERE i.storage_key LIKE 'orthanc:%'
      ORDER BY i.received_at ASC NULLS LAST
      LIMIT $1`,
    [limit]
  );

  let replicated = 0, failed = 0;
  for (const r of rows) {
    const orthancId = r.storage_key.slice(8); // remove 'orthanc:'
    const newKey = await _replicateInstanceToRustfs(
      orthancId, r.study_instance_uid, r.series_instance_uid, r.sop_instance_uid, r.file_size_bytes,
    );
    if (!newKey.startsWith('orthanc:')) {
      await db.query(`UPDATE pacs.instances SET storage_key = $1 WHERE id = $2`, [newKey, r.id]);
      replicated++;
    } else {
      failed++;
    }
  }

  const { rows: pend } = await db.query(
    `SELECT COUNT(*)::int AS n FROM pacs.instances WHERE storage_key LIKE 'orthanc:%'`
  );

  await audit.log({
    ...audit.fromRequest(req),
    action: 'DICOM_REPLICATE_PENDING',
    resourceType: 'system',
    details: { replicated, failed, remaining: pend[0].n, batch: rows.length },
  });

  return success(res, {
    replicated, failed, remaining: pend[0].n, batch: rows.length,
  }, `Replicadas ${replicated} instância(s); ${pend[0].n} ainda pendente(s)`);
}

// ── Helper: sincroniza pacs.series/pacs.instances a partir do Orthanc ────────
// Usado quando pacs.instances está vazio para um estudo já existente no Orthanc.
// Listagem de instâncias por study_instance_uid (para OrthoVis)
// Adiciona Cross-Origin-Resource-Policy para permitir fetch cross-origin no viewer
async function listInstances(req, res) {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  const { studyUID } = req.params;

  const { rows: studyRows } = await db.query(
    `SELECT s.id, s.study_instance_uid, s.accession_number,
            s.study_date, s.modality_type,
            s.number_of_series, s.number_of_instances,
            s.referring_physician_name AS dicom_referring_name,
            p.name_encrypted, p.birth_date, p.gender, p.medical_record_number,
            a.clinical_indication,
            proc.name AS procedure_name,
            ep.name      AS req_phys_name,
            ep.crm       AS req_phys_crm,
            ep.crm_uf    AS req_phys_crm_uf,
            ep.specialty AS req_phys_specialty
     FROM pacs.studies s
     JOIN ris.patients p ON p.id = s.patient_id
     LEFT JOIN ris.appointments a ON a.id = s.appointment_id
     LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id
     LEFT JOIN ris.external_physicians ep ON ep.id = a.requesting_physician_id
     WHERE s.study_instance_uid = $1`,
    [studyUID]
  );
  if (!studyRows.length) throw new NotFoundError('Estudo DICOM');
  const study = studyRows[0];

  // Consulta pacs.instances (banco de dados)
  let { rows: instances } = await db.query(
    `SELECT i.id, i.sop_instance_uid, i.instance_number,
            se.id AS series_id, se.series_instance_uid, se.series_number, se.modality
     FROM pacs.instances i
     JOIN pacs.series se ON se.id = i.series_id
     WHERE se.study_id = $1
     ORDER BY se.series_number ASC NULLS LAST, i.instance_number ASC NULLS LAST`,
    [study.id]
  );

  // ── Lazy sync: pacs.instances vazio mas estudo pode estar no Orthanc ─────────
  // Cobre estudos que existiam antes desta implementação ou enviados via Orthanc direto.
  if (instances.length === 0) {
    logger.info('pacs.instances vazio — tentando lazy sync do Orthanc', {
      studyUID, studyId: study.id,
    });
    try {
      instances = await _syncInstancesFromOrthanc(study.id, study.study_instance_uid, study.modality_type);
    } catch (syncErr) {
      logger.warn('Lazy sync falhou — OrthoVis não poderá carregar as imagens', {
        studyUID, error: syncErr.message,
      });
      // Não lança erro: retorna lista vazia para o OrthoVis mostrar a mensagem correta
    }
  }

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.STUDY_VIEWED,
    resourceType: 'study',
    resourceId: study.id,
  });

  // Médico solicitante: preferimos o cadastro estruturado (external_physicians via appointment);
  // se não houver, caímos no texto livre vindo do header DICOM.
  const reqPhysName = study.req_phys_name || study.dicom_referring_name || null;
  const reqPhysCrm  = study.req_phys_crm
    ? `${study.req_phys_crm}${study.req_phys_crm_uf ? '/' + study.req_phys_crm_uf : ''}`
    : null;

  return success(res, {
    study: {
      id:                    study.id,
      study_instance_uid:    study.study_instance_uid,
      accession_number:      study.accession_number,
      study_date:            study.study_date,
      modality_type:         study.modality_type,
      number_of_series:      study.number_of_series,
      number_of_instances:   study.number_of_instances,
      patient_name:          enc.decrypt(study.name_encrypted),
      birth_date:            study.birth_date,
      gender:                study.gender,
      medical_record_number: study.medical_record_number,
      procedure_name:        study.procedure_name,
      clinical_indication:   study.clinical_indication,
      requesting_physician: reqPhysName ? {
        name:      reqPhysName,
        crm:       reqPhysCrm,
        specialty: study.req_phys_specialty ?? null,
      } : null,
    },
    instances: instances.map(i => ({
      id:                  i.id,
      series_id:           i.series_id,
      series_instance_uid: i.series_instance_uid,
      series_number:       i.series_number,
      sop_instance_uid:    i.sop_instance_uid,
      instance_number:     i.instance_number,
      modality:            i.modality,
    })),
  });
}

/**
 * Recebe um screenshot anotado e envia ao Orthanc como Secondary Capture
 * vinculado ao estudo original.
 *
 * Fluxo:
 *   1) Resolve study_instance_uid no PG
 *   2) `POST /tools/lookup` no Orthanc → obtém orthancStudyId
 *   3) `POST /tools/create-dicom` com Parent=orthancStudyId → cria SC instance
 *   4) Loga no audit
 *
 * Retorna `{ orthanc_instance_id, sop_instance_uid }`.
 */
async function uploadSecondaryCapture(req, res) {
  const { id }       = req.params;
  const file         = req.file;
  const label        = (req.body?.label || '').toString().slice(0, 200);
  if (!file) throw new AppError('Imagem ausente', 422, 'NO_IMAGE');
  if (!['image/png','image/jpeg','image/webp'].includes(file.mimetype)) {
    throw new AppError(`Formato não suportado: ${file.mimetype}`, 415, 'BAD_MIME');
  }

  const { rows: stRows } = await db.query(
    `SELECT s.id, s.study_instance_uid,
            p.name_encrypted, p.medical_record_number
       FROM pacs.studies s
       JOIN ris.patients p ON p.id = s.patient_id
      WHERE s.id = $1`,
    [id]
  );
  if (!stRows.length) throw new NotFoundError('Estudo');
  const study = stRows[0];

  // 1) Encontra study ID no Orthanc
  const lookup = await orthanc.post('/tools/lookup', study.study_instance_uid, {
    headers: { 'Content-Type': 'text/plain' },
  });
  const studyEntry = (lookup.data || []).find(x => x.Type === 'Study');
  if (!studyEntry) {
    throw new AppError('Estudo não localizado no PACS', 404, 'NOT_IN_PACS');
  }
  const orthancStudyId = studyEntry.ID;

  // 2) Cria DICOM Secondary Capture (Orthanc transforma a imagem automaticamente)
  const dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
  const dicomTags = {
    SpecificCharacterSet:  'ISO_IR 100',
    PatientName:           enc.decrypt(study.name_encrypted) || '',
    PatientID:             study.medical_record_number || '',
    StudyInstanceUID:      study.study_instance_uid,
    SeriesDescription:     'Secondary Capture — OrthoVis',
    SeriesNumber:          '9001',                 // série dedicada a SC
    Modality:              'SC',
    ImageComments:         label || 'Screenshot exportado pelo OrthoVis',
  };

  const created = await orthanc.post('/tools/create-dicom', {
    Tags:    dicomTags,
    Content: dataUri,
    Parent:  orthancStudyId,
  });

  // create-dicom devolve { ID, Path, ... } — ID é o instance UID interno do Orthanc
  const orthancInstanceId = created.data?.ID;
  let sopInstanceUid = null;
  if (orthancInstanceId) {
    try {
      const inst = await orthanc.get(`/instances/${orthancInstanceId}`);
      sopInstanceUid = inst.data?.MainDicomTags?.SOPInstanceUID ?? null;
    } catch (e) {
      logger.warn('[sc] não foi possível ler SOPInstanceUID', { orthancInstanceId, error: e.message });
    }
  }

  await audit.log({
    ...audit.fromRequest(req),
    action:       'STUDY_SECONDARY_CAPTURE_CREATED',
    resourceType: 'study',
    resourceId:   id,
    details:      { orthanc_instance_id: orthancInstanceId, label, bytes: file.size },
  });

  return success(res, {
    orthanc_instance_id: orthancInstanceId,
    sop_instance_uid:    sopInstanceUid,
    label,
    size_bytes:          file.size,
  }, 'Captura enviada ao PACS');
}

module.exports = { listUnmatched, matchUnmatched, discardUnmatched, list, pending, getById, priors, series, streamInstance, uploadComplete, uploadDicom,
                   uploadInit, uploadChunk, uploadFinalize, uploadAbort,
                   replicationStatus, replicatePending,
                   listInstances, uploadSecondaryCapture };
