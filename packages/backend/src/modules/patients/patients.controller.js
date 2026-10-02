const db = require('../../config/database');
const enc = require('../../services/encryption');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const audit = require('../../services/audit');
const { notify } = require('../../services/notifications');
const { success, created, paginated, noContent } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');

// Normaliza nome para busca parcial: remove acentos + caixa baixa.
const normalizeName = (s) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const PATIENT_COLS = `p.id, p.name_encrypted, p.birth_date, p.gender,
              p.cpf_encrypted, p.phone_encrypted, p.email_encrypted,
              p.medical_record_number, p.blood_type, p.allergies, p.address,
              p.is_active, p.deactivated_at, p.created_at, p.updated_at`;

async function list(req, res) {
  const { q, page, limit, gender, include_inactive, birth_date } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  // Por padrão lista só ativos. Admin pode pedir inativos via ?include_inactive=true.
  const showInactive = include_inactive === 'true' && req.user?.role === 'admin';
  const conditions = showInactive ? [] : ['p.is_active = TRUE'];
  // Paciente é um recurso GLOBAL da rede pública: todo funcionário enxerga
  // qualquer paciente (qualquer um pode ser atendido em qualquer unidade).
  // O scoping por unidade aplica-se só à CARGA operacional (estudos,
  // agendamentos, laudos), não ao cadastro de pacientes.

  // Busca PARCIAL por nome só é viável combinada com a data de nascimento:
  // o nome é cifrado (hash determinístico só casa nome COMPLETO), então
  // filtramos por substring na aplicação SOBRE o conjunto já reduzido pela
  // data (coluna em claro) — confirma identidade sem varrer toda a base.
  const hasNamePart = !!q && /\p{L}/u.test(q);
  const partialName = hasNamePart && !!birth_date;

  // birth_date é coluna em claro → filtra direto no SQL.
  if (birth_date) { params.push(birth_date); conditions.push(`p.birth_date = $${params.length}`); }
  if (gender) { params.push(gender); conditions.push(`p.gender = $${params.length}`); }

  // Busca por nome/CPF/CNS via hash exato (comportamento padrão). No modo
  // partialName o nome é filtrado na app, então não entra como condição de hash.
  if (q && !partialName) {
    const digits = q.replace(/\D/g, '').trim();
    const digitsHash = digits ? enc.searchHash(digits) : enc.searchHash(q);
    params.push(digitsHash, enc.searchHash(q));
    conditions.push(`(p.cpf_hash = $${params.length - 1} OR p.cns_hash = $${params.length - 1} OR p.name_search_hash = $${params.length})`);
  }

  // Cláusula WHERE só se houver condições — quando admin inclui inativos
  // sem filtros adicionais, conditions fica vazio.
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  await audit.log({
    ...audit.fromRequest(req),
    action: 'PATIENT_LIST',
    details: { q, birth_date, page, limit },
  });

  // ── Modo busca parcial por nome (conjunto limitado pela data) ───────────────
  if (partialName) {
    const CAP = 500; // teto de segurança do conjunto a descriptografar
    const { rows } = await db.query(
      `SELECT ${PATIENT_COLS} FROM ris.patients p ${where}
        ORDER BY p.is_active DESC, p.created_at DESC LIMIT ${CAP}`,
      params
    );
    const needle = normalizeName(q);
    const matched = rows
      .map(enc.decryptPatientFields)
      .filter((p) => normalizeName(p.name).includes(needle));
    return paginated(res, {
      data: matched.slice(offset, offset + limit),
      total: matched.length,
      page,
      limit,
    });
  }

  // ── Caminho padrão paginado em SQL ──────────────────────────────────────────
  const [countRes, dataRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM ris.patients p ${where}`, params),
    db.query(
      `SELECT ${PATIENT_COLS}
       FROM ris.patients p
       ${where}
       ORDER BY p.is_active DESC, p.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  const data = dataRes.rows.map(enc.decryptPatientFields);

  return paginated(res, {
    data,
    total: parseInt(countRes.rows[0].count),
    page,
    limit,
  });
}

async function getById(req, res) {
  const { rows } = await db.query(
    `SELECT p.*
     FROM ris.patients p
     WHERE p.id = $1 AND p.is_active = TRUE`,
    [req.params.id]
  );
  if (!rows.length) throw new NotFoundError('Paciente');

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.PATIENT_VIEWED,
    resourceType: 'patient',
    resourceId: req.params.id,
  });

  return success(res, enc.decryptPatientFields(rows[0]));
}

async function create(req, res) {
  const body = req.body;
  const encrypted = enc.encryptPatientFields(body);

  if (body.appointment && !body.appointment.procedure_id) {
    throw new AppError('ID do procedimento é obrigatório para agendamento', 400, 'MISSING_PROCEDURE');
  }

  const result = await db.transaction(async client => {
    // Paciente é único na rede por CPF/CNS (hash determinístico) — evita duplicar cadastro
    const idConds = [];
    const idParams = [];
    if (encrypted.cpf_hash) { idParams.push(encrypted.cpf_hash); idConds.push(`cpf_hash = $${idParams.length}`); }
    if (encrypted.cns_hash) { idParams.push(encrypted.cns_hash); idConds.push(`cns_hash = $${idParams.length}`); }
    const { rows: existing } = idConds.length
      ? await client.query(
          `SELECT id, medical_record_number, created_at
           FROM ris.patients WHERE ${idConds.join(' OR ')}`,
          idParams
        )
      : { rows: [] };

    let patient;
    let isNew = false;

    if (existing.length) {
      patient = existing[0];
    } else {
      try {
        const { rows } = await client.query(
          `INSERT INTO ris.patients
             (name_encrypted, name_search_hash, birth_date, gender,
              cpf_encrypted, cpf_hash, cns_encrypted, cns_hash,
              rg_encrypted, phone_encrypted, email_encrypted,
              blood_type, allergies, notes,
              address, created_by, health_unit_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           RETURNING id, medical_record_number, created_at`,
          [
            encrypted.name_encrypted,  encrypted.name_search_hash,
            body.birth_date,           body.gender,
            encrypted.cpf_encrypted   || null, encrypted.cpf_hash || null,
            encrypted.cns_encrypted   || null, encrypted.cns_hash || null,
            encrypted.rg_encrypted    || null,
            encrypted.phone_encrypted || null,
            encrypted.email_encrypted || null,
            body.blood_type           || null,
            body.allergies            || null,
            body.notes                || null,
            body.address ? JSON.stringify(body.address) : null,
            req.user.sub,
            req.user.health_unit_id   || null,
          ]
        );
        patient = rows[0];
        isNew = true;
      } catch (err) {
        // Corrida: outro request inseriu o mesmo CPF/CNS entre o SELECT e o INSERT
        if (err.code === '23505') {
          throw new AppError('Paciente já cadastrado', 409, 'DUPLICATE_ENTRY');
        }
        throw err;
      }
    }

    if (!body.appointment) {
      return { patient, isNew };
    }

    const a = body.appointment;

    if (a.modality_id) {
      const endTime = new Date(
        new Date(a.scheduled_at).getTime() + (a.duration_minutes || 30) * 60000
      );
      const { rows: conflicts } = await client.query(
        `SELECT id FROM ris.appointments
         WHERE modality_id = $1
           AND status NOT IN ('cancelled','no_show')
           AND scheduled_at < $2
           AND (scheduled_at + (duration_minutes * INTERVAL '1 minute')) > $3`,
        [a.modality_id, endTime.toISOString(), a.scheduled_at]
      );
      if (conflicts.length) {
        throw new AppError('Conflito de horário na modalidade selecionada', 409, 'SCHEDULING_CONFLICT');
      }
    }

    const { rows: apRows } = await client.query(
      `INSERT INTO ris.appointments
         (patient_id, procedure_id, modality_id, room_id,
          requesting_user_id, requesting_physician_id,
          scheduled_at, duration_minutes, priority,
          clinical_indication, notes, created_by, health_unit_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, scheduled_at, status, created_at`,
      [
        patient.id,                        a.procedure_id,
        a.modality_id                || null, a.room_id                    || null,
        // requesting_user_id é obrigatório pelo CHECK constraint — usa criador como fallback
        a.requesting_user_id         || req.user.sub,
        a.requesting_physician_id    || null,
        a.scheduled_at,                    a.duration_minutes    || null,
        a.priority                   || 0,
        a.clinical_indication        || null, a.notes               || null,
        req.user.sub,
        req.user.health_unit_id      || null,
      ]
    );

    return { patient, appointment: apRows[0], isNew };
  });

  // Audit fora da transação para não bloquear o commit
  if (result.isNew) {
    await audit.log({
      ...audit.fromRequest(req),
      action:       audit.ACTIONS.PATIENT_CREATED,
      resourceType: 'patient',
      resourceId:   result.patient.id,
      // Aceite dos Termos/LGPD marcado no cadastro (prova auditável, LGPD).
      details:      { terms_accepted: body.terms_accepted === true },
    });
  }
  if (result.appointment) {
    await audit.log({
      ...audit.fromRequest(req),
      action:       audit.ACTIONS.APPOINTMENT_CREATED,
      resourceType: 'appointment',
      resourceId:   result.appointment.id,
    });
  }

  if (result.appointment) {
    const msg = result.isNew
      ? 'Paciente e agendamento criados com sucesso'
      : 'Paciente já existente — agendamento criado';
    // Email transacionais — não bloqueia resposta, falha silenciosa
    if (result.isNew)      setImmediate(() => notify('patient.created',     { patientId: result.patient.id }));
    setImmediate(() => notify('appointment.created', { appointmentId: result.appointment.id }));
    return created(res, { patient: result.patient, appointment: result.appointment }, msg);
  }

  setImmediate(() => notify('patient.created', { patientId: result.patient.id }));
  return created(res, result.patient, 'Paciente cadastrado com sucesso');
}

async function update(req, res) {
  const { id } = req.params;
  const body = req.body;

  const existing = await db.query(
    `SELECT id FROM ris.patients WHERE id = $1 AND is_active = TRUE`, [id]
  );
  if (!existing.rows.length) throw new NotFoundError('Paciente');

  const encrypted = enc.encryptPatientFields(body);

  // Build dinâmico apenas com campos presentes
  const sets = [];
  const params = [];

  const fieldMap = {
    birth_date:         body.birth_date,
    gender:             body.gender,
    blood_type:         body.blood_type,
    allergies:          body.allergies,
    notes:              body.notes,
    address:            body.address ? JSON.stringify(body.address) : undefined,
    name_encrypted:     encrypted.name_encrypted,
    name_search_hash:   encrypted.name_search_hash,
    cpf_encrypted:      encrypted.cpf_encrypted,
    cpf_hash:           encrypted.cpf_hash,
    cns_encrypted:      encrypted.cns_encrypted,
    cns_hash:           encrypted.cns_hash,
    rg_encrypted:       encrypted.rg_encrypted,
    phone_encrypted:    encrypted.phone_encrypted,
    email_encrypted:    encrypted.email_encrypted,
  };

  for (const [col, val] of Object.entries(fieldMap)) {
    if (val !== undefined) {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    }
  }

  if (!sets.length) return success(res, { id }, 'Nenhum campo para atualizar');

  params.push(id);
  await db.query(
    `UPDATE ris.patients SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${params.length}`,
    params
  );

  await audit.log({
    ...audit.fromRequest(req),
    action: audit.ACTIONS.PATIENT_UPDATED,
    resourceType: 'patient',
    resourceId: id,
    details: { fields: Object.keys(body) },
  });

  return success(res, { id }, 'Paciente atualizado com sucesso');
}

/**
 * Inativação de paciente — soft delete simples, SEM cascade.
 *
 * Política:
 *   - `is_active = FALSE` + `deactivated_at = NOW()`
 *   - Agendamentos, estudos, laudos, consentimentos: **intactos**
 *   - Portal do paciente continua ativo no DB, mas o login retorna 403 com
 *     code='ACCOUNT_INACTIVE' (verificado em runtime via patients.is_active).
 *   - Reativação: paciente loga e clica "Reativar conta" → seta is_active=TRUE
 *   - Exclusão permanente: APENAS admin via endpoint dedicado com confirmação
 *     de senha (vide deletePermanently).
 */
async function deactivate(req, res) {
  const { id } = req.params;

  const { rowCount } = await db.query(
    `UPDATE ris.patients
        SET is_active = FALSE,
            deactivated_at = NOW(),
            updated_at = NOW()
      WHERE id = $1 AND is_active = TRUE`,
    [id]
  );
  if (!rowCount) throw new NotFoundError('Paciente');

  await audit.log({
    ...audit.fromRequest(req),
    action:       audit.ACTIONS.PATIENT_DELETED,
    resourceType: 'patient',
    resourceId:   id,
  });

  return success(res, { id }, 'Paciente inativado. Dados preservados.');
}

/**
 * Reativa um paciente inativado.
 * Permitido para: admin (rota /patients/:id/reactivate)
 *               ou o próprio paciente via portal (rota /patient-portal/reactivate)
 */
async function reactivate(req, res) {
  const { id } = req.params;
  const { rowCount } = await db.query(
    `UPDATE ris.patients
        SET is_active = TRUE,
            deactivated_at = NULL,
            updated_at = NOW()
      WHERE id = $1 AND is_active = FALSE`,
    [id]
  );
  if (!rowCount) throw new NotFoundError('Paciente inativo');

  await audit.log({
    ...audit.fromRequest(req),
    action:       'PATIENT_REACTIVATED',
    resourceType: 'patient',
    resourceId:   id,
  });

  return success(res, { id }, 'Paciente reativado');
}

/**
 * Exclusão permanente de paciente — APENAS admin, exige confirmação de senha.
 *
 * Pré-condições:
 *   - Caller deve ter role='admin' (garantido pelo middleware na rota)
 *   - Paciente DEVE estar inativo (is_active=FALSE)
 *   - Body { password } confere com bcrypt hash do admin chamador
 *
 * Efeitos (transação única):
 *   - DELETE em ris.patients (cascateia ris.patient_portal_accounts,
 *     ris.patient_consents, ris.notifications via FK ON DELETE CASCADE
 *     quando houver, ou explicitamente quando não)
 *   - Estudos DICOM no Orthanc são apagados via REST API
 *   - Audit log é MANTIDO (registro do operador, não dado do titular)
 */
async function deletePermanently(req, res) {
  const { id } = req.params;
  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    throw new AppError('Confirme com sua senha de admin', 400, 'PASSWORD_REQUIRED');
  }

  const bcrypt = require('bcryptjs');
  const { rows: adm } = await db.query(
    `SELECT id, password_hash FROM auth.users WHERE id = $1 AND role = 'admin' AND is_active = TRUE`,
    [req.user.sub]
  );
  if (!adm.length) throw new AppError('Apenas admin', 403, 'ADMIN_ONLY');

  const ok = await bcrypt.compare(password, adm[0].password_hash);
  if (!ok) throw new AppError('Senha inválida', 401, 'BAD_PASSWORD');

  const { rows: pRows } = await db.query(
    `SELECT id, is_active FROM ris.patients WHERE id = $1`,
    [id]
  );
  if (!pRows.length) throw new NotFoundError('Paciente');
  if (pRows[0].is_active) {
    throw new AppError('Paciente precisa estar inativo antes da exclusão permanente', 400, 'PATIENT_STILL_ACTIVE');
  }

  // Coleta os instances Orthanc antes de apagar o PG
  const { rows: orthancRefs } = await db.query(
    `SELECT i.storage_key
       FROM pacs.instances i
       JOIN pacs.series  se ON se.id = i.series_id
       JOIN pacs.studies s  ON s.id  = se.study_id
      WHERE s.patient_id = $1
        AND i.storage_key LIKE 'orthanc:%'`,
    [id]
  );
  const orthancStudies = new Set();
  for (const r of orthancRefs) {
  }
  // Pega Orthanc study IDs (mais barato apagar 1 study que N instances)
  const { rows: orthancStudyRows } = await db.query(
    `SELECT DISTINCT split_part(s.study_instance_uid, '.', 1) AS uid,
            s.id AS study_id
       FROM pacs.studies s
      WHERE s.patient_id = $1`,
    [id]
  );

  const result = await db.transaction(async (client) => {
    // Apagado antes de studies pois reports não tem CASCADE explícito na FK
    await client.query(
      `DELETE FROM ris.reports
        WHERE study_id IN (SELECT id FROM pacs.studies WHERE patient_id = $1)`,
      [id]
    );
    // ON DELETE CASCADE cobre pacs.series/instances/annotations
    const st = await client.query(
      `DELETE FROM pacs.studies WHERE patient_id = $1`,
      [id]
    );
    const ap = await client.query(
      `DELETE FROM ris.appointments WHERE patient_id = $1`,
      [id]
    );
    await client.query(`DELETE FROM ris.notifications WHERE resource_type = 'patient' AND resource_id = $1`, [id]);
    await client.query(`DELETE FROM ris.patient_notifications WHERE patient_id = $1`, [id]);
    await client.query(`DELETE FROM ris.patient_portal_accounts WHERE patient_id = $1`, [id]);
    await client.query(`DELETE FROM ris.patient_consents WHERE patient_id = $1`, [id]);
    const pa = await client.query(`DELETE FROM ris.patients WHERE id = $1`, [id]);

    return { studies: st.rowCount, appointments: ap.rowCount, patient: pa.rowCount };
  });

  // Apaga as imagens no Orthanc (best effort — falha aqui não reverte o PG)
  const orthanc = require('../../services/orthanc');
  const logger  = require('../../config/logger');
  let orthancDeleted = 0;
  for (const inst of orthancRefs) {
    const orthancInstanceId = inst.storage_key.slice('orthanc:'.length);
    try {
      await orthanc.delete(`/instances/${orthancInstanceId}`);
      orthancDeleted++;
    } catch (err) {
      logger.warn('[delete] falha ao apagar instance no Orthanc', {
        orthancInstanceId, message: err.message,
      });
    }
  }

  // Audit log — mantém (registro do operador, NÃO dado pessoal do titular)
  await audit.log({
    ...audit.fromRequest(req),
    action:       'PATIENT_PERMANENTLY_DELETED',
    resourceType: 'patient',
    resourceId:   id,
    details: {
      ...result,
      orthanc_instances_deleted: orthancDeleted,
      orthanc_instances_total:   orthancRefs.length,
    },
  });

  return success(res, {
    ...result,
    orthanc_instances_deleted: orthancDeleted,
  }, 'Paciente excluído permanentemente');
}

async function history(req, res) {
  const { id } = req.params;
  const { rows } = await db.query(
    `SELECT
       a.id AS appointment_id, a.scheduled_at, a.status AS appointment_status,
       proc.name AS procedure_name, proc.tuss_code, proc.modality_type,
       s.id AS study_id, s.study_instance_uid, s.accession_number,
       s.study_date, s.status AS study_status,
       s.number_of_series, s.number_of_instances,
       r.id AS report_id, r.status AS report_status, r.signed_at,
       u.name AS radiologist_name
     FROM ris.appointments a
     JOIN ris.procedures proc ON proc.id = a.procedure_id
     LEFT JOIN pacs.studies s ON s.appointment_id = a.id
     LEFT JOIN ris.reports r ON r.study_id = s.id AND r.status NOT IN ('cancelled')
     LEFT JOIN auth.users u ON u.id = r.radiologist_id
     WHERE a.patient_id = $1
     ORDER BY a.scheduled_at DESC
     LIMIT 50`,
    [id]
  );
  return success(res, rows);
}

/**
 * Mescla um cadastro DUPLICADO em um SOBREVIVENTE (admin).
 * Reatribui todas as referências (estudos, agendamentos, encaminhamentos,
 * notificações, consentimentos) do duplicado para o sobrevivente e INATIVA o
 * duplicado (preserva trilha — não é hard delete). Tudo em transação.
 */
async function merge(req, res) {
  const survivorId = req.params.id;
  const { duplicate_id: duplicateId } = req.body;

  if (survivorId === duplicateId) {
    throw new AppError('Não é possível mesclar um paciente com ele mesmo', 422, 'MERGE_SAME');
  }

  const counts = await db.transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, is_active FROM ris.patients WHERE id IN ($1, $2)`,
      [survivorId, duplicateId]
    );
    if (rows.length !== 2) throw new NotFoundError('Paciente (sobrevivente ou duplicado)');
    const survivor = rows.find(r => r.id === survivorId);
    if (!survivor || survivor.is_active === false) {
      throw new AppError('O paciente sobrevivente deve estar ativo', 422, 'SURVIVOR_INACTIVE');
    }

    // Reatribui referências do duplicado → sobrevivente
    const st = await client.query(`UPDATE pacs.studies      SET patient_id = $1 WHERE patient_id = $2`, [survivorId, duplicateId]);
    const ap = await client.query(`UPDATE ris.appointments  SET patient_id = $1 WHERE patient_id = $2`, [survivorId, duplicateId]);
    await client.query(`UPDATE ris.referrals          SET patient_id = $1 WHERE patient_id = $2`, [survivorId, duplicateId]);
    await client.query(`UPDATE ris.patient_notifications SET patient_id = $1 WHERE patient_id = $2`, [survivorId, duplicateId]);
    await client.query(`UPDATE ris.patient_consents    SET patient_id = $1 WHERE patient_id = $2`, [survivorId, duplicateId]);
    await client.query(
      `UPDATE ris.notifications SET resource_id = $1 WHERE resource_type = 'patient' AND resource_id = $2`,
      [survivorId, duplicateId]
    );

    // Conta do portal: move só se o sobrevivente ainda não tiver uma (evita
    // violar unicidade por paciente).
    const { rows: survAcc } = await client.query(
      `SELECT 1 FROM ris.patient_portal_accounts WHERE patient_id = $1 LIMIT 1`, [survivorId]
    );
    if (!survAcc.length) {
      await client.query(`UPDATE ris.patient_portal_accounts SET patient_id = $1 WHERE patient_id = $2`, [survivorId, duplicateId]);
    }

    await client.query(
      `UPDATE ris.patients
          SET is_active = FALSE, deactivated_at = NOW(),
              notes = COALESCE(notes,'') || ' [MESCLADO em ' || $1 || ' por admin em ' || NOW()::date || ']',
              updated_at = NOW()
        WHERE id = $2`,
      [survivorId, duplicateId]
    );

    return { studies: st.rowCount, appointments: ap.rowCount };
  });

  await audit.log({
    ...audit.fromRequest(req),
    action: 'PATIENT_MERGED',
    resourceType: 'patient',
    resourceId: survivorId,
    details: { duplicate_id: duplicateId, ...counts },
  });

  return success(res, { survivor_id: survivorId, duplicate_id: duplicateId, ...counts }, 'Pacientes mesclados');
}

/**
 * Exportação de dados do titular (LGPD Art. 18 — acesso/portabilidade). Admin/DPO.
 * Compila tudo que o sistema guarda do paciente, em JSON.
 */
async function lgpdExport(req, res) {
  const { id } = req.params;
  const { rows: pRows } = await db.query(`SELECT * FROM ris.patients WHERE id = $1`, [id]);
  if (!pRows.length) throw new NotFoundError('Paciente');
  const patient = enc.decryptPatientFields(pRows[0]);

  const [appts, studies, reports, consents] = await Promise.all([
    db.query(`SELECT a.id, a.scheduled_at, a.status, proc.name AS procedure_name
                FROM ris.appointments a LEFT JOIN ris.procedures proc ON proc.id=a.procedure_id
               WHERE a.patient_id=$1 ORDER BY a.scheduled_at DESC`, [id]),
    db.query(`SELECT id, accession_number, study_date, modality_type, status FROM pacs.studies WHERE patient_id=$1 ORDER BY study_date DESC`, [id]),
    db.query(`SELECT r.id, r.status, r.signed_at, r.conclusion, r.cid10_codes
                FROM ris.reports r JOIN pacs.studies s ON s.id=r.study_id
               WHERE s.patient_id=$1 AND r.status IN ('signed','amended') ORDER BY r.signed_at DESC`, [id]),
    db.query(`SELECT pc.id, ct.title, pc.signed_at, pc.revoked_at
                FROM ris.patient_consents pc JOIN ris.consent_terms ct ON ct.id=pc.term_id
               WHERE pc.patient_id=$1`, [id]),
  ]);

  await audit.log({
    ...audit.fromRequest(req),
    action: 'PATIENT_LGPD_EXPORT', resourceType: 'patient', resourceId: id,
  });

  return success(res, {
    exported_at: new Date().toISOString(),
    patient: {
      id: patient.id, name: patient.name, cpf: patient.cpf, cns: patient.cns,
      birth_date: patient.birth_date, gender: patient.gender,
      phone: patient.phone, email: patient.email, address: patient.address,
      medical_record_number: patient.medical_record_number,
      blood_type: patient.blood_type, allergies: patient.allergies,
      is_active: patient.is_active, created_at: patient.created_at,
    },
    appointments: appts.rows,
    studies:      studies.rows,
    reports:      reports.rows,
    consents:     consents.rows,
  });
}

/**
 * Relatório de acessos (LGPD Art. 18 / Art. 37) — quem acessou os dados do
 * paciente (e de seus estudos/laudos). Admin/DPO.
 */
async function accessLog(req, res) {
  const { id } = req.params;
  const { rows: ids } = await db.query(
    `SELECT s.id::text AS rid FROM pacs.studies s WHERE s.patient_id=$1
     UNION SELECT r.id::text FROM ris.reports r JOIN pacs.studies s ON s.id=r.study_id WHERE s.patient_id=$1`,
    [id]
  );
  const resourceIds = [id, ...ids.map(r => r.rid)];
  const { rows } = await db.query(
    `SELECT id, user_email, user_role, action, resource_type, resource_id, ip_address, created_at
       FROM audit.logs
      WHERE resource_id = ANY($1::uuid[])
      ORDER BY created_at DESC
      LIMIT 500`,
    [resourceIds]
  );
  return success(res, rows);
}

// Senha temporária forte: começa com letra MAIÚSCULA, contém dígitos, len 12.
// Satisfaz a política do portal (mín 8, 1 maiúscula, 1 número).
function genTempPassword() {
  return 'P' + crypto.randomBytes(3).toString('hex') + crypto.randomInt(1000, 9999);
}

/**
 * Liberar/Resetar acesso ao portal do paciente (desacoplado do check-in de exame).
 * Recepção/enfermagem/médico/admin podem gerar o acesso a QUALQUER paciente com CPF.
 * Cria a conta (ou reseta a senha) e devolve a senha temporária UMA vez, para o
 * balcão entregar ao paciente (que troca no primeiro acesso).
 */
async function grantPortalAccess(req, res) {
  const { id } = req.params;
  const reset = req.body?.reset === true;

  const { rows: pr } = await db.query(
    `SELECT id, cpf_hash FROM ris.patients WHERE id = $1 AND is_active = TRUE`, [id]);
  if (!pr.length) throw new NotFoundError('Paciente');
  if (!pr[0].cpf_hash)
    throw new AppError('Paciente sem CPF cadastrado — o portal usa CPF para entrar. Cadastre o CPF primeiro.', 422, 'NO_CPF');

  const { rows: ex } = await db.query(
    `SELECT id FROM ris.patient_portal_accounts WHERE patient_id = $1`, [id]);

  if (ex.length && !reset) {
    return success(res, { created: false, exists: true }, 'Paciente já possui acesso ao portal');
  }

  const temp = genTempPassword();
  const hash = await bcrypt.hash(temp, 12);

  if (ex.length) {
    await db.query(
      `UPDATE ris.patient_portal_accounts
          SET password_hash = $1, failed_attempts = 0, locked_until = NULL,
              is_active = TRUE, updated_at = NOW()
        WHERE id = $2`, [hash, ex[0].id]);
  } else {
    await db.query(
      `INSERT INTO ris.patient_portal_accounts (patient_id, cpf_hash, password_hash)
       VALUES ($1, $2, $3)`, [id, pr[0].cpf_hash, hash]);
  }

  await audit.log({
    ...audit.fromRequest(req),
    action: ex.length ? 'PORTAL_ACCESS_RESET' : 'PORTAL_ACCESS_GRANTED',
    resourceType: 'patient', resourceId: id,
  });

  return created(res, { created: !ex.length, reset: ex.length > 0, temp_password: temp },
    ex.length ? 'Senha do portal redefinida' : 'Acesso ao portal liberado');
}

module.exports = { list, getById, create, update, deactivate, reactivate, deletePermanently, history, merge, lgpdExport, accessLog, grantPortalAccess };
