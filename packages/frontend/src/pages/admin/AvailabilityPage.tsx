import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Trash2, CalendarOff, FlaskConical, Save } from 'lucide-react';
import { healthUnitsApi, availabilityApi } from '../../api/endpoints';
import { SectionHeader, Field, Select, Spinner, Alert, EmptyState } from '../../components/ui';
import { getErrorMessage, modalityLabel } from '../../utils/format';
import { toast } from '../../components/ui/Toast';

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/**
 * Gestão de disponibilidade da agenda.
 * - Sem `fixedUnitId`: mostra seletor de unidade (uso standalone, legado).
 * - Com `fixedUnitId`: opera só naquela unidade, sem seletor nem SectionHeader
 *   (embutida na página de gestão da unidade — /admin/units/:id).
 */
export default function AvailabilityPage({ fixedUnitId, embedded }: { fixedUnitId?: string; embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const year = new Date().getFullYear();

  const { data: units = [] } = useQuery({
    queryKey: ['hu-list'],
    queryFn:  () => healthUnitsApi.list().then(r => (r.data as any).data as any[]),
    enabled:  !fixedUnitId,
  });
  const [selUnitId, setUnitId] = useState('');
  const unitId = fixedUnitId ?? selUnitId;
  useEffect(() => { if (!fixedUnitId && !selUnitId && units.length) setUnitId(units[0].id); }, [units, selUnitId, fixedUnitId]);

  const { data: rules = [], isLoading: loadingRules } = useQuery({
    queryKey: ['avail-rules', unitId],
    queryFn:  () => availabilityApi.listRules(unitId).then(r => (r.data as any).data as any[]),
    enabled:  !!unitId,
  });
  const { data: holidays = [] } = useQuery({
    queryKey: ['avail-holidays', unitId, year],
    queryFn:  () => availabilityApi.listHolidays({ health_unit_id: unitId, year }).then(r => (r.data as any).data as any[]),
    enabled:  !!unitId,
  });

  const { data: procData, isLoading: loadingProcs } = useQuery({
    queryKey: ['unit-procedures', unitId],
    queryFn:  () => healthUnitsApi.procedures(unitId).then(r => (r.data as any).data),
    enabled:  !!unitId,
  });
  type ProcCfg = { offered: boolean; weekdays: number[]; start_time: string; end_time: string };
  const [procCfg, setProcCfg] = useState<Record<string, ProcCfg>>({});
  useEffect(() => {
    if (!procData) return;
    const cfg: Record<string, ProcCfg> = {};
    for (const p of procData.procedures as any[]) {
      cfg[p.id] = {
        offered:   !!p.offered,
        weekdays:  Array.isArray(p.weekdays) ? p.weekdays : [],
        start_time: p.start_time ?? '',
        end_time:   p.end_time ?? '',
      };
    }
    setProcCfg(cfg);
  }, [procData]);
  const procList: any[] = procData?.procedures ?? [];
  const offeredCount = Object.values(procCfg).filter(c => c.offered).length;
  const patchProc = (id: string, patch: Partial<ProcCfg>) =>
    setProcCfg(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const toggleWeekday = (id: string, d: number) => setProcCfg(prev => {
    const cur = prev[id]?.weekdays ?? [];
    const next = cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d].sort();
    return { ...prev, [id]: { ...prev[id], weekdays: next } };
  });
  const saveProcs = useMutation({
    mutationFn: () => healthUnitsApi.setProcedures(unitId,
      Object.entries(procCfg).filter(([, c]) => c.offered).map(([procedure_id, c]) => ({
        procedure_id,
        weekdays:   c.weekdays,
        start_time: c.start_time || null,
        end_time:   c.end_time || null,
      }))),
    onSuccess:  () => { toast.success('Procedimentos da unidade atualizados'); qc.invalidateQueries({ queryKey: ['unit-procedures', unitId] }); },
    onError:    (e) => toast.error(getErrorMessage(e)),
  });

  const [nr, setNr] = useState({ weekday: 1, start_time: '08:00', end_time: '12:00', slot_minutes: 30, capacity: 1 });
  const [nh, setNh] = useState({ holiday_date: '', description: '' });
  const [err, setErr] = useState('');

  const createRule = useMutation({
    mutationFn: () => availabilityApi.createRule({
      health_unit_id: unitId, weekday: Number(nr.weekday),
      start_time: nr.start_time, end_time: nr.end_time,
      slot_minutes: Number(nr.slot_minutes), capacity: Number(nr.capacity),
    }),
    onSuccess: () => { setErr(''); qc.invalidateQueries({ queryKey: ['avail-rules', unitId] }); },
    onError:   (e) => setErr(getErrorMessage(e)),
  });
  const delRule = useMutation({
    mutationFn: (id: string) => availabilityApi.deleteRule(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['avail-rules', unitId] }),
  });
  const createHoliday = useMutation({
    mutationFn: () => availabilityApi.createHoliday({ health_unit_id: unitId, holiday_date: nh.holiday_date, description: nh.description }),
    onSuccess:  () => { setErr(''); setNh({ holiday_date: '', description: '' }); qc.invalidateQueries({ queryKey: ['avail-holidays', unitId, year] }); },
    onError:    (e) => setErr(getErrorMessage(e)),
  });
  const delHoliday = useMutation({
    mutationFn: (id: string) => availabilityApi.deleteHoliday(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['avail-holidays', unitId, year] }),
  });

  const rulesByDay = (d: number) => rules.filter(r => r.weekday === d).sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <div className="space-y-6 animate-fade-in">
      {!embedded && (
        <SectionHeader
          title="Disponibilidade da Agenda"
          subtitle="Horários de atendimento, capacidade e feriados por unidade"
        />
      )}

      {err && <Alert message={err} onClose={() => setErr('')} />}

      {/* Seletor de unidade — só no modo standalone */}
      {!fixedUnitId && (
        <div className="flex items-center gap-3">
          <CalendarClock size={16} className="text-cyan-400" />
          <Select value={unitId} onChange={e => setUnitId(e.target.value)} className="max-w-xs">
            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-4">
            <h3 className="font-display font-semibold text-slate-100 mb-3 text-sm">Nova janela de atendimento</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
              <Field label="Dia">
                <Select value={nr.weekday} onChange={e => setNr({ ...nr, weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((w, i) => <option key={i} value={i}>{w}</option>)}
                </Select>
              </Field>
              <Field label="Início">
                <input type="time" className="input" value={nr.start_time} onChange={e => setNr({ ...nr, start_time: e.target.value })} />
              </Field>
              <Field label="Fim">
                <input type="time" className="input" value={nr.end_time} onChange={e => setNr({ ...nr, end_time: e.target.value })} />
              </Field>
              <Field label="Slot (min)">
                <input type="number" min={5} max={240} className="input" value={nr.slot_minutes} onChange={e => setNr({ ...nr, slot_minutes: Number(e.target.value) })} />
              </Field>
              <Field label="Capacidade">
                <input type="number" min={1} max={50} className="input" value={nr.capacity} onChange={e => setNr({ ...nr, capacity: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="flex justify-end mt-3">
              <button className="btn-primary" disabled={createRule.isPending || !unitId} onClick={() => createRule.mutate()}>
                {createRule.isPending ? <Spinner size={14} /> : <><Plus size={14} /> Adicionar janela</>}
              </button>
            </div>
          </div>

          {loadingRules ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-24 rounded-lg" />)}
            </div>
          ) : rules.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Sem janelas configuradas" description="Sem regras, o agendamento livre permanece (comportamento padrão)." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {WEEKDAYS.map((w, d) => {
                const dayRules = rulesByDay(d);
                if (!dayRules.length) return null;
                return (
                  <div key={d} className="card p-3">
                    <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wide mb-2">{w}</p>
                    <div className="space-y-2">
                      {dayRules.map(r => (
                        <div key={r.id} className="flex items-center justify-between text-sm bg-navy-800/40 rounded-lg px-3 py-2">
                          <div>
                            <span className="text-slate-200 font-mono">{r.start_time.slice(0,5)}–{r.end_time.slice(0,5)}</span>
                            <span className="text-slate-500 text-xs ml-2">{r.slot_minutes}min · cap {r.capacity}</span>
                          </div>
                          <button className="text-slate-600 hover:text-red-400" onClick={() => delRule.mutate(r.id)} title="Remover">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="font-display font-semibold text-slate-100 mb-3 text-sm flex items-center gap-2">
              <CalendarOff size={15} className="text-amber-400" /> Feriados {year}
            </h3>
            <div className="space-y-3">
              <Field label="Data">
                <input type="date" className="input" value={nh.holiday_date} onChange={e => setNh({ ...nh, holiday_date: e.target.value })} />
              </Field>
              <Field label="Descrição">
                <input className="input" placeholder="Ex: Aniversário da cidade" value={nh.description} onChange={e => setNh({ ...nh, description: e.target.value })} />
              </Field>
              <button className="btn-primary w-full justify-center" disabled={createHoliday.isPending || !nh.holiday_date || !unitId} onClick={() => createHoliday.mutate()}>
                {createHoliday.isPending ? <Spinner size={14} /> : <><Plus size={14} /> Adicionar feriado</>}
              </button>
            </div>
          </div>

          <div className="card overflow-hidden">
            {holidays.length === 0 ? (
              <p className="text-slate-500 text-xs px-4 py-6 text-center">Nenhum feriado cadastrado</p>
            ) : holidays.map(h => (
              <div key={h.id} className="flex items-center justify-between px-4 py-2.5 border-b border-navy-800/40 text-sm">
                <div>
                  <span className="text-slate-200 font-mono">{new Date(h.holiday_date + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                  {h.description && <span className="text-slate-500 text-xs ml-2">{h.description}</span>}
                  {!h.health_unit_id && <span className="badge badge-info ml-2 text-[10px]">global</span>}
                </div>
                <button className="text-slate-600 hover:text-red-400" onClick={() => delHoliday.mutate(h.id)} title="Remover">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-display font-semibold text-slate-100 text-sm flex items-center gap-2">
            <FlaskConical size={15} className="text-cyan-400" /> Procedimentos oferecidos
          </h3>
          <button className="btn-primary" disabled={saveProcs.isPending || !unitId} onClick={() => saveProcs.mutate()}>
            {saveProcs.isPending ? <Spinner size={14} /> : <><Save size={14} /> Salvar</>}
          </button>
        </div>
        <p className="text-xs text-slate-600 mb-3">
          Marque os exames que esta unidade realiza e defina os dias/horários. {offeredCount === 0
            ? 'Nada marcado = a unidade oferece TODOS os procedimentos (sem restrição de dia/horário).'
            : `${offeredCount} selecionado(s).`}
        </p>
        {loadingProcs ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {procList.map(p => {
              const c = procCfg[p.id] ?? { offered: false, weekdays: [], start_time: '', end_time: '' };
              return (
                <div key={p.id}
                  className={`rounded-lg border transition-colors ${
                    c.offered ? 'border-cyan-700/50 bg-cyan-900/15' : 'border-navy-700 bg-navy-900/40'}`}>
                  <label className="flex items-center gap-2 px-3 py-2 cursor-pointer text-sm">
                    <input type="checkbox" checked={c.offered} onChange={() => patchProc(p.id, { offered: !c.offered })} className="accent-cyan-500" />
                    <span className="flex-1 min-w-0">
                      <span className="text-slate-200 truncate block">{p.name}</span>
                      <span className="text-[10px] text-slate-500">{modalityLabel[p.modality_type] ?? p.modality_type ?? '—'} · {p.duration_minutes}min</span>
                    </span>
                  </label>

                  {c.offered && (
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-navy-800/40">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wide">Dias da semana</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {WEEKDAYS.map((w, d) => (
                            <button key={d} type="button" onClick={() => toggleWeekday(p.id, d)}
                              className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                                c.weekdays.includes(d)
                                  ? 'border-cyan-700/50 bg-cyan-900/30 text-cyan-300'
                                  : 'border-navy-700 text-slate-500 hover:border-navy-500'}`}>
                              {w.slice(0, 3)}
                            </button>
                          ))}
                        </div>
                        <span className="text-[10px] text-slate-600">{c.weekdays.length === 0 ? 'Nenhum marcado = todos os dias' : ''}</span>
                      </div>
                      <div className="flex items-end gap-2">
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase tracking-wide block">Início</span>
                          <input type="time" className="input py-1 text-sm w-28" value={c.start_time}
                            onChange={e => patchProc(p.id, { start_time: e.target.value })} />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 uppercase tracking-wide block">Fim</span>
                          <input type="time" className="input py-1 text-sm w-28" value={c.end_time}
                            onChange={e => patchProc(p.id, { end_time: e.target.value })} />
                        </div>
                        {(c.start_time || c.end_time) && (
                          <button type="button" className="text-[11px] text-slate-500 hover:text-slate-300 pb-1.5"
                            onClick={() => patchProc(p.id, { start_time: '', end_time: '' })}>limpar</button>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-600">Horário vazio = segue as janelas gerais de atendimento.</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
