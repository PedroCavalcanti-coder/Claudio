import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { Building2, ArrowLeft } from 'lucide-react';
import { healthUnitsApi } from '../../api/endpoints';
import { useAuthStore } from '../../stores/authStore';
import AvailabilityPage from './AvailabilityPage';
import ShiftsSection from './ShiftsSection';

const TYPE_LABEL: Record<string, string> = {
  clinic: 'Clínica', hospital: 'Hospital', ubs: 'UBS', upa: 'UPA', other: 'Outro',
};

/**
 * Página de gestão de UMA unidade (/admin/units/:id).
 * Concentra a configuração operacional da unidade: horários de atendimento,
 * calendário/feriados e os procedimentos oferecidos — tudo escopado a ela.
 */
export default function UnitManagePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isAdmin = useAuthStore(s => s.user?.role) === 'admin';

  // Admin pode listar todas as unidades; recepção lê só a sua via /mine.
  const { data: unit, isLoading } = useQuery({
    queryKey: ['unit', id, isAdmin],
    queryFn:  async () => {
      if (isAdmin) {
        const r = await healthUnitsApi.list();
        return ((r.data as any).data as any[]).find(u => u.id === id);
      }
      const r = await healthUnitsApi.mine();
      const d = (r.data as any).data;
      const arr = Array.isArray(d) ? d : [d];
      return arr.find((u: any) => u.id === id) ?? arr[0];
    },
    enabled: !!id,
  });

  if (isLoading) return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="skeleton w-10 h-10 rounded-lg" />
        <div className="space-y-2">
          <div className="skeleton h-5 w-48 rounded" />
          <div className="skeleton h-3 w-32 rounded" />
        </div>
      </div>
      <div className="skeleton h-40 rounded-xl" />
      <div className="skeleton h-64 rounded-xl" />
    </div>
  );
  if (!unit) {
    return (
      <div className="p-6">
        <button className="btn-ghost mb-4" onClick={() => navigate('/admin/units')}><ArrowLeft size={14} /> Voltar</button>
        <p className="text-slate-400">Unidade não encontrada.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        {isAdmin && (
          <button className="btn-ghost px-2 py-2" onClick={() => navigate('/admin/units')} title="Voltar para Unidades">
            <ArrowLeft size={16} />
          </button>
        )}
        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--color-accent-subtle)', color: 'var(--cyan-500)' }}>
          <Building2 size={18} />
        </div>
        <div>
          <h1 className="font-display font-bold text-xl text-slate-100">{unit.name}</h1>
          <p className="text-slate-500 text-sm">
            {TYPE_LABEL[unit.type] ?? unit.type}
            {unit.cnes ? ` · CNES ${unit.cnes}` : ''}
            {' · '}Funcionamento, calendário e procedimentos da unidade
          </p>
        </div>
      </div>

      <ShiftsSection unitId={id!} />

      <AvailabilityPage fixedUnitId={id} embedded />
    </div>
  );
}
