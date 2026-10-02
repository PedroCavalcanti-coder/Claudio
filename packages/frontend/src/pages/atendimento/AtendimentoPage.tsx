import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList, Plus, AlertTriangle, HeartPulse, Stethoscope, Pill, CheckCircle2,
  UserPlus, Search, ArrowRight, Megaphone, DoorOpen, Ticket,
} from 'lucide-react';
import { ehrApi, patientsApi } from '../../api/endpoints';
import { Spinner, Modal, Field, Select, EmptyState, ConfirmDialog } from '../../components/ui';
import { toast } from '../../components/ui/Toast';
import { formatDateTime, getErrorMessage } from '../../utils/format';

const sel = (r: any) => (r.data as any).data as any[];
const ENC_TYPE: Record<string, string> = { ambulatorial: 'Ambulatorial', urgencia: 'Urgência', retorno: 'Retorno', teleconsulta: 'Teleconsulta' };

// Classificação de risco — Protocolo de Manchester (cor → prioridade na fila).
const MANCHESTER: { key: string; label: string; sub: string; color: string }[] = [
  { key: 'red', label: 'Emergência', sub: 'imediato', color: '#ef4444' },
  { key: 'orange', label: 'Muito urgente', sub: '10 min', color: '#f97316' },
  { key: 'yellow', label: 'Urgente', sub: '60 min', color: '#eab308' },
  { key: 'green', label: 'Pouco urgente', sub: '120 min', color: '#22c55e' },
  { key: 'blue', label: 'Não urgente', sub: '240 min', color: '#3b82f6' },
];
const MANCHESTER_COLOR: Record<string, string> = Object.fromEntries(MANCHESTER.map((m) => [m.key, m.color]));

// Estágios do quadro (exclui completed/cancelled)
const BOARD: { stage: string; label: string; icon: any; color: string }[] = [
  { stage: 'triage',          label: 'Triagem / medições',  icon: HeartPulse,    color: '#f59e0b' },
  { stage: 'waiting_doctor',  label: 'Aguardando médico',   icon: Stethoscope,   color: 'var(--cyan-500)' },
  { stage: 'in_consultation', label: 'Em atendimento',      icon: ClipboardList, color: '#6366f1' },
  { stage: 'medication',      label: 'Medicação',           icon: Pill,          color: '#f43f5e' },
];

export default function AtendimentoPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [triageFor, setTriageFor] = useState<any | null>(null);
  const [confirmDone, setConfirmDone] = useState<any | null>(null);
  const [callOpen, setCallOpen] = useState(false);

  const q = useQuery({
    queryKey: ['ehr-queue'], queryFn: () => ehrApi.queue(), select: sel, refetchInterval: 30_000,
  });
  const inv = () => qc.invalidateQueries({ queryKey: ['ehr-queue'] });

  const fmtTicket = (n: any) => (n == null ? null : String(n).padStart(3, '0'));
  const waitingCount = (q.data ?? []).filter((e) => e.flow_stage === 'waiting_doctor' && !e.called_at).length;

  const advMut = useMutation({
    mutationFn: ({ id, stage }: any) => ehrApi.advanceEpisode(id, stage),
    onSuccess: () => { inv(); }, onError: (e) => toast.error(getErrorMessage(e)),
  });
  // Abre a página dedicada do atendimento médico (alergias, evolução, receita, medicação).
  const goConsulta = (e: any) => navigate(`/atendimento/consulta/${e.id}`, { state: { patientName: e.patient_name, isEmergency: e.is_emergency } });

  const byStage = (s: string) => (q.data ?? []).filter((e) => e.flow_stage === s);

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-accent-subtle)', color: 'var(--cyan-500)' }}>
          <ClipboardList size={18} />
        </div>
        <div className="flex-1">
          <h1 className="font-display font-bold text-xl text-slate-100">Painel de Atendimento</h1>
          <p className="text-slate-500 text-sm">Recepção → triagem → médico → medicação</p>
        </div>
        <button className="btn-ghost relative" onClick={() => setCallOpen(true)} title="Chamar o próximo da fila médica">
          <Megaphone size={16} /> Chamar próximo
          {waitingCount > 0 && <span className="badge badge-neutral ml-1">{waitingCount}</span>}
        </button>
        <a className="btn-ghost" href="/painel" target="_blank" rel="noreferrer" title="Abrir painel de chamada (TV)"><DoorOpen size={16} /> Painel TV</a>
        <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Iniciar atendimento</button>
      </header>

      {q.isLoading ? <div className="p-8 text-center"><Spinner /></div>
        : !(q.data?.length) ? <EmptyState icon={ClipboardList} title="Nenhum atendimento em andamento"
            description="Clique em 'Iniciar atendimento' para registrar um paciente (ou emergência)." />
        : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
            {BOARD.map(({ stage, label, icon: Icon, color }) => {
              const items = byStage(stage);
              return (
                <div key={stage} className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <Icon size={13} style={{ color }} /> {label} <span className="badge badge-neutral">{items.length}</span>
                  </div>
                  {items.length === 0 && <p className="text-xs text-slate-600 px-1">—</p>}
                  {items.map((e) => (
                    <div key={e.id} className={`card p-3 ${e.is_emergency ? 'border-red-700/50' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-200 truncate">
                            {fmtTicket(e.ticket_number) && <span className="badge badge-neutral text-xs mr-1 font-mono" title="Ficha do dia"><Ticket size={9} /> {fmtTicket(e.ticket_number)}</span>}
                            {e.manchester_level && <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: MANCHESTER_COLOR[e.manchester_level] }} title="Classificação de risco (Manchester)" />}
                            {e.patient_name}
                            {e.is_emergency && <span className="badge badge-danger text-xs ml-1"><AlertTriangle size={9} /> Emergência</span>}
                            {e.registration_status === 'pending' && <span className="badge badge-warning text-xs ml-1">Cadastro pendente</span>}
                          </p>
                          <p className="text-xs text-slate-500">
                            {ENC_TYPE[e.encounter_type] ?? e.encounter_type} · {formatDateTime(e.started_at)}
                            {e.called_at && <span className="text-emerald-400 ml-1">· Chamado{e.room_label ? ` → ${e.room_label}` : ''}</span>}
                            {e.assigned_doctor_name && <span className="text-slate-400 ml-1">· Dr(a). {e.assigned_doctor_name}</span>}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {stage === 'triage' && (
                          <button className="btn-primary px-2 py-1 text-xs" onClick={() => setTriageFor(e)}><HeartPulse size={12} /> Medições</button>
                        )}
                        {stage === 'waiting_doctor' && (
                          <button className="btn-primary px-2 py-1 text-xs" onClick={() => goConsulta(e)}><Stethoscope size={12} /> Atender</button>
                        )}
                        {stage === 'in_consultation' && (<>
                          <button className="btn-primary px-2 py-1 text-xs" onClick={() => goConsulta(e)}><Stethoscope size={12} /> Continuar</button>
                          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => navigate(`/patients/${e.patient_id}/chart`)}>Prontuário</button>
                          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setConfirmDone(e)}><CheckCircle2 size={11} /> Concluir</button>
                        </>)}
                        {stage === 'medication' && (
                          <span className="text-xs text-slate-500 flex items-center gap-1"><Pill size={11} className="text-rose-400" /> Na enfermagem — conclui ao administrar</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

      <Modal open={open} onClose={() => setOpen(false)} title="Iniciar atendimento" size="md">
        <StartForm onDone={(patientId) => { setOpen(false); inv(); if (patientId) toast.success('Atendimento iniciado'); }} />
      </Modal>
      <Modal open={!!triageFor} onClose={() => setTriageFor(null)} title={`Triagem — ${triageFor?.patient_name ?? ''}`} size="md">
        {triageFor && <TriageForm encounterId={triageFor.id} onDone={() => { setTriageFor(null); inv(); }} />}
      </Modal>
      <Modal open={callOpen} onClose={() => setCallOpen(false)} title="Chamar próximo da fila" size="sm">
        <CallNextForm waiting={waitingCount} onDone={() => { setCallOpen(false); inv(); }} />
      </Modal>
      <ConfirmDialog
        open={!!confirmDone}
        title="Concluir atendimento?"
        message={`Encerrar o atendimento de ${confirmDone?.patient_name ?? 'paciente'}. Esta ação fecha o caso e não pode ser desfeita.`}
        loading={advMut.isPending}
        onCancel={() => setConfirmDone(null)}
        onConfirm={() => advMut.mutate({ id: confirmDone.id, stage: 'completed' }, { onSuccess: () => setConfirmDone(null) })}
      />
    </div>
  );
}

function StartForm({ onDone }: { onDone: (patientId?: string) => void }) {
  const [mode, setMode] = useState<'existing' | 'emergency'>('existing');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<any | null>(null);
  const [cc, setCc] = useState('');
  const [emg, setEmg] = useState({ cpf: '', cns: '', name: '', gender: 'O' });

  const searchQ = useQuery({
    queryKey: ['patients-search', search], enabled: mode === 'existing' && search.trim().length >= 2,
    queryFn: () => patientsApi.list({ q: search.trim(), limit: 8 }), select: (r) => (r.data as any).data as any[],
  });

  const mut = useMutation({
    mutationFn: () => mode === 'existing'
      ? ehrApi.startEpisode({ patient_id: picked.id, chief_complaint: cc || undefined })
      : ehrApi.startEpisode({ cpf: emg.cpf || undefined, cns: emg.cns || undefined, name: emg.name || undefined, gender: emg.gender, chief_complaint: cc || undefined }),
    onSuccess: (r: any) => onDone(r.data.data.patient_id),
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="space-y-3">
      <div className="flex border-b border-navy-800/50">
        <button className={`px-3 py-2 text-sm border-b-2 ${mode === 'existing' ? 'text-cyan-400 border-cyan-500' : 'text-slate-500 border-transparent'}`} onClick={() => setMode('existing')}><Search size={13} className="inline mr-1" /> Paciente existente</button>
        <button className={`px-3 py-2 text-sm border-b-2 ${mode === 'emergency' ? 'text-red-400 border-red-500' : 'text-slate-500 border-transparent'}`} onClick={() => setMode('emergency')}><AlertTriangle size={13} className="inline mr-1" /> Emergência</button>
      </div>

      {mode === 'existing' ? (
        <>
          {picked ? (
            <div className="flex items-center justify-between input">
              <span className="text-sm text-slate-200">{picked.name}{picked.medical_record_number ? ` · ${picked.medical_record_number}` : ''}</span>
              <button className="text-slate-500 hover:text-slate-200 text-xs" onClick={() => setPicked(null)}>trocar</button>
            </div>
          ) : (
            <Field label="Buscar paciente (nome/CPF)">
              <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Digite ao menos 2 caracteres…" />
              {search.trim().length >= 2 && (searchQ.data?.length ?? 0) > 0 && (
                <div className="mt-1 max-h-48 overflow-y-auto card p-1">
                  {searchQ.data!.map((p) => (
                    <button key={p.id} className="block w-full text-left px-2 py-1.5 text-xs text-slate-300 hover:bg-navy-800 rounded" onClick={() => setPicked(p)}>
                      {p.name}{p.medical_record_number ? ` · ${p.medical_record_number}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </Field>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-amber-300/80">Emergência: cadastro pendente, basta CPF ou Cartão SUS. Complete o cadastro depois.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CPF"><input className="input" value={emg.cpf} onChange={(e) => setEmg({ ...emg, cpf: e.target.value })} placeholder="só números" /></Field>
            <Field label="Cartão SUS (CNS)"><input className="input" value={emg.cns} onChange={(e) => setEmg({ ...emg, cns: e.target.value })} placeholder="15 dígitos" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nome (se souber)"><input className="input" value={emg.name} onChange={(e) => setEmg({ ...emg, name: e.target.value })} placeholder="Opcional" /></Field>
            <Field label="Sexo"><Select value={emg.gender} onChange={(e) => setEmg({ ...emg, gender: e.target.value })}><option value="O">Não informado</option><option value="M">Masculino</option><option value="F">Feminino</option></Select></Field>
          </div>
        </>
      )}

      <Field label="Queixa principal"><textarea className="input resize-none" rows={2} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Motivo do atendimento" /></Field>
      <div className="flex justify-end pt-2 border-t border-navy-700">
        <button className="btn-primary" disabled={mut.isPending || (mode === 'existing' ? !picked : !(emg.cpf || emg.cns))} onClick={() => mut.mutate()}>
          {mut.isPending ? <Spinner size={14} /> : <><UserPlus size={14} /> Iniciar <ArrowRight size={13} /></>}
        </button>
      </div>
    </div>
  );
}

function CallNextForm({ waiting, onDone }: { waiting: number; onDone: () => void }) {
  const [room, setRoom] = useState('');
  const mut = useMutation({
    mutationFn: () => ehrApi.callNext({ room_label: room.trim() || undefined }),
    onSuccess: (r: any) => {
      const d = r.data.data ?? {};
      const tk = d.ticket_number != null ? String(d.ticket_number).padStart(3, '0') : '';
      toast.success(`Ficha ${tk} chamada${d.room_label ? ` → ${d.room_label}` : ''}`);
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-300">
        Chama o próximo paciente aguardando médico (ordem: emergência → risco → chegada).
        {waiting > 0 ? <> Há <strong>{waiting}</strong> na fila.</> : <> Fila vazia no momento.</>}
      </p>
      <Field label="Consultório / sala (opcional)">
        <input className="input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Ex.: Consultório 2" autoFocus />
      </Field>
      <div className="flex justify-end pt-2 border-t border-navy-700">
        <button className="btn-primary" disabled={mut.isPending || waiting === 0} onClick={() => mut.mutate()}>
          {mut.isPending ? <Spinner size={14} /> : <><Megaphone size={14} /> Chamar próximo</>}
        </button>
      </div>
    </div>
  );
}

// Limites = MESMOS do schema do backend (vitalsBody) → feedback imediato em vez
// de "dados inválidos" genérico. `int` marca campos que não aceitam decimal.
const TRIAGE_FIELDS: { key: string; label: string; unit: string; min: number; max: number; int?: boolean }[] = [
  { key: 'systolic',     label: 'PA sistólica',  unit: 'mmHg', min: 0, max: 300, int: true },
  { key: 'diastolic',    label: 'PA diastólica', unit: 'mmHg', min: 0, max: 200, int: true },
  { key: 'heart_rate',   label: 'FC',            unit: 'bpm',  min: 0, max: 400, int: true },
  { key: 'resp_rate',    label: 'FR',            unit: 'irpm', min: 0, max: 120, int: true },
  { key: 'temp_c',       label: 'Temp.',         unit: '°C',   min: 20, max: 45 },
  { key: 'spo2',         label: 'SpO₂',          unit: '%',    min: 0, max: 100, int: true },
  { key: 'weight_kg',    label: 'Peso',          unit: 'kg',   min: 0, max: 500 },
  { key: 'glucose_mgdl', label: 'Glicemia',      unit: 'mg/dL', min: 0, max: 2000, int: true },
  { key: 'pain_scale',   label: 'Dor (0–10)',    unit: '',     min: 0, max: 10, int: true },
];
// Escala de dor visual: cor por intensidade (verde=sem dor → vermelho=pior dor).
const PAIN_COLOR = (n: number) =>
  n === 0 ? '#22c55e' : n <= 2 ? '#84cc16' : n <= 4 ? '#eab308'
  : n <= 6 ? '#f59e0b' : n <= 8 ? '#f97316' : n === 9 ? '#ef4444' : '#b91c1c';
function TriageForm({ encounterId, onDone }: { encounterId: string; onDone: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [manchester, setManchester] = useState('');

  // Valida no cliente com os limites do schema; retorna o corpo só se tudo ok.
  const buildBody = (): Record<string, number> | null => {
    const body: Record<string, number> = {};
    const e: Record<string, string> = {};
    for (const f of TRIAGE_FIELDS) {
      const raw = vals[f.key];
      if (raw === undefined || raw === '') continue;
      const n = Number(raw);
      if (Number.isNaN(n))            e[f.key] = 'Número inválido';
      else if (f.int && !Number.isInteger(n)) e[f.key] = 'Use número inteiro';
      else if (n < f.min || n > f.max) e[f.key] = `Entre ${f.min} e ${f.max}`;
      else body[f.key] = n;
    }
    if (Object.keys(body).length === 0 && Object.keys(e).length === 0) {
      toast.error('Preencha ao menos uma medição.');
      return null;
    }
    setErrs(e);
    if (Object.keys(e).length) { toast.error('Corrija os campos destacados.'); return null; }
    return body;
  };

  const mut = useMutation({
    mutationFn: (body: Record<string, number | string>) => ehrApi.triage(encounterId, body),
    onSuccess: () => { toast.success('Triagem registrada — paciente na fila médica'); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const submit = () => {
    const body = buildBody();
    if (body) mut.mutate({ ...body, ...(manchester ? { manchester_level: manchester } : {}) });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {TRIAGE_FIELDS.filter((f) => f.key !== 'pain_scale').map(({ key, label, unit, min, max, int }) => (
          <Field key={key} label={`${label}${unit ? ` (${unit})` : ''}`}>
            <input
              className={`input ${errs[key] ? 'border-red-500/70' : ''}`}
              type="number" step={int ? '1' : '0.1'} min={min} max={max}
              value={vals[key] ?? ''}
              onChange={(e) => { setVals((p) => ({ ...p, [key]: e.target.value })); if (errs[key]) setErrs((p) => { const n = { ...p }; delete n[key]; return n; }); }}
            />
            <p className={`text-[10px] mt-0.5 ${errs[key] ? 'text-red-400' : 'text-slate-600'}`}>{errs[key] ?? `${min}–${max}`}</p>
          </Field>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-sm text-slate-300">Escala de dor (0–10)</p>
          {vals.pain_scale != null && vals.pain_scale !== '' && (
            <button type="button" className="text-[11px] text-slate-500 hover:text-slate-300" onClick={() => setVals((p) => { const n = { ...p }; delete n.pain_scale; return n; })}>limpar</button>
          )}
        </div>
        <div className="flex gap-1">
          {Array.from({ length: 11 }, (_, n) => {
            const active = vals.pain_scale === String(n);
            const chosen = vals.pain_scale != null && vals.pain_scale !== '';
            return (
              <button
                key={n} type="button" aria-label={`Dor ${n}`} aria-pressed={active}
                onClick={() => setVals((p) => ({ ...p, pain_scale: active ? '' : String(n) }))}
                className={`flex-1 h-9 rounded text-sm font-bold text-white transition ${active ? 'ring-2 ring-white scale-110 shadow-lg' : 'hover:brightness-110'}`}
                style={{ background: PAIN_COLOR(n), opacity: chosen && !active ? 0.4 : 1 }}
              >{n}</button>
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 mt-1 px-0.5">
          <span>Sem dor</span><span>Leve</span><span>Moderada</span><span>Intensa</span><span>Pior dor</span>
        </div>
      </div>
      {/* Classificação de risco (Manchester) — define a prioridade na fila médica */}
      <div>
        <p className="text-sm text-slate-300 mb-1.5">Classificação de risco (Manchester)</p>
        <div className="grid grid-cols-5 gap-1.5">
          {MANCHESTER.map((m) => {
            const active = manchester === m.key;
            return (
              <button key={m.key} type="button" aria-pressed={active}
                onClick={() => setManchester(active ? '' : m.key)}
                className={`rounded p-1.5 text-center border transition ${active ? 'ring-2 ring-white scale-105' : 'opacity-80 hover:opacity-100'}`}
                style={{ background: `${m.color}22`, borderColor: m.color }}>
                <span className="block w-4 h-4 rounded-full mx-auto mb-1" style={{ background: m.color }} />
                <span className="block text-[10px] text-slate-200 leading-tight">{m.label}</span>
                <span className="block text-[9px] text-slate-500">{m.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-navy-700">
        <button className="btn-primary" disabled={mut.isPending} onClick={submit}>
          {mut.isPending ? <Spinner size={14} /> : <>Registrar e enviar à fila médica <ArrowRight size={13} /></>}
        </button>
      </div>
    </div>
  );
}
