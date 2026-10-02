import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Stethoscope, HeartPulse, Maximize2, Volume2, VolumeX } from 'lucide-react';
import { ehrApi } from '../../api/endpoints';
import { useAuthStore } from '../../stores/authStore';

// LGPD: painel público (TV) exibe só ficha + primeiro nome + sala — nunca CPF/diagnóstico
interface PanelCalled { ticket_number: number | null; name: string; room_label: string | null; called_at: string; is_emergency: boolean; }
interface PanelWaiting { ticket_number: number | null; name: string; is_emergency: boolean; manchester_level: string | null; }
interface PanelData {
  unit_name: string | null;
  now_calling: PanelCalled | null;
  called: PanelCalled[];
  waiting: PanelWaiting[];
  doctors_on_duty: string[];
  nurses_on_duty: string[];
  server_time: string;
}

const MANCHESTER_COLOR: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e', blue: '#3b82f6',
};

const fmtTicket = (n: number | null) => (n == null ? '—' : String(n).padStart(3, '0'));

export default function PainelPage() {
  const user = useAuthStore((s) => s.user);
  const [now, setNow] = useState(new Date());
  const [muted, setMuted] = useState(true);
  const [lastCalled, setLastCalled] = useState<number | null>(null);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const q = useQuery({
    queryKey: ['panel'],
    queryFn: () => ehrApi.panel(),
    select: (r): PanelData => (r.data as any).data,
    refetchInterval: 6000,
    refetchIntervalInBackground: true,
  });

  const data = q.data;
  const calling = data?.now_calling ?? null;

  useEffect(() => {
    const tk = calling?.ticket_number ?? null;
    if (tk != null && tk !== lastCalled) {
      setLastCalled(tk);
      if (!muted) beep();
    }
  }, [calling?.ticket_number]); // eslint-disable-line react-hooks/exhaustive-deps

  // RBAC: paciente nunca acessa o painel de chamada (mesmo autenticado)
  if (user?.role === 'patient') return <Navigate to="/portal_do_paciente" replace />;

  const goFullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col text-white overflow-hidden"
         style={{ background: 'linear-gradient(160deg,#070d1a 0%,#0c1626 60%,#0a1322 100%)' }}>
      <header className="flex items-center justify-between px-8 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'rgba(59,130,246,0.18)' }}>
            <HeartPulse size={24} className="text-sky-300" />
          </div>
          <div>
            <h1 className="font-bold text-2xl tracking-tight">Painel de Atendimento</h1>
            <p className="text-sky-200/70 text-sm">{data?.unit_name || 'Unidade de Saúde'}</p>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="text-4xl font-bold tabular-nums leading-none">
              {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="text-sky-200/60 text-sm capitalize">
              {now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
            </div>
          </div>
          <button onClick={() => setMuted((m) => !m)} title={muted ? 'Ativar som da chamada' : 'Silenciar'}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-sky-200">
            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <button onClick={goFullscreen} title="Tela cheia"
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-sky-200">
            <Maximize2 size={20} />
          </button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-3 gap-6 px-8 py-6 min-h-0">
        <section className="col-span-2 rounded-3xl border border-sky-400/20 flex flex-col items-center justify-center p-8"
                 style={{ background: calling?.is_emergency ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.08)' }}>
          <p className="uppercase tracking-[0.3em] text-sky-200/70 text-xl mb-4">Chamando</p>
          {calling ? (
            <>
              <div className="font-bold tabular-nums leading-none animate-pulse"
                   style={{ fontSize: 'clamp(6rem,18vw,16rem)', color: calling.is_emergency ? '#fca5a5' : '#fff' }}>
                {fmtTicket(calling.ticket_number)}
              </div>
              <div className="mt-4 text-5xl font-semibold text-center">{calling.name}</div>
              {calling.room_label && (
                <div className="mt-6 px-8 py-3 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 text-4xl font-bold">
                  → {calling.room_label}
                </div>
              )}
            </>
          ) : (
            <div className="text-sky-200/50 text-4xl">Aguardando chamada…</div>
          )}
        </section>

        <section className="flex flex-col gap-6 min-h-0">
          <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] p-5 min-h-0 flex flex-col">
            <h2 className="text-sky-200/70 uppercase tracking-widest text-sm mb-3">Próximos</h2>
            <div className="flex-1 overflow-hidden flex flex-col gap-2">
              {(data?.waiting?.length ?? 0) === 0 && <p className="text-sky-200/40 text-lg">Fila vazia</p>}
              {data?.waiting?.slice(0, 6).map((w, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2 rounded-xl bg-white/[0.04]">
                  <span className="text-3xl font-bold tabular-nums">{fmtTicket(w.ticket_number)}</span>
                  <span className="text-lg text-sky-100/80 truncate ml-3 flex-1 text-right">{w.name}</span>
                  {(w.manchester_level || w.is_emergency) && (
                    <span className="ml-3 w-4 h-4 rounded-full shrink-0"
                          style={{ background: w.is_emergency ? '#ef4444' : (MANCHESTER_COLOR[w.manchester_level || ''] || '#64748b') }} />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className="text-sky-200/70 uppercase tracking-widest text-sm mb-3">Últimas chamadas</h2>
            <div className="flex flex-col gap-1.5">
              {(data?.called?.length ?? 0) === 0 && <p className="text-sky-200/40">—</p>}
              {data?.called?.slice(0, 4).map((c, i) => (
                <div key={i} className="flex items-center justify-between text-sky-100/70">
                  <span className="text-2xl font-bold tabular-nums">{fmtTicket(c.ticket_number)}</span>
                  <span className="truncate ml-3">{c.name}</span>
                  {c.room_label && <span className="ml-3 text-emerald-300/80 font-semibold">{c.room_label}</span>}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <footer className="px-8 py-4 border-t border-white/10 flex items-center gap-10 text-lg">
        <div className="flex items-center gap-2 min-w-0">
          <Stethoscope size={20} className="text-sky-300 shrink-0" />
          <span className="text-sky-200/60 mr-2">Plantão médico:</span>
          <span className="font-semibold truncate">{data?.doctors_on_duty?.join('  ·  ') || '—'}</span>
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <HeartPulse size={20} className="text-rose-300 shrink-0" />
          <span className="text-sky-200/60 mr-2">Enfermagem:</span>
          <span className="font-semibold truncate">{data?.nurses_on_duty?.join('  ·  ') || '—'}</span>
        </div>
        <div className="ml-auto text-sky-200/40 text-sm">Atualiza automaticamente</div>
      </footer>
    </div>
  );
}

// Bipe curto via WebAudio (sem asset externo).
function beep() {
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(); osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => ctx.close();
  } catch { /* som é opcional */ }
}
