import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Calendar, CheckCircle, XCircle, Search, ChevronDown, Printer } from 'lucide-react';
import { appointmentsApi, patientsApi, lookupsApi, availabilityApi, healthUnitsApi } from '../../api/endpoints';
import { useAuthStore } from '../../stores/authStore';
import TermsCheckbox from '../../components/TermsCheckbox';

function printAppointmentReceipt(a: any) {
  const esc = (s: any) => String(s ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dt = a.scheduled_at ? new Date(a.scheduled_at) : null;
  const data = dt ? dt.toLocaleDateString('pt-BR') : '—';
  const hora = dt ? dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Comprovante de Agendamento</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;color:#111;padding:24px;font-size:13px}
    .head{text-align:center;border-bottom:2px solid #1a3a5c;padding-bottom:10px;margin-bottom:14px}
    .head h1{font-size:16px;color:#1a3a5c}
    .head p{font-size:11px;color:#666;margin-top:2px}
    .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #ddd}
    .row .k{color:#666}.row .v{font-weight:600;text-align:right}
    .big{margin:14px 0;text-align:center;padding:10px;background:#f0f4f8;border-radius:6px}
    .big .d{font-size:22px;font-weight:700;color:#1a3a5c}
    .prep{margin-top:14px;font-size:11px;color:#444;background:#fff8e1;border:1px solid #ffe08a;border-radius:6px;padding:10px}
    .foot{margin-top:18px;font-size:10px;color:#999;text-align:center}
    @media print{body{padding:8px}}
  </style></head><body>
    <div class="head"><h1>Comprovante de Agendamento</h1><p>${esc(a.health_unit_name || 'Rede Municipal de Saúde')}</p></div>
    <div class="big"><div class="d">${data} · ${hora}</div></div>
    <div class="row"><span class="k">Paciente</span><span class="v">${esc(a.patient_name)}</span></div>
    <div class="row"><span class="k">Prontuário</span><span class="v">${esc(a.medical_record_number)}</span></div>
    <div class="row"><span class="k">Tipo</span><span class="v">${a.appointment_kind === 'teleconsultation' ? 'Teleconsulta' : a.appointment_kind === 'consultation' ? 'Consulta' : 'Exame'}</span></div>
    ${(a.appointment_kind === 'consultation' || a.appointment_kind === 'teleconsultation')
      ? `${a.specialty ? `<div class="row"><span class="k">Especialidade</span><span class="v">${esc(a.specialty)}</span></div>` : ''}
         ${a.assigned_doctor_name ? `<div class="row"><span class="k">Médico</span><span class="v">${esc(a.assigned_doctor_name)}</span></div>` : ''}`
      : `<div class="row"><span class="k">Procedimento</span><span class="v">${esc(a.procedure_name)}</span></div>
         ${a.modality_type ? `<div class="row"><span class="k">Modalidade</span><span class="v">${esc(a.modality_type)}</span></div>` : ''}
         ${a.room_name ? `<div class="row"><span class="k">Sala</span><span class="v">${esc(a.room_name)}</span></div>` : ''}`}
    ${a.preparation_instructions ? `<div class="prep"><strong>Preparo:</strong> ${esc(a.preparation_instructions)}</div>` : ''}
    ${a.appointment_kind === 'teleconsultation' ? `<div class="prep"><strong>Teleconsulta:</strong> no horário, acesse o Portal do Paciente e clique em "Entrar na sala". Tenha câmera e microfone.</div>` : ''}
    <div class="foot">Apresente este comprovante na recepção · chegue 15 min antes · Emitido em ${new Date().toLocaleString('pt-BR')}</div>
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 250);
}
import type { Appointment, Procedure } from '../../types';
import {
  Modal, Spinner, Pagination, EmptyState, Alert,
  Field, Select, SectionHeader,
} from '../../components/ui';
import {
  appointmentStatusLabel, appointmentStatusBadge,
  priorityLabel, priorityBadge, modalityLabel, getErrorMessage,
} from '../../utils/format';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  patient_id:          z.string().uuid('Selecione um paciente'),
  appointment_kind:    z.enum(['imaging', 'consultation', 'teleconsultation']).default('imaging'),
  procedure_id:        z.string().optional(),  // obrigatoriedade condicional é aplicada no refine abaixo
  specialty:           z.string().optional(),
  reason:              z.string().optional(),
  scheduled_at:        z.string().min(1, 'Data/hora obrigatória'),
  duration_minutes:    z.coerce.number().int().min(5).max(480).default(30),
  priority:            z.coerce.number().int().min(0).max(2).default(0),
  assigned_doctor_id:  z.string().optional(),
  clinical_indication: z.string().optional(),
  notes:               z.string().optional(),
}).refine(
  (d) => d.appointment_kind !== 'imaging' || (!!d.procedure_id && d.procedure_id.length > 0),
  { message: 'Selecione um procedimento', path: ['procedure_id'] },
);
type FormData = z.infer<typeof schema>;

function PatientSearch({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const [query, setQuery]         = useState('');
  const [selected, setSelected]   = useState('');
  const [open, setOpen]           = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery({
    queryKey: ['patient-search-appt', query],
    queryFn:  () => patientsApi.list({ q: query, limit: 8, page: 1 }),
    select:   r => r.data.data as any[],
    enabled:  query.length >= 2,
  });

  function pick(p: any) {
    setSelected(p.name ?? p.medical_record_number);
    setQuery('');
    setOpen(false);
    onChange(p.id, p.name ?? '');
  }

  return (
    <div ref={ref} className="relative">
      {value && !open ? (
        <button type="button"
          className="input w-full text-left flex items-center justify-between"
          onClick={() => { setOpen(true); setSelected(''); onChange('', ''); }}>
          <span className="truncate text-slate-200">{selected}</span>
          <ChevronDown size={14} className="text-slate-500 shrink-0" />
        </button>
      ) : (
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            autoFocus
            className="input pl-8"
            placeholder="Buscar por nome ou CPF..."
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
          />
          {isFetching && <Spinner size={12} className="absolute right-3 top-1/2 -translate-y-1/2" />}
        </div>
      )}
      {open && query.length >= 2 && (
        <div className="absolute z-50 w-full mt-1 rounded-lg bg-navy-800 border border-navy-600 shadow-xl max-h-52 overflow-y-auto">
          {!data || data.length === 0 ? (
            <p className="text-slate-500 text-xs px-3 py-2">Nenhum paciente encontrado</p>
          ) : data.map((p: any) => (
            <button key={p.id} type="button"
              className="w-full text-left px-3 py-2 hover:bg-navy-700 text-sm flex flex-col"
              onClick={() => pick(p)}>
              <span className="text-slate-200">{p.name}</span>
              <span className="text-slate-500 text-xs">{p.medical_record_number}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AppointmentForm({ onSave, onClose }: {
  onSave: (d: any) => Promise<any>; onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [patientId, setPatientId] = useState('');

  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { duration_minutes: 30, priority: 0, appointment_kind: 'imaging' },
  });
  const kind = watch('appointment_kind');
  const isClinical = kind === 'consultation' || kind === 'teleconsultation';

  // Lista só os procedimentos habilitados para a unidade do recepcionista logado
  const myUnitId = (useAuthStore.getState().user as any)?.health_unit_id ?? undefined;
  const { data: procedures = [], isLoading: loadingProcs } = useQuery<Procedure[]>({
    queryKey: ['procedures', myUnitId],
    queryFn:  () => lookupsApi.procedures(myUnitId).then(r => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  const procedureId = watch('procedure_id');
  const [slotDate, setSlotDate] = useState('');
  const { data: myUnit } = useQuery({
    queryKey: ['my-unit-appt'],
    queryFn:  () => healthUnitsApi.mine().then(r => (r.data as any).data),
    staleTime: 5 * 60 * 1000,
  });
  const { data: slotData } = useQuery({
    queryKey: ['appt-slots', myUnit?.id, slotDate, procedureId],
    queryFn:  () => availabilityApi.slots({ health_unit_id: myUnit.id, date: slotDate, procedure_id: procedureId || undefined }).then(r => (r.data as any).data),
    enabled:  !!myUnit?.id && !!slotDate,
  });
  const pickSlot = (iso: string) => {
    const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
    setValue('scheduled_at', `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`, { shouldValidate: true });
  };

  // Permite ao atendente sobrescrever manualmente a auto-seleção do plantonista
  const { data: unitDoctors = [] } = useQuery({
    queryKey: ['unit-doctors', myUnit?.id],
    queryFn:  () => healthUnitsApi.staff(myUnit.id).then(r => (r.data as any).data as any[]),
    enabled:  !!myUnit?.id,
    select:   (rows: any[]) => rows.filter(u => u.role === 'doctor' && u.is_active),
    staleTime: 5 * 60 * 1000,
  });

  const onSubmit = async (data: FormData) => {
    setError('');
    try {
      // assigned_doctor_id vazio → omite (backend auto-seleciona o plantonista).
      const { assigned_doctor_id, procedure_id, specialty, reason, ...rest } = data;
      const clinical = data.appointment_kind !== 'imaging';
      await onSave({
        ...rest,
        ...(assigned_doctor_id ? { assigned_doctor_id } : {}),
        ...(clinical ? {} : { procedure_id }),
        ...(clinical && specialty ? { specialty } : {}),
        ...(clinical && reason ? { reason } : {}),
        scheduled_at: new Date(data.scheduled_at).toISOString(),
      });
      onClose();
    } catch (err) { setError(getErrorMessage(err)); }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && <Alert message={error} onClose={() => setError('')} />}
      <div className="grid grid-cols-2 gap-4">

        <div className="col-span-2">
          <Field label="Paciente" error={errors.patient_id?.message} required>
            <PatientSearch
              value={patientId}
              onChange={(id) => {
                setPatientId(id);
                setValue('patient_id', id, { shouldValidate: true });
              }}
            />
            <input type="hidden" {...register('patient_id')} />
          </Field>
        </div>

        <div className="col-span-2">
          <Field label="Tipo de agendamento" required>
            <Select {...register('appointment_kind')}>
              <option value="imaging">Exame de imagem</option>
              <option value="consultation">Consulta</option>
              <option value="teleconsultation">Teleconsulta (vídeo)</option>
            </Select>
          </Field>
        </div>

        {!isClinical && (
        <div className="col-span-2">
          <Field label="Procedimento" error={errors.procedure_id?.message} required>
            <Select {...register('procedure_id')} disabled={loadingProcs}>
              <option value="">{loadingProcs ? 'Carregando...' : 'Selecione o procedimento'}</option>
              {procedures.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.tuss_code ? ` — ${p.tuss_code}` : ''}{p.modality_type ? ` (${p.modality_type})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        )}

        {isClinical && (
          <>
            <Field label="Especialidade">
              <input className="input" placeholder="Ex.: Clínica Geral, Pediatria..." {...register('specialty')} />
            </Field>
            <Field label="Motivo da consulta">
              <input className="input" placeholder="Queixa / motivo..." {...register('reason')} />
            </Field>
          </>
        )}

        {!isClinical && myUnit?.id && (
          <div className="col-span-2">
            <Field label="Horários disponíveis (opcional)">
              <input type="date" className="input mb-2 max-w-[200px]" value={slotDate}
                onChange={e => setSlotDate(e.target.value)} />
              {slotDate && slotData && (
                slotData.holiday ? (
                  <p className="text-amber-400 text-xs">Dia sem atendimento (feriado).</p>
                ) : slotData.slots?.length ? (
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {slotData.slots.map((s: any) => (
                      <button key={s.time} type="button" disabled={!s.available}
                        title={s.available ? `${s.remaining} vaga(s)` : 'Sem vaga'}
                        className={`px-2 py-1 rounded text-xs border transition-colors ${
                          s.available
                            ? 'border-cyan-700/50 text-cyan-300 hover:bg-cyan-900/30'
                            : 'border-navy-700 text-slate-600 line-through cursor-not-allowed'}`}
                        onClick={() => pickSlot(s.time)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs">Sem janela de atendimento neste dia — use a data/hora manual.</p>
                )
              )}
            </Field>
          </div>
        )}

        <Field label="Data e Hora" error={errors.scheduled_at?.message} required>
          <input type="datetime-local" className="input" {...register('scheduled_at')} />
        </Field>
        <Field label="Duração (min)">
          <input type="number" className="input" min={5} max={480} {...register('duration_minutes')} />
        </Field>
        <Field label="Prioridade">
          <Select {...register('priority')}>
            <option value="0">Normal</option>
            <option value="1">Urgente</option>
            <option value="2">Emergência</option>
          </Select>
        </Field>
        <div className="col-span-2">
          <Field label="Médico (opcional)">
            <Select {...register('assigned_doctor_id')} disabled={!unitDoctors.length}>
              <option value="">Automático — plantonista da unidade</option>
              {unitDoctors.map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <p className="text-[11px] text-slate-500 mt-1">Em branco, o sistema distribui entre os médicos de plantão.</p>
          </Field>
        </div>
        <Field label="Indicação Clínica">
          <input className="input" placeholder="Motivo do exame..." {...register('clinical_indication')} />
        </Field>
        <div className="col-span-2">
          <Field label="Observações">
            <textarea className="input resize-none h-16" {...register('notes')} />
          </Field>
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-2 border-t border-navy-700">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? <Spinner size={14} /> : 'Criar Agendamento'}
        </button>
      </div>
    </form>
  );
}

export default function AppointmentsPage() {
  const qc = useQueryClient();
  const [page, setPage]         = useState(1);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal]       = useState(false);
  const [cancelTarget, setCancelTarget]   = useState<Appointment | null>(null);
  const [cancelReason, setCancelReason]   = useState('');
  const [checkinTarget, setCheckinTarget] = useState<null | { id: string; patient_name?: string }>(null);
  const [checkinCpf, setCheckinCpf]       = useState('');
  const [checkinPassword, setCheckinPassword] = useState('');
  const [checkinError, setCheckinError]   = useState('');
  const [checkinAgreed, setCheckinAgreed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', page, dateFilter, statusFilter],
    queryFn:  () => appointmentsApi.list({
      page, limit: 15,
      date:   dateFilter   || undefined,
      status: statusFilter || undefined,
    }),
    select: r => r.data,
  });

  const createMut = useMutation({
    mutationFn: (d: FormData) => appointmentsApi.create(d as any),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['appointments'] }); setModal(false); },
  });

  const checkInMut = useMutation({
    mutationFn: ({ id, cpf, password }: { id: string; cpf: string; password: string }) =>
      appointmentsApi.checkIn(id, { cpf, password, terms_accepted: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      setCheckinTarget(null);
      setCheckinError('');
    },
    onError: (err: any) => setCheckinError(err.response?.data?.message ?? 'Erro no check-in'),
  });

  const cancelMut = useMutation({
    mutationFn: () => appointmentsApi.cancel(cancelTarget!.id, cancelReason),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['appointments'] }); setCancelTarget(null); setCancelReason(''); },
  });

  const appointments: Appointment[] = data?.data ?? [];

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Agendamentos"
        subtitle="Gestão de exames agendados"
        action={
          <button className="btn-primary" onClick={() => setModal(true)}>
            <Plus size={15} /> Novo Agendamento
          </button>
        }
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar size={15} className="text-cyan-400" />
          <input
            type="date"
            className="input max-w-[180px]"
            value={dateFilter}
            onChange={e => { setDateFilter(e.target.value); setPage(1); }}
          />
        </div>
        <Select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="text-xs py-1 h-auto max-w-[180px]"
        >
          <option value="">Todos os status</option>
          <option value="scheduled">Agendado</option>
          <option value="confirmed">Confirmado</option>
          <option value="checked_in">Aguardando Exame</option>
          <option value="in_progress">Em Andamento</option>
          <option value="done">Concluído</option>
          <option value="cancelled">Cancelado</option>
          <option value="no_show">Não compareceu</option>
        </Select>
        {(dateFilter || statusFilter) && (
          <button className="btn-ghost text-xs py-1 px-2" onClick={() => {
            setDateFilter(new Date().toISOString().slice(0, 10));
            setStatusFilter('');
            setPage(1);
          }}>
            Hoje
          </button>
        )}
        <span className="text-slate-500 text-sm">{data?.pagination?.total ?? 0} agendamentos</span>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                {['Horário', 'Paciente', 'Procedimento', 'Modalidade', 'Prioridade', 'Status', 'Ações'].map(h => (
                  <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-3 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-navy-800/50">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : appointments.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState icon={Calendar} title="Nenhum agendamento" description="Sem exames para esta data / filtro" />
                </td></tr>
              ) : appointments.map(a => (
                <tr key={a.id} className="border-b border-navy-800/30 table-row-hover">
                  <td className="px-4 py-3 font-mono text-cyan-400 text-xs">
                    {new Date(a.scheduled_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-200 font-medium">{(a as any).patient_name}</p>
                    <p className="text-slate-500 text-xs">{(a as any).medical_record_number}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-400 max-w-[180px] truncate">
                    {(a as any).procedure_name
                      || (a as any).specialty
                      || ((a as any).appointment_kind === 'teleconsultation' ? 'Teleconsulta'
                          : (a as any).appointment_kind === 'consultation' ? 'Consulta' : '—')}
                    {(a as any).assigned_doctor_name && ((a as any).appointment_kind || 'imaging') !== 'imaging' && (
                      <span className="block text-slate-600 text-xs">{(a as any).assigned_doctor_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {(a as any).appointment_kind === 'teleconsultation' ? (
                      <span className="badge badge-info">Teleconsulta</span>
                    ) : (a as any).appointment_kind === 'consultation' ? (
                      <span className="badge badge-neutral">Consulta</span>
                    ) : (a as any).modality_type ? (
                      <span className="badge badge-info">{modalityLabel[(a as any).modality_type] ?? (a as any).modality_type}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${priorityBadge(a.priority)}`}>{priorityLabel(a.priority)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${appointmentStatusBadge[a.status]}`}>
                      {appointmentStatusLabel[a.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        className="btn-ghost px-2 py-1 text-xs"
                        title="Imprimir comprovante"
                        onClick={() => printAppointmentReceipt(a)}
                      >
                        <Printer size={12} />
                      </button>
                      {['scheduled', 'confirmed'].includes(a.status) && (
                        <button
                          className="btn-ghost px-2 py-1 text-xs text-emerald-400 border-emerald-900/50"
                          onClick={() => { setCheckinTarget({ id: a.id, patient_name: (a as any).patient_name }); setCheckinCpf(''); setCheckinPassword(''); setCheckinError(''); }}
                        >
                          <CheckCircle size={12} /> Check-in
                        </button>
                      )}
                      {!['done', 'cancelled', 'no_show'].includes(a.status) && (
                        <button className="btn-danger px-2 py-1 text-xs" onClick={() => setCancelTarget(a)}>
                          <XCircle size={12} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="flex justify-between items-center px-4 py-3 border-t border-navy-700">
            <span className="text-slate-500 text-xs">{data.pagination.total} registros</span>
            <Pagination page={page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Novo Agendamento" size="lg">
        <AppointmentForm onSave={d => createMut.mutateAsync(d)} onClose={() => setModal(false)} />
      </Modal>

      <Modal
        open={!!checkinTarget}
        onClose={() => { setCheckinTarget(null); setCheckinAgreed(false); }}
        title={`Check-in — ${checkinTarget?.patient_name ?? ''}`}
        size="sm"
      >
        <div className="space-y-3">
          {checkinError && <Alert message={checkinError} onClose={() => setCheckinError('')} />}
          <Field label="CPF" required>
            <input className="input" placeholder="000.000.000-00" value={checkinCpf}
              onChange={e => setCheckinCpf(e.target.value)} />
          </Field>
          <Field label="Senha" required>
            <input type="password" className="input"
              placeholder="Mínimo 8 caracteres, 1 maiúscula, 1 número"
              value={checkinPassword} onChange={e => setCheckinPassword(e.target.value)} />
          </Field>
          <TermsCheckbox checked={checkinAgreed} onChange={setCheckinAgreed}
            label="O paciente leu e concorda com os" />
          <div className="flex gap-3 justify-end">
            <button className="btn-ghost" onClick={() => { setCheckinTarget(null); setCheckinAgreed(false); }}>Cancelar</button>
            <button
              className="btn-primary"
              disabled={checkInMut.isPending || !checkinCpf || !checkinPassword || !checkinAgreed}
              onClick={() => checkInMut.mutate({ id: checkinTarget!.id, cpf: checkinCpf, password: checkinPassword })}
            >
              {checkInMut.isPending ? <Spinner size={14} /> : 'Confirmar Check-in'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancelar Agendamento" size="sm">
        <div className="space-y-4">
          <p className="text-slate-400 text-sm">Informe o motivo do cancelamento:</p>
          <textarea className="input resize-none h-20" placeholder="Motivo..." value={cancelReason}
            onChange={e => setCancelReason(e.target.value)} />
          <div className="flex gap-3 justify-end">
            <button className="btn-ghost" onClick={() => setCancelTarget(null)}>Voltar</button>
            <button className="btn-danger" disabled={cancelReason.length < 3 || cancelMut.isPending}
              onClick={() => cancelMut.mutate()}>
              {cancelMut.isPending ? <Spinner size={14} /> : 'Cancelar Agendamento'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
