import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pill, Syringe, CheckCircle2, Ban, Clock, AlertTriangle, Plus, X } from 'lucide-react';
import { ehrApi } from '../../api/endpoints';
import { Spinner, Modal, Field, Select, EmptyState } from '../../components/ui';
import { toast } from '../../components/ui/Toast';
import { formatDateTime, getErrorMessage } from '../../utils/format';

// Status de cada horário aprazado, calculado no fuso do navegador (= do enfermeiro).
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const slotStatus = (idx: number, time: string, doneCount: number): 'done' | 'overdue' | 'pending' =>
  idx < doneCount ? 'done' : (toMinutes(time) <= nowMinutes() ? 'overdue' : 'pending');

const sel = (r: any) => (r.data as any).data as any[];

// Motivos estruturados da não-administração/recusa (espelham REFUSAL_REASONS do backend).
const REFUSAL_REASONS: [string, string][] = [
  ['patient_refused', 'Paciente recusou'],
  ['patient_absent', 'Paciente ausente'],
  ['fasting', 'Jejum / NPO'],
  ['clinical_change', 'Mudança clínica / contraindicação'],
  ['not_available', 'Medicamento indisponível'],
  ['intolerance', 'Intolerância / vômito'],
  ['medical_order', 'Suspenso por ordem médica'],
  ['other', 'Outro (detalhar na observação)'],
];

export default function MedicacaoPage() {
  const qc = useQueryClient();
  const [target, setTarget] = useState<any | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<any | null>(null);
  const q = useQuery({ queryKey: ['ehr-med-queue'], queryFn: () => ehrApi.medicationQueue(), select: sel, refetchInterval: 20_000 });
  // Doses aprazadas de hoje — refetch curto p/ o status de atraso atualizar.
  const sched = useQuery({ queryKey: ['ehr-med-schedule'], queryFn: () => ehrApi.medicationSchedule(), select: sel, refetchInterval: 60_000 });
  const invAll = () => { qc.invalidateQueries({ queryKey: ['ehr-med-queue'] }); qc.invalidateQueries({ queryKey: ['ehr-med-schedule'] }); };

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(244,63,94,0.12)', color: '#f43f5e' }}>
          <Syringe size={18} />
        </div>
        <div>
          <h1 className="font-display font-bold text-xl text-slate-100">Medicação na unidade</h1>
          <p className="text-slate-500 text-sm">Medicamentos prescritos para administrar no local (enfermagem)</p>
        </div>
      </header>

      {(sched.data?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Clock size={13} /> Doses de hoje (aprazadas)</h2>
          {sched.data!.map((m) => {
            const times: string[] = m.scheduled_times ?? [];
            const overdue = times.some((t, i) => slotStatus(i, t, m.done_count) === 'overdue');
            return (
              <div key={m.item_id} className={`card px-4 py-3 ${overdue ? 'border-red-700/50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-200">{m.drug_name}{m.dose ? ` · ${m.dose}` : ''}{m.route ? <span className="text-slate-500"> · {m.route}</span> : ''}
                      {overdue && <span className="badge badge-danger text-xs ml-2"><AlertTriangle size={9} /> Dose atrasada</span>}</p>
                    <p className="text-xs text-slate-500">{m.patient_name}{m.mrn ? ` · ${m.mrn}` : ''}</p>
                  </div>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setScheduleTarget(m)}><Clock size={12} /> Horários</button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {times.map((t, i) => {
                    const st = slotStatus(i, t, m.done_count);
                    const cls = st === 'overdue' ? 'border-red-600 text-red-300 bg-red-500/10'
                      : st === 'done' ? 'border-emerald-700/50 text-emerald-300 bg-emerald-500/5'
                      : 'border-navy-600 text-slate-400';
                    return (
                      <button key={i} disabled={st === 'done'} onClick={() => st !== 'done' && setTarget(m)}
                        className={`text-xs px-2 py-1 rounded border flex items-center gap-1 ${cls} ${st === 'done' ? 'cursor-default' : 'hover:brightness-110'}`}>
                        {st === 'done' ? <CheckCircle2 size={11} /> : st === 'overdue' ? <AlertTriangle size={11} /> : <Clock size={11} />} {t}{st === 'overdue' ? ' · atrasada' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Pill size={13} /> Fila de administração</h2>
      {q.isLoading ? <div className="p-8 text-center"><Spinner /></div>
        : !(q.data?.length) ? <EmptyState icon={Pill} title="Nada para administrar" description="Itens marcados como 'administrar na unidade' em prescrições assinadas aparecem aqui." />
        : (
          <div className="space-y-2">
            {q.data!.map((m) => (
              <div key={m.item_id} className="card flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200">{m.drug_name}{m.dose ? ` · ${m.dose}` : ''}
                    {m.route ? <span className="text-slate-500"> · {m.route}</span> : ''}</p>
                  <p className="text-xs text-slate-500">{m.patient_name}{m.mrn ? ` · ${m.mrn}` : ''} · prescrito por {m.prescriber_name ?? '—'} · {formatDateTime(m.created_at)}</p>
                </div>
                <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => setScheduleTarget(m)}><Clock size={13} /> Aprazar</button>
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setTarget(m)}><CheckCircle2 size={13} /> Administrar</button>
              </div>
            ))}
          </div>
        )}

      <Modal open={!!target} onClose={() => setTarget(null)} title="Registrar administração" size="md">
        {target && <AdministerForm item={target} onDone={() => { setTarget(null); invAll(); }} />}
      </Modal>
      <Modal open={!!scheduleTarget} onClose={() => setScheduleTarget(null)} title="Aprazamento (horários da dose)" size="sm">
        {scheduleTarget && <ScheduleForm item={scheduleTarget} onDone={() => { setScheduleTarget(null); invAll(); }} />}
      </Modal>
    </div>
  );
}

function ScheduleForm({ item, onDone }: { item: any; onDone: () => void }) {
  const [times, setTimes] = useState<string[]>(item.scheduled_times ?? []);
  const [t, setT] = useState('08:00');
  const add = () => { if (/^\d{2}:\d{2}$/.test(t) && !times.includes(t)) setTimes([...times, t].sort()); };
  const mut = useMutation({
    mutationFn: () => ehrApi.setItemSchedule(item.item_id, times),
    onSuccess: () => { toast.success('Aprazamento salvo'); onDone(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-300"><strong>{item.drug_name}</strong>{item.dose ? ` · ${item.dose}` : ''} — {item.patient_name}</p>
      <div className="flex items-end gap-2">
        <Field label="Adicionar horário"><input type="time" className="input" value={t} onChange={(e) => setT(e.target.value)} /></Field>
        <button className="btn-ghost h-[42px]" onClick={add}><Plus size={14} /> Add</button>
      </div>
      {times.length ? (
        <div className="flex flex-wrap gap-1.5">
          {times.map((tt) => (
            <span key={tt} className="text-xs px-2 py-1 rounded border border-navy-600 text-slate-300 flex items-center gap-1">
              <Clock size={11} /> {tt}
              <button className="text-slate-500 hover:text-red-400" onClick={() => setTimes(times.filter((x) => x !== tt))}><X size={11} /></button>
            </span>
          ))}
        </div>
      ) : <p className="text-xs text-slate-500">Nenhum horário — a dose fica na fila avulsa (dose única).</p>}
      <div className="flex justify-end pt-2 border-t border-navy-700">
        <button className="btn-primary" disabled={mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? <Spinner size={14} /> : 'Salvar aprazamento'}</button>
      </div>
    </div>
  );
}

// "5 certos" da medicação — gate de segurança antes de administrar (#5 Nível 4).
const FIVE_RIGHTS: [string, string][] = [
  ['patient', 'Paciente certo (identidade conferida)'],
  ['drug', 'Medicamento certo'],
  ['dose', 'Dose certa'],
  ['route', 'Via certa'],
  ['time', 'Hora certa'],
];
function AdministerForm({ item, onDone }: { item: any; onDone: () => void }) {
  const [f, setF] = useState({ dose: item.dose ?? '', route: item.route ?? '', site: '', status: 'administered', refusal_reason: '', notes: '' });
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const notAdministered = f.status !== 'administered';
  // Os 5 certos só são exigidos quando vai ADMINISTRAR (recusa não precisa).
  const allChecked = FIVE_RIGHTS.every(([k]) => checks[k]);
  const fiveRightsOk = notAdministered || allChecked;
  const mut = useMutation({
    mutationFn: () => ehrApi.administerMedication({
      prescription_item_id: item.item_id, patient_id: item.patient_id, encounter_id: item.encounter_id || undefined,
      drug_name: item.drug_name, dose: f.dose || undefined, route: f.route || undefined, site: f.site || undefined,
      status: f.status, refusal_reason: notAdministered ? (f.refusal_reason || undefined) : undefined, notes: f.notes || undefined,
      patient_verified: !notAdministered && !!checks.patient,
    }),
    onSuccess: (res: any) => {
      const d = (res.data as any).data ?? {};
      if (d.returned_to_doctor) toast.success('Registrado — paciente retornado ao médico para decidir a conduta');
      else if (d.completed)     toast.success('Medicação administrada — atendimento concluído');
      else                      toast.success('Medicação registrada (MAR)');
      onDone();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-300"><strong>{item.drug_name}</strong> — {item.patient_name}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dose"><input className="input" value={f.dose} onChange={(e) => setF({ ...f, dose: e.target.value })} /></Field>
        <Field label="Via"><input className="input" value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })} placeholder="EV / IM / VO" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Local"><input className="input" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} placeholder="Ex.: MSD" /></Field>
        <Field label="Situação"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="administered">Administrado</option><option value="refused">Recusado</option><option value="not_administered">Não administrado</option></Select></Field>
      </div>
      {notAdministered && (
        <Field label="Motivo da não-administração" required>
          <Select value={f.refusal_reason} onChange={(e) => setF({ ...f, refusal_reason: e.target.value })}>
            <option value="">Selecione…</option>
            {REFUSAL_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
      )}
      <Field label="Observação"><textarea className="input resize-none" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>

      {!notAdministered && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-2.5 space-y-1.5">
          <p className="text-xs font-semibold text-amber-300 flex items-center gap-1"><AlertTriangle size={12} /> Confirme os 5 certos da medicação</p>
          {FIVE_RIGHTS.map(([k, lbl]) => (
            <label key={k} className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={!!checks[k]} onChange={(e) => setChecks((p) => ({ ...p, [k]: e.target.checked }))} /> {lbl}
            </label>
          ))}
          <p className="text-[10px] text-slate-500 pl-5">Paciente: <strong className="text-slate-300">{item.patient_name}</strong>{item.mrn ? ` · ${item.mrn}` : ''}</p>
        </div>
      )}

      <div className="flex justify-end pt-2 border-t border-navy-700">
        <button className={f.status === 'administered' ? 'btn-primary' : 'btn-danger'} disabled={mut.isPending || (notAdministered && !f.refusal_reason) || !fiveRightsOk} onClick={() => mut.mutate()}>
          {mut.isPending ? <Spinner size={14} /> : (f.status === 'administered' ? <><CheckCircle2 size={14} /> Confirmar administração</> : <><Ban size={14} /> Registrar não-administração</>)}
        </button>
      </div>
    </div>
  );
}
