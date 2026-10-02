import { useQuery } from '@tanstack/react-query';
import { Calendar } from 'lucide-react';
import { appointmentsApi } from '../../api/endpoints';
import { Skeleton } from '../../components/ui';
import { appointmentStatusBadge, appointmentStatusLabel } from '../../utils/format';
import { useAuthStore } from '../../stores/authStore';

interface WorklistItem {
  id:             string;
  scheduled_at:   string;
  patient_name:   string;
  procedure_name: string;
  status:         string;
}

export default function DashboardPage() {
  const user    = useAuthStore(s => s.user);
  const hasRole = useAuthStore(s => s.hasRole);
  const today = new Date().toISOString().slice(0, 10);

  // Radiologista/médico não usam a Agenda de Hoje: evita disparar a query e receber 403
  const canSeeAgenda = hasRole('receptionist', 'technician', 'admin');
  const { data: worklist, isLoading: loadingWL } = useQuery({
    queryKey: ['worklist-today'],
    queryFn:  () => appointmentsApi.list({ date: today, limit: 8, page: 1 }),
    select:   r => r.data,
    refetchInterval: 30_000,
    enabled:  canSeeAgenda,
  });

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-xl text-slate-100">
            {greeting}, {user?.name?.split(' ')[0]} 👋
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long' })}
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ background: 'var(--color-success-bg)', border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)' }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--color-success)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>Sistema online</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-slate-100 flex items-center gap-2">
              <Calendar size={16} className="text-cyan-400" /> Agenda de Hoje
            </h2>
            {canSeeAgenda && <span className="badge badge-info">{worklist?.data?.length ?? 0} exames</span>}
          </div>

          {!canSeeAgenda ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Calendar size={32} className="mb-2 opacity-40" />
              <p className="text-sm">A agenda do dia é gerida pela recepção.</p>
              <p className="text-xs text-slate-600 mt-1">Acesse <strong>Worklist</strong> ou <strong>Laudos</strong> para o seu fluxo de trabalho.</p>
            </div>
          ) : loadingWL ? (
            <div className="space-y-2">
              {Array.from({length:5}).map((_,i) => <Skeleton key={i} className="h-14" />)}
            </div>
          ) : worklist?.data?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Calendar size={32} className="mb-2 opacity-40" />
              <p className="text-sm">Nenhum exame agendado para hoje</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {worklist?.data?.map((appt: WorklistItem) => (
                <div key={appt.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-navy-800/60 hover:bg-navy-800 transition-colors">
                  <div className="text-center min-w-[48px]">
                    <p className="text-cyan-400 font-mono text-sm font-medium">
                      {new Date(appt.scheduled_at).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}
                    </p>
                  </div>
                  <div className="w-px h-8 bg-navy-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-200 text-sm font-medium truncate">{appt.patient_name}</p>
                    <p className="text-slate-500 text-xs truncate">{appt.procedure_name}</p>
                  </div>
                  <span className={`badge ${appointmentStatusBadge[appt.status]}`}>
                    {appointmentStatusLabel[appt.status]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
