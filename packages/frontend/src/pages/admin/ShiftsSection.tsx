import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus, Trash2, Users2, Sun, Sunset, Moon } from 'lucide-react';
import { healthUnitsApi } from '../../api/endpoints';
import { Field, Spinner } from '../../components/ui';
import { toast } from '../../components/ui/Toast';
import { getErrorMessage } from '../../utils/format';

const ROLE_LABEL: Record<string, string> = {
  receptionist: 'Recepção', technician: 'Técnico', radiologist: 'Radiologista', doctor: 'Médico', admin: 'Admin',
};
const PRESETS = [
  { label: 'Manhã', icon: Sun,    start: '07:00', end: '12:00' },
  { label: 'Tarde', icon: Sunset, start: '13:00', end: '18:00' },
  { label: 'Noite', icon: Moon,   start: '18:00', end: '22:00' },
];

/**
 * Turnos da unidade + atribuição de equipe. O gestor cria turnos nomeados
 * (horários livres; presets ajudam) e marca quais funcionários trabalham em cada.
 */
export default function ShiftsSection({ unitId }: { unitId: string }) {
  const qc = useQueryClient();

  const { data: shifts = [], isLoading: loadingShifts } = useQuery({
    queryKey: ['unit-shifts', unitId],
    queryFn:  () => healthUnitsApi.shifts(unitId).then(r => (r.data as any).data as any[]),
    enabled:  !!unitId,
  });
  const { data: staff = [] } = useQuery({
    queryKey: ['unit-staff', unitId],
    queryFn:  () => healthUnitsApi.staff(unitId).then(r => (r.data as any).data as any[]),
    enabled:  !!unitId,
  });

  const [nf, setNf] = useState({ name: '', start_time: '07:00', end_time: '12:00' });

  const createShift = useMutation({
    mutationFn: () => healthUnitsApi.createShift(unitId, nf),
    onSuccess:  () => { setNf({ name: '', start_time: '07:00', end_time: '12:00' }); qc.invalidateQueries({ queryKey: ['unit-shifts', unitId] }); },
    onError:    (e) => toast.error(getErrorMessage(e)),
  });
  const delShift = useMutation({
    mutationFn: (id: string) => healthUnitsApi.deleteShift(unitId, id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['unit-shifts', unitId] }); qc.invalidateQueries({ queryKey: ['unit-staff', unitId] }); },
  });
  const setUserShifts = useMutation({
    mutationFn: ({ userId, ids }: { userId: string; ids: string[] }) => healthUnitsApi.setUserShifts(unitId, userId, ids),
    onSuccess:  () => { toast.success('Turnos do funcionário atualizados'); qc.invalidateQueries({ queryKey: ['unit-staff', unitId] }); },
    onError:    (e) => toast.error(getErrorMessage(e)),
  });

  const applyPreset = (p: typeof PRESETS[number]) =>
    setNf(f => ({ name: f.name || p.label, start_time: p.start, end_time: p.end }));

  const toggleUserShift = (u: any, shiftId: string) => {
    const cur: string[] = u.shift_ids ?? [];
    const next = cur.includes(shiftId) ? cur.filter(x => x !== shiftId) : [...cur, shiftId];
    setUserShifts.mutate({ userId: u.id, ids: next });
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="font-display font-semibold text-slate-100 text-sm flex items-center gap-2 mb-3">
          <Clock size={15} className="text-cyan-400" /> Turnos de trabalho
        </h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESETS.map(p => (
            <button key={p.label} type="button" onClick={() => applyPreset(p)}
              className="btn-ghost text-xs px-2 py-1"><p.icon size={12} /> {p.label}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <Field label="Nome do turno">
            <input className="input" value={nf.name} onChange={e => setNf({ ...nf, name: e.target.value })} placeholder="Ex: Manhã, Plantão A…" />
          </Field>
          <Field label="Início">
            <input type="time" className="input" value={nf.start_time} onChange={e => setNf({ ...nf, start_time: e.target.value })} />
          </Field>
          <Field label="Fim">
            <input type="time" className="input" value={nf.end_time} onChange={e => setNf({ ...nf, end_time: e.target.value })} />
          </Field>
          <button className="btn-primary" disabled={!nf.name.trim() || createShift.isPending} onClick={() => createShift.mutate()}>
            {createShift.isPending ? <Spinner size={14} /> : <><Plus size={14} /> Criar turno</>}
          </button>
        </div>

        {loadingShifts ? (
          <div className="flex justify-center py-4"><Spinner size={18} /></div>
        ) : shifts.length === 0 ? (
          <p className="text-xs text-slate-500 mt-3">Nenhum turno criado ainda.</p>
        ) : (
          <div className="flex flex-wrap gap-2 mt-3">
            {shifts.map(s => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-navy-700 bg-navy-900/40 px-3 py-1.5 text-sm">
                <span className="text-slate-200 font-medium">{s.name}</span>
                <span className="text-xs text-slate-500 font-mono">{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}</span>
                <span className="text-[10px] text-slate-600">· {s.member_count} pessoa(s)</span>
                <button className="text-slate-600 hover:text-red-400" onClick={() => delShift.mutate(s.id)} title="Remover turno"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-4">
        <h3 className="font-display font-semibold text-slate-100 text-sm flex items-center gap-2 mb-1">
          <Users2 size={15} className="text-cyan-400" /> Equipe da unidade
        </h3>
        <p className="text-xs text-slate-600 mb-3">Marque os turnos de cada funcionário.</p>
        {staff.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhum funcionário lotado nesta unidade.</p>
        ) : shifts.length === 0 ? (
          <p className="text-xs text-slate-500">Crie ao menos um turno para atribuir à equipe.</p>
        ) : (
          <div className="space-y-2">
            {staff.map(u => (
              <div key={u.id} className="flex flex-wrap items-center gap-2 border-b border-navy-800/40 pb-2">
                <div className="min-w-[180px]">
                  <span className="text-sm text-slate-200">{u.name}</span>
                  <span className="text-[10px] text-slate-500 ml-2 uppercase tracking-wide">{ROLE_LABEL[u.role] ?? u.role}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {shifts.map(s => {
                    const on = (u.shift_ids ?? []).includes(s.id);
                    return (
                      <button key={s.id} type="button" onClick={() => toggleUserShift(u, s.id)}
                        className={`px-2 py-1 rounded text-xs border transition-colors ${
                          on ? 'border-cyan-700/50 bg-cyan-900/30 text-cyan-300' : 'border-navy-700 text-slate-500 hover:border-navy-500'}`}>
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
