import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, CalendarRange, Activity, UserX, FileImage, FileSignature, Clock, Users, Receipt, Download } from 'lucide-react';
import { analyticsApi, billingApi } from '../../api/endpoints';
import { Spinner } from '../../components/ui';
import { toast } from '../../components/ui/Toast';
import { appointmentStatusLabel, getErrorMessage } from '../../utils/format';
import { useAuthStore } from '../../stores/authStore';

/**
 * Relatórios operacionais (#6): produção, absenteísmo (no-show) e fila do PEP.
 * Só agregados — sem PII. Escopo por unidade aplicado no backend.
 */

const sel = (r: any) => (r.data as any).data;
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const STAGE_LABEL: Record<string, string> = {
  reception: 'Recepção', triage: 'Triagem', waiting_doctor: 'Aguardando médico',
  in_consultation: 'Em atendimento', medication: 'Medicação',
};

export default function RelatoriosPage() {
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const range = { from, to };

  const prod = useQuery({ queryKey: ['an-prod', from, to], queryFn: () => analyticsApi.production(range), select: sel });
  const ns   = useQuery({ queryKey: ['an-ns', from, to], queryFn: () => analyticsApi.noShow(range), select: sel });
  const queue = useQuery({ queryKey: ['an-queue'], queryFn: () => analyticsApi.queue(), select: sel, refetchInterval: 30_000 });

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-accent-subtle)', color: 'var(--cyan-500)' }}>
          <BarChart3 size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-xl text-slate-100">Relatórios operacionais</h1>
          <p className="text-slate-500 text-sm">Produção · absenteísmo · fila de espera</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs text-slate-500">De
            <input type="date" className="input mt-0.5 block" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">Até
            <input type="date" className="input mt-0.5 block" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      </header>

      {/* ── Produção ── */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><CalendarRange size={13} /> Produção no período</h2>
        {prod.isLoading ? <div className="p-6 text-center"><Spinner /></div> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat icon={Activity}      label="Agendamentos"   value={prod.data?.appointments_total ?? 0} color="var(--cyan-500)" />
              <Stat icon={FileImage}     label="Exames realizados" value={prod.data?.studies_done ?? 0} color="#6366f1" />
              <Stat icon={FileSignature} label="Laudos assinados" value={prod.data?.reports_signed ?? 0} color="#22c55e" />
              <Stat icon={UserX}         label="Faltas (no-show)" value={ns.data?.no_show ?? 0} color="#ef4444" />
            </div>

            {/* Série diária de agendamentos */}
            <div className="card p-4">
              <p className="text-xs text-slate-500 mb-3">Agendamentos por dia</p>
              <DailyBars data={prod.data?.daily ?? []} />
            </div>

            {/* Distribuição por status */}
            {(prod.data?.by_status?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2">
                {prod.data.by_status.map((s: any) => (
                  <span key={s.status} className="badge badge-neutral text-xs">
                    {appointmentStatusLabel[s.status] ?? s.status}: <b className="ml-1">{s.n}</b>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Absenteísmo ── */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><UserX size={13} /> Absenteísmo (no-show)</h2>
        {ns.isLoading ? <div className="p-6 text-center"><Spinner /></div> : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="card p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Taxa de falta</p>
                <p className="text-3xl font-bold" style={{ color: (ns.data?.rate_pct ?? 0) > 20 ? '#ef4444' : '#f59e0b' }}>{ns.data?.rate_pct ?? 0}%</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p><b className="text-slate-300">{ns.data?.no_show ?? 0}</b> faltas</p>
                <p>de <b className="text-slate-300">{ns.data?.scheduled ?? 0}</b> agendados</p>
              </div>
            </div>
            <div className="card p-4 md:col-span-2">
              <p className="text-xs text-slate-500 mb-2">Procedimentos com mais faltas</p>
              {(ns.data?.by_procedure?.length ?? 0) === 0 ? <p className="text-sm text-slate-600">Sem faltas no período.</p> : (
                <div className="space-y-1.5">
                  {ns.data.by_procedure.map((p: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-slate-300 truncate">{p.procedure_name}</span>
                      <span className="text-slate-500 text-xs ml-2 shrink-0">{p.no_show}/{p.scheduled} · <b className="text-red-400">{p.rate_pct}%</b></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Fila de espera (PEP) ── */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Clock size={13} /> Fila de espera (agora)</h2>
        {queue.isLoading ? <div className="p-6 text-center"><Spinner /></div> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat icon={Users} label="Aguardando médico" value={queue.data?.waiting ?? 0} color="var(--cyan-500)" />
              <Stat icon={Clock} label="Espera média (min)" value={queue.data?.avg_wait_min ?? 0} color="#f59e0b" />
              <Stat icon={Clock} label="Espera máxima (min)" value={queue.data?.max_wait_min ?? 0} color="#ef4444" />
              <Stat icon={Activity} label="Concluídos hoje" value={queue.data?.completed_today ?? 0} color="#22c55e" />
            </div>
            {(queue.data?.by_stage?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2">
                {queue.data.by_stage.map((s: any) => (
                  <span key={s.flow_stage} className="badge badge-neutral text-xs">{STAGE_LABEL[s.flow_stage] ?? s.flow_stage}: <b className="ml-1">{s.n}</b></span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-600">Tempo médio total de atendimento hoje: {queue.data?.avg_total_min ?? 0} min.</p>
          </>
        )}
      </section>

      {/* ── Faturamento SUS — produção ambulatorial (#3 Nível 5) ── */}
      <BillingSection />
    </div>
  );
}

// Extrato de produção por competência + export CSV (BPA-C consolidado).
function BillingSection() {
  const can = useAuthStore((s) => s.can);
  const now = new Date();
  const [comp, setComp] = useState(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`);
  const q = useQuery({
    queryKey: ['billing-prod', comp], enabled: can('faturamento') && /^\d{6}$/.test(comp),
    queryFn: () => billingApi.production(comp), select: sel,
  });
  if (!can('faturamento')) return null;

  const exportCsv = async () => {
    try {
      const r = await billingApi.exportCsv(comp);
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = `producao_sus_${comp}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Receipt size={13} /> Faturamento SUS — produção ambulatorial</h2>
        <div className="flex items-end gap-2">
          <label className="text-xs text-slate-500">Competência (AAAAMM)
            <input className="input mt-0.5 block w-28" value={comp} maxLength={6} onChange={(e) => setComp(e.target.value.replace(/\D/g, ''))} />
          </label>
          <button className="btn-ghost" disabled={!(q.data?.lines?.length)} onClick={exportCsv}><Download size={14} /> Exportar CSV</button>
        </div>
      </div>
      <p className="text-[11px] text-slate-600">Extrato de procedimentos realizados (status “concluído”) por competência. O arquivo oficial BPA-MAG (largura fixa) e o TISS exigem mapeamento TUSS→SIGTAP + homologação DATASUS — exporte o CSV para conferência/importação.</p>
      {q.isLoading ? <div className="p-6 text-center"><Spinner /></div>
        : !(q.data?.lines?.length) ? <p className="text-sm text-slate-600">Sem produção realizada nesta competência.</p>
        : (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 border-b border-navy-700">
                <tr><th className="text-left px-3 py-2">Código</th><th className="text-left px-3 py-2">Procedimento</th><th className="text-left px-3 py-2">CNES</th><th className="text-right px-3 py-2">Qtd.</th></tr>
              </thead>
              <tbody>
                {q.data.lines.map((l: any, i: number) => (
                  <tr key={i} className="border-b border-navy-800/50">
                    <td className="px-3 py-1.5 font-mono text-cyan-400">{l.code}</td>
                    <td className="px-3 py-1.5 text-slate-300">{l.procedure_name}</td>
                    <td className="px-3 py-1.5 text-slate-500">{l.cnes || '—'}</td>
                    <td className="px-3 py-1.5 text-right text-slate-200 tabular-nums">{l.quantity}</td>
                  </tr>
                ))}
                <tr className="font-semibold"><td colSpan={3} className="px-3 py-2 text-right text-slate-400">Total</td><td className="px-3 py-2 text-right tabular-nums">{q.data.total_procedures}</td></tr>
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

function Stat({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} style={{ color }} />
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-100 tabular-nums">{value}</p>
    </div>
  );
}

// Barras diárias simples (sem lib): altura proporcional ao máximo.
function DailyBars({ data }: { data: { day: string; n: number }[] }) {
  if (!data.length) return <p className="text-sm text-slate-600">Sem dados no período.</p>;
  const max = Math.max(...data.map((d) => d.n), 1);
  return (
    <div className="flex items-end gap-0.5 h-28">
      {data.map((d) => (
        <div key={d.day} className="flex-1 flex flex-col items-center justify-end group relative" title={`${d.day}: ${d.n}`}>
          <div className="w-full rounded-t" style={{ height: `${(d.n / max) * 100}%`, minHeight: d.n > 0 ? 2 : 0, background: 'var(--cyan-500)' }} />
          <span className="absolute -top-4 text-[9px] text-slate-400 opacity-0 group-hover:opacity-100">{d.n}</span>
        </div>
      ))}
    </div>
  );
}
