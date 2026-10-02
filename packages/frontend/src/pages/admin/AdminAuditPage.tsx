import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { auditApi } from '../../api/endpoints';
import { SkeletonRows, Field, Pagination } from '../../components/ui';

type AuditRow = {
  id: string; user_email?: string; user_role?: string; action: string;
  resource_type?: string; resource_id?: string; ip_address?: string;
  details?: any; created_at: string;
};

export default function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [dateFrom, setDateFrom] = useState('');

  const { data: actions = [] } = useQuery({
    queryKey: ['audit-actions'],
    queryFn:  () => auditApi.actions(),
    select:   r => (r.data as any).data as string[],
    staleTime: 5 * 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, action, resourceType, userEmail, dateFrom],
    queryFn:  () => auditApi.list({
      page, limit: 30,
      ...(action ? { action } : {}),
      ...(resourceType ? { resource_type: resourceType } : {}),
      ...(userEmail ? { user_email: userEmail } : {}),
      ...(dateFrom ? { date_from: dateFrom } : {}),
    }),
    select: r => r.data as any,
  });
  const rows: AuditRow[] = data?.data ?? [];
  const totalPages = data?.pagination?.totalPages ?? 1;

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background:'var(--color-accent-subtle)', color:'var(--cyan-500)' }}>
          <ScrollText size={18}/>
        </div>
        <div>
          <h1 className="font-display font-bold text-xl text-slate-100">Auditoria</h1>
          <p className="text-slate-500 text-sm">Registro imutável de operações (LGPD Art. 37)</p>
        </div>
      </header>

      <div className="card p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Ação">
          <select className="input" value={action} onChange={e => { setAction(e.target.value); setPage(1); }}>
            <option value="">Todas</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Tipo de recurso">
          <input className="input" value={resourceType} onChange={e => { setResourceType(e.target.value); setPage(1); }} placeholder="patient, study, report..."/>
        </Field>
        <Field label="E-mail do usuário">
          <input className="input" value={userEmail} onChange={e => { setUserEmail(e.target.value); setPage(1); }} placeholder="parte do e-mail"/>
        </Field>
        <Field label="A partir de">
          <input className="input" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}/>
        </Field>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-navy-900/50 border-b border-navy-800/40">
            <tr>
              {['Quando','Usuário','Ação','Recurso','IP'].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows rows={8} cols={5} />
            ) : !rows.length ? (
              <tr><td colSpan={5} className="text-center p-8 text-slate-500">Nenhum registro para o filtro.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-b border-navy-800/30">
                <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap font-mono text-xs">
                  {new Date(r.created_at).toLocaleString('pt-BR')}
                </td>
                <td className="px-4 py-2.5 text-slate-300">
                  {r.user_email ?? '—'}
                  {r.user_role && <span className="text-slate-600 text-xs"> · {r.user_role}</span>}
                </td>
                <td className="px-4 py-2.5"><span className="badge badge-neutral" style={{ fontSize: 10 }}>{r.action}</span></td>
                <td className="px-4 py-2.5 text-slate-400 text-xs">
                  {r.resource_type ?? '—'}{r.resource_id ? ` · ${r.resource_id.slice(0,8)}…` : ''}
                </td>
                <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{r.ip_address ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-end">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
