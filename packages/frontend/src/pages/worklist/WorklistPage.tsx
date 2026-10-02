import IdentityPicker, { emptyIdentity, identityBody, identityValid, type CheckinIdentity } from '../../components/IdentityPicker';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, CheckCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { useOpenInViewer } from '../../utils/viewer';
import { appointmentsApi } from '../../api/endpoints';
import { Spinner, EmptyState, SectionHeader, Modal } from '../../components/ui';
import { toast } from '../../components/ui/Toast';
import { formatAge, modalityLabel, priorityBadge, priorityLabel, getErrorMessage } from '../../utils/format';



export default function WorklistPage() {
  const qc = useQueryClient();
  const openInViewer = useOpenInViewer();
  const { data: worklist, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['worklist'],
    queryFn:  () => appointmentsApi.worklist(),
    select:   r => r.data.data,
    refetchInterval: 30_000,
  });

  const checkInMut = useMutation({
    mutationFn: ({ id, identity }: { id: string; identity: CheckinIdentity }) => appointmentsApi.checkIn(id, identityBody(identity)),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['worklist'] }); setCheckinTarget(null); setCheckinIdentity(emptyIdentity); toast.success('Check-in realizado'); },
    onError:    (e) => toast.error(getErrorMessage(e)),
  });
  const [checkinTarget, setCheckinTarget] = useState<null|{id:string,patient_name?:string}>(null);
  const [checkinIdentity, setCheckinIdentity] = useState<CheckinIdentity>(emptyIdentity);

  const now = new Date();
  const items = (worklist ?? []) as any[];

  const grouped = {
    waiting:    items.filter(i => ['scheduled','confirmed'].includes(i.status)),
    inProgress: items.filter(i => i.status === 'in_progress'),
    checkedIn:  items.filter(i => i.status === 'checked_in'),
    done:       items.filter(i => i.status === 'done'),
  };

  function minutesUntil(scheduled: string) {
    return Math.round((new Date(scheduled).getTime() - now.getTime()) / 60000);
  }

  function timeLabel(scheduled: string) {
    const mins = minutesUntil(scheduled);
    if (mins < -5) return { label: `${Math.abs(mins)}m atrasado`, color: 'text-red-400' };
    if (mins < 15) return { label: 'Agora', color: 'text-amber-400' };
    return { label: `em ${mins}min`, color: 'text-slate-500' };
  }

  function WorklistCard({ item }: { item: any }) {
    const time = timeLabel(item.scheduled_at);
    return (
      <div className="card-elevated p-4 space-y-3 animate-slide-up">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-slate-200 font-medium">{item.patient_name}</p>
            <p className="text-slate-500 text-xs mt-0.5">
              {item.medical_record_number}
              {item.birth_date && ` · ${formatAge(item.birth_date)}`}
              {item.gender && ` · ${item.gender}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-cyan-400 font-mono text-sm">
              {new Date(item.scheduled_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
            </p>
            <p className={`text-xs ${time.color}`}>{time.label}</p>
          </div>
        </div>

        <div>
          <p className="text-slate-300 text-sm font-medium">{item.procedure_name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="badge badge-info">{modalityLabel[item.modality_type] ?? item.modality_type}</span>
            {item.dicom_ae_title && <span className="text-slate-600 font-mono text-xs">{item.dicom_ae_title}</span>}
            <span className={`badge ${priorityBadge(item.priority)}`}>{priorityLabel(item.priority)}</span>
          </div>
        </div>

        {item.clinical_indication && (
          <p className="text-slate-500 text-xs italic border-l-2 border-navy-600 pl-2">
            {item.clinical_indication}
          </p>
        )}

        <div className="flex gap-2 pt-1 border-t border-navy-700">
          {['scheduled','confirmed'].includes(item.status) && (
            <button
              className="btn-primary flex-1 justify-center py-1.5 text-xs"
              onClick={() => { setCheckinTarget({ id: item.appointment_id, patient_name: item.patient_name }); setCheckinIdentity(emptyIdentity); }}
              disabled={checkInMut.isPending}
            >
              <CheckCircle size={12} /> Check-in
            </button>
          )}
          {item.study_id && (
            <button
              className="btn-ghost flex-1 justify-center py-1.5 text-xs"
              onClick={() => openInViewer(item.study_instance_uid)}
            >
              <ExternalLink size={12} /> Abrir Viewer
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <SectionHeader
          title="Worklist"
          subtitle={`${items.length} exames hoje — atualizado às ${now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`}
        />
        <button className="btn-ghost" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Aguardando',    count: grouped.waiting.length,    color: 'border-blue-700 bg-blue-900/20' },
          { label: 'Chegou',        count: grouped.checkedIn.length,  color: 'border-amber-700 bg-amber-900/20' },
          { label: 'Em andamento',  count: grouped.inProgress.length, color: 'border-cyan-700 bg-cyan-900/20' },
          { label: 'Realizados',    count: grouped.done.length,       color: 'border-emerald-700 bg-emerald-900/20' },
        ].map(s => (
          <div key={s.label} className={`rounded-lg border ${s.color} p-3 text-center`}>
            <p className="text-2xl font-display font-bold text-white">{s.count}</p>
            <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="skeleton h-4 w-1/2 rounded" />
                <div className="skeleton h-5 w-16 rounded-full" />
              </div>
              <div className="skeleton h-3 w-2/3 rounded" />
              <div className="skeleton h-9 rounded-lg" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Activity} title="Worklist vazia" description="Nenhum exame agendado para hoje" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Prioridade: em andamento > chegou > aguardando > feito */}
          {[...grouped.inProgress, ...grouped.checkedIn, ...grouped.waiting, ...grouped.done]
            .map(item => <WorklistCard key={item.appointment_id} item={item} />)}
        </div>
      )}

      {/* Check-in Modal */}
      {checkinTarget && (
        <Modal open onClose={() => setCheckinTarget(null)} title={`Check-in — ${checkinTarget.patient_name ?? ''}`} size="sm">
          <div className="space-y-3">
            <IdentityPicker value={checkinIdentity} onChange={setCheckinIdentity} />
            <div className="flex gap-3 justify-end pt-2 border-t border-navy-700">
              <button className="btn-ghost" onClick={() => setCheckinTarget(null)}>Cancelar</button>
              <button className="btn-primary" disabled={checkInMut.isPending || !identityValid(checkinIdentity)}
                onClick={() => checkInMut.mutate({ id: checkinTarget.id, identity: checkinIdentity })}>
                {checkInMut.isPending ? <Spinner size={14} /> : <><CheckCircle size={14} /> Confirmar Check-in</>}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
