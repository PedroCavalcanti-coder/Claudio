import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Search, User, RefreshCw, History, Trash2, RotateCcw, Send, GitMerge, ShieldCheck, Stethoscope, KeyRound, Copy } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { patientsApi, lookupsApi } from '../../api/endpoints';
import ReferralModal from '../../components/ReferralModal';
import MergePatientModal from '../../components/MergePatientModal';
import LgpdModal from '../../components/LgpdModal';
import TermsCheckbox from '../../components/TermsCheckbox';
import type { Patient, Procedure } from '../../types';
import {
  Modal, Spinner, Pagination, EmptyState, Alert,
  Field, Select, SectionHeader, ConfirmDialog,
} from '../../components/ui';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../components/ui/Toast';
import { formatDate, formatAge, genderLabel, getErrorMessage } from '../../utils/format';

// ── Schema de criação (com campos obrigatórios) ───────────────────────────────
const createSchema = z.object({
  name:       z.string().min(3, 'Nome obrigatório'),
  birth_date: z.string().min(1, 'Data de nascimento obrigatória'),
  gender:     z.enum(['M', 'F', 'O'], { error: 'Selecione o sexo' }),
  // CPF e CNS opcionais, mas exige-se ao menos um (rede pública: há quem não tenha CPF)
  cpf:        z.string().regex(/^\d{11}$|^\d{3}\.\d{3}\.\d{3}-\d{2}$/, 'CPF inválido').optional().or(z.literal('')),
  cns:        z.string().regex(/^\d{15}$/, 'CNS deve ter 15 dígitos').optional().or(z.literal('')),
  phone:      z.string().optional(),
  email:      z.string().email('E-mail inválido').optional().or(z.literal('')),
  blood_type: z.string().optional(),
  allergies:  z.string().optional(),
}).refine(d => !!d.cpf || !!d.cns, {
  message: 'Informe ao menos CPF ou CNS',
  path: ['cpf'],
});
type CreateData = z.infer<typeof createSchema>;

// ── Schema de edição (CPF não editável) ──────────────────────────────────────
const editSchema = z.object({
  name:       z.string().min(3, 'Nome obrigatório'),
  birth_date: z.string().min(1, 'Data de nascimento obrigatória'),
  gender:     z.enum(['M', 'F', 'O'], { error: 'Selecione o sexo' }),
  cns:        z.string().regex(/^\d{15}$/, 'CNS deve ter 15 dígitos').optional().or(z.literal('')),
  phone:      z.string().optional(),
  email:      z.string().email('E-mail inválido').optional().or(z.literal('')),
  blood_type: z.string().optional(),
  allergies:  z.string().optional(),
});
type EditData = z.infer<typeof editSchema>;

// ── Formulário de CRIAÇÃO ─────────────────────────────────────────────────────
function CreatePatientForm({ onSave, onClose }: {
  onSave: (data: any) => Promise<any>;
  onClose: () => void;
}) {
  const [error, setError]                         = useState('');
  const [agreed, setAgreed]                       = useState(false);  // consentimento LGPD
  const [createAppointment, setCreateAppointment] = useState(false);
  const [apptProcedureId, setApptProcedureId]     = useState('');
  const [apptScheduledAt, setApptScheduledAt]     = useState('');
  const [apptDuration, setApptDuration]           = useState(30);
  const [apptPriority, setApptPriority]           = useState(0);
  const [apptClinicalIndication, setApptClinicalIndication] = useState('');
  const [apptError, setApptError]                 = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateData>({
    resolver: zodResolver(createSchema),
  });

  const { data: procedures = [], isLoading: loadingProcedures } = useQuery<Procedure[]>({
    queryKey: ['procedures'],
    queryFn:  () => lookupsApi.procedures().then((r: any) => r.data.data),
    staleTime: 5 * 60 * 1000,
    enabled: createAppointment,
  });

  const onSubmit = async (data: CreateData) => {
    setError('');
    setApptError('');
    if (createAppointment) {
      if (!apptProcedureId) { setApptError('Selecione um procedimento'); return; }
      if (!apptScheduledAt) { setApptError('Informe a data e hora do agendamento'); return; }
    }
    try {
      const payload: any = { ...data, terms_accepted: agreed };
      // Remove identificadores vazios — backend valida formato e exige ao menos um
      if (!payload.cpf) delete payload.cpf;
      if (!payload.cns) delete payload.cns;
      if (createAppointment && apptProcedureId && apptScheduledAt) {
        payload.appointment = {
          procedure_id:        apptProcedureId,
          scheduled_at:        new Date(apptScheduledAt).toISOString(),
          duration_minutes:    apptDuration,
          priority:            apptPriority,
          clinical_indication: apptClinicalIndication || undefined,
        };
      }
      await onSave(payload);
      onClose();
    } catch (err) { setError(getErrorMessage(err)); }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && <Alert message={error} onClose={() => setError('')} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="col-span-1 sm:col-span-2">
          <Field label="Nome Completo" error={errors.name?.message} required>
            <input className="input" placeholder="Maria da Silva" {...register('name')} />
          </Field>
        </div>
        <Field label="Data de Nascimento" error={errors.birth_date?.message} required>
          <input type="date" className="input" {...register('birth_date')} />
        </Field>
        <Field label="Sexo" error={errors.gender?.message} required>
          <Select {...register('gender')}>
            <option value="">Selecione</option>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
            <option value="O">Outro</option>
          </Select>
        </Field>
        <Field label="CPF" error={errors.cpf?.message}>
          <input className="input" placeholder="000.000.000-00" {...register('cpf')} />
        </Field>
        <Field label="CNS (Cartão Nacional de Saúde)" error={errors.cns?.message}>
          <input className="input" placeholder="000000000000000" maxLength={15} {...register('cns')} />
        </Field>
        <Field label="Tipo Sanguíneo">
          <Select {...register('blood_type')}>
            <option value="">—</option>
            {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Telefone" error={errors.phone?.message}>
          <input className="input" placeholder="(11) 99999-0000" {...register('phone')} />
        </Field>
        <Field label="E-mail" error={errors.email?.message}>
          <input className="input" placeholder="paciente@email.com" {...register('email')} />
        </Field>
        <div className="col-span-1 sm:col-span-2">
          <Field label="Alergias">
            <textarea className="input resize-none h-16" placeholder="Descreva alergias conhecidas..." {...register('allergies')} />
          </Field>
        </div>
      </div>

      {/* Seção de agendamento — exclusiva do formulário de criação */}
      <div className="border-t border-navy-700 pt-4">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input type="checkbox" className="rounded" checked={createAppointment}
            onChange={e => { setCreateAppointment(e.target.checked); setApptError(''); }} />
          <span className="text-sm text-slate-300">Criar agendamento após cadastro</span>
        </label>

        {createAppointment && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
            {apptError && (
              <div className="col-span-1 sm:col-span-2">
                <Alert message={apptError} onClose={() => setApptError('')} />
              </div>
            )}
            <div className="col-span-1 sm:col-span-2">
              <Field label="Procedimento" required>
                <Select value={apptProcedureId} onChange={e => setApptProcedureId(e.target.value)}
                  disabled={loadingProcedures}>
                  <option value="">{loadingProcedures ? 'Carregando...' : 'Selecione o procedimento'}</option>
                  {procedures.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.tuss_code ? ` — ${p.tuss_code}` : ''}{p.modality_type ? ` (${p.modality_type})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Data e Hora" required>
              <input type="datetime-local" className="input" value={apptScheduledAt}
                onChange={e => setApptScheduledAt(e.target.value)} />
            </Field>
            <Field label="Duração (min)">
              <input type="number" className="input" min={5} max={480} value={apptDuration}
                onChange={e => setApptDuration(Number(e.target.value))} />
            </Field>
            <Field label="Prioridade">
              <Select value={String(apptPriority)} onChange={e => setApptPriority(Number(e.target.value))}>
                <option value="0">Normal</option>
                <option value="1">Urgente</option>
                <option value="2">Emergência</option>
              </Select>
            </Field>
            <Field label="Indicação Clínica">
              <input className="input" placeholder="Ex: dor torácica..." value={apptClinicalIndication}
                onChange={e => setApptClinicalIndication(e.target.value)} />
            </Field>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-navy-700">
        <TermsCheckbox checked={agreed} onChange={setAgreed}
          label="O paciente (ou responsável) foi informado sobre o tratamento de dados e concorda com os" />
      </div>
      <div className="flex gap-3 justify-end pt-2">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting || !agreed}>
          {isSubmitting ? <Spinner size={14} /> : 'Cadastrar Paciente'}
        </button>
      </div>
    </form>
  );
}

// ── Formulário de EDIÇÃO ──────────────────────────────────────────────────────
function EditPatientForm({ patientId, onSave, onClose }: {
  patientId: string;
  onSave: (data: EditData) => Promise<any>;
  onClose: () => void;
}) {
  const [error, setError] = useState('');

  // Busca dados completos do paciente (o list omite alguns campos)
  const { data: patient, isLoading } = useQuery<Patient>({
    queryKey: ['patient-detail', patientId],
    queryFn:  () => patientsApi.getById(patientId).then((r: any) => r.data.data),
    staleTime: 0,
  });

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<EditData>({
    resolver: zodResolver(editSchema),
    values: patient ? {
      name:       patient.name       ?? '',
      // birth_date vem como ISO ("YYYY-MM-DDT00:00:00.000Z"); o <input type="date">
      // exige YYYY-MM-DD, então recortamos a parte da data.
      birth_date: (patient.birth_date ?? '').slice(0, 10),
      gender:     (patient.gender as 'M'|'F'|'O') ?? 'M',
      cns:        patient.cns        ?? '',
      phone:      patient.phone      ?? '',
      email:      patient.email      ?? '',
      blood_type: patient.blood_type ?? '',
      allergies:  patient.allergies  ?? '',
    } : undefined,
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Spinner size={28} /></div>;
  }

  const onSubmit = async (data: EditData) => {
    setError('');
    try { await onSave(data); onClose(); }
    catch (err) { setError(getErrorMessage(err)); }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && <Alert message={error} onClose={() => setError('')} />}

      <div className="rounded-lg px-3 py-2 bg-navy-800/60 border border-navy-700 text-xs text-slate-500 flex items-center justify-between">
        <span>CPF (não editável)</span>
        <span className="text-slate-300 font-mono">{patient?.cpf ?? '•••.•••.•••-••'}</span>
      </div>

      <Field label="CNS (Cartão Nacional de Saúde)" error={errors.cns?.message}>
        <input className="input" placeholder="000000000000000" maxLength={15} {...register('cns')} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="col-span-1 sm:col-span-2">
          <Field label="Nome Completo" error={errors.name?.message} required>
            <input className="input" placeholder="Maria da Silva" {...register('name')} />
          </Field>
        </div>
        <Field label="Data de Nascimento" error={errors.birth_date?.message} required>
          <input type="date" className="input" {...register('birth_date')} />
        </Field>
        <Field label="Sexo" error={errors.gender?.message} required>
          <Select {...register('gender')}>
            <option value="M">Masculino</option>
            <option value="F">Feminino</option>
            <option value="O">Outro</option>
          </Select>
        </Field>
        <Field label="Tipo Sanguíneo">
          <Select {...register('blood_type')}>
            <option value="">—</option>
            {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Telefone" error={errors.phone?.message}>
          <input className="input" placeholder="(11) 99999-0000" {...register('phone')} />
        </Field>
        <div className="col-span-1 sm:col-span-2">
          <Field label="E-mail" error={errors.email?.message}>
            <input className="input" placeholder="paciente@email.com" {...register('email')} />
          </Field>
        </div>
        <div className="col-span-1 sm:col-span-2">
          <Field label="Alergias">
            <textarea className="input resize-none h-20" placeholder="Descreva alergias conhecidas..." {...register('allergies')} />
          </Field>
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-2 border-t border-navy-700">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? <Spinner size={14} /> : 'Salvar Alterações'}
        </button>
      </div>
    </form>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function PatientsPage() {
  const qc = useQueryClient();
  const isAdmin = useAuthStore(s => s.hasRole('admin'));
  const canEhr  = useAuthStore(s => s.can('ehr'));
  const canPortal = useAuthStore(s => s.can('portal_grant'));
  // Botões seguem a MESMA matriz do backend (permissões granulares)
  const canCreate = useAuthStore(s => s.can('patients:create'));
  const canUpdate = useAuthStore(s => s.can('patients:update'));
  const canDeactivate = useAuthStore(s => s.can('patients:delete'));
  const canHistory = useAuthStore(s => s.can('patients:history'));
  const canRefer = useAuthStore(s => s.can('referrals:create'));
  const [portalResult, setPortalResult] = useState<null | { name: string; temp_password?: string; reset?: boolean; exists?: boolean; patientId: string }>(null);
  const portalMut = useMutation({
    mutationFn: ({ patient, reset }: { patient: Patient; reset: boolean }) =>
      patientsApi.grantPortalAccess(patient.id, reset)
        .then(r => ({ ...((r.data as any).data), name: (patient as any).name ?? '', patientId: patient.id })),
    onSuccess: (data: any) => setPortalResult(data),
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const navigate = useNavigate();
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ]           = useState('');
  const [birth, setBirth]   = useState('');   // data digitada
  const [qBirth, setQBirth] = useState('');   // data aplicada na busca
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal]   = useState<null | 'create' | 'edit' | 'history'>(null);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [confirm, setConfirm]   = useState<Patient | null>(null);
  // Hard-delete admin
  const [permanentTarget, setPermanentTarget] = useState<Patient | null>(null);
  const [referralTarget, setReferralTarget] = useState<Patient | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Patient | null>(null);
  const [lgpdTarget, setLgpdTarget] = useState<Patient | null>(null);
  const [permanentPassword, setPermanentPassword] = useState('');
  const [permanentError, setPermanentError]   = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['patients', page, q, qBirth, showInactive],
    queryFn:  () => patientsApi.list({
      page, limit: 15,
      q: q || undefined,
      birth_date: qBirth || undefined,
      include_inactive: (isAdmin && showInactive) ? 'true' : undefined,
    }),
    select:   r => r.data,
  });

  const { data: historyData } = useQuery({
    queryKey: ['patient-history', selected?.id],
    queryFn:  () => patientsApi.history(selected!.id),
    enabled:  !!selected && modal === 'history',
    select:   r => r.data.data,
  });

  const createMut = useMutation({
    mutationFn: (d: any) => patientsApi.create(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
  });

  const updateMut = useMutation({
    mutationFn: (d: EditData) => patientsApi.update(selected!.id, d as any),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['patient-detail', selected?.id] });
    },
  });

  const deactivateMut = useMutation({
    mutationFn: () => patientsApi.deactivate(confirm!.id),
    onSuccess:  () => {
      // Inativação preserva dados — paciente some das listas que filtram is_active=TRUE.
      qc.invalidateQueries({ queryKey: ['patients'] });
      setConfirm(null);
    },
  });

  const reactivateMut = useMutation({
    mutationFn: (p: Patient) => patientsApi.reactivate(p.id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      toast.success('Paciente reativado');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const deletePermanentlyMut = useMutation({
    mutationFn: () => patientsApi.deletePermanently(permanentTarget!.id, permanentPassword),
    onSuccess:  (res) => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['worklist'] });
      qc.invalidateQueries({ queryKey: ['studies-pending'] });
      qc.invalidateQueries({ queryKey: ['studies-all'] });
      const mode = (res.data as any)?.data?.mode;
      toast.success(mode === 'anonymized'
        ? 'Cadastro anonimizado. O registro clínico foi preservado (guarda legal de 20 anos).'
        : 'Cadastro excluído permanentemente.');
      setPermanentTarget(null);
      setPermanentPassword('');
      setPermanentError(null);
    },
    onError: (e) => setPermanentError(getErrorMessage(e)),
  });

  const patients: Patient[] = data?.data ?? [];
  const pagination = data?.pagination;

  function closeModal() { setModal(null); setSelected(null); }

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Pacientes"
        subtitle="Cadastro e gestão de pacientes"
        action={canCreate ? (
          <button className="btn-primary" onClick={() => setModal('create')}>
            <Plus size={15} /> Novo Paciente
          </button>
        ) : undefined}
      />

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            className="input pl-9"
            placeholder="Nome (3+ letras por palavra), CPF ou CNS..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setQ(search); setQBirth(birth); setPage(1); } }}
          />
        </div>
        <div title="Nascimento — permite buscar por nome parcial (confirmar identidade)">
          <input
            type="date"
            className="input"
            value={birth}
            onChange={e => setBirth(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setQ(search); setQBirth(birth); setPage(1); } }}
          />
        </div>
        <button className="btn-ghost" onClick={() => { setQ(search); setQBirth(birth); setPage(1); }}>
          <Search size={14} /> Buscar
        </button>
        {(q || qBirth) && (
          <button className="btn-ghost" onClick={() => { setQ(''); setSearch(''); setBirth(''); setQBirth(''); setPage(1); }}>
            <RefreshCw size={14} /> Limpar
          </button>
        )}
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none ml-auto">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => { setShowInactive(e.target.checked); setPage(1); }}
              style={{ accentColor: 'var(--color-accent)', width: 14, height: 14 }}
            />
            Mostrar inativos
          </label>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                {['Prontuário', 'Nome', 'Nascimento / Idade', 'Sexo', 'Ações'].map(h => (
                  <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-3 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-navy-800/50">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : patients.length === 0 ? (
                <tr><td colSpan={5}>
                  <EmptyState icon={User} title="Nenhum paciente encontrado"
                    description={q ? 'Tente outro termo de busca' : 'Cadastre o primeiro paciente'} />
                </td></tr>
              ) : patients.map(p => (
                <tr key={p.id} className={`border-b border-navy-800/30 table-row-hover ${p.is_active === false ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 font-mono text-cyan-500 text-xs whitespace-nowrap">
                    {p.medical_record_number}
                    {p.is_active === false && (
                      <span className="ml-2 badge badge-neutral" style={{ fontSize: 9 }}>INATIVO</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-200 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                    {formatDate(p.birth_date)}
                    <span className="text-slate-600 ml-1 text-xs">({formatAge(p.birth_date)})</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{genderLabel[p.gender] ?? p.gender}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 flex-wrap">
                      {p.is_active === false ? (
                        <>
                          <button className="btn-ghost px-2 py-1 text-xs"
                            onClick={() => reactivateMut.mutate(p)} disabled={reactivateMut.isPending}>
                            <RotateCcw size={12} /> Reativar
                          </button>
                          {isAdmin && (
                            <button className="btn-danger px-2 py-1 text-xs"
                              onClick={() => { setPermanentTarget(p); setPermanentPassword(''); setPermanentError(null); }}>
                              <Trash2 size={12} /> Excluir
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          {canEhr && (
                            <button className="btn-ghost px-2 py-1 text-xs"
                              title="Abrir prontuário eletrônico"
                              onClick={() => navigate(`/patients/${p.id}/chart`)}>
                              <Stethoscope size={12} /> Prontuário
                            </button>
                          )}
                          {canUpdate && (
                            <button className="btn-ghost px-2 py-1 text-xs"
                              onClick={() => { setSelected(p); setModal('edit'); }}>
                              Editar
                            </button>
                          )}
                          {canHistory && (
                            <button className="btn-ghost px-2 py-1 text-xs"
                              onClick={() => { setSelected(p); setModal('history'); }}>
                              <History size={12} />
                            </button>
                          )}
                          {canRefer && (
                            <button
                              className="btn-ghost px-2 py-1 text-xs"
                              title="Encaminhar a outra unidade"
                              onClick={() => setReferralTarget(p)}
                            >
                              <Send size={12} /> Encaminhar
                            </button>
                          )}
                          {canPortal && (
                            <button
                              className="btn-ghost px-2 py-1 text-xs"
                              title="Liberar acesso ao Portal do Paciente"
                              disabled={portalMut.isPending}
                              onClick={() => portalMut.mutate({ patient: p, reset: false })}
                            >
                              <KeyRound size={12} /> Portal
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              className="btn-ghost px-2 py-1 text-xs"
                              title="Mesclar paciente duplicado neste"
                              onClick={() => setMergeTarget(p)}
                            >
                              <GitMerge size={12} /> Mesclar
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              className="btn-ghost px-2 py-1 text-xs"
                              title="LGPD — dados, acessos e consentimentos"
                              onClick={() => setLgpdTarget(p)}
                            >
                              <ShieldCheck size={12} /> LGPD
                            </button>
                          )}
                          {canDeactivate && (
                            <button className="btn-danger px-2 py-1 text-xs" onClick={() => setConfirm(p)}>
                              Inativar
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-navy-700">
            <span className="text-slate-500 text-xs">{pagination.total} pacientes</span>
            <Pagination page={page} totalPages={pagination.totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>

      <Modal open={modal === 'create'} onClose={closeModal} title="Novo Paciente" size="lg">
        <CreatePatientForm onSave={d => createMut.mutateAsync(d)} onClose={closeModal} />
      </Modal>

      <Modal open={modal === 'edit' && !!selected} onClose={closeModal} title={`Editar — ${selected?.name ?? ''}`} size="lg">
        {selected && (
          <EditPatientForm
            patientId={selected.id}
            onSave={d => updateMut.mutateAsync(d)}
            onClose={closeModal}
          />
        )}
      </Modal>

      <Modal open={modal === 'history' && !!selected} onClose={closeModal}
        title={`Histórico — ${selected?.name ?? ''}`} size="xl">
        <div className="space-y-2">
          {!historyData ? (
            <div className="flex justify-center py-8"><Spinner size={24} /></div>
          ) : historyData.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-8">Nenhum exame registrado</p>
          ) : historyData.map((h: any) => (
            <div key={h.appointment_id} className="flex items-center gap-4 p-3 rounded-lg bg-navy-800/60">
              <div className="min-w-[90px] text-center shrink-0">
                <p className="text-xs text-slate-400">{formatDate(h.scheduled_at)}</p>
                <span className={`badge mt-1 ${h.report_status === 'signed' ? 'badge-success' : 'badge-neutral'}`}>
                  {h.report_status === 'signed' ? 'Laudado' : 'Pendente'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-slate-200 text-sm font-medium truncate">{h.procedure_name}</p>
                <p className="text-slate-500 text-xs">{h.modality_type} · {h.accession_number}</p>
              </div>
              <p className="text-slate-500 text-xs shrink-0">{h.radiologist_name ?? '—'}</p>
            </div>
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        title="Inativar Paciente"
        message={`Tem certeza que deseja inativar "${confirm?.name}"? O cadastro fica inativo mas todos os dados (agendamentos, exames, laudos) são preservados. O paciente pode reativar pelo portal.`}
        danger
        loading={deactivateMut.isPending}
        onConfirm={() => deactivateMut.mutate()}
        onCancel={() => setConfirm(null)}
      />

      {/* exclusão definitiva requer reautenticação por senha (não apenas sessão ativa) */}
      <Modal
        open={!!permanentTarget}
        onClose={() => { setPermanentTarget(null); setPermanentPassword(''); setPermanentError(null); }}
        title="Excluir paciente permanentemente"
        size="md"
      >
        <div className="space-y-4">
          <div className="p-3 rounded-lg border" style={{ background: 'var(--color-danger-bg)', borderColor: 'color-mix(in srgb, var(--color-danger) 30%, transparent)' }}>
            <p className="text-sm font-semibold" style={{ color: 'var(--color-danger)' }}>Esta ação é irreversível.</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-danger)' }}>
              <strong>{permanentTarget?.name}</strong> sem nenhum atendimento, exame ou documento clínico
              será <strong>excluído</strong> do banco. Se houver prontuário, receita, atestado, laudo ou exame,
              o cadastro será <strong>anonimizado</strong>: nome, CPF, CNS, contatos e endereço são apagados e o
              acesso ao portal é removido, mas o registro clínico é <strong>preservado</strong>, pois a lei exige
              guarda de 20 anos (CFM 1.821/2007; LGPD art. 16, I). Os documentos assinados e as imagens
              mantêm os dados do momento do atendimento. O audit log do operador é mantido.
            </p>
          </div>

          <Field label="Confirme com sua senha de admin">
            <input
              type="password"
              className="input"
              value={permanentPassword}
              onChange={e => { setPermanentPassword(e.target.value); setPermanentError(null); }}
              placeholder="Senha"
              autoFocus
            />
          </Field>

          {permanentError && <Alert message={permanentError} onClose={() => setPermanentError(null)} />}

          <div className="flex justify-end gap-2">
            <button className="btn-ghost"
              onClick={() => { setPermanentTarget(null); setPermanentPassword(''); setPermanentError(null); }}>
              Cancelar
            </button>
            <button className="btn-danger"
              disabled={!permanentPassword || deletePermanentlyMut.isPending}
              onClick={() => deletePermanentlyMut.mutate()}>
              {deletePermanentlyMut.isPending
                ? <><Spinner size={14} /> Apagando...</>
                : <><Trash2 size={14} /> Excluir definitivamente</>}
            </button>
          </div>
        </div>
      </Modal>

      {referralTarget && (
        <ReferralModal
          patientId={referralTarget.id}
          patientName={referralTarget.name ?? ''}
          onClose={() => setReferralTarget(null)}
        />
      )}

      {mergeTarget && (
        <MergePatientModal
          survivor={mergeTarget}
          onClose={() => setMergeTarget(null)}
          onMerged={() => { qc.invalidateQueries({ queryKey: ['patients'] }); }}
        />
      )}

      {lgpdTarget && (
        <LgpdModal patient={lgpdTarget} onClose={() => setLgpdTarget(null)} />
      )}

      {/* senha temporária é exibida uma única vez — não fica recuperável depois */}
      <Modal open={!!portalResult} onClose={() => setPortalResult(null)} title="Acesso ao Portal do Paciente" size="sm">
        {portalResult && (portalResult.exists ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-300"><b>{portalResult.name}</b> já possui acesso ao portal.</p>
            <p className="text-xs text-slate-500">Se o paciente esqueceu a senha, redefina abaixo (gera nova senha temporária).</p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setPortalResult(null)}>Fechar</button>
              <button className="btn-primary" disabled={portalMut.isPending}
                onClick={() => portalMut.mutate({ patient: { id: portalResult.patientId, name: portalResult.name } as any, reset: true })}>
                Redefinir senha
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              {portalResult.reset ? 'Senha redefinida' : 'Acesso liberado'} para <b>{portalResult.name}</b>.
            </p>
            <div>
              <p className="text-xs text-slate-500 mb-1">Senha temporária (mostrada só agora — entregue ao paciente):</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 rounded bg-navy-900 border border-navy-700 text-cyan-300 font-mono text-sm select-all">{portalResult.temp_password}</code>
                <button className="btn-ghost px-2 py-2" title="Copiar"
                  onClick={() => { navigator.clipboard?.writeText(portalResult.temp_password || ''); toast.success('Senha copiada'); }}>
                  <Copy size={14} />
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-600">O paciente entra no portal com o CPF e esta senha, e deve trocá-la no primeiro acesso.</p>
            <div className="flex justify-end"><button className="btn-primary" onClick={() => setPortalResult(null)}>Concluído</button></div>
          </div>
        ))}
      </Modal>

    </div>
  );
}
