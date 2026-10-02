import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pill, PackagePlus, Search, AlertTriangle, ArrowDownUp, History, PackageMinus, UserSearch, ClipboardList } from 'lucide-react';
import { pharmacyApi, patientsApi, ehrApi } from '../../api/endpoints';
import { Spinner } from '../../components/ui';
import { toast } from '../../components/ui/Toast';
import { getErrorMessage } from '../../utils/format';
import { useAuthStore } from '../../stores/authStore';

const sel = (r: any) => (r.data as any).data;
const fmtDate = (d?: string) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');

export default function FarmaciaPage() {
  const can = useAuthStore((s) => s.can);
  const [tab, setTab] = useState<'estoque' | 'dispensar'>('estoque');
  // Dispensar exige pharmacy:dispense (enfermagem); recepção/técnico só gerem estoque
  const canDispense = can('pharmacy:dispense') && can('prescription:read');

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-accent-subtle)', color: 'var(--cyan-500)' }}>
          <Pill size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-xl text-slate-100">Farmácia</h1>
          <p className="text-slate-500 text-sm">Estoque da unidade · dispensação ligada à prescrição</p>
        </div>
      </header>

      <div className="flex gap-1 border-b border-navy-700">
        <TabBtn active={tab === 'estoque'} onClick={() => setTab('estoque')} icon={ArrowDownUp} label="Estoque" />
        {canDispense && <TabBtn active={tab === 'dispensar'} onClick={() => setTab('dispensar')} icon={PackageMinus} label="Dispensação" />}
      </div>

      {tab === 'estoque' ? <EstoqueTab /> : <DispensarTab />}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${active ? 'border-cyan-500 text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
      <Icon size={14} /> {label}
    </button>
  );
}

function EstoqueTab() {
  const qc = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [movesFor, setMovesFor] = useState<any | null>(null);

  const stock = useQuery({
    queryKey: ['pharm-stock', q, low],
    queryFn: () => pharmacyApi.stock({ q: q || undefined, low: low ? '1' : undefined }),
    select: sel,
  });
  const canStock = can('pharmacy:stock');

  const move = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => pharmacyApi.movement(id, body),
    onSuccess: () => { toast.success('Movimento registrado'); qc.invalidateQueries({ queryKey: ['pharm-stock'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const quickOut = (s: any) => {
    const v = window.prompt(`Saída de "${s.drug_name}" (saldo ${s.quantity} ${s.unit_label}). Quantidade:`, '1');
    if (!v) return;
    const n = Number(v.replace(',', '.'));
    if (!(n > 0)) return toast.error('Quantidade inválida');
    move.mutate({ id: s.id, body: { movement_type: 'out', quantity: n, reason: 'Saída manual' } });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-8 w-full" placeholder="Buscar medicamento…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="text-xs text-slate-400 flex items-center gap-1.5 cursor-pointer select-none">
          <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Só estoque baixo
        </label>
        {canStock && <button className="btn-primary" onClick={() => setShowAdd(true)}><PackagePlus size={14} /> Entrada</button>}
      </div>

      {stock.isLoading ? <div className="p-6 text-center"><Spinner /></div>
        : !(stock.data?.length) ? <p className="text-sm text-slate-600 p-4">Nenhum item em estoque.</p>
        : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-xs text-slate-500 border-b border-navy-700">
                <tr>
                  <th className="text-left px-3 py-2">Medicamento</th>
                  <th className="text-left px-3 py-2">Lote</th>
                  <th className="text-left px-3 py-2">Validade</th>
                  <th className="text-right px-3 py-2">Saldo</th>
                  <th className="text-right px-3 py-2">Mín.</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {stock.data.map((s: any) => (
                  <tr key={s.id} className="border-b border-navy-800/50">
                    <td className="px-3 py-1.5 text-slate-200">{s.drug_name} <span className="text-slate-600 text-xs">{s.unit_label}</span></td>
                    <td className="px-3 py-1.5 text-slate-500 font-mono text-xs">{s.lot || '—'}</td>
                    <td className="px-3 py-1.5 text-xs">
                      <span className={s.expiring ? 'text-amber-400' : 'text-slate-500'}>{fmtDate(s.expiry_date)}{s.expiring && ' ⚠'}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      <span className={s.low_stock ? 'text-red-400 font-semibold' : 'text-slate-200'}>{s.quantity}</span>
                      {s.low_stock && <AlertTriangle size={12} className="inline ml-1 text-red-400" />}
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-600 tabular-nums">{s.min_level}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      {canStock && <button className="btn-ghost text-xs px-2 py-1" onClick={() => quickOut(s)}>Saída</button>}
                      <button className="btn-ghost text-xs px-2 py-1" onClick={() => setMovesFor(s)} title="Histórico"><History size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {showAdd && <AddStockModal onClose={() => setShowAdd(false)} />}
      {movesFor && <MovementsModal stock={movesFor} onClose={() => setMovesFor(null)} />}
    </div>
  );
}

function AddStockModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ drug_name: '', lot: '', expiry_date: '', unit_label: 'un', quantity: '', min_level: '' });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const m = useMutation({
    mutationFn: () => pharmacyApi.createStock({
      drug_name: f.drug_name.trim(),
      lot: f.lot.trim() || undefined,
      expiry_date: f.expiry_date || undefined,
      unit_label: f.unit_label.trim() || 'un',
      quantity: Number(f.quantity.replace(',', '.')),
      min_level: f.min_level ? Number(f.min_level.replace(',', '.')) : 0,
    }),
    onSuccess: () => { toast.success('Entrada registrada'); qc.invalidateQueries({ queryKey: ['pharm-stock'] }); onClose(); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const valid = f.drug_name.trim() && Number(f.quantity.replace(',', '.')) > 0;

  return (
    <Modal title="Entrada de estoque" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Medicamento *"><input className="input w-full" value={f.drug_name} onChange={(e) => set('drug_name', e.target.value)} placeholder="Ex.: Dipirona 500mg comp." /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lote"><input className="input w-full" value={f.lot} onChange={(e) => set('lot', e.target.value)} /></Field>
          <Field label="Validade"><input type="date" className="input w-full" value={f.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unidade"><input className="input w-full" value={f.unit_label} onChange={(e) => set('unit_label', e.target.value)} placeholder="comp/mL/un" /></Field>
          <Field label="Quantidade *"><input className="input w-full" inputMode="decimal" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></Field>
          <Field label="Mínimo"><input className="input w-full" inputMode="decimal" value={f.min_level} onChange={(e) => set('min_level', e.target.value)} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!valid || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Salvando…' : 'Registrar entrada'}</button>
        </div>
      </div>
    </Modal>
  );
}

function MovementsModal({ stock, onClose }: { stock: any; onClose: () => void }) {
  const moves = useQuery({ queryKey: ['pharm-moves', stock.id], queryFn: () => pharmacyApi.movements(stock.id), select: sel });
  const LABEL: Record<string, string> = { in: 'Entrada', out: 'Saída', adjust: 'Ajuste' };
  return (
    <Modal title={`Movimentos — ${stock.drug_name}`} onClose={onClose}>
      {moves.isLoading ? <div className="p-4 text-center"><Spinner /></div>
        : !(moves.data?.length) ? <p className="text-sm text-slate-600">Sem movimentos.</p>
        : (
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {moves.data.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between text-sm py-1 border-b border-navy-800/50">
                <span className={m.movement_type === 'out' ? 'text-red-400' : m.movement_type === 'in' ? 'text-emerald-400' : 'text-amber-400'}>
                  {LABEL[m.movement_type]} {m.quantity}
                </span>
                <span className="text-slate-500 text-xs">→ {m.balance_after} · {new Date(m.created_at).toLocaleString('pt-BR')}</span>
              </div>
            ))}
          </div>
        )}
    </Modal>
  );
}

function DispensarTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [patient, setPatient] = useState<any | null>(null);
  const [picked, setPicked] = useState<Record<string, { qty: string; stock_id?: string }>>({});

  const results = useQuery({
    queryKey: ['pharm-pt-search', search],
    queryFn: () => patientsApi.list({ q: search }),
    select: sel, enabled: search.trim().length >= 2,
  });
  const prescriptions = useQuery({
    queryKey: ['pharm-rx', patient?.id], enabled: !!patient,
    queryFn: () => ehrApi.prescriptions(patient.id), select: sel,
  });
  const dispensations = useQuery({
    queryKey: ['pharm-disp', patient?.id], enabled: !!patient,
    queryFn: () => pharmacyApi.dispensations(patient.id), select: sel,
  });
  const stock = useQuery({ queryKey: ['pharm-stock-all'], queryFn: () => pharmacyApi.stock(), select: sel, enabled: !!patient });

  const disp = useMutation({
    mutationFn: (body: any) => pharmacyApi.dispense(body),
    onSuccess: () => {
      toast.success('Dispensação registrada');
      setPicked({});
      qc.invalidateQueries({ queryKey: ['pharm-disp'] });
      qc.invalidateQueries({ queryKey: ['pharm-stock-all'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const toggle = (itemId: string, drug: string) => setPicked((p) => {
    const n = { ...p };
    if (n[itemId]) delete n[itemId]; else n[itemId] = { qty: '1' };
    return n;
  });
  const setQty = (itemId: string, qty: string) => setPicked((p) => ({ ...p, [itemId]: { ...p[itemId], qty } }));
  const setStockId = (itemId: string, stock_id: string) => setPicked((p) => ({ ...p, [itemId]: { ...p[itemId], stock_id: stock_id || undefined } }));

  const submit = (rx: any) => {
    const items = rx.items
      .filter((it: any) => picked[it.id])
      .map((it: any) => ({
        prescription_item_id: it.id,
        drug_name: it.drug_name,
        quantity: Number((picked[it.id].qty || '1').replace(',', '.')),
        stock_id: picked[it.id].stock_id,
      }));
    if (!items.length) return toast.error('Selecione ao menos um item');
    disp.mutate({ patient_id: patient.id, prescription_id: rx.id, encounter_id: rx.encounter_id || undefined, items });
  };

  return (
    <div className="space-y-4">
      {!patient ? (
        <div className="space-y-2 max-w-lg">
          <div className="relative">
            <UserSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="input pl-8 w-full" placeholder="Buscar paciente (nome)…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {results.isLoading ? <div className="p-3"><Spinner /></div> : (
            <div className="space-y-1">
              {(results.data || []).map((p: any) => (
                <button key={p.id} onClick={() => setPatient(p)} className="card w-full text-left px-3 py-2 hover:border-cyan-700 text-sm">
                  <span className="text-slate-200">{p.name}</span>
                  <span className="text-slate-600 text-xs ml-2">{p.birth_date ? new Date(p.birth_date).toLocaleDateString('pt-BR') : ''}</span>
                </button>
              ))}
              {search.length >= 2 && !results.isLoading && !(results.data?.length) && <p className="text-sm text-slate-600">Nenhum paciente.</p>}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 card px-3 py-2">
            <span className="text-sm text-slate-200 font-medium">{patient.name}</span>
            <button className="btn-ghost text-xs" onClick={() => { setPatient(null); setPicked({}); }}>Trocar paciente</button>
          </div>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><ClipboardList size={13} /> Prescrições</h2>
            {prescriptions.isLoading ? <div className="p-4"><Spinner /></div>
              : !(prescriptions.data?.length) ? <p className="text-sm text-slate-600">Sem prescrições para este paciente.</p>
              : prescriptions.data.map((rx: any) => (
                <div key={rx.id} className="card p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{new Date(rx.created_at).toLocaleDateString('pt-BR')} · {rx.rx_type} · <span className={rx.status === 'signed' ? 'text-emerald-400' : 'text-amber-400'}>{rx.status}</span></span>
                    <button className="btn-primary text-xs py-1" disabled={disp.isPending} onClick={() => submit(rx)}>Dispensar selecionados</button>
                  </div>
                  <div className="space-y-1">
                    {(rx.items || []).map((it: any) => (
                      <div key={it.id} className="flex flex-wrap items-center gap-2 text-sm py-1 border-b border-navy-800/50">
                        <label className="flex items-center gap-1.5 flex-1 min-w-[160px] cursor-pointer">
                          <input type="checkbox" checked={!!picked[it.id]} onChange={() => toggle(it.id, it.drug_name)} />
                          <span className="text-slate-200">{it.drug_name}</span>
                          {it.dose && <span className="text-slate-600 text-xs">{it.dose}</span>}
                        </label>
                        {picked[it.id] && (
                          <>
                            <input className="input w-20 text-sm py-1" inputMode="decimal" value={picked[it.id].qty} onChange={(e) => setQty(it.id, e.target.value)} placeholder="Qtd" />
                            <select className="input text-sm py-1 max-w-[200px]" value={picked[it.id].stock_id || ''} onChange={(e) => setStockId(it.id, e.target.value)}>
                              <option value="">— sem baixa de estoque —</option>
                              {(stock.data || []).map((s: any) => (
                                <option key={s.id} value={s.id}>{s.drug_name} ({s.quantity} {s.unit_label}{s.lot ? ` · ${s.lot}` : ''})</option>
                              ))}
                            </select>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><History size={13} /> Dispensações anteriores</h2>
            {dispensations.isLoading ? <div className="p-3"><Spinner /></div>
              : !(dispensations.data?.length) ? <p className="text-sm text-slate-600">Nenhuma dispensação.</p>
              : dispensations.data.map((d: any) => (
                <div key={d.id} className="card p-2.5 text-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>{new Date(d.created_at).toLocaleString('pt-BR')} · {d.dispensed_by_name || '—'}</span>
                    <span className="badge badge-neutral">{d.status}</span>
                  </div>
                  <div className="text-slate-300 text-xs">{(d.items || []).map((i: any) => `${i.drug_name} (${i.quantity} ${i.unit_label})`).join(' · ')}</div>
                </div>
              ))}
          </section>
        </>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: any }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="card p-4 w-full max-w-md max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-100 mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: any }) {
  return <label className="block text-xs text-slate-400 space-y-1"><span>{label}</span>{children}</label>;
}
