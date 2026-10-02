import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Video, UserSearch, Link2, Copy, PhoneOff, Plus } from 'lucide-react';
import { teleconsultApi, patientsApi } from '../../api/endpoints';
import { Spinner } from '../../components/ui';
import { toast } from '../../components/ui/Toast';
import { getErrorMessage } from '../../utils/format';

/**
 * Teleconsulta (#6 Nível 4) — painel do profissional. Cria a sala (sessão),
 * compartilha o link do paciente e entra como anfitrião. A vídeo-chamada roda em
 * /tele/:token (WebRTC P2P, sinalização por REST).
 */
const sel = (r: any) => (r.data as any).data;
const roomUrl = (token: string) => `${window.location.origin}/tele/${token}`;

export default function TeleconsultaPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [patient, setPatient] = useState<any | null>(null);

  const results = useQuery({
    queryKey: ['tele-pt', search], enabled: search.trim().length >= 2,
    queryFn: () => patientsApi.list({ search }), select: sel,
  });
  const sessions = useQuery({
    queryKey: ['tele-sessions', patient?.id], enabled: !!patient,
    queryFn: () => teleconsultApi.sessions(patient.id), select: sel,
  });

  const create = useMutation({
    mutationFn: () => teleconsultApi.createSession({ patient_id: patient.id }),
    onSuccess: () => { toast.success('Sala criada'); qc.invalidateQueries({ queryKey: ['tele-sessions'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const end = useMutation({
    mutationFn: (id: string) => teleconsultApi.setStatus(id, 'ended'),
    onSuccess: () => { toast.success('Sessão encerrada'); qc.invalidateQueries({ queryKey: ['tele-sessions'] }); },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const copyLink = (token: string) => {
    navigator.clipboard?.writeText(roomUrl(token)).then(
      () => toast.success('Link copiado — envie ao paciente'),
      () => toast.error('Não foi possível copiar'),
    );
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-accent-subtle)', color: 'var(--cyan-500)' }}>
          <Video size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-xl text-slate-100">Teleconsulta</h1>
          <p className="text-slate-500 text-sm">Vídeo-chamada P2P · link enviado ao paciente</p>
        </div>
      </header>

      {!patient ? (
        <div className="space-y-2 max-w-lg">
          <div className="relative">
            <UserSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="input pl-8 w-full" placeholder="Buscar paciente (nome)…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {results.isLoading ? <div className="p-3"><Spinner /></div> : (
            <div className="space-y-1">
              {(results.data || []).map((p: any) => (
                <button key={p.id} onClick={() => setPatient(p)} className="card w-full text-left px-3 py-2 hover:border-cyan-700 text-sm text-slate-200">{p.name}</button>
              ))}
              {search.length >= 2 && !results.isLoading && !(results.data?.length) && <p className="text-sm text-slate-600">Nenhum paciente.</p>}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 card px-3 py-2">
            <span className="text-sm text-slate-200 font-medium">{patient.name}</span>
            <div className="flex gap-2">
              <button className="btn-primary text-sm py-1" disabled={create.isPending} onClick={() => create.mutate()}><Plus size={14} /> Nova sala</button>
              <button className="btn-ghost text-xs" onClick={() => setPatient(null)}>Trocar</button>
            </div>
          </div>

          {sessions.isLoading ? <div className="p-4"><Spinner /></div>
            : !(sessions.data?.length) ? <p className="text-sm text-slate-600">Nenhuma sala. Crie uma nova para iniciar.</p>
            : (
              <div className="space-y-2">
                {sessions.data.map((s: any) => (
                  <div key={s.id} className="card p-3 flex flex-wrap items-center gap-2">
                    <div className="flex-1 min-w-[160px]">
                      <p className="text-sm text-slate-200">{new Date(s.created_at).toLocaleString('pt-BR')}</p>
                      <p className="text-xs"><StatusBadge status={s.status} /></p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-navy-900 rounded px-2 py-1 max-w-[280px] truncate">
                      <Link2 size={12} /> <span className="truncate">{roomUrl(s.room_token)}</span>
                    </div>
                    <button className="btn-ghost text-xs px-2 py-1" onClick={() => copyLink(s.room_token)}><Copy size={13} /> Copiar</button>
                    {s.status !== 'ended' && s.status !== 'cancelled' && (
                      <>
                        <button className="btn-primary text-xs py-1" onClick={() => navigate(`/tele/${s.room_token}?host=1`)}><Video size={13} /> Entrar</button>
                        <button className="btn-ghost text-xs px-2 py-1 text-red-400" onClick={() => end.mutate(s.id)} title="Encerrar"><PhoneOff size={13} /></button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

          <p className="text-[11px] text-slate-600 max-w-2xl">
            Crie uma sala, copie o link e envie ao paciente (WhatsApp/SMS/e-mail). O paciente abre o link no celular ou computador e a câmera conecta direto (ponto a ponto). Não há gravação nem servidor de vídeo — apenas sinalização.
          </p>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    created: 'badge-neutral', active: 'badge-success', ended: 'badge-neutral', cancelled: 'badge-danger',
  };
  const label: Record<string, string> = { created: 'Criada', active: 'Em andamento', ended: 'Encerrada', cancelled: 'Cancelada' };
  return <span className={`badge ${map[status] || 'badge-neutral'}`}>{label[status] || status}</span>;
}
