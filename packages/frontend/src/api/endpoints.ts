import api from './client';
import type { Patient, Appointment, Report, User } from '../types';

export const authApi = {
  login:   (email: string, password: string, mfa_code?: string) =>
    api.post('/auth/login', { email, password, mfa_code }),
  logout:  () => api.post('/auth/logout'),
  me:      () => api.get('/auth/me'),
  refresh: () => api.post('/auth/refresh'),
  changePassword: (current_password: string, new_password: string) =>
    api.post('/auth/change-password', { current_password, new_password }),
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),
  resetPassword:  (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }),
};

/** Parâmetros aceitos por GET /patients (o backend lê `q`; `search` seria ignorado e devolveria a 1ª página). */
export interface PatientListParams {
  q?: string;                     // CPF, CNS, nome completo — ou nome parcial junto com birth_date
  birth_date?: string;            // AAAA-MM-DD
  gender?: 'M' | 'F' | 'O';
  include_inactive?: 'true' | 'false';
  page?: number;
  limit?: number;
}

export const patientsApi = {
  list:              (params?: PatientListParams) => api.get('/patients', { params }),
  getById:           (id: string) => api.get(`/patients/${id}`),
  create:            (data: Partial<Patient>) => api.post('/patients', data),
  update:            (id: string, data: Partial<Patient>) => api.patch(`/patients/${id}`, data),
  deactivate:        (id: string) => api.delete(`/patients/${id}`),
  reactivate:        (id: string) => api.post(`/patients/${id}/reactivate`),
  deletePermanently: (id: string, password: string) =>
    api.delete(`/patients/${id}/permanent`, { data: { password } }),
  merge:             (survivorId: string, duplicateId: string) =>
    api.post(`/patients/${survivorId}/merge`, { duplicate_id: duplicateId }),
  history:           (id: string) => api.get(`/patients/${id}/history`),
  // LGPD — direitos do titular (admin/DPO)
  lgpdExport:        (id: string) => api.get(`/patients/${id}/lgpd-export`),
  accessLog:         (id: string) => api.get(`/patients/${id}/access-log`),
  // Acesso ao portal — libera/reseta e devolve senha temporária (uma vez).
  grantPortalAccess: (id: string, reset?: boolean) =>
    api.post(`/patients/${id}/portal-access`, reset ? { reset: true } : {}),
};

export const consentApi = {
  revoke: (consentId: string) => api.post(`/consent/${consentId}/revoke`),
};

export const appointmentsApi = {
  list:     (params?: Record<string, unknown>) => api.get('/appointments', { params }),
  worklist: () => api.get('/appointments/worklist'),
  getById:  (id: string) => api.get(`/appointments/${id}`),
  create:   (data: Partial<Appointment>) => api.post('/appointments', data),
  update:   (id: string, data: Partial<Appointment>) => api.patch(`/appointments/${id}`, data),
  checkIn:  (id: string, data: { identity_verified_by?: 'cpf' | 'cns' | 'document'; cpf?: string; cns?: string; document_verified?: boolean; terms_accepted?: boolean }) =>
    api.patch(`/appointments/${id}/checkin`, data),
  cancel:   (id: string, reason: string) => api.patch(`/appointments/${id}/cancel`, { reason }),
  walkIn:   (data: { patient_id: string; procedure_id: string; modality_id?: string; clinical_indication?: string }) =>
    api.post('/appointments/walk-in', data),
};

export const auditApi = {
  list:    (params?: Record<string, unknown>) => api.get('/audit', { params }),
  actions: () => api.get('/audit/actions'),
};

export interface ExamNote {
  id:         string;
  study_id:   string;
  user_id:    string | null;
  title:      string | null;
  content:    string;
  created_at: string;
  updated_at: string;
}
export const examNotesApi = {
  listByStudy: (studyId: string) => api.get<{ data: ExamNote[] }>(`/studies/${studyId}/notes`),
  create:      (studyId: string, body: { title?: string; content?: string }) =>
                 api.post<{ data: ExamNote }>(`/studies/${studyId}/notes`, body),
  update:      (id: string, body: { title?: string; content?: string }) =>
                 api.patch<{ data: ExamNote }>(`/notes/${id}`, body),
  remove:      (id: string) => api.delete(`/notes/${id}`),
};

// Hash pulado (retorna null) acima do limite para não estourar a RAM do
// browser — o servidor sempre valida o tamanho como verificação alternativa.
const SHA_MAX_BYTES = 100 * 1024 * 1024;
async function sha256Hex(file: File): Promise<string | null> {
  if (file.size > SHA_MAX_BYTES) return null;
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null; // ex.: contexto inseguro sem HTTPS — cai pra verificação por tamanho
  }
}

export const studiesApi = {
  list:    (params?: Record<string, unknown>) => api.get('/studies', { params }),
  pending: () => api.get('/studies/pending'),
  getById: (id: string) => api.get(`/studies/${id}`),
  series:  (id: string) => api.get(`/studies/${id}/series`),
  priors:  (id: string) => api.get(`/studies/${id}/priors`),
  upload:  (formData: FormData, onProgress?: (pct: number) => void) =>
    api.post('/studies/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30 * 60 * 1000, // uploads grandes em rede lenta
      maxContentLength: Infinity,
      maxBodyLength:    Infinity,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    }),

  /**
   * Upload em blocos: init → chunks (gravados em disco no servidor) → finalize
   * com verificação de integridade. Não bufferiza tudo em RAM nem no browser
   * nem no backend. `meta` deve conter appointment_id + contexto opcional.
   */
  uploadChunked: async (
    files: File[],
    meta: Record<string, unknown>,
    onProgress?: (pct: number) => void,
  ) => {
    const CHUNK = 8 * 1024 * 1024;
    const totalBytes = files.reduce((s, f) => s + f.size, 0) || 1;
    let sentBytes = 0;

    // sha256 do manifesto é o que o finalize usa para checar integridade
    const manifest = await Promise.all(files.map(async (f) => ({
      name: f.name, size: f.size, sha256: await sha256Hex(f),
    })));

    const initRes = await api.post('/studies/upload/init', { ...meta, files: manifest });
    const uploadId = (initRes.data as any).data.upload_id as string;

    try {
      // ordem sequencial por arquivo é exigida pelo servidor para remontar os blocos
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        let off = 0;
        do {
          const blob = f.slice(off, Math.min(off + CHUNK, f.size));
          await api.post(`/studies/upload/${uploadId}/chunk?fileIndex=${i}`, blob, {
            headers: { 'Content-Type': 'application/octet-stream' },
            timeout: 10 * 60 * 1000,
          });
          sentBytes += blob.size;
          off += CHUNK;
          if (onProgress) onProgress(Math.min(99, Math.round((sentBytes / totalBytes) * 100)));
        } while (off < f.size);
      }

      const finRes = await api.post(`/studies/upload/${uploadId}/finalize`, {}, {
        timeout: 10 * 60 * 1000,
      });
      if (onProgress) onProgress(100);
      return finRes;
    } catch (err) {
      // best-effort: descarta a sessão para não deixar lixo em disco
      try { await api.delete(`/studies/upload/${uploadId}`); } catch { /* ignore */ }
      throw err;
    }
  },

  /**
   * Envia uma captura raster (PNG/JPEG/WebP) como DICOM Secondary Capture
   * vinculada ao estudo. O backend converte via Orthanc /tools/create-dicom.
   */
  uploadSecondaryCapture: (studyId: string, blob: Blob, label?: string) => {
    const fd = new FormData();
    fd.append('image', blob, label ? `${label}.png` : 'capture.png');
    if (label) fd.append('label', label);
    return api.post(`/studies/${studyId}/secondary-capture`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60_000,
    });
  },
};

export const reportsApi = {
  list:          (params?: Record<string, unknown>) => api.get('/reports', { params }),
  getById:       (id: string) => api.get(`/reports/${id}`),
  getByStudy:    (studyId: string) => api.get(`/reports/by-study/${studyId}`),
  create:        (data: Partial<Report>) => api.post('/reports', data),
  update:        (id: string, data: Partial<Report>) => api.patch(`/reports/${id}`, data),
  sign: (id: string, data: {
    content_html?:          string;
    findings:               string;
    conclusion:             string;
    technique?:             string;
    recommendations?:       string;
    /** Legado: o backend assina com nome/CRM do CADASTRO do radiologista autenticado. */
    doctor_name?:           string;
    doctor_crm?:            string;
    doctor_institution?:    string;
    digital_certificate_sn?: string;
    digital_certificate_cn?: string;
    cid10_codes?:           { code: string; description?: string }[];
  }) => api.post(`/reports/${id}/sign`, data),

  cid10:         (q: string) => api.get('/reports/cid10', { params: { q } }),

  /**
   * Renderiza o laudo como PDF no servidor (Puppeteer). Retorna blob PDF.
   * Sem content_html → o servidor reconstrói o documento canônico a partir dos
   * campos estruturados (idêntico ao PDF assinado). Com content_html → renderiza
   * o HTML enviado (ex.: export completo com capturas de imagem).
   */
  renderPdf: (id: string, content_html?: string) =>
    api.post(`/reports/${id}/render-pdf`, content_html ? { content_html } : {}, {
      responseType: 'blob',
      timeout:      60_000,
    }),
  amend:         (id: string, reason: string) => api.post(`/reports/${id}/amend`, { reason }),
  getPdf:        (id: string) => api.get(`/reports/${id}/pdf`, { responseType: 'blob' }),
  /**
   * Baixa o laudo assinado. O backend transmite o PDF (ou, em fallback, o HTML)
   * pelo próprio servidor — por isso pedimos blob e preservamos o content-type.
   */
  download:      (id: string) =>
    api.get(`/reports/${id}/download`, { responseType: 'blob' }),
  templates:     () => api.get('/reports/templates'),
  autoTexts:     (params?: { q?: string; modality?: string }) =>
    api.get('/reports/auto-texts', { params }),
};

export const usersApi = {
  list:           (params?: Record<string, unknown>) => api.get('/users', { params }),
  getById:        (id: string) => api.get(`/users/${id}`),
  // Sem `password`: o backend gera a senha provisória e a devolve UMA vez (`temp_password`).
  create:         (data: Partial<User> & { password?: string }) => api.post('/users', data),
  update:         (id: string, data: Partial<User>) => api.patch(`/users/${id}`, data),
  deactivate:     (id: string) => api.patch(`/users/${id}/deactivate`),
  resetPassword:  (id: string) => api.patch(`/users/${id}/reset-password`, {}),
};

export const radiologistApi = {
  worklist:      (params?: Record<string, unknown>) => api.get('/radiologist/worklist', { params }),
  claim:         (id: string)  => api.patch(`/radiologist/worklist/${id}/claim`),
  notifications: () => api.get('/radiologist/notifications'),
};

export const studiesApiExt = {
  uploadComplete: (id: string) => api.patch(`/studies/${id}/upload-complete`),
};

// endpoint público (sem auth) usado pelo portal do paciente
export const appointmentStatusApi = {
  getStatus: (id: string) => api.get(`/appointments/${id}/status`),
};

export const reportSummaryApi = {
  getSummary: (id: string) => api.get(`/reports/${id}/summary`),
};

export const referralsApi = {
  list:    (params?: Record<string, unknown>) => api.get('/referrals', { params }),
  create:  (data: { patient_id: string; from_unit_id?: string; to_unit_id: string; to_user_id?: string; specialty?: string; reason: string }) =>
             api.post('/referrals', data),
  decide:  (id: string, decision: 'accepted'|'declined', notes?: string) =>
             api.patch(`/referrals/${id}/decide`, { decision, decision_notes: notes }),
  cancel:  (id: string) => api.patch(`/referrals/${id}/cancel`),
  counterReference: (id: string, content: string) => api.patch(`/referrals/${id}/counter-reference`, { content }),
};

export const healthUnitsApi = {
  list:       () => api.get('/health-units'),
  mine:       () => api.get('/health-units/mine'),
  setupStatus: () => api.get('/health-units/setup-status'),
  create:     (data: Record<string, unknown>) => api.post('/health-units', data),
  update:     (id: string, data: Record<string, unknown>) => api.patch(`/health-units/${id}`, data),
  modalities: (unitId: string) => api.get(`/health-units/${unitId}/modalities`),
  rooms:      (unitId: string) => api.get(`/health-units/${unitId}/rooms`),
  assignUser: (unitId: string, user_id: string) => api.patch(`/health-units/${unitId}/assign-user`, { user_id }),
  procedures:    (unitId: string) => api.get(`/health-units/${unitId}/procedures`),
  // procedures: [{ procedure_id, weekdays?:number[], start_time?:'HH:MM', end_time?:'HH:MM' }]
  setProcedures: (unitId: string, procedures: Array<{ procedure_id: string; weekdays?: number[]; start_time?: string | null; end_time?: string | null }>) =>
                   api.put(`/health-units/${unitId}/procedures`, { procedures }),
  shifts:        (unitId: string) => api.get(`/health-units/${unitId}/shifts`),
  createShift:   (unitId: string, data: { name: string; start_time: string; end_time: string }) =>
                   api.post(`/health-units/${unitId}/shifts`, data),
  updateShift:   (unitId: string, shiftId: string, data: Record<string, unknown>) =>
                   api.patch(`/health-units/${unitId}/shifts/${shiftId}`, data),
  deleteShift:   (unitId: string, shiftId: string) =>
                   api.delete(`/health-units/${unitId}/shifts/${shiftId}`),
  staff:         (unitId: string) => api.get(`/health-units/${unitId}/staff`),
  setUserShifts: (unitId: string, userId: string, shift_ids: string[]) =>
                   api.put(`/health-units/${unitId}/staff/${userId}/shifts`, { shift_ids }),
};

export const availabilityApi = {
  slots: (params: { health_unit_id: string; date: string; modality_id?: string; procedure_id?: string }) =>
            api.get('/availability/slots', { params }),
  listRules:     (health_unit_id?: string) => api.get('/availability/rules', { params: health_unit_id ? { health_unit_id } : {} }),
  createRule:    (data: Record<string, unknown>) => api.post('/availability/rules', data),
  updateRule:    (id: string, data: Record<string, unknown>) => api.patch(`/availability/rules/${id}`, data),
  deleteRule:    (id: string) => api.delete(`/availability/rules/${id}`),
  listHolidays:  (params?: { health_unit_id?: string; year?: number }) => api.get('/availability/holidays', { params }),
  createHoliday: (data: Record<string, unknown>) => api.post('/availability/holidays', data),
  deleteHoliday: (id: string) => api.delete(`/availability/holidays/${id}`),
};

type RangeParams = { from?: string; to?: string; health_unit_id?: string };
export const analyticsApi = {
  production: (params?: RangeParams) => api.get('/analytics/production', { params }),
  noShow:     (params?: RangeParams) => api.get('/analytics/no-show', { params }),
  queue:      (params?: { health_unit_id?: string }) => api.get('/analytics/queue', { params }),
};

export const lookupsApi = {
  // sem mapeamento de procedimentos p/ a unidade, o backend devolve o catálogo inteiro
  procedures: (health_unit_id?: string) =>
    api.get('/procedures', { params: health_unit_id ? { health_unit_id } : {} }),
};

export const catalogApi = {
  cid10:       (q: string) => api.get('/catalog/cid10', { params: { q } }),
  medications: (q: string) => api.get('/catalog/medications', { params: { q } }),
};

export const billingApi = {
  production: (competencia: string) => api.get('/billing/production', { params: { competencia } }),
  exportCsv:  (competencia: string) => api.get('/billing/production/export', { params: { competencia }, responseType: 'blob' }),
};

export const pharmacyApi = {
  stock:        (params?: { health_unit_id?: string; q?: string; low?: string }) =>
    api.get('/pharmacy/stock', { params }),
  createStock:  (data: Record<string, unknown>) => api.post('/pharmacy/stock', data),
  movement:     (id: string, data: Record<string, unknown>) => api.post(`/pharmacy/stock/${id}/movement`, data),
  movements:    (id: string) => api.get(`/pharmacy/stock/${id}/movements`),
  dispensations:(pid: string) => api.get(`/pharmacy/patients/${pid}/dispensations`),
  dispense:     (data: Record<string, unknown>) => api.post('/pharmacy/dispensations', data),
};

export const messagingApi = {
  outbox: (params?: { status?: string; channel?: string; health_unit_id?: string }) =>
    api.get('/messaging/outbox', { params }),
  retry:  (id: string) => api.post(`/messaging/outbox/${id}/retry`),
  send:   (data: { channel: string; to: string; body: string; template?: string }) =>
    api.post('/messaging/send', data),
};

// sinalização WebRTC feita via polling REST (sem WebSocket) para caber na infra LAN-only
export const teleconsultApi = {
  createSession: (data: Record<string, unknown>) => api.post('/teleconsult/sessions', data),
  sessions:      (pid: string) => api.get(`/teleconsult/patients/${pid}/sessions`),
  setStatus:     (id: string, status: string) => api.patch(`/teleconsult/sessions/${id}/status`, { status }),
  room:          (token: string) => api.get(`/teleconsult/room/${token}`),
  postSignal:    (token: string, data: { sender: string; kind: string; payload: unknown }) =>
    api.post(`/teleconsult/room/${token}/signal`, data),
  getSignals:    (token: string, params: { since: number; role: string }) =>
    api.get(`/teleconsult/room/${token}/signal`, { params }),
};

export const proceduresApi = {
  list:       (params?: Record<string, unknown>) => api.get('/procedures', { params }),
  create:     (data: Record<string, unknown>) => api.post('/procedures', data),
  update:     (id: string, data: Record<string, unknown>) => api.patch(`/procedures/${id}`, data),
  deactivate: (id: string) => api.delete(`/procedures/${id}`),
};

export interface SoapInput {
  subjective?: string; objective?: string; assessment?: string; plan?: string;
  cid10_codes?: { code: string; description?: string }[];
}
export interface VitalsInput {
  systolic?: number; diastolic?: number; heart_rate?: number; resp_rate?: number;
  temp_c?: number; spo2?: number; weight_kg?: number; height_cm?: number;
  pain_scale?: number; glucose_mgdl?: number; notes?: string;
}
export const ehrApi = {
  listEncounters:  (patientId: string) => api.get('/ehr/encounters', { params: { patient_id: patientId } }),
  getEncounter:    (id: string) => api.get(`/ehr/encounters/${id}`),
  createEncounter: (data: { patient_id: string; encounter_type?: string; chief_complaint?: string; appointment_id?: string; health_unit_id?: string }) =>
                     api.post('/ehr/encounters', data),
  updateEncounter: (id: string, data: { encounter_type?: string; chief_complaint?: string }) =>
                     api.patch(`/ehr/encounters/${id}`, data),
  closeEncounter:  (id: string) => api.post(`/ehr/encounters/${id}/close`),
  createNote: (encounterId: string, data: SoapInput) => api.post(`/ehr/encounters/${encounterId}/notes`, data),
  updateNote: (id: string, data: SoapInput) => api.patch(`/ehr/clinical-notes/${id}`, data),
  signNote:   (id: string) => api.post(`/ehr/clinical-notes/${id}/sign`),
  amendNote:  (id: string, reason: string) => api.post(`/ehr/clinical-notes/${id}/amend`, { reason }),
  noteVersions: (id: string) => api.get(`/ehr/clinical-notes/${id}/versions`),
  listProblems:  (patientId: string) => api.get(`/ehr/patients/${patientId}/problems`),
  createProblem: (data: { patient_id: string; title: string; cid10_code?: string; status?: string; is_chronic?: boolean; onset_date?: string; notes?: string; encounter_id?: string }) =>
                   api.post('/ehr/problems', data),
  updateProblem: (id: string, data: Record<string, unknown>) => api.patch(`/ehr/problems/${id}`, data),
  listVitals:   (patientId: string) => api.get(`/ehr/patients/${patientId}/vitals`),
  createVitals: (encounterId: string, data: VitalsInput) => api.post(`/ehr/encounters/${encounterId}/vitals`, data),
  timeline:   (patientId: string) => api.get(`/ehr/patients/${patientId}/timeline`),
  // acesso de emergência fora do fluxo normal — exige motivo e fica em log de auditoria (LGPD)
  breakGlass: (patientId: string, reason: string) => api.post(`/ehr/patients/${patientId}/breakglass`, { reason }),

  allergies:        (pid: string) => api.get(`/ehr/patients/${pid}/allergies`),
  createAllergy:    (data: Record<string, unknown>) => api.post('/ehr/allergies', data),
  updateAllergy:    (id: string, data: Record<string, unknown>) => api.patch(`/ehr/allergies/${id}`, data),
  medications:      (pid: string) => api.get(`/ehr/patients/${pid}/medications`),
  createMedication: (data: Record<string, unknown>) => api.post('/ehr/medications', data),
  updateMedication: (id: string, data: Record<string, unknown>) => api.patch(`/ehr/medications/${id}`, data),
  history:          (pid: string) => api.get(`/ehr/patients/${pid}/history`),
  saveHistory:      (data: { patient_id: string; history_type: string; content?: string }) => api.put('/ehr/history', data),
  attachments:      (pid: string) => api.get(`/ehr/patients/${pid}/attachments`),
  uploadAttachment: (formData: FormData) => api.post('/ehr/attachments', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  downloadAttachment: (id: string) => api.get(`/ehr/attachments/${id}/download`, { responseType: 'blob' }),
  prescriptions:    (pid: string) => api.get(`/ehr/patients/${pid}/prescriptions`),
  createPrescription: (data: Record<string, unknown>) => api.post('/ehr/prescriptions', data),
  signPrescription: (id: string) => api.post(`/ehr/prescriptions/${id}/sign`),
  cancelPrescription: (id: string) => api.post(`/ehr/prescriptions/${id}/cancel`),
  prescriptionPdf:  (id: string) => api.get(`/ehr/prescriptions/${id}/pdf`, { responseType: 'blob' }),
  certificates:     (pid: string) => api.get(`/ehr/patients/${pid}/certificates`),
  createCertificate: (data: Record<string, unknown>) => api.post('/ehr/certificates', data),
  signCertificate:  (id: string) => api.post(`/ehr/certificates/${id}/sign`),
  certificatePdf:   (id: string) => api.get(`/ehr/certificates/${id}/pdf`, { responseType: 'blob' }),
  immunizations:    (pid: string) => api.get(`/ehr/patients/${pid}/immunizations`),
  createImmunization: (data: Record<string, unknown>) => api.post('/ehr/immunizations', data),
  updateImmunization: (id: string, data: Record<string, unknown>) => api.patch(`/ehr/immunizations/${id}`, data),

  startEpisode:    (data: Record<string, unknown>) => api.post('/ehr/episodes', data),
  triage:          (encounterId: string, vitals: Record<string, unknown>) => api.post(`/ehr/encounters/${encounterId}/triage`, vitals),
  advanceEpisode:  (encounterId: string, stage: string) => api.post(`/ehr/encounters/${encounterId}/advance`, { stage }),
  queue:           (params?: { health_unit_id?: string; stage?: string }) => api.get('/ehr/queue', { params }),
  callNext:        (data?: { health_unit_id?: string; room_label?: string }) => api.post('/ehr/queue/call-next', data || {}),
  panel:           (params?: { health_unit_id?: string }) => api.get('/ehr/panel', { params }),
  medicationQueue: (params?: { health_unit_id?: string }) => api.get('/ehr/medication-queue', { params }),
  administerMedication: (data: Record<string, unknown>) => api.post('/ehr/medication-administrations', data),
  medicationSchedule: (params?: { health_unit_id?: string }) => api.get('/ehr/medication-schedule', { params }),
  setItemSchedule: (itemId: string, times: string[]) => api.patch(`/ehr/prescription-items/${itemId}/schedule`, { times }),
  administrations: (pid: string) => api.get(`/ehr/patients/${pid}/medication-administrations`),
  // escalas de risco de enfermagem (Morse: queda; Braden: lesão por pressão)
  nursingAssessments: (pid: string) => api.get(`/ehr/patients/${pid}/nursing-assessments`),
  createNursingAssessment: (data: Record<string, unknown>) => api.post('/ehr/nursing-assessments', data),
  // SAE (Sistematização da Assistência de Enfermagem) — evolução de enfermagem
  nursingEvolutions: (pid: string) => api.get(`/ehr/patients/${pid}/nursing-evolutions`),
  createNursingEvolution: (data: Record<string, unknown>) => api.post('/ehr/nursing-evolutions', data),
  drugCheck: (patient_id: string | undefined, drug_names: string[]) => api.post('/ehr/drug-check', { patient_id, drug_names }),
  // SADT (Serviço de Apoio Diagnóstico e Terapêutico) — solicitação de exames/laboratório
  serviceRequests: (pid: string) => api.get(`/ehr/patients/${pid}/service-requests`),
  createServiceRequest: (data: Record<string, unknown>) => api.post('/ehr/service-requests', data),
  setServiceRequestStatus: (id: string, status: string) => api.patch(`/ehr/service-requests/${id}/status`, { status }),
  adverseEvents: (pid: string) => api.get(`/ehr/patients/${pid}/adverse-events`),
  createAdverseEvent: (data: Record<string, unknown>) => api.post('/ehr/adverse-events', data),
};
