import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, Pencil, Power, Settings2 } from 'lucide-react';
import { healthUnitsApi } from '../../api/endpoints';
import { Spinner, SkeletonRows, Field } from '../../components/ui';
import { toast } from '../../components/ui/Toast';

type Unit = {
  id: string; name: string; cnpj?: string; cnes?: string; type: string;
  phone?: string; email?: string; is_active: boolean; user_count?: number;
};

const TYPE_LABEL: Record<string,string> = {
  clinic:'Clínica', hospital:'Hospital', ubs:'UBS', upa:'UPA', other:'Outro',
};

export default function AdminUnitsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Unit | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data: units, isLoading } = useQuery({
    queryKey: ['admin-units'],
    queryFn:  () => healthUnitsApi.list(),
    select:   r => (r.data as any).data as Unit[],
  });

  const createMut = useMutation({
    mutationFn: (d: any) => healthUnitsApi.create(d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-units'] }); setShowForm(false); toast.success('Unidade criada'); },
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Falha ao criar unidade'),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id:string; data:any }) => healthUnitsApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-units'] }); setEditing(null); toast.success('Unidade atualizada'); },
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Falha ao atualizar'),
  });
  const toggleActive = (u: Unit) => updateMut.mutate({ id: u.id, data: { is_active: !u.is_active } });

  return (
    <div className="space-y-5 animate-fade-in">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background:'var(--color-accent-subtle)', color:'var(--cyan-500)' }}>
            <Building2 size={18}/>
          </div>
          <div>
            <h1 className="font-display font-bold text-xl text-slate-100">Unidades de Saúde</h1>
            <p className="text-slate-500 text-sm">Hospitais, postos, clínicas e policlínicas da rede</p>
          </div>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus size={14}/> Nova unidade
        </button>
      </header>

      {(showForm || editing) && (
        <UnitForm
          initial={editing}
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
              {['Nome','Tipo','CNES','Telefone','Funcionários','Status','Ações'].map(h => (
                <th key={h} className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows rows={6} cols={7} />
            ) : !units?.length ? (
              <tr><td colSpan={7} className="text-center p-8 text-slate-500">
                Nenhuma unidade cadastrada. Crie a primeira clicando em "Nova unidade".
              </td></tr>
            ) : units.map(u => (
              <tr key={u.id} className={`border-b border-navy-800/30 ${!u.is_active ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 text-slate-200 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-slate-400">{TYPE_LABEL[u.type] ?? u.type}</td>
                <td className="px-4 py-3 text-slate-400 font-mono text-xs">{u.cnes ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400">{u.phone ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400">{u.user_count ?? 0}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${u.is_active ? 'badge-success' : 'badge-neutral'}`}>
                    {u.is_active ? 'Ativa' : 'Inativa'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button className="btn-primary px-2 py-1 text-xs" onClick={() => navigate(`/admin/units/${u.id}`)}>
                      <Settings2 size={12}/> Gerenciar
                    </button>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(u)}>
                      <Pencil size={12}/> Editar
                    </button>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => toggleActive(u)}>
                      <Power size={12}/> {u.is_active ? 'Desativar' : 'Reativar'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UnitForm({ initial, onClose, onSubmit, submitting }: {
  initial: Unit | null; onClose: () => void;
  onSubmit: (data: any) => void; submitting: boolean;
}) {
  const [name,  setName]  = useState(initial?.name ?? '');
  const [type,  setType]  = useState(initial?.type ?? 'ubs');
  const [cnes,  setCnes]  = useState(initial?.cnes ?? '');
  const [cnpj,  setCnpj]  = useState(initial?.cnpj ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');

  return (
    <div className="card p-5">
      <h2 className="font-display font-semibold text-slate-100 mb-4">
        {initial ? 'Editar unidade' : 'Nova unidade de saúde'}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Field label="Nome" required>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: UBS Centro" autoFocus/>
        </Field>
        <Field label="Tipo">
          <select className="input" value={type} onChange={e => setType(e.target.value)}>
            <option value="ubs">UBS — Unidade Básica de Saúde</option>
            <option value="upa">UPA — Pronto Atendimento</option>
            <option value="hospital">Hospital</option>
            <option value="clinic">Clínica / Policlínica</option>
            <option value="other">Outro</option>
          </select>
        </Field>
        <Field label="CNES">
          <input className="input font-mono" value={cnes} onChange={e => setCnes(e.target.value)} placeholder="0000000" maxLength={7}/>
        </Field>
        <Field label="CNPJ">
          <input className="input font-mono" value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="00.000.000/0000-00"/>
        </Field>
        <Field label="Telefone">
          <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(00) 0000-0000"/>
        </Field>
        <Field label="E-mail">
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)}/>
        </Field>
      </div>
      <div className="flex gap-2 justify-end">
        <button className="btn-ghost" onClick={onClose} disabled={submitting}>Cancelar</button>
        <button
          className="btn-primary"
          disabled={submitting || !name.trim()}
          onClick={() => onSubmit({ name: name.trim(), type, cnes: cnes || null, cnpj: cnpj || null, phone: phone || null, email: email || null })}
        >
          {submitting ? <Spinner size={14}/> : (initial ? 'Salvar' : 'Criar unidade')}
        </button>
      </div>
    </div>
  );
}
