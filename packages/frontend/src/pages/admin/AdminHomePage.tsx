import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, Users2, FlaskConical, ShieldCheck, ScrollText } from 'lucide-react';
import { healthUnitsApi, usersApi, proceduresApi } from '../../api/endpoints';

/**
 * Painel de Administração — home dedicada do admin.
 *
 * Concentra as funções de gestão da REDE municipal: unidades, equipe,
 * procedimentos e configurações globais. Nenhum outro perfil acessa essas
 * rotas (rota `/admin/*` é gateada por RoleGuard resource="settings").
 */
export default function AdminHomePage() {
  const { data: units }      = useQuery({ queryKey:['admin-units-count'],      queryFn: () => healthUnitsApi.list(), select: r => (r.data as any).data });
  const { data: usersData }  = useQuery({ queryKey:['admin-users-count'],      queryFn: () => usersApi.list({ limit: 1, page: 1 }), select: r => r.data });
  const { data: procData }   = useQuery({ queryKey:['admin-procedures-count'], queryFn: () => proceduresApi.list({ limit: 1, page: 1 }), select: r => r.data });

  const unitCount = (units as any[] | undefined)?.length ?? 0;
  const userCount = (usersData as any)?.pagination?.total ?? (usersData as any)?.data?.length ?? 0;
  const procCount = (procData as any)?.pagination?.total ?? (procData as any)?.data?.length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background:'var(--color-accent-subtle)', color:'var(--cyan-500)' }}>
          <ShieldCheck size={20}/>
        </div>
        <div>
          <h1 className="font-display font-bold text-xl text-slate-100">Administração da Rede</h1>
          <p className="text-slate-500 text-sm">Gestão de unidades, equipe e procedimentos da rede</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <AdminCard
          to="/admin/units"
          icon={Building2}
          title="Unidades de Saúde"
          subtitle="Cadastro · horários, calendário e procedimentos"
          count={unitCount}
          countLabel="unidades cadastradas"
        />
        <AdminCard
          to="/admin/staff"
          icon={Users2}
          title="Equipe"
          subtitle="Médicos, técnicos, recepção"
          count={userCount}
          countLabel="funcionários"
        />
        <AdminCard
          to="/procedures"
          icon={FlaskConical}
          title="Procedimentos"
          subtitle="Catálogo TUSS da rede"
          count={procCount}
          countLabel="procedimentos"
        />
        <AdminCard
          to="/admin/audit"
          icon={ScrollText}
          title="Auditoria"
          subtitle="Registro de acessos e operações"
        />
      </div>

      <div className="card p-5">
        <h2 className="font-display font-semibold text-slate-100 mb-2">Sobre este painel</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          Esta área é exclusiva do administrador da rede municipal. Aqui você cadastra
          as unidades de saúde, vincula funcionários a cada unidade e gerencia o catálogo
          de procedimentos disponíveis. As alterações feitas aqui afetam toda a rede —
          nenhum outro perfil pode acessar essas funções.
        </p>
      </div>
    </div>
  );
}

function AdminCard({
  to, icon: Icon, title, subtitle, count, countLabel,
}: {
  to: string; icon: React.ElementType; title: string; subtitle: string;
  count?: number; countLabel?: string;
}) {
  return (
    <Link to={to} className="card p-5 hover:border-cyan-500/50 transition-colors cursor-pointer group">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform"
          style={{ background:'var(--color-accent-subtle)', color:'var(--cyan-500)' }}>
          <Icon size={18}/>
        </div>
        {typeof count === 'number' && (
          <div className="text-right">
            <p className="text-2xl font-display font-bold text-slate-100" style={{ lineHeight: 1 }}>{count}</p>
            <p className="text-xs text-slate-600 mt-0.5">{countLabel}</p>
          </div>
        )}
      </div>
      <h3 className="font-display font-semibold text-slate-100">{title}</h3>
      <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
    </Link>
  );
}
