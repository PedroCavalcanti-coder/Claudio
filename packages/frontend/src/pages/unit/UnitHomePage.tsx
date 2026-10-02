import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { healthUnitsApi } from '../../api/endpoints';
import { useAuthStore } from '../../stores/authStore';
import DashboardPage from '../dashboard/DashboardPage';

const TYPE_LABEL: Record<string, string> = {
  ubs: 'Unidade Básica de Saúde', upa: 'Pronto Atendimento',
  hospital: 'Hospital', clinic: 'Clínica / Policlínica', other: 'Unidade de Saúde',
};

/**
 * Home da unidade — landing dos funcionários (não-admin).
 *
 * Mostra um banner com a unidade onde o usuário está lotado e, abaixo, o
 * dashboard operacional (que já vem filtrado por unidade no backend). Reforça
 * visualmente "você está atuando na unidade X" e centraliza a navegação.
 */
export default function UnitHomePage() {
  const user = useAuthStore(s => s.user);
  const { data: unit } = useQuery({
    queryKey: ['my-unit-home'],
    queryFn:  () => healthUnitsApi.mine(),
    select:   r => (r.data as any).data,
    staleTime: 5 * 60_000,
  });

  const name = unit?.name || user?.health_unit_name || 'Minha Unidade';
  const type = unit?.type ? (TYPE_LABEL[unit.type] ?? unit.type) : '';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Banner da unidade */}
      <div
        className="card flex items-center gap-4 p-5"
        style={{ borderLeft: '3px solid var(--cyan-500)' }}
      >
        <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--color-accent-subtle)', color: 'var(--cyan-500)' }}>
          <Building2 size={22} />
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-slate-500">Você está atuando em</div>
          <h1 className="font-display font-bold text-lg text-slate-100 truncate">{name}</h1>
          <div className="text-sm text-slate-500">
            {type}{unit?.cnes ? ` · CNES ${unit.cnes}` : ''}
          </div>
        </div>
      </div>

      {/* Dashboard operacional — dados já filtrados pela unidade no backend */}
      <DashboardPage />
    </div>
  );
}
