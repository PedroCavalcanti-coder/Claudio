import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Inbox, ArrowDownLeft, ArrowUpRight, Check, X, Ban, Clock, Reply, FileText } from 'lucide-react';
import { referralsApi } from '../../api/endpoints';
import { Spinner, SkeletonRows, Modal, Field } from '../../components/ui';
import { toast } from '../../components/ui/Toast';
import { useAuthStore } from '../../stores/authStore';

type ReferralRow = {
  id: string;
  patient_id: string;
  from_unit_id: string; from_unit_name: string;
  to_unit_id:   string; to_unit_name:   string;
  to_user_id?:  string; to_user_name?:  string;
  specialty?:   string;
  reason:       string;
  status: 'pending'|'accepted'|'completed'|'declined'|'cancelled';
  decided_at?:  string;
  decision_notes?: string;
  counter_reference?: string;
  counter_referred_at?: string;
  counter_referred_by_name?: string;
  created_at:   string;
};

const STATUS_BADGE: Record<string,string> = {
  pending:   'badge-warning',
  accepted:  'badge-success',
  completed: 'badge-info',
  declined:  'badge-danger',
  cancelled: 'badge-neutral',
};
const STATUS_LABEL: Record<string,string> = {
  pending:'Aguardando', accepted:'Aceito', completed:'Concluído',
  declined:'Recusado',  cancelled:'Cancelado',
};

/**
 * Caixa de encaminhamentos.
 *
 * Duas abas:
 *   - Recebidos: vieram para a unidade do usuário (ou diretamente para ele).
 *                Permite aceitar / recusar quando pendentes.
 *   - Enviados:  saíram da unidade do usuário. Permite cancelar quando pendentes.
 *
 * Admin vê tudo (sem filtro de direção).
 */
export default function ReferralsInboxPage() {
  const me = useAuthStore(s => s.user);
  const qc = useQueryClient();
  const [tab, setTab] = useState<'incoming'|'outgoing'>('incoming');
  const [decideTarget, setDecideTarget] = useState<{ ref: ReferralRow; decision: 'accepted'|'declined' } | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [counterTarget, setCounterTarget] = useState<ReferralRow | null>(null);
  const [counterText, setCounterText] = useState('');

  const { data: resp, isLoading } = useQuery({
    queryKey: ['referrals-inbox', tab],
    queryFn:  () => referralsApi.list({ direction: tab, limit: 50, page: 1 }),
    select:   r => r.data as any,
  });
  const rows: ReferralRow[] = resp?.data ?? [];

  const decideMut = useMutation({
    mutationFn: ({ id, decision, notes }: { id:string; decision:'accepted'|'declined'; notes?:string }) =>
      referralsApi.decide(id, decision, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['referrals-inbox'] });
      setDecideTarget(null); setDecisionNotes('');
      toast.success('Decisão registrada');
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Falha'),
  });
  const cancelMut = useMutation({
    mutationFn: (id: string) => referralsApi.cancel(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['referrals-inbox'] }); toast.success('Encaminhamento cancelado'); },
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Falha'),
  });
  const counterMut = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => referralsApi.counterReference(id, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['referrals-inbox'] });
      setCounterTarget(null); setCounterText('');
      toast.success('Contrarreferência registrada — ciclo fechado');
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Falha'),
  });

  const isAdmin = me?.role === 'admin';

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background:'var(--color-accent-subtle)', color:'var(--cyan-500)' }}>
          <Inbox size={18}/>
        </div>
        <div>
          <h1 className="font-display font-bold text-xl text-slate-100">Encaminhamentos</h1>
          <p className="text-slate-500 text-sm">
            Pacientes encaminhados entre unidades da rede
          </p>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-navy-800/50">
        <TabBtn active={tab==='incoming'} onClick={() => setTab('incoming')}
          icon={ArrowDownLeft} label={isAdmin ? 'Para esta unidade/rede' : 'Recebidos'}/>
        <TabBtn active={tab==='outgoing'} onClick={() => setTab('outgoing')}
          icon={ArrowUpRight} label={isAdmin ? 'Saindo da rede' : 'Enviados'}/>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-navy-900/50 border-b border-navy-800/40">
            <tr>
              {[
                'Paciente',
                tab==='incoming' ? 'Origem' : 'Destino',
                'Especialidade', 'Médico destino', 'Motivo', 'Status', 'Ações',
              ].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows rows={6} cols={7} />
            ) : !rows.length ? (
              <tr><td colSpan={7} className="text-center p-8 text-slate-500">
                {tab==='incoming'
                  ? 'Nenhum encaminhamento recebido.'
                  : 'Nenhum encaminhamento enviado.'}
              </td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-b border-navy-800/30">
                <td className="px-4 py-3 text-slate-200 font-mono text-xs">{r.patient_id.slice(0, 8)}…</td>
                <td className="px-4 py-3 text-slate-300">{tab==='incoming' ? r.from_unit_name : r.to_unit_name}</td>
                <td className="px-4 py-3 text-slate-400">{r.specialty ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400">{r.to_user_name ?? <span className="text-slate-600">qualquer</span>}</td>
                <td className="px-4 py-3 text-slate-400 max-w-xs truncate" title={r.reason}>{r.reason}</td>
                <td className="px-4 py-3"><span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {/* Recebido + pendente → aceitar/recusar */}
                    {tab==='incoming' && r.status === 'pending' && (
                      <>
                        <button className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => setDecideTarget({ ref: r, decision: 'accepted' })}>
                          <Check size={12}/> Aceitar
                        </button>
                        <button className="btn-ghost px-2 py-1 text-xs"
                          onClick={() => setDecideTarget({ ref: r, decision: 'declined' })}>
                          <X size={12}/> Recusar
                        </button>
                      </>
                    )}
                    {/* Enviado + pendente → cancelar */}
                    {tab==='outgoing' && r.status === 'pending' && (
                      <button className="btn-ghost px-2 py-1 text-xs"
                        onClick={() => cancelMut.mutate(r.id)} disabled={cancelMut.isPending}>
                        <Ban size={12}/> Cancelar
                      </button>
                    )}
                    {r.status !== 'pending' && r.decided_at && (
                      <span className="text-xs text-slate-500" title={r.decision_notes}>
                        <Clock size={10} className="inline"/> {new Date(r.decided_at).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                    {/* Destino respondeu? aceito → contrarreferenciar; concluído → ver resposta */}
                    {tab==='incoming' && r.status === 'accepted' && (
                      <button className="btn-ghost px-2 py-1 text-xs"
                        onClick={() => { setCounterTarget(r); setCounterText(''); }}>
                        <Reply size={12}/> Contrarreferenciar
                      </button>
                    )}
                    {r.status === 'completed' && r.counter_reference && (
                      <button className="btn-ghost px-2 py-1 text-xs"
                        onClick={() => setCounterTarget(r)}>
                        <FileText size={12}/> Contrarreferência
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Dialog de decisão (aceitar/recusar com nota) */}
      {decideTarget && (
        <Modal open onClose={() => { setDecideTarget(null); setDecisionNotes(''); }}
          title={decideTarget.decision === 'accepted' ? 'Aceitar encaminhamento' : 'Recusar encaminhamento'} size="sm">
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              <strong className="text-slate-300">Motivo original:</strong> {decideTarget.ref.reason}
            </p>
            <Field label="Observação (opcional)">
              <textarea className="input resize-none" rows={3} value={decisionNotes}
                onChange={e => setDecisionNotes(e.target.value)}
                placeholder={decideTarget.decision === 'accepted'
                  ? 'Ex: paciente já agendado para sexta-feira'
                  : 'Ex: paciente fora do perfil de atendimento; sugiro UPA'} />
            </Field>
            <div className="flex justify-end gap-2 pt-2 border-t border-navy-700">
              <button className="btn-ghost" onClick={() => { setDecideTarget(null); setDecisionNotes(''); }}>Cancelar</button>
              <button className={decideTarget.decision === 'accepted' ? 'btn-primary' : 'btn-danger'}
                disabled={decideMut.isPending}
                onClick={() => decideMut.mutate({ id: decideTarget.ref.id, decision: decideTarget.decision, notes: decisionNotes || undefined })}>
                {decideMut.isPending ? <Spinner size={14}/> : (
                  decideTarget.decision === 'accepted'
                    ? <><Check size={14}/> Confirmar aceite</>
                    : <><X size={14}/> Confirmar recusa</>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Contrarreferência: registrar (aceito) ou ler (concluído) */}
      {counterTarget && (
        <Modal open onClose={() => { setCounterTarget(null); setCounterText(''); }}
          title={counterTarget.status === 'completed' ? 'Contrarreferência' : 'Registrar contrarreferência'} size="md">
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              <strong className="text-slate-300">Motivo do encaminhamento:</strong> {counterTarget.reason}
            </p>
            {counterTarget.status === 'completed' ? (
              <>
                <div className="rounded-lg border border-navy-700 p-3 text-sm text-slate-300 whitespace-pre-wrap">{counterTarget.counter_reference}</div>
                <p className="text-xs text-slate-500">
                  {counterTarget.counter_referred_by_name ?? '—'}
                  {counterTarget.counter_referred_at ? ` · ${new Date(counterTarget.counter_referred_at).toLocaleString('pt-BR')}` : ''}
                </p>
                <div className="flex justify-end pt-2 border-t border-navy-700">
                  <button className="btn-ghost" onClick={() => setCounterTarget(null)}>Fechar</button>
                </div>
              </>
            ) : (
              <>
                <Field label="Resposta clínica ao solicitante (conduta, evolução, orientações)">
                  <textarea className="input resize-none" rows={5} value={counterText}
                    onChange={e => setCounterText(e.target.value)}
                    placeholder="Ex: Paciente avaliado pela cardiologia. Conduta: ... Retorno em 30 dias. Mantém medicação." />
                </Field>
                <div className="flex justify-end gap-2 pt-2 border-t border-navy-700">
                  <button className="btn-ghost" onClick={() => { setCounterTarget(null); setCounterText(''); }}>Cancelar</button>
                  <button className="btn-primary" disabled={counterMut.isPending || counterText.trim().length < 3}
                    onClick={() => counterMut.mutate({ id: counterTarget.id, content: counterText.trim() })}>
                    {counterMut.isPending ? <Spinner size={14}/> : <><Reply size={14}/> Enviar contrarreferência</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors
        ${active
          ? 'text-cyan-400 border-b-2 border-cyan-500'
          : 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent'}`}
    >
      <Icon size={14}/> {label}
    </button>
  );
}
