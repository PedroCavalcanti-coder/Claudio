const db    = require('../../config/database');
const enc   = require('../../services/encryption');
const audit = require('../../services/audit');
const env   = require('../../config/env');
const mwl   = require('../../services/mwl.service');
const messaging = require('../../services/messaging');
const logger = require('../../config/logger');
const availability = require('../availability/availability.controller');
const { notify } = require('../../services/notifications');
const { buildUnitFilter, buildUnitOrReferralFilter } = require('../../middlewares/unitVisibility');
const { success, created, paginated } = require('../../utils/response');
const { NotFoundError, AppError } = require('../../utils/errors');

/**
 * Escolhe um plantonista da unidade para o
 * agendamento quando a recepção não informa o médico. Critério:
 *   1. role='doctor' ativo, lotado num turno (ris.shifts) da unidade cujo
 *      intervalo de horário cobre o horário do agendamento;
 *   2. balanceia por carga — o plantonista com MENOS agendamentos no dia.
 * Fallback: se ninguém em turno cobre o horário, usa qualquer médico ativo da
 * unidade (mesma ordenação por carga). Retorna null se a unidade não tem médico.
 */
async function pickPlantonista(unitId, scheduledAt) {
  if (!unitId || !scheduledAt) return null;
  const at = new Date(scheduledAt);
  if (isNaN(at)) return null;
  const hhmm = at.toISOString().slice(11, 16); // HH:MM em UTC (horário do agendamento)
  const day  = at.toISOString().slice(0, 10);

  // 1. Plantonistas em turno que cobre o horário, ordenados por menor carga no dia.
  const onShift = await db.query(
    `SELECT u.id
       FROM auth.users u
       JOIN ris.user_shifts us ON us.user_id = u.id
       JOIN ris.shifts s ON s.id = us.shift_id AND s.is_active
      WHERE u.role = 'doctor' AND u.is_active
        AND s.health_unit_id = $1
        AND $2::time BETWEEN s.start_time AND s.end_time
      GROUP BY u.id
      ORDER BY (
        SELECT count(*) FROM ris.appointments a
         WHERE a.assigned_doctor_id = u.id
           AND a.scheduled_at::date = $3::date
           AND a.status NOT IN ('cancelled','no_show')
      ) ASC, random()
      LIMIT 1`,
    [unitId, hhmm, day]
  );
  if (onShift.rows.length) return onShift.rows[0].id;

  // 2. Fallback — qualquer médico ativo lotado na unidade, menor carga no dia.
  const anyDoc = await db.query(
    `SELECT u.id
       FROM auth.users u
      WHERE u.role = 'doctor' AND u.is_active AND u.health_unit_id = $1
      ORDER BY (
        SELECT count(*) FROM ris.appointments a
         WHERE a.assigned_doctor_id = u.id
           AND a.scheduled_at::date = $2::date
           AND a.status NOT IN ('cancelled','no_show')
      ) ASC, random()
      LIMIT 1`,
    [unitId, day]
  );
  return anyDoc.rows.length ? anyDoc.rows[0].id : null;
}

async function list(req, res) {
  const { date, date_from, date_to, status, modality_id, patient_id, page, limit } = req.query;
  const offset = (page - 1) * limit;
  const params = [];
  const conditions = [];

  if (date) {
    params.push(date);
    conditions.push(`a.scheduled_at::DATE = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    conditions.push(`a.scheduled_at::DATE >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    conditions.push(`a.scheduled_at::DATE <= $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (modality_id) {
    params.push(modality_id);
    conditions.push(`a.modality_id = $${params.length}`);
  }
  if (patient_id) {
    params.push(patient_id);
    conditions.push(`a.patient_id = $${params.length}`);
  }

  // Filtro multi-unidade — agendamentos da própria unidade OU de paciente
  // referenciado a ela (agenda numa unidade, executa em outra). Admin/recurso
  // veem tudo; sem lotação não vê nada (fail-closed).
  const unitFilter = buildUnitOrReferralFilter(req, 'a', 'a.patient_id', params);
  if (unitFilter) conditions.push(unitFilter);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // LEFT JOIN procedures: consulta/teleconsulta NÃO têm procedure_id (clínico),
  // então um INNER JOIN as excluiria da agenda.
  const baseQuery = `
    FROM ris.appointments a
    JOIN ris.patients p ON p.id = a.patient_id
    LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id
    LEFT JOIN ris.modalities m ON m.id = a.modality_id
    LEFT JOIN ris.rooms r ON r.id = a.room_id
    LEFT JOIN auth.users doc ON doc.id = a.assigned_doctor_id
    ${where}`;

  const [countRes, dataRes] = await Promise.all([
    db.query(`SELECT COUNT(*) ${baseQuery}`, params),
    db.query(`
      SELECT a.*, proc.name AS procedure_name, proc.tuss_code, proc.modality_type,
             proc.duration_minutes AS procedure_duration, proc.requires_fasting,
             m.name AS modality_name, m.dicom_ae_title,
             r.name AS room_name, doc.name AS assigned_doctor_name,
             p.birth_date, p.gender, p.medical_record_number,
             p.name_encrypted, p.cpf_encrypted
      ${baseQuery}
      ORDER BY a.scheduled_at ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ]);

  const data = dataRes.rows.map(row => ({
    ...row,
    patient_name: enc.safeDecrypt(row.name_encrypted),
    name_encrypted: undefined,
    cpf_encrypted: undefined,
  }));

  return paginated(res, { data, total: parseInt(countRes.rows[0].count), page, limit });
}

async function worklist(req, res) {
  // View otimizada para técnicos — exames do dia, escopados pela unidade.
  const params = [];
  const unitFilter = buildUnitFilter(req, 'v', params);
  const where = unitFilter ? `WHERE ${unitFilter}` : '';
  const { rows } = await db.query(
    `SELECT * FROM ris.v_worklist_today v ${where}`,
    params
  );
  return success(res, rows);
}

async function getById(req, res) {
  const { rows } = await db.query(
    `SELECT a.*, proc.name AS procedure_name, proc.tuss_code,
            proc.preparation_instructions, proc.requires_fasting, proc.requires_contrast,
            m.name AS modality_name, m.dicom_ae_title,
            r.name AS room_name, doc.name AS assigned_doctor_name,
            p.birth_date, p.gender, p.medical_record_number,
            p.name_encrypted, p.phone_encrypted
     FROM ris.appointments a
     JOIN ris.patients p ON p.id = a.patient_id
     LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id
     LEFT JOIN ris.modalities m ON m.id = a.modality_id
     LEFT JOIN ris.rooms r ON r.id = a.room_id
     LEFT JOIN auth.users doc ON doc.id = a.assigned_doctor_id
      WHERE a.id = $1`,
    [req.params.id]
  );
  if (!rows.length) throw new NotFoundError('Agendamento');

  const row = rows[0];
  return success(res, {
    ...row,
    patient_name:  enc.safeDecrypt(row.name_encrypted),
    patient_phone: enc.safeDecrypt(row.phone_encrypted, null),
    name_encrypted: undefined,
    phone_encrypted: undefined,
  });
}

async function create(req, res) {
  const body = req.body;
  const kind = body.appointment_kind || 'imaging';
  const isClinical = kind === 'consultation' || kind === 'teleconsultation';
  const unitId = req.user.health_unit_id || null;

  // ── Validações específicas de IMAGEM (modalidade/equipamento/disponibilidade) ──
  if (kind === 'imaging') {
    if (!body.procedure_id) throw new AppError('Procedimento é obrigatório para exame de imagem', 422);

    // Equipamento indisponível (desativado/em manutenção) não recebe agendamento
    if (body.modality_id) {
      const { rows: mRows } = await db.query(
        `SELECT is_active FROM ris.modalities WHERE id = $1`, [body.modality_id]
      );
      if (!mRows.length) throw new AppError('Equipamento não encontrado', 404, 'MODALITY_NOT_FOUND');
      if (mRows[0].is_active === false) {
        throw new AppError('Equipamento indisponível (desativado/em manutenção)', 422, 'MODALITY_UNAVAILABLE');
      }
    }

    // Valida feriado / janela / capacidade quando há regras de disponibilidade.
    const enforced = await availability.assertSchedulable({
      unitId, modalityId: body.modality_id || null, procedureId: body.procedure_id || null,
      scheduledAt: body.scheduled_at, durationMin: body.duration_minutes,
    });
    if (!enforced && body.modality_id) {
      const endTime = new Date(new Date(body.scheduled_at).getTime() + body.duration_minutes * 60000);
      const { rows: conflicts } = await db.query(
        `SELECT id FROM ris.appointments
         WHERE modality_id = $1 AND status NOT IN ('cancelled','no_show')
           AND scheduled_at < $2
           AND (scheduled_at + (duration_minutes * INTERVAL '1 minute')) > $3`,
        [body.modality_id, endTime.toISOString(), body.scheduled_at]
      );
      if (conflicts.length) throw new AppError('Conflito de horário na modalidade selecionada', 409, 'SCHEDULING_CONFLICT');
    }
  }

  // ── Médico designado ──────────────────────────────────────────────────────────
  // Imagem: opcional (auto-plantonista). Clínico: OBRIGATÓRIO (a consulta é com um
  // médico). Override manual sempre vence; senão auto-seleciona por carga.
  let assignedDoctorId = body.assigned_doctor_id || null;
  let autoAssigned = false;
  if (!assignedDoctorId) {
    assignedDoctorId = await pickPlantonista(unitId, body.scheduled_at);
    autoAssigned = !!assignedDoctorId;
  }
  if (isClinical && !assignedDoctorId) {
    throw new AppError('Consulta exige um médico; nenhum plantonista disponível no horário', 422, 'NO_DOCTOR');
  }

  const insertAppt = (q) => q(
    `INSERT INTO ris.appointments
       (patient_id, appointment_kind, procedure_id, modality_id, room_id,
        requesting_user_id, requesting_physician_id, assigned_doctor_id,
        specialty, reason,
        scheduled_at, duration_minutes, priority,
        clinical_indication, notes, created_by, health_unit_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id, appointment_kind, scheduled_at, status, assigned_doctor_id, created_at`,
    [
      body.patient_id, kind,
      // Clínico não tem procedimento/modalidade/sala de imagem.
      isClinical ? null : body.procedure_id,
      isClinical ? null : (body.modality_id || null),
      isClinical ? null : (body.room_id || null),
      body.requesting_user_id || req.user.sub,
      body.requesting_physician_id || null,
      assignedDoctorId,
      isClinical ? (body.specialty || null) : null,
      isClinical ? (body.reason || null) : null,
      body.scheduled_at, body.duration_minutes, body.priority,
      body.clinical_indication || null, body.notes || null, req.user.sub,
      unitId,
    ]
  );

  let rows;
  if (isClinical && !body.allow_overbooking) {
    // O médico não pode estar em duas consultas ao mesmo tempo. Trava por médico dentro de
    // transação para dois agendamentos simultâneos não passarem juntos pela checagem.
    ({ rows } = await db.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`doctor-slot:${assignedDoctorId}`]);
      const { rows: clash } = await client.query(
        `SELECT id, scheduled_at FROM ris.appointments
          WHERE assigned_doctor_id = $1
            AND appointment_kind IN ('consultation', 'teleconsultation')
            AND status NOT IN ('cancelled', 'no_show')
            AND scheduled_at < ($2::timestamptz + ($3 * INTERVAL '1 minute'))
            AND (scheduled_at + (duration_minutes * INTERVAL '1 minute')) > $2::timestamptz
          LIMIT 1`,
        [assignedDoctorId, body.scheduled_at, body.duration_minutes]);
      if (clash.length) {
        throw new AppError(
          'O médico já tem consulta nesse horário. Escolha outro horário ou marque como encaixe.',
          409, 'DOCTOR_BUSY', { conflicting_appointment_id: clash[0].id, scheduled_at: clash[0].scheduled_at });
      }
      return insertAppt((text, params) => client.query(text, params));
    }));
  } else {
    ({ rows } = await insertAppt((text, params) => db.query(text, params)));
  }

  setImmediate(() => notify('appointment.created', { appointmentId: rows[0].id }));
  // Confirmação por SMS/WhatsApp é best-effort: sem provedor configurado
  // fica `pending` (ver docs/pendencias.md); nunca bloqueia a criação do agendamento.
  setImmediate(() => enqueueAppointmentConfirm(rows[0].id, unitId, req.user.sub).catch(
    (e) => logger.warn('Falha ao enfileirar confirmação de agendamento', { error: e.message })));
  return created(res, { ...rows[0], auto_assigned_doctor: autoAssigned }, 'Agendamento criado com sucesso');
}

async function enqueueAppointmentConfirm(appointmentId, unitId, userId) {
  const { rows } = await db.query(
    `SELECT p.name_encrypted, p.phone_encrypted,
            COALESCE(pr.name,
                     CASE WHEN a.appointment_kind = 'teleconsultation' THEN 'teleconsulta'
                          WHEN a.appointment_kind = 'consultation' THEN COALESCE('consulta ' || a.specialty, 'consulta')
                          ELSE 'exame' END) AS procedure_name,
            COALESCE(hu.name, '') AS unit_name, a.scheduled_at
       FROM ris.appointments a
       JOIN ris.patients p       ON p.id = a.patient_id
       LEFT JOIN ris.procedures pr ON pr.id = a.procedure_id
       LEFT JOIN ris.health_units hu ON hu.id = a.health_unit_id
      WHERE a.id = $1`,
    [appointmentId]
  );
  if (!rows.length) return;
  const r = rows[0];
  const phone = r.phone_encrypted ? enc.safeDecrypt(r.phone_encrypted, null) : '';
  if (!phone) return; // sem telefone não há o que confirmar
  const name = r.name_encrypted ? enc.safeDecrypt(r.name_encrypted) : '';
  const body = messaging.buildAppointmentConfirm({
    patientName: name, procedure: r.procedure_name, when: r.scheduled_at, unitName: r.unit_name,
  });
  await messaging.enqueue(db, {
    channel: 'sms', to: phone, body, template: 'appointment_confirm',
    refType: 'appointment', refId: appointmentId, unitId, userId,
  });
}

/**
 * Atendimento avulso (walk-in): paciente chega sem agendamento prévio.
 * Cria o agendamento JÁ em 'checked_in' na unidade de quem registra, para que
 * o upload de DICOM funcione no mesmo fluxo. Usado por técnico/recepção.
 */
async function createWalkIn(req, res) {
  const body = req.body;

  // Equipamento indisponível não recebe atendimento
  if (body.modality_id) {
    const { rows: mRows } = await db.query(
      `SELECT is_active FROM ris.modalities WHERE id = $1`, [body.modality_id]
    );
    if (!mRows.length) throw new AppError('Equipamento não encontrado', 404, 'MODALITY_NOT_FOUND');
    if (mRows[0].is_active === false) {
      throw new AppError('Equipamento indisponível (desativado/em manutenção)', 422, 'MODALITY_UNAVAILABLE');
    }
  }

  const { rows } = await db.query(
    `INSERT INTO ris.appointments
       (patient_id, procedure_id, modality_id, room_id,
        requesting_user_id, scheduled_at, duration_minutes, priority,
        clinical_indication, notes, created_by, health_unit_id,
        status, checked_in_at, checked_in_by)
     VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9,$10,$11,'checked_in',NOW(),$10)
     RETURNING id, scheduled_at, status, created_at`,
    [
      body.patient_id, body.procedure_id, body.modality_id || null, body.room_id || null,
      req.user.sub,
      body.duration_minutes || 30, body.priority || 0,
      body.clinical_indication || null, body.notes || 'Atendimento avulso (walk-in)',
      req.user.sub, req.user.health_unit_id || null,
    ]
  );

  await audit.log({
    ...audit.fromRequest(req),
    action: 'APPOINTMENT_WALKIN',
    resourceType: 'appointment',
    resourceId: rows[0].id,
    details: { patient_id: body.patient_id, procedure_id: body.procedure_id },
  });

  return created(res, rows[0], 'Atendimento avulso registrado');
}

async function update(req, res) {
  const { id } = req.params;
  const body = req.body;

  // Remarcar consulta/teleconsulta: mesma regra do agendamento — o médico não pode ficar em duas.
  if ((body.scheduled_at || body.duration_minutes) && !body.allow_overbooking) {
    const { rows: cur } = await db.query(
      `SELECT assigned_doctor_id, appointment_kind, scheduled_at, duration_minutes
         FROM ris.appointments WHERE id = $1 AND status IN ('scheduled','confirmed')`, [id]);
    const a = cur[0];
    if (a && a.assigned_doctor_id && a.appointment_kind !== 'imaging') {
      const { rows: clash } = await db.query(
        `SELECT id FROM ris.appointments
          WHERE id <> $1 AND assigned_doctor_id = $2
            AND appointment_kind IN ('consultation', 'teleconsultation')
            AND status NOT IN ('cancelled', 'no_show')
            AND scheduled_at < ($3::timestamptz + ($4 * INTERVAL '1 minute'))
            AND (scheduled_at + (duration_minutes * INTERVAL '1 minute')) > $3::timestamptz
          LIMIT 1`,
        [id, a.assigned_doctor_id, body.scheduled_at || a.scheduled_at, body.duration_minutes || a.duration_minutes]);
      if (clash.length) throw new AppError('O médico já tem consulta nesse horário.', 409, 'DOCTOR_BUSY');
    }
  }

  const { rowCount } = await db.query(
    `UPDATE ris.appointments
     SET scheduled_at = COALESCE($1, scheduled_at),
         duration_minutes = COALESCE($2, duration_minutes),
         modality_id = COALESCE($3, modality_id),
         room_id = COALESCE($4, room_id),
         clinical_indication = COALESCE($5, clinical_indication),
         notes = COALESCE($6, notes),
         priority = COALESCE($7, priority),
         updated_at = NOW()
     WHERE id = $8 AND status IN ('scheduled','confirmed')`,
    [
      body.scheduled_at, body.duration_minutes, body.modality_id, body.room_id,
      body.clinical_indication, body.notes, body.priority, id,
    ]
  );
  if (!rowCount) throw new NotFoundError('Agendamento (ou não pode ser editado nesse status)');
  return success(res, { id }, 'Agendamento atualizado');
}

// Check-in = chegada do paciente + CONFERÊNCIA DE IDENTIDADE. Não cria conta do portal nem exige
// senha: paciente só-CNS, idoso ou sem celular precisa ser atendido, e a recepção não pode ficar
// bloqueada por senha esquecida. Conta do portal é opcional (botão "Portal" em Pacientes).
// Identidade confirmada por CPF, CNS ou conferência visual de documento com foto.
async function checkIn(req, res) {
  const { id } = req.params;
  const { cpf, cns, document_verified } = req.body;
  const method = req.body.identity_verified_by
    || (cpf ? 'cpf' : cns ? 'cns' : document_verified ? 'document' : null);
  if (!method) {
    throw new AppError('Confirme a identidade: informe CPF ou CNS, ou marque a conferência de documento com foto', 422, 'IDENTITY_REQUIRED');
  }

  let appointmentId = id;
  let portalActive = false;

  await db.transaction(async client => {
    const { rows } = await client.query(
      `SELECT a.id, a.patient_id, a.status, a.modality_id, p.cpf_hash, p.cns_hash,
              a.appointment_kind, a.assigned_doctor_id, a.encounter_id,
              a.health_unit_id, a.reason
       FROM ris.appointments a
       JOIN ris.patients p ON p.id = a.patient_id
       WHERE a.id = $1 FOR UPDATE`,
      [id]
    );
    if (!rows.length) throw new AppError('Agendamento não encontrado', 404);

    const ap = rows[0];
    if (!['scheduled', 'confirmed'].includes(ap.status))
      throw new AppError('Check-in não disponível para o status atual do agendamento', 422);

    if (method === 'cpf') {
      if (!cpf) throw new AppError('Informe o CPF do paciente', 422, 'IDENTITY_REQUIRED');
      if (!ap.cpf_hash) throw new AppError('Paciente sem CPF cadastrado — confira por CNS ou documento com foto', 422, 'NO_CPF_ON_FILE');
      if (enc.searchHash(cpf.replace(/[.\-]/g, '').trim()) !== ap.cpf_hash)
        throw new AppError('CPF não corresponde ao agendamento. Check-in cancelado.', 422, 'IDENTITY_MISMATCH');
    } else if (method === 'cns') {
      if (!cns) throw new AppError('Informe o CNS do paciente', 422, 'IDENTITY_REQUIRED');
      if (!ap.cns_hash) throw new AppError('Paciente sem CNS cadastrado — confira por CPF ou documento com foto', 422, 'NO_CNS_ON_FILE');
      if (enc.searchHash(String(cns).replace(/\D/g, '')) !== ap.cns_hash)
        throw new AppError('CNS não corresponde ao agendamento. Check-in cancelado.', 422, 'IDENTITY_MISMATCH');
    } else if (method === 'document') {
      if (document_verified !== true)
        throw new AppError('Confirme que o documento com foto foi conferido', 422, 'IDENTITY_REQUIRED');
    }

    const { rows: acc } = await client.query(
      `SELECT 1 FROM ris.patient_portal_accounts WHERE patient_id = $1 AND is_active = TRUE`, [ap.patient_id]);
    portalActive = acc.length > 0;

    const { rowCount } = await client.query(
      `UPDATE ris.appointments
       SET status               = 'checked_in',
           checked_in_at        = NOW(),
           checked_in_by        = $1,
           portal_access_granted = $3,
           identity_verified_by = $4,
           identity_verified_at = NOW(),
           updated_at           = NOW()
       WHERE id = $2 AND status IN ('scheduled', 'confirmed')`,
      [req.user.sub, id, portalActive, method]
    );
    if (!rowCount) throw new AppError('Check-in não foi possível', 422);

    const isClinical = ap.appointment_kind === 'consultation' || ap.appointment_kind === 'teleconsultation';

    // Linguagem do status varia conforme o tipo de atendimento (clínico x exame)
    await client.query(
      `UPDATE ris.patients
       SET current_status = $2, updated_at = NOW()
       WHERE id = $1`,
      [ap.patient_id, isClinical ? 'aguardando atendimento' : 'esperando o exame']
    );

    // Consulta/teleconsulta: abre o atendimento (encounter) e coloca o paciente
    // na fila médica do PEP, unindo o agendamento (RIS) ao atendimento clínico.
    if (isClinical && !ap.encounter_id) {
      // UPSERT atômico — evita corrida entre check-ins simultâneos na mesma unidade/dia.
      let ticketNumber = null;
      if (ap.health_unit_id) {
        const t = await client.query(
          `INSERT INTO ehr.daily_ticket_counters (health_unit_id, ticket_date, last_number)
             VALUES ($1, CURRENT_DATE, 1)
           ON CONFLICT (health_unit_id, ticket_date)
             DO UPDATE SET last_number = ehr.daily_ticket_counters.last_number + 1
           RETURNING last_number`,
          [ap.health_unit_id]
        );
        ticketNumber = t.rows[0].last_number;
      }
      const encType = ap.appointment_kind === 'teleconsultation' ? 'teleconsulta' : 'ambulatorial';
      const encRes = await client.query(
        `INSERT INTO ehr.encounters
           (patient_id, professional_id, health_unit_id, appointment_id, encounter_type,
            status, flow_stage, chief_complaint_enc, assigned_doctor_id,
            ticket_number, ticket_date, created_by)
         VALUES ($1,$2,$3,$4,$5::ehr.encounter_type,'open','waiting_doctor',$6,$7,$8,CURRENT_DATE,$9)
         RETURNING id`,
        [
          ap.patient_id, ap.assigned_doctor_id || req.user.sub, ap.health_unit_id, id, encType,
          ap.reason ? enc.encrypt(ap.reason) : null, ap.assigned_doctor_id, ticketNumber, req.user.sub,
        ]
      );
      await client.query(`UPDATE ris.appointments SET encounter_id = $1 WHERE id = $2`, [encRes.rows[0].id, id]);
    }

    appointmentId = ap.id;

    await audit.log({
      ...audit.fromRequest(req),
      action:       audit.ACTIONS.CHECKIN,
      resourceType: 'appointment',
      resourceId:   id,
      // Aceite dos Termos/LGPD + como a identidade foi conferida — prova auditável.
      details:      { terms_accepted: req.body?.terms_accepted === true, identity_verified_by: method },
    });

    // Envio à worklist DICOM roda fora da transação — falha não deve reverter o check-in.
    if (!isClinical && ap.modality_id) {
      setImmediate(() =>
        mwl.sendWorklistEntry(id).catch(err =>
          require('../../config/logger').error('MWL erro', { error: err.message })
        )
      );
    }
  });

  setImmediate(() => notify('appointment.checked_in', { appointmentId }));
  return success(res, { id: appointmentId, portal_access_granted: portalActive, identity_verified_by: method },
    'Check-in realizado com sucesso');
}

// Retorna status resumido do agendamento (acessível a qualquer usuário autenticado)
async function getStatus(req, res) {
  const { rows } = await db.query(
    `SELECT
       a.id, a.status, a.scheduled_at, a.checked_in_at, a.priority,
       a.portal_access_granted, a.appointment_kind,
       proc.name AS procedure_name, proc.modality_type,
       s.id AS study_id, s.status AS study_status, s.display_status,
       s.number_of_series, s.number_of_instances, s.upload_completed_at,
       r.id AS report_id, r.status AS report_status, r.signed_at
     FROM ris.appointments a
     LEFT JOIN ris.procedures proc ON proc.id = a.procedure_id   -- consulta/teleconsulta não têm procedimento
     LEFT JOIN pacs.studies s ON s.appointment_id = a.id
     LEFT JOIN ris.reports r  ON r.study_id = s.id AND r.status NOT IN ('cancelled')
     WHERE a.id = $1`,
    [req.params.id]
  );
  if (!rows.length) throw new NotFoundError('Agendamento');

  const row = rows[0];

  const clinical = row.appointment_kind !== 'imaging';
  const statusLabels = {
    scheduled:   { label: 'Agendado',            color: '#3b82f6', step: 0 },
    confirmed:   { label: 'Confirmado',           color: '#6366f1', step: 1 },
    checked_in:  { label: clinical ? 'Aguardando Atendimento' : 'Aguardando Exame', color: '#8b5cf6', step: 2 },
    in_progress: { label: clinical ? 'Em Atendimento' : 'Realizando Exame',         color: '#f59e0b', step: 3 },
    done:        { label: clinical ? 'Atendimento Concluído'
                          : (['signed', 'amended'].includes(row.report_status) ? 'Laudo Disponível' : 'Exame Concluído'), color: '#10b981', step: 4 },
    cancelled:   { label: 'Cancelado',            color: '#ef4444', step: -1 },
    no_show:     { label: 'Não Compareceu',       color: '#6b7280', step: -1 },
  };

  const current = statusLabels[row.status] ?? { label: row.status, color: '#6b7280', step: 0 };

  return success(res, {
    appointment_id:    row.id,
    status:            row.status,
    status_label:      current.label,
    status_color:      current.color,
    step:              current.step,
    scheduled_at:      row.scheduled_at,
    checked_in_at:     row.checked_in_at,
    procedure_name:    row.procedure_name,
    modality_type:     row.modality_type,
    study_id:          row.study_id,
    study_status:      row.study_status,
    images_available:  !!row.upload_completed_at,
    report_id:         row.report_id,
    report_status:     row.report_status,
    report_available:  ['signed', 'amended'].includes(row.report_status),
    appointment_kind:  row.appointment_kind,
    signed_at:         row.signed_at,
  });
}

async function cancel(req, res) {
  const { id } = req.params;
  const { reason } = req.body;
  const { rowCount } = await db.query(
    `UPDATE ris.appointments
     SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1,
         cancellation_reason = $2, updated_at = NOW()
     WHERE id = $3 AND status NOT IN ('done','cancelled')`,
    [req.user.sub, reason, id]
  );
  if (!rowCount) throw new AppError('Cancelamento não possível', 422);
  // Remoção da worklist DICOM é best-effort e não bloqueia a resposta ao cliente
  setImmediate(() => mwl.removeWorklist(id).catch(err =>
    require('../../config/logger').warn('MWL remove erro', { error: err.message })
  ));
  return success(res, { id }, 'Agendamento cancelado');
}

module.exports = { list, worklist, getById, create, createWalkIn, update, checkIn, cancel, getStatus };
