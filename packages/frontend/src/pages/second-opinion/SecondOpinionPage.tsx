import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Clock, AlertTriangle, CheckCircle, MessageSquare, UserX, ChevronRight, Plus, Eye } from 'lucide-react';
import api from '../../api/client';
import { Modal, Spinner, EmptyState, Alert, Field, Select, SectionHeader } from '../../components/ui';
import { formatDateTime, modalityLabel } from '../../utils/format';

const REASONS: Record<string, string> = {
  technical_quality: 'Inconsistência Técnica',
  diagnostic_doubt:  'Dúvida Diagnóstica',
  complex_case:      'Caso Complexo',
  peer_review:       'Revisão / Auditoria',
};

const STATUS_CONFIG: Record<string, { label: string; badge: string; icon: typeof Clock }> = {
  pending:         { label: 'Aguardando',      badge: 'badge-warning', icon: Clock       },
  under_review:    { label: 'Em Análise',      badge: 'badge-info',    icon: Eye         },
  patient_recalled:{ label: 'Reconvocado',     badge: 'badge-danger',  icon: UserX       },
  resolved:        { label: 'Resolvido',       badge: 'badge-success', icon: CheckCircle },
  cancelled:       { label: 'Cancelado',       badge: 'badge-neutral', icon: AlertTriangle },
};

function SlaTimer({ deadline, isOverdue }: { deadline: string; isOverdue: boolean }) {
  const remaining = Math.abs(
    (new Date(deadline).getTime() - Date.now()) / 3600000
  );
  const label = isOverdue
    ? `${remaining.toFixed(0)}h em atraso`
    : `${remaining.toFixed(0)}h restantes`;

  return (
    <span className={`flex items-center gap-1 text-xs font-mono ${isOverdue ? 'text-red-400' : remaining < 4 ? 'text-amber-400' : 'text-slate-400'}`}>
      <Clock size={11} />
      {label}
    </span>
  );
}

function RequestModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ study_id: '', reason: 'diagnostic_doubt', description: '' });
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () => api.post('/second-opinion', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['second-opinions'] }); onClose(); },
    onError: (e: any) => setError(e.response?.data?.message ?? 'Erro'),
  });

  return (
    <div className="space-y-4">
      {error && <Alert message={error} onClose={() => setError('')} />}

      <div className="p-3 rounded-lg bg-blue-950/40 border border-blue-800/40 text-xs text-blue-300 flex items-start gap-2">
        <Users size={13} className="shrink-0 mt-0.5" />
        <span>
          Ao solicitar Segunda Opinião, o exame é encaminhado ao Conselho Técnico.
          Todos os acessos e pareceres são rastreados conforme CFM Res. 2.107/2014.
        </span>
      </div>

      <Field label="Study ID (UUID)" required>
        <input className="input font-mono text-xs"
          placeholder="UUID do estudo PACS"
          value={form.study_id}
          onChange={e => setForm(p => ({ ...p, study_id: e.target.value }))}
        />
      </Field>

      <Field label="Motivo" required>
        <Select value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}>
          {Object.entries(REASONS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
      </Field>

      <Field label="Descrição detalhada" required>
        <textarea
          className="input resize-none h-28"
          placeholder="Descreva a dificuldade diagnóstica ou problema técnico..."
          value={form.description}
          onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
        />
      </Field>

      <div className="flex gap-3 justify-end pt-2 border-t border-navy-700">
        <button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button
          className="btn-primary"
          disabled={!form.study_id || !form.description || mut.isPending}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? <Spinner size={14} /> : <><Users size={14} /> Enviar ao Conselho</>}
        </button>
      </div>
    </div>
  );
}

function ReviewModal({ item, onClose }: { item: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [opinion, setOpinion] = useState('');
  const [recall, setRecall]   = useState(false);
  const [resolution, setResolution] = useState('');
  const [error, setError]     = useState('');

  const { data: detail, isLoading } = useQuery({
    queryKey: ['second-opinion-detail', item.id],
    queryFn:  () => api.get(`/second-opinion/${item.id}`),
    select:   r => r.data.data,
  });

  const reviewMut = useMutation({
    mutationFn: () => api.post(`/second-opinion/${item.id}/review`, { opinion_text: opinion }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['second-opinions'] }); onClose(); },
    onError:    (e: any) => setError(e.response?.data?.message ?? 'Erro'),
  });

  const recallMut = useMutation({
    mutationFn: () => api.patch(`/second-opinion/${item.id}/recall`, { reason: resolution }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['second-opinions'] }); onClose(); },
    onError:    (e: any) => setError(e.response?.data?.message ?? 'Erro'),
  });

  const resolveMut = useMutation({
    mutationFn: () => api.patch(`/second-opinion/${item.id}/resolve`, { resolution, joint_report: true }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['second-opinions'] }); onClose(); },
    onError:    (e: any) => setError(e.response?.data?.message ?? 'Erro'),
  });

  const isResolved = ['resolved','cancelled','patient_recalled'].includes(item.status);

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {error && <Alert message={error} onClose={() => setError('')} />}

      <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-navy-800/50 border border-navy-700 text-xs">
        <div><span className="text-slate-600">Paciente:</span> <span className="text-slate-300 font-medium">{item.patient_name}</span></div>
        <div><span className="text-slate-600">Modalidade:</span> <span className="text-slate-300">{modalityLabel[item.modality_type] ?? item.modality_type}</span></div>
        <div><span className="text-slate-600">Motivo:</span> <span className="text-slate-300">{REASONS[item.reason]}</span></div>
        <div><span className="text-slate-600">Solicitante:</span> <span className="text-slate-300">{item.requesting_physician}</span></div>
        <div className="col-span-2"><span className="text-slate-600">Descrição:</span> <span className="text-slate-400 block mt-1">{item.description}</span></div>
      </div>

      {isLoading ? <Spinner /> : detail?.reviewers?.length > 0 && (
        <div>
          <p className="label">Pareceres do Conselho</p>
          <div className="space-y-2">
            {detail.reviewers.map((r: any) => (
              <div key={r.reviewer_id} className="p-3 rounded-lg bg-navy-800/60 border border-navy-700">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-cyan-400 text-xs font-medium">{r.reviewer_name}</span>
                  <span className="text-slate-600 text-xs">{r.opinion_at ? formatDateTime(r.opinion_at) : '—'}</span>
                </div>
                <p className="text-slate-300 text-sm">{r.opinion_text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isResolved && (
        <>
          <div className="flex gap-2">
            <button onClick={() => setRecall(false)} className={`flex-1 py-1.5 rounded-lg text-xs border transition-all ${!recall ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300' : 'border-navy-600 text-slate-500 hover:border-navy-500'}`}>
              Adicionar Parecer
            </button>
            <button onClick={() => setRecall(true)} className={`flex-1 py-1.5 rounded-lg text-xs border transition-all ${recall ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' : 'border-navy-600 text-slate-500 hover:border-navy-500'}`}>
              Reconvocar / Resolver
            </button>
          </div>

          {!recall ? (
            <Field label="Seu Parecer">
              <textarea className="input resize-none h-24"
                placeholder="Descreva sua avaliação clínica..."
                value={opinion}
                onChange={e => setOpinion(e.target.value)}
              />
            </Field>
          ) : (
            <Field label="Descrição da Resolução">
              <textarea className="input resize-none h-24"
                placeholder="Descreva a decisão do conselho ou motivo da reconvocação..."
                value={resolution}
                onChange={e => setResolution(e.target.value)}
              />
            </Field>
          )}

          <div className="flex gap-2 justify-end border-t border-navy-700 pt-3">
            <button className="btn-ghost" onClick={onClose}>Fechar</button>

            {!recall ? (
              <button className="btn-primary" disabled={!opinion.trim() || reviewMut.isPending} onClick={() => reviewMut.mutate()}>
                {reviewMut.isPending ? <Spinner size={14} /> : <><MessageSquare size={14} /> Registrar Parecer</>}
              </button>
            ) : (
              <>
                <button className="btn-danger" disabled={!resolution.trim() || recallMut.isPending} onClick={() => recallMut.mutate()}>
                  {recallMut.isPending ? <Spinner size={14} /> : <><UserX size={14} /> Reconvocar</>}
                </button>
                <button className="btn-primary" disabled={!resolution.trim() || resolveMut.isPending} onClick={() => resolveMut.mutate()}>
                  {resolveMut.isPending ? <Spinner size={14} /> : <><CheckCircle size={14} /> Resolver</>}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {isResolved && (
        <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-sm text-emerald-300">
          <p className="font-semibold mb-1">Caso Encerrado</p>
          <p className="text-emerald-400/70 text-xs">{item.resolution || '—'}</p>
        </div>
      )}
    </div>
  );
}

export default function SecondOpinionPage() {
  const [tab, setTab]         = useState<'pending'|'resolved'>('pending');
  const [requestModal, setRequestModal] = useState(false);
  const [selected, setSelected]         = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['second-opinions', tab],
    queryFn:  () => api.get('/second-opinion', { params: { status: tab === 'pending' ? undefined : 'resolved', limit: 50 } }),
    select:   r => r.data.data,
    refetchInterval: 30_000,
  });

  const items: any[] = data ?? [];

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Conselho Técnico"
        subtitle="Segunda opinião e revisão colegiada — CFM Res. 2.107/2014"
        action={
          <button className="btn-primary" onClick={() => setRequestModal(true)}>
            <Plus size={15} /> Solicitar Segunda Opinião
          </button>
        }
      />

      <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-purple-800/40 bg-purple-950/30 text-xs text-purple-300">
        <Users size={14} className="shrink-0 mt-0.5" />
        <span>
          Todos os acessos e pareceres são registrados no log de auditoria para rastreabilidade clínica.
          Imagens originais são preservadas — anotações salvas como camada adicional (DICOM Presentation State).
        </span>
      </div>

      <div className="flex gap-1 p-1 bg-navy-900 rounded-lg w-fit border border-navy-700">
        {([['pending','Pendentes'],['resolved','Resolvidos']] as const).map(([v, l]) => (
          <button key={v}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === v ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-300'
            }`}
            onClick={() => setTab(v)}
          >{l}</button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                {['Paciente','Modalidade','Motivo','Solicitante','SLA','Status','Revisores','Ação'].map(h => (
                  <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-3 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-navy-800/50">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={8}>
                  <EmptyState icon={Users} title="Nenhum caso pendente" description="Todos os casos foram resolvidos" />
                </td></tr>
              ) : items.map(item => {
                const sc = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
                return (
                  <tr key={item.id} className="border-b border-navy-800/30 table-row-hover">
                    <td className="px-4 py-3">
                      <p className="text-slate-200 font-medium">{item.patient_name}</p>
                      <p className="text-slate-500 text-xs font-mono">{item.medical_record_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge badge-info">{modalityLabel[item.modality_type] ?? item.modality_type}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{REASONS[item.reason]}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{item.requesting_physician}</td>
                    <td className="px-4 py-3">
                      {item.sla_deadline && (
                        <SlaTimer deadline={item.sla_deadline} isOverdue={item.is_overdue} />
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${sc.badge}`}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-slate-400 font-mono text-sm">{item.reviewer_count}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected(item)}>
                        <ChevronRight size={14} /> Analisar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={requestModal} onClose={() => setRequestModal(false)} title="Solicitar Segunda Opinião" size="md">
        <RequestModal onClose={() => setRequestModal(false)} />
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Análise do Conselho Técnico" size="lg">
        {selected && <ReviewModal item={selected} onClose={() => setSelected(null)} />}
      </Modal>
    </div>
  );
}
