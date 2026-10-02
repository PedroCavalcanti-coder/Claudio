// ── Auth ──────────────────────────────────────────────────────────────────────
export type UserRole = 'admin' | 'radiologist' | 'technician' | 'receptionist' | 'doctor' | 'patient' | 'nurse';

export interface User {
  id:              string;
  name:            string;
  email:           string;
  role:            UserRole;
  crm?:            string;
  crm_uf?:         string;
  specialty?:      string;
  username?:       string;
  health_unit_id?: string;
  health_unit_name?:string;
  last_login_at?:  string;
  /** Páginas liberadas (menu/rotas) e permissões granulares, devolvidas no login. */
  permissions?:    Record<string, boolean>;
  granular_permissions?: string[];
  must_change_password?: boolean;
}

export interface HealthUnit {
  id:        string;
  name:      string;
  cnpj?:     string;
  cnes?:     string;
  type:      'clinic' | 'hospital' | 'lab';
  phone?:    string;
  email?:    string;
  is_active: boolean;
}

export interface AuthState {
  user:         User | null;
  accessToken:  string | null;
  isAuthenticated: boolean;
}

// ── Pagination ────────────────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  success:    boolean;
  data:       T[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data:    T;
}

// ── Patients ──────────────────────────────────────────────────────────────────
export type Gender = 'M' | 'F' | 'O';

export interface Patient {
  id:                    string;
  name:                  string;
  birth_date:            string;
  gender:                Gender;
  cpf?:                  string;
  cns?:                  string;
  phone?:                string;
  email?:                string;
  blood_type?:           string;
  allergies?:            string;
  medical_record_number: string;
  address?:              Address;
  is_active:             boolean;
  created_at:            string;
  updated_at:            string;
}

export interface Address {
  street?:       string;
  number?:       string;
  complement?:   string;
  neighborhood?: string;
  city?:         string;
  state?:        string;
  zip?:          string;
}

// ── Appointments ──────────────────────────────────────────────────────────────
export type AppointmentStatus = 'scheduled'|'confirmed'|'checked_in'|'in_progress'|'done'|'cancelled'|'no_show';

export interface Appointment {
  id:                    string;
  patient_id:            string;
  patient_name:          string;
  patient_gender:        Gender;
  medical_record_number: string;
  procedure_id:          string;
  procedure_name:        string;
  tuss_code:             string;
  modality_type:         string;
  modality_name?:        string;
  room_name?:            string;
  scheduled_at:          string;
  duration_minutes:      number;
  status:                AppointmentStatus;
  priority:              number;
  clinical_indication?:  string;
  notes?:                string;
  created_at:            string;
}

// ── Studies / PACS ────────────────────────────────────────────────────────────
export type StudyStatus = 'pending'|'receiving'|'received'|'incomplete'|'complete'|'archived'|'deleted';
export type ModalityType = 'CR'|'DX'|'CT'|'MR'|'US'|'NM'|'PT'|'MG'|'RF'|'OT';

export interface Study {
  id:                    string;
  study_instance_uid:    string;
  accession_number:      string;
  study_date:            string;
  modality_type:         ModalityType;
  study_description?:    string;
  number_of_series:      number;
  number_of_instances:   number;
  size_bytes:            number;
  status:                StudyStatus;
  received_at:           string;
  patient_id:            string;
  patient_name:          string;
  medical_record_number: string;
  birth_date:            string;
  procedure_name?:       string;
  report_id?:            string;
  report_status?:        string;
  hours_waiting?:        number;
}

// ── Reports ───────────────────────────────────────────────────────────────────
export type ReportStatus = 'draft'|'review'|'signed'|'amended'|'cancelled';

export interface Report {
  id:               string;
  study_id:         string;
  radiologist_id:   string;
  radiologist_name: string;
  status:           ReportStatus;
  technique?:       string;
  findings?:        string;
  conclusion?:      string;
  recommendations?: string;
  content_html?:    string;
  signed_at?:       string;
  signature_hash?:  string;
  pdf_storage_key?: string;
  share_token?:     string;
  created_at:       string;
  updated_at:       string;
  // Study info
  study_date?:      string;
  modality_type?:   string;
  accession_number?:string;
  patient_name?:    string;
  medical_record_number?: string;
}

export interface ReportTemplate {
  id:           string;
  name:         string;
  modality_type?: string;
  content_json: { sections: Array<{ id: string; label: string; type: string; required: boolean }> };
}

export interface AutoText {
  id:           string;
  shortcut:     string;
  title:        string;
  content:      string;
  modality_type?: string;
}

// ── Procedures ───────────────────────────────────────────────────────────────
export interface Procedure {
  id:               string;
  name:             string;
  tuss_code?:       string;
  modality_type?:   string;
  duration_minutes: number;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export interface DashboardStats {
  total_appointments: number;
  completed:          number;
  signed_reports:     number;
  pending_reports:    number;
  gross_revenue:      string;
  by_modality:        Array<{ modality_type: string; total: number; done: number }>;
}
