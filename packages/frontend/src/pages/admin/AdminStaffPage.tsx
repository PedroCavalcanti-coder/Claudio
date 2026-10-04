import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users2, Plus, Pencil, Power, KeyRound, Copy } from 'lucide-react';
import { usersApi, healthUnitsApi } from '../../api/endpoints';
import { Spinner, SkeletonRows, Field } from '../../components/ui';
import TermsCheckbox from '../../components/TermsCheckbox';
import { toast } from '../../components/ui/Toast';

type UserRow = {
  id: string; name: string; email: string; role: string;
  crm?: string; crm_uf?: string; specialty?: string;
  is_active: boolean; health_unit_id?: string; health_unit_name?: string;
  is_network_resource?: boolean; shared_specialties?: string[]; extra_roles?: string[];
  shifts?: { id: string; name: string; start_time: string; end_time: string }[];
  created_at: string;
};
type Unit = { id: string; name: string; is_active: boolean };

const ROLE_LABEL: Record<string,string> = {
  admin:'Admin', radiologist:'Radiologista', technician:'Técnico',
  receptionist:'Recepção', doctor:'Médico', patient:'Paciente',
};
const ROLE_BADGE: Record<string,string> = {
  admin:'badge-danger', radiologist:'badge-info', technician:'badge-neutral',
  receptionist:'badge-success', doctor:'badge-warning', patient:'badge-neutral',
};

export default function AdminStaffPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filterUnit, setFilterUnit] = useState<string>('');

  const { data: usersResp, isLoading } = useQuery({
    queryKey: ['admin-staff', filterUnit],
    queryFn:  () => usersApi.list({ limit: 100, page: 1, ...(filterUnit ? { health_unit_id: filterUnit } : {}) }),
    select:   r => r.data as any,
  });
  const users: UserRow[] = usersResp?.data ?? [];

  const { data: units = [] } = useQuery({
    queryKey: ['admin-units-for-staff'],
    queryFn:  () => healthUnitsApi.list(),
    select:   r => (r.data as any).data as Unit[],
  });

  const createMut = useMutation({
    mutationFn: (d: any) => usersApi.create(d),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['admin-staff'] });
      setShowForm(false);
      const u = r.data?.data;
      // Senha provisória gerada no backend: aparece UMA vez
      setResetResult({ name: u.name, email: u.email, password: u.temp_password, created: true });
    },
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Falha ao criar funcionário'),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id:string; data:any }) => usersApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-staff'] }); setEditing(null); toast.success('Funcionário atualizado'); },
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Falha ao atualizar'),
  });
  const deactivateMut = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-staff'] }); toast.success('Funcionário desativado'); },
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Falha'),
  });
  // Sem envio de e-mail/SMS: a senha provisória é gerada no BACKEND e exibida uma única vez.
  const [resetResult, setResetResult] = useState<null | { name: string; email: string; password: string; created?: boolean }>(null);
  const resetMut = useMutation({
    mutationFn: (u: UserRow) =>
      usersApi.resetPassword(u.id).then((r) => ({ name: u.name, email: u.email, password: (r.data as any).data.temp_password as string })),
    onSuccess: (r: any) => setResetResult(r),
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Falha ao resetar senha'),
  });

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background:'var(--color-accent-subtle)', color:'var(--cyan-500)' }}>
            <Users2 size={18}/>
          </div>
          <div>
            <h1 className="font-display font-bold text-xl text-slate-100">Equipe da Rede</h1>
            <p className="text-slate-500 text-sm">Funcionários vinculados às unidades de saúde</p>
          </div>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus size={14}/> Novo funcionário
        </button>
      </header>

      <div className="flex items-center gap-3">
        <Field label="Filtrar por unidade">
          <select className="input" value={filterUnit} onChange={e => setFilterUnit(e.target.value)}>
            <option value="">Todas as unidades</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
      </div>

      {(showForm || editing) && (
        <StaffForm
          initial={editing}
          units={units}
          onClose={() => { setEditing(null); setShowForm(false); }}
          onSubmit={(data) => {
            if (editing) updateMut.mutate({ id: editing.id, data });
            else         createMut.mutate(data);
          }}
          submitting={createMut.isPending || updateMut.isPending}
        />
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-navy-900/50 border-b border-navy-800/40">
            <tr>
              {['Nome','E-mail','Perfil','Unidade','Turnos','CRM','Status','Ações'].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows rows={6} cols={8} />
            ) : !users.length ? (
              <tr><td colSpan={7} className="text-center p-8 text-slate-500">Nenhum funcionário neste filtro.</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className={`border-b border-navy-800/30 ${!u.is_active ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 text-slate-200 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-slate-400">{u.email}</td>
                <td className="px-4 py-3"><span className={`badge ${ROLE_BADGE[u.role]}`}>{ROLE_LABEL[u.role] ?? u.role}</span></td>
                <td className="px-4 py-3 text-slate-400">
                  {u.is_network_resource
                    ? <span title={(u.shared_specialties||[]).join(', ') || 'Acessa todas as unidades'}>
                        Recurso de rede{u.shared_specialties?.length ? ` (${u.shared_specialties.join(', ')})` : ''}
                      </span>
                    : (u.health_unit_name ?? (u.role === 'admin' ? 'Rede inteira' : '—'))}
                </td>
                <td className="px-4 py-3">
                  {u.shifts?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {u.shifts.map(s => (
                        <span key={s.id} className="badge badge-info text-[10px]"
                          title={`${s.start_time?.slice(0,5)}–${s.end_time?.slice(0,5)}`}>
                          {s.name}
                        </span>
                      ))}
                    </div>
                  ) : <span className="text-slate-600 text-xs">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-400 font-mono text-xs">{u.crm ? `${u.crm}${u.crm_uf?'/'+u.crm_uf:''}` : '—'}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${u.is_active ? 'badge-success' : 'badge-neutral'}`}>
                    {u.is_active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(u)}>
                      <Pencil size={12}/> Editar
                    </button>
                    <button className="btn-ghost px-2 py-1 text-xs" title="Gerar nova senha temporária"
                      disabled={resetMut.isPending} onClick={() => resetMut.mutate(u)}>
                      <KeyRound size={12}/> Senha
                    </button>
                    {u.is_active && (
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => deactivateMut.mutate(u.id)}>
                        <Power size={12}/> Desativar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resetResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setResetResult(null)}>
          <div className="card p-4 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-100 mb-2">{resetResult.created ? 'Funcionário criado' : 'Senha redefinida'}</h3>
            <p className="text-sm text-slate-300 mb-3">{resetResult.created ? 'Senha provisória de' : 'Nova senha temporária de'} <b>{resetResult.name}</b> ({resetResult.email}):</p>
            <div className="flex items-center gap-2 mb-3">
              <code className="flex-1 px-3 py-2 rounded bg-navy-900 border border-navy-700 text-cyan-300 font-mono text-sm select-all">{resetResult.password}</code>
              <button className="btn-ghost px-2 py-2" title="Copiar"
                onClick={() => { navigator.clipboard?.writeText(resetResult.password); toast.success('Senha copiada'); }}>
                <Copy size={14}/>
              </button>
            </div>
            <p className="text-[11px] text-slate-600 mb-3">Mostrada só agora. Entregue ao funcionário: no primeiro acesso o sistema exige que ele defina a própria senha.</p>
            <div className="flex justify-end"><button className="btn-primary" onClick={() => setResetResult(null)}>Concluído</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function StaffForm({ initial, units, onClose, onSubmit, submitting }: {
  initial: UserRow | null; units: Unit[]; onClose: () => void;
  onSubmit: (data: any) => void; submitting: boolean;
}) {
  const [name, setName]   = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [role, setRole]   = useState(initial?.role ?? 'technician');
  const [crm, setCrm]     = useState(initial?.crm ?? '');
  const [crmUf, setCrmUf] = useState(initial?.crm_uf ?? '');
  const [specialty, setSpecialty] = useState(initial?.specialty ?? '');
  const [unitId, setUnitId] = useState(initial?.health_unit_id ?? '');
  const [agreed, setAgreed] = useState(false);
  const [isNetworkResource, setIsNetworkResource] = useState(!!initial?.is_network_resource);
  const [sharedSpecialtiesText, setSharedSpecialtiesText] = useState(
    (initial?.shared_specialties || []).join(', ')
  );
  const [extraRoles, setExtraRoles] = useState<string[]>(initial?.extra_roles || []);
  const requiresCrm = role === 'radiologist' || role === 'doctor';

  const ALL_ROLES = ['radiologist', 'technician', 'receptionist', 'doctor', 'nurse'];
  const ROLE_PT: Record<string,string> = { radiologist:'Radiologista', technician:'Técnico', receptionist:'Recepção', doctor:'Médico', nurse:'Enfermagem' };
  const toggleExtra = (r: string) =>
    setExtraRoles(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);

  const submit = () => {
    const data: any = {
      name: name.trim(), email: email.trim().toLowerCase(), role,
      crm: crm || undefined, crm_uf: crmUf || undefined, specialty: specialty || undefined,
      health_unit_id: role === 'admin' ? undefined : (unitId || undefined),
      is_network_resource: isNetworkResource,
      shared_specialties: sharedSpecialtiesText
        .split(',').map(s => s.trim()).filter(Boolean),
      extra_roles: extraRoles.filter(r => r !== role),
    };
    onSubmit(data);
  };

  return (
    <div className="card p-5">
      <h2 className="font-display font-semibold text-slate-100 mb-4">
        {initial ? 'Editar funcionário' : 'Novo funcionário'}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Field label="Nome completo" required>
          <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus/>
        </Field>
        <Field label="E-mail" required>
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={!!initial}/>
        </Field>
        <Field label="Perfil" required>
          <select className="input" value={role} onChange={e => setRole(e.target.value)}>
            <option value="admin">Admin (rede inteira)</option>
            <option value="radiologist">Radiologista</option>
            <option value="doctor">Médico Solicitante</option>
            <option value="technician">Técnico</option>
            <option value="receptionist">Recepção</option>
            <option value="nurse">Enfermagem</option>
          </select>
        </Field>
        {role !== 'admin' && (
          <Field label="Unidade de lotação" required>
            <select className="input" value={unitId} onChange={e => setUnitId(e.target.value)}>
              <option value="">— Selecione —</option>
              {units.filter(u => u.is_active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        )}
        {requiresCrm && (
          <>
            <Field label="CRM" required>
              <input className="input font-mono" value={crm} onChange={e => setCrm(e.target.value)}/>
            </Field>
            <Field label="UF do CRM">
              <input className="input font-mono uppercase" value={crmUf} onChange={e => setCrmUf(e.target.value.toUpperCase())} maxLength={2}/>
            </Field>
            <Field label="Especialidade">
              <input className="input" value={specialty} onChange={e => setSpecialty(e.target.value)} placeholder="Ex: Radiologia, Ortopedia..."/>
            </Field>
          </>
        )}
      </div>

      {role !== 'admin' && role !== 'patient' && role !== 'receptionist' && (
        <div className="border-t border-navy-800/40 pt-3 mb-4 space-y-2">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isNetworkResource}
              onChange={e => setIsNetworkResource(e.target.checked)}
              className="mt-1 accent-cyan-500"
            />
            <div>
              <div className="text-sm text-slate-200 font-medium">Recurso compartilhado da rede</div>
              <div className="text-xs text-slate-500">
                Permite atender pacientes de qualquer unidade sem precisar de encaminhamento.
                Use quando este profissional é o único da especialidade na rede.
              </div>
            </div>
          </label>
          {isNetworkResource && (
            <Field label="Especialidades compartilhadas (separe por vírgula)">
              <input
                className="input"
                value={sharedSpecialtiesText}
                onChange={e => setSharedSpecialtiesText(e.target.value)}
                placeholder="Ex: Radiologia, Cardiologia"
              />
            </Field>
          )}
        </div>
      )}

      {role !== 'admin' && (
        <div className="border-t border-navy-800/40 pt-3 mb-4">
          <div className="text-sm text-slate-200 font-medium">Acessos adicionais (perfil)</div>
          <div className="text-xs text-slate-500 mb-2">
            Concede a este funcionário o acesso de outros papéis, além do seu papel-base.
            Ex.: recepção que também faz upload (técnico).
          </div>
          <div className="flex flex-wrap gap-3">
            {ALL_ROLES.filter(r => r !== role).map(r => (
              <label key={r} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" className="accent-cyan-500"
                  checked={extraRoles.includes(r)} onChange={() => toggleExtra(r)} />
                {ROLE_PT[r]}
              </label>
            ))}
          </div>
        </div>
      )}

      {!initial && (
        <div className="border-t border-navy-800/40 pt-3 mb-3">
          <TermsCheckbox checked={agreed} onChange={setAgreed}
            label="O funcionário foi informado e concorda com os" />
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button className="btn-ghost" onClick={onClose} disabled={submitting}>Cancelar</button>
        <button
          className="btn-primary"
          disabled={submitting || !name.trim() || !email.trim() || (!initial && !agreed) || (role !== 'admin' && !unitId) || (requiresCrm && !crm)}
          onClick={submit}
        >
          {submitting ? <Spinner size={14}/> : (initial ? 'Salvar' : 'Criar funcionário')}
        </button>
      </div>
    </div>
  );
}
