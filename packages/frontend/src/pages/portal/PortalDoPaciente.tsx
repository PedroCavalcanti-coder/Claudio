import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Shield, FileText, FileImage, Download, Eye,
  Clock, CheckCircle, LogOut,
  ChevronRight, RefreshCw, Lock,
  AlertTriangle, Activity, Pill, Syringe,
  Calendar, ScrollText, Video, Stethoscope,
} from 'lucide-react';
import api from '../../api/client';
import { Spinner, Alert } from '../../components/ui';
import { formatDate } from '../../utils/format';
import DicomViewerLite from './DicomViewerLite';
import ThemeToggle from '../../components/ui/ThemeToggle';
import StatusStepper from './components/StatusStepper';
import { STEP_CONFIG } from './portalShared';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getToken(): string | null {
  return sessionStorage.getItem('portal_token');
}

function getPatient(): { id: string; name: string; mrn: string } | null {
  const raw = sessionStorage.getItem('portal_patient');
  return raw ? JSON.parse(raw) : null;
}

// ─── Card de exame ─────────────────────────────────────────────────────────────
function ExamCard({ exam, token }: { exam: any; token: string }) {
  const [expanded, setExpanded] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);

  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey:  ['portal-status', exam.study_id],
    queryFn:   () => api.get(`/patient-portal/exams/${exam.study_id}/status`, {
      headers: { 'X-Portal-Token': token },
    }),
    select:    r => r.data.data,
    enabled:   !!exam.study_id,
    refetchInterval: 30_000,
  });

  const downloadPdfMut = useMutation({
    mutationFn: () => api.get(`/patient-portal/exams/${exam.study_id}/pdf`, {
      headers: { 'X-Portal-Token': token },
      responseType: 'blob',
    }),
    onSuccess: res => {
      // O backend transmite o PDF; salvamos como arquivo.
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laudo-${String(exam.study_id).slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
    onError:   (e: any) => setPdfError(e.response?.data?.message ?? 'PDF não disponível'),
  });

  const isCompleted = statusData?.is_completed;
  const hasReport   = statusData?.has_report;
  const current     = statusData?.current_status;
  const cfg         = STEP_CONFIG[current ?? 'processing'] ?? STEP_CONFIG.processing;

  return (
    <div
      style={{
        borderRadius: 14, overflow: 'hidden',
        background: 'var(--navy-900)',
        border: `1.5px solid ${isCompleted ? 'color-mix(in srgb, var(--color-success) 40%, transparent)' : 'var(--navy-700)'}`,
        transition: 'border-color 0.2s ease',
      }}
    >
      {/* Header */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', cursor: 'pointer', transition: 'background-color 0.12s ease' }}
        onClick={() => setExpanded(p => !p)}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--navy-800)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Status icon */}
        <div
          style={{
            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22,
            background: `${cfg.color}14`,
            border: `1px solid ${cfg.color}28`,
          }}
        >
          {cfg.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--sl-100)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {exam.procedure_name ?? 'Exame de Imagem'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--sl-500)', marginTop: 2 }}>
            {formatDate(exam.scheduled_at)}{exam.modality_type && ` · ${exam.modality_type}`}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {statusLoading ? (
            <Spinner size={13} />
          ) : statusData && (
            <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: `${cfg.color}15`, color: cfg.color, border: `1px solid ${cfg.color}30` }}>
              {cfg.label}
            </span>
          )}
          <ChevronRight size={14} style={{ color: 'var(--sl-600)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s ease' }} />
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div
          style={{ padding: '0 18px 18px', borderTop: '1px solid var(--navy-700)', paddingTop: 16 }}
          className="animate-slide-down"
        >
          {statusData?.steps && (
            <StatusStepper steps={statusData.steps} current={current} color={cfg.color} />
          )}

          {pdfError && <div style={{ marginBottom: 12 }}><Alert type="error" message={pdfError} onClose={() => setPdfError('')} /></div>}

          {/* Botões de ação — independentes entre si */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* Linha de botões: PDF (se laudado) + Ver Imagens (se tem study) */}
            {(hasReport || exam.study_id) && (
              <div style={{ display: 'flex', gap: 10 }}>
                {hasReport && (
                  <button
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                      padding: '11px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                      background: 'var(--color-success-bg)',
                      color: 'var(--color-success)',
                      border: '1px solid color-mix(in srgb, var(--color-success) 30%, transparent)',
                      cursor: 'pointer', fontFamily: 'Outfit, sans-serif',
                      opacity: downloadPdfMut.isPending ? 0.6 : 1,
                    }}
                    onClick={() => downloadPdfMut.mutate()}
                    disabled={downloadPdfMut.isPending}
                  >
                    {downloadPdfMut.isPending ? <Spinner size={13} /> : <Download size={14} />}
                    Baixar Laudo
                  </button>
                )}

                {exam.study_id && (
                  <button
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                      padding: '11px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                      background: 'var(--color-accent-subtle)',
                      color: 'var(--color-accent)',
                      border: '1px solid var(--color-accent-ring)',
                      cursor: 'pointer', fontFamily: 'Outfit, sans-serif',
                    }}
                    onClick={() => setViewerOpen(true)}
                  >
                    <Eye size={14} /> Ver Imagens
                  </button>
                )}
              </div>
            )}

            {/* Aviso de laudo em preparação (só quando não tem laudo ainda) */}
            {!hasReport && (
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                  borderRadius: 8, fontSize: 12,
                  background: 'var(--color-info-bg)',
                  border: '1px solid color-mix(in srgb, var(--color-info) 20%, transparent)',
                  color: 'var(--sl-400)',
                }}
              >
                <Clock size={12} style={{ color: 'var(--color-info)', flexShrink: 0 }} />
                <span>
                  {exam.study_id
                    ? 'Imagens disponíveis — laudo em elaboração pelo médico.'
                    : 'Seu laudo está sendo preparado. Você será notificado quando estiver pronto.'}
                </span>
              </div>
            )}
          </div>

          {exam.accession_number && (
            <p style={{ fontSize: 10, color: 'var(--sl-700)', textAlign: 'right', marginTop: 10, fontFamily: 'JetBrains Mono, monospace' }}>
              Acesso: {exam.accession_number}
            </p>
          )}
        </div>
      )}

      {/* Viewer Lite — abre como overlay fullscreen */}
      {viewerOpen && exam.study_id && (
        <DicomViewerLite
          studyId={exam.study_id}
          portalToken={token}
          procedureName={exam.procedure_name}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
// ─── Resumo de saúde do paciente (PEP, somente leitura) ─────────────────────────
const SEV_PT: Record<string, string> = { severe: 'grave', moderate: 'moderada', mild: 'leve', unknown: '' };
function PortalClinicalSummary({ token }: { token: string }) {
  const { data } = useQuery({
    queryKey: ['portal-clinical'],
    queryFn: async () => api.get('/patient-portal/clinical-summary', { headers: { 'X-Portal-Token': token } }),
    select: (r: any) => r.data.data,
    enabled: !!token, retry: 0,
  });
  if (!data) return null;
  const allergies = data.allergies ?? [], problems = data.problems ?? [], medications = data.medications ?? [], immunizations = data.immunizations ?? [];
  if (!allergies.length && !problems.length && !medications.length && !immunizations.length) return null;
  const renderBlock = ({ title, Icon, items, bg, color }: any) => items.length ? (
    <div style={{ borderRadius: 12, padding: 14, background: 'var(--navy-900)', border: '1px solid var(--navy-700)' }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sl-500)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontFamily: 'JetBrains Mono, monospace' }}><Icon size={13} /> {title}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((t: string, i: number) => <span key={i} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: bg, color }}>{t}</span>)}
      </div>
    </div>
  ) : null;
  return (
    <div style={{ marginBottom: 4 }}>
      <h2 style={{ fontFamily: 'Instrument Serif, serif', fontSize: 20, fontWeight: 400, color: 'var(--sl-100)', letterSpacing: '-0.01em', marginBottom: 12 }}>Resumo de Saúde</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {renderBlock({ title: "Alergias", Icon: AlertTriangle, bg: "rgba(239,68,68,0.15)", color: "#fca5a5", items: allergies.map((a: any) => a.allergen + (a.severity && a.severity !== 'unknown' ? ` (${SEV_PT[a.severity]})` : '')) })}
        {renderBlock({ title: "Condições ativas", Icon: Activity, bg: "var(--color-accent-subtle)", color: "var(--cyan-500)", items: problems.map((p: any) => p.title) })}
        {renderBlock({ title: "Medicamentos", Icon: Pill, bg: "var(--navy-800)", color: "var(--sl-300)", items: medications.map((m: any) => m.name + (m.dose ? ` ${m.dose}` : '')) })}
        {renderBlock({ title: "Vacinas", Icon: Syringe, bg: "var(--navy-800)", color: "var(--sl-300)", items: immunizations.slice(0, 10).map((v: any) => v.vaccine + (v.dose_label ? ` (${v.dose_label})` : '')) })}
      </div>
    </div>
  );
}

// ─── Agendamentos + documentos clínicos (receitas, atestados) ──────────────────
const KIND_PT: Record<string, string> = { imaging: 'Exame', consultation: 'Consulta', teleconsultation: 'Teleconsulta' };
const APPT_STATUS_PT: Record<string, string> = {
  scheduled: 'Agendado', confirmed: 'Confirmado', checked_in: 'Check-in feito',
  in_progress: 'Em andamento', done: 'Concluído', cancelled: 'Cancelado', no_show: 'Faltou',
};
function PortalDocuments({ token }: { token: string }) {
  const hdr = { headers: { 'X-Portal-Token': token } };
  const appts = useQuery({
    queryKey: ['portal-appts'], enabled: !!token, retry: 0,
    queryFn: async () => api.get('/patient-portal/appointments', hdr), select: (r: any) => r.data.data as any[],
  });
  const rx = useQuery({
    queryKey: ['portal-rx'], enabled: !!token, retry: 0,
    queryFn: async () => api.get('/patient-portal/prescriptions', hdr), select: (r: any) => r.data.data as any[],
  });
  const certs = useQuery({
    queryKey: ['portal-certs'], enabled: !!token, retry: 0,
    queryFn: async () => api.get('/patient-portal/certificates', hdr), select: (r: any) => r.data.data as any[],
  });

  const download = async (url: string, filename: string) => {
    const r = await api.get(url, { ...hdr, responseType: 'blob' });
    const u = URL.createObjectURL(r.data as Blob);
    const a = document.createElement('a'); a.href = u; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  };

  const upcoming = (appts.data ?? []).filter((a: any) => !['done', 'cancelled', 'no_show'].includes(a.status));
  const card: CSSProperties = { borderRadius: 12, padding: 14, background: 'var(--navy-900)', border: '1px solid var(--navy-700)' };
  const label: CSSProperties = { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--sl-500)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontFamily: 'JetBrains Mono, monospace' };
  const docBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--cyan-500)', background: 'none', border: 'none', cursor: 'pointer' };

  const nothing = !upcoming.length && !(rx.data?.length) && !(certs.data?.length);
  if (nothing) return null;

  return (
    <div style={{ marginBottom: 4 }}>
      <h2 style={{ fontFamily: 'Instrument Serif, serif', fontSize: 20, fontWeight: 400, color: 'var(--sl-100)', letterSpacing: '-0.01em', marginBottom: 12 }}>Agendamentos e Documentos</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>

        {/* Próximos agendamentos */}
        {!!upcoming.length && (
          <div style={card}>
            <p style={label}><Calendar size={13} /> Próximos atendimentos</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {upcoming.slice(0, 6).map((a: any) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {a.appointment_kind === 'teleconsultation' ? <Video size={14} style={{ color: 'var(--cyan-500)' }} />
                    : a.appointment_kind === 'consultation' ? <Stethoscope size={14} style={{ color: 'var(--sl-400)' }} />
                    : <FileImage size={14} style={{ color: 'var(--sl-400)' }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: 'var(--sl-200)' }}>{KIND_PT[a.appointment_kind] ?? 'Atendimento'}{a.procedure_name ? ` — ${a.procedure_name}` : a.specialty ? ` — ${a.specialty}` : ''}</p>
                    <p style={{ fontSize: 11, color: 'var(--sl-500)' }}>{formatDate(a.scheduled_at)} · {APPT_STATUS_PT[a.status] ?? a.status}{a.doctor_name ? ` · Dr(a). ${a.doctor_name}` : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Receitas */}
        {!!rx.data?.length && (
          <div style={card}>
            <p style={label}><Pill size={13} /> Receitas</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rx.data.slice(0, 6).map((r: any) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: 'var(--sl-200)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(r.items ?? []).map((i: any) => i.drug_name).slice(0, 3).join(', ') || 'Receita'}</p>
                    <p style={{ fontSize: 11, color: 'var(--sl-500)' }}>{formatDate(r.signed_at ?? r.created_at)}</p>
                  </div>
                  {r.pdf_available && (
                    <button style={docBtn} onClick={() => download(`/patient-portal/prescriptions/${r.id}/pdf`, `receita-${String(r.id).slice(0, 8)}.pdf`)}>
                      <Download size={13} /> PDF
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Atestados */}
        {!!certs.data?.length && (
          <div style={card}>
            <p style={label}><ScrollText size={13} /> Atestados e declarações</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {certs.data.slice(0, 6).map((c: any) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: 'var(--sl-200)' }}>{c.cert_type === 'medical_leave' ? 'Atestado médico' : c.cert_type === 'attendance' ? 'Declaração de comparecimento' : 'Documento'}</p>
                    <p style={{ fontSize: 11, color: 'var(--sl-500)' }}>{formatDate(c.signed_at ?? c.created_at)}</p>
                  </div>
                  {c.pdf_available && (
                    <button style={docBtn} onClick={() => download(`/patient-portal/certificates/${c.id}/pdf`, `atestado-${String(c.id).slice(0, 8)}.pdf`)}>
                      <Download size={13} /> PDF
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Banner: teleconsulta ativa (médico abriu a sala) ──────────────────────────
function PortalTeleBanner({ token }: { token: string }) {
  const { data } = useQuery({
    queryKey: ['portal-tele'], enabled: !!token, retry: 0, refetchInterval: 20_000,
    queryFn: async () => api.get('/patient-portal/teleconsult', { headers: { 'X-Portal-Token': token } }),
    select: (r: any) => r.data.data,
  });
  if (!data?.room_token) return null;
  return (
    <a href={`/tele/${data.room_token}`}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12,
        background: 'var(--color-accent-subtle)', border: '1px solid var(--cyan-500)', textDecoration: 'none', marginBottom: 4 }}>
      <Video size={18} style={{ color: 'var(--cyan-500)' }} />
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 14, color: 'var(--sl-100)', fontWeight: 600 }}>Sua teleconsulta está disponível</p>
        <p style={{ fontSize: 12, color: 'var(--sl-400)' }}>O profissional abriu a sala. Toque para entrar na chamada de vídeo.</p>
      </div>
      <span style={{ fontSize: 13, color: 'var(--cyan-500)', display: 'flex', alignItems: 'center', gap: 4 }}>Entrar <ChevronRight size={14} /></span>
    </a>
  );
}

export default function PortalDoPaciente() {
  const navigate  = useNavigate();
  const token     = getToken();
  const patient   = getPatient();

  // Redirecionar se não autenticado
  useEffect(() => {
    if (!token || !patient) navigate('/login_paciente', { replace: true });
  }, [token, patient, navigate]);

  const { data: exams, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['portal-exams'],
    queryFn:  async () => {
      const r = await api.get('/patient-portal/exams', {
        headers: { 'X-Portal-Token': token ?? '' },
      });
      return r;
    },
    select:   r => r.data.data as any[],
    enabled:  !!token,
    refetchInterval: 60_000,
    retry: 0, // sem retries — se falhar redireciona para login
  });

  // Token expirado (401) → redireciona para login do paciente
  useEffect(() => {
    if (error && (error as any)?.response?.status === 401) {
      sessionStorage.removeItem('portal_token');
      sessionStorage.removeItem('portal_patient');
      navigate('/login_paciente', { replace: true });
    }
  }, [error, navigate]);

  function handleLogout() {
    sessionStorage.removeItem('portal_token');
    sessionStorage.removeItem('portal_patient');
    try { api.post('/patient-portal/logout', {}, { headers: { 'X-Portal-Token': token ?? '' } }); } catch { /* ok */ }
    navigate('/login_paciente', { replace: true });
  }

  if (!token || !patient) return null;

  const completedCount = (exams ?? []).filter((e: any) => e.report_status === 'signed' || e.report_status === 'amended').length;

  const statItems = [
    { icon: CheckCircle, label: 'Finalizados',  value: completedCount,                         cssColor: 'var(--color-success)', cssBg: 'var(--color-success-bg)'   },
    { icon: Clock,       label: 'Em andamento', value: (exams?.length ?? 0) - completedCount,  cssColor: 'var(--cyan-500)',       cssBg: 'var(--color-accent-subtle)' },
    { icon: FileText,    label: 'Total',         value: exams?.length ?? 0,                     cssColor: 'var(--sl-400)',         cssBg: 'var(--navy-800)'            },
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--navy-950)',
        backgroundImage: 'var(--page-gradient)',
      }}
    >
      {/* ── Header ───────────────────────────────────── */}
      <header
        style={{
          position: 'sticky', top: 0, zIndex: 20,
          borderBottom: '1px solid var(--navy-700)',
          padding: '0 20px',
          height: 56,
          display: 'flex', alignItems: 'center',
          background: 'color-mix(in srgb, var(--navy-900) 92%, transparent)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div style={{ maxWidth: 640, width: '100%', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--cyan-500), var(--navy-600))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={15} color="white" strokeWidth={2.5} />
            </div>
            <div>
              <p style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 13, color: 'var(--sl-100)', lineHeight: 1.2 }}>Portal do Paciente</p>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'var(--sl-600)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>RIS/PACS · SEGURO</p>
            </div>
          </div>

          {/* Right: theme + logout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggle compact />
            <button
              onClick={handleLogout}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--sl-500)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', transition: 'color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-danger)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--sl-500)')}
            >
              <LogOut size={13} /> Sair
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ─────────────────────────────────────── */}
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Welcome card */}
        <div
          style={{
            borderRadius: 16, padding: '20px 22px',
            background: 'var(--color-accent-subtle)',
            border: '1.5px solid var(--color-accent-ring)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <p style={{ fontSize: 12, color: 'var(--sl-400)', marginBottom: 3 }}>Olá,</p>
              <p style={{ fontFamily: 'Instrument Serif, serif', fontSize: 22, fontWeight: 400, color: 'var(--sl-100)', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
                {patient.name}
              </p>
              <p style={{ fontSize: 10, color: 'var(--sl-500)', fontFamily: 'JetBrains Mono, monospace', marginTop: 5 }}>
                Prontuário: {patient.mrn}
              </p>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: 36, color: 'var(--color-accent)', lineHeight: 1 }}>
                {completedCount}
              </div>
              <p style={{ fontSize: 10, color: 'var(--sl-500)', marginTop: 3 }}>
                laudo{completedCount !== 1 ? 's' : ''} disponível{completedCount !== 1 ? 'is' : ''}
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {statItems.map(s => (
            <div
              key={s.label}
              style={{
                borderRadius: 12, padding: '14px 12px', textAlign: 'center',
                background: 'var(--navy-900)',
                border: '1px solid var(--navy-700)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: s.cssBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <s.icon size={14} color={s.cssColor} />
                </div>
              </div>
              <p style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: 22, color: 'var(--sl-100)', lineHeight: 1 }}>{s.value}</p>
              <p style={{ fontSize: 10, color: 'var(--sl-600)', fontFamily: 'JetBrains Mono, monospace', marginTop: 4 }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Teleconsulta ativa — entrar na sala */}
        <PortalTeleBanner token={token} />

        {/* Resumo de saúde (PEP) */}
        <PortalClinicalSummary token={token} />

        {/* Agendamentos (consulta/exame/teleconsulta) + receitas + atestados */}
        <PortalDocuments token={token} />

        {/* Exams header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontFamily: 'Instrument Serif, serif', fontSize: 20, fontWeight: 400, color: 'var(--sl-100)', letterSpacing: '-0.01em' }}>
            Meus Exames
          </h2>
          <button
            onClick={() => refetch()}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--sl-500)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', transition: 'color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--cyan-500)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--sl-500)')}
          >
            <RefreshCw size={11} className={isFetching ? 'animate-spin' : ''} /> Atualizar
          </button>
        </div>

        {/* Error */}
        {error && <Alert type="error" message="Erro ao carregar exames. Verifique sua conexão." />}

        {/* Exam list */}
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 14 }} />)}
          </div>
        ) : !(exams?.length) ? (
          <div
            style={{
              borderRadius: 14, padding: '48px 20px', textAlign: 'center',
              background: 'var(--navy-900)', border: '1px solid var(--navy-700)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            }}
          >
            <FileImage size={28} color="var(--sl-700)" />
            <p style={{ fontSize: 14, color: 'var(--sl-400)' }}>Nenhum exame encontrado</p>
            <p style={{ fontSize: 12, color: 'var(--sl-600)' }}>Os exames aparecerão aqui após serem realizados</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(exams as any[]).map((exam: any) => (
              <ExamCard key={exam.appointment_id ?? exam.study_id} exam={exam} token={token} />
            ))}
          </div>
        )}

        {/* LGPD footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 0', fontSize: 10, color: 'var(--sl-700)', fontFamily: 'JetBrains Mono, monospace' }}>
          <Lock size={9} />
          <span>Dados protegidos pela LGPD · RDC 611/2022 ANVISA · CFM 1.821/2007</span>
        </div>
      </main>
    </div>
  );
}
