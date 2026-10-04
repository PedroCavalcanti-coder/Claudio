import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus, Search, Pencil, Trash2, FlaskConical,
} from 'lucide-react';
import { proceduresApi } from '../../api/endpoints';
import {
  Modal, ConfirmDialog, Alert, EmptyState, Spinner, SkeletonRows,
  Field, Select, SectionHeader,
} from '../../components/ui';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface Procedure {
  id: string;
  name: string;
  name_abbrev: string | null;
  tuss_code: string;
  cbhpm_code: string | null;
  modality_type: string | null;
  body_part: string | null;
  duration_minutes: number;
  requires_fasting: boolean;
  fasting_hours: number | null;
  requires_contrast: boolean;
  requires_referral: boolean;
  preparation_instructions: string | null;
  is_active: boolean;
}

const MODALITY_TYPES = ['CR','DX','CT','MR','US','NM','PT','MG','RF','OT','SC','XA'] as const;
const MODALITY_LABELS: Record<string, string> = {
  CR:'Radiografia Computadorizada', DX:'Radiografia Digital', CT:'Tomografia Computadorizada',
  MR:'Ressonância Magnética', US:'Ultrassonografia', NM:'Medicina Nuclear',
  PT:'PET-CT', MG:'Mamografia', RF:'Fluoroscopia', OT:'Outros', SC:'Captura de Tela', XA:'Angiografia',
};

// ── Schema Zod ────────────────────────────────────────────────────────────────
const procedureSchema = z.object({
  name:                     z.string().min(2, 'Mínimo 2 caracteres').max(300),
  name_abbrev:              z.string().max(100).optional().or(z.literal('')),
  tuss_code:                z.string().min(1, 'Obrigatório').max(20),
  cbhpm_code:               z.string().max(10).optional().or(z.literal('')),
  modality_type:            z.string().optional().or(z.literal('')),
  body_part:                z.string().max(100).optional().or(z.literal('')),
  duration_minutes:         z.coerce.number().int().min(5).max(480),
  requires_fasting:         z.boolean(),
  fasting_hours:            z.coerce.number().int().min(1).max(72).optional().or(z.literal('')),
  requires_contrast:        z.boolean(),
  requires_referral:        z.boolean(),
  preparation_instructions: z.string().optional().or(z.literal('')),
});

type FormData = z.infer<typeof procedureSchema>;

// ── Formulário ────────────────────────────────────────────────────────────────
function ProcedureForm({
  defaultValues,
  onSubmit,
  loading,
  error,
}: {
  defaultValues?: Partial<FormData>;
  onSubmit: (data: FormData) => void;
  loading: boolean;
  error: string;
}) {
  const { register, handleSubmit, watch, formState: { errors } } = useForm<z.input<typeof procedureSchema>, unknown, FormData>({
    resolver: zodResolver(procedureSchema),
    defaultValues: {
      duration_minutes: 30,
      requires_fasting: false,
      requires_contrast: false,
      requires_referral: false,
      ...defaultValues,
    },
  });

  const requiresFasting = watch('requires_fasting');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {error && <Alert message={error} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Nome completo" required error={errors.name?.message}>
          <input className="input" placeholder="Ex: Tomografia de Crânio" {...register('name')} />
        </Field>
        <Field label="Abreviação" error={errors.name_abbrev?.message}>
          <input className="input" placeholder="Ex: TC Crânio" {...register('name_abbrev')} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Código TUSS" required error={errors.tuss_code?.message}>
          <input className="input font-mono" placeholder="40304361" {...register('tuss_code')} />
        </Field>
        <Field label="Código CBHPM" error={errors.cbhpm_code?.message}>
          <input className="input font-mono" placeholder="4.01.01.07-2" {...register('cbhpm_code')} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Modalidade" error={errors.modality_type?.message}>
          <Select {...register('modality_type')}>
            <option value="">— Selecione —</option>
            {MODALITY_TYPES.map(m => (
              <option key={m} value={m}>{m} — {MODALITY_LABELS[m]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Região do corpo" error={errors.body_part?.message}>
          <input className="input" placeholder="Ex: Crânio, Tórax" {...register('body_part')} />
        </Field>
      </div>

      <Field label="Duração (minutos)" required error={errors.duration_minutes?.message}>
        <input className="input" type="number" min={5} max={480} {...register('duration_minutes')} />
      </Field>

      {/* Checkboxes */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { field: 'requires_fasting' as const,  label: 'Requer jejum' },
          { field: 'requires_contrast' as const, label: 'Requer contraste' },
          { field: 'requires_referral' as const, label: 'Requer encaminhamento' },
        ].map(({ field, label }) => (
          <label key={field} className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" className="w-4 h-4 rounded accent-cyan-500" {...register(field)} />
            <span className="text-sm text-slate-300">{label}</span>
          </label>
        ))}
      </div>

      {requiresFasting && (
        <Field label="Horas de jejum" error={errors.fasting_hours?.message}>
          <input className="input" type="number" min={1} max={72} placeholder="Ex: 8" {...register('fasting_hours')} />
        </Field>
      )}

      <Field label="Instruções de preparo" error={errors.preparation_instructions?.message}>
        <textarea
          className="input resize-none"
          rows={3}
          placeholder="Instruções para o paciente antes do exame..."
          {...register('preparation_instructions')}
        />
      </Field>

      <div className="flex justify-end pt-2">
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? <Spinner size={14} /> : 'Salvar'}
        </button>
      </div>
    </form>
  );
}

// ── Badge de modalidade ───────────────────────────────────────────────────────
function ModalityBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-slate-600 text-xs">—</span>;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-cyan-900/40 border border-cyan-700/40 text-cyan-300">
      {type}
    </span>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function ProceduresPage() {
  const qc = useQueryClient();
  const [search, setSearch]         = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Procedure | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Procedure | null>(null);
  const [formError, setFormError]   = useState('');

  const { data: procedures = [], isLoading } = useQuery<Procedure[]>({
    queryKey: ['procedures-manage', showInactive],
    queryFn: () =>
      proceduresApi.list(showInactive ? { active: 'all' } : {})
        .then((r: any) => r.data.data),
    staleTime: 30_000,
  });

  const filtered = search.trim().length >= 1
    ? procedures.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.tuss_code.includes(search)
      )
    : procedures;

  const createMut = useMutation({
    mutationFn: (data: FormData) => proceduresApi.create({
      ...data,
      name_abbrev:              data.name_abbrev || null,
      cbhpm_code:               data.cbhpm_code || null,
      modality_type:            data.modality_type || null,
      body_part:                data.body_part || null,
      fasting_hours:            data.fasting_hours || null,
      preparation_instructions: data.preparation_instructions || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['procedures-manage'] });
      qc.invalidateQueries({ queryKey: ['procedures'] });
      setCreateOpen(false);
      setFormError('');
    },
    onError: (e: any) => setFormError(e.response?.data?.message ?? 'Erro ao criar procedimento'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormData }) =>
      proceduresApi.update(id, {
        ...data,
        name_abbrev:              data.name_abbrev || null,
        cbhpm_code:               data.cbhpm_code || null,
        modality_type:            data.modality_type || null,
        body_part:                data.body_part || null,
        fasting_hours:            data.fasting_hours || null,
        preparation_instructions: data.preparation_instructions || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['procedures-manage'] });
      qc.invalidateQueries({ queryKey: ['procedures'] });
      setEditTarget(null);
      setFormError('');
    },
    onError: (e: any) => setFormError(e.response?.data?.message ?? 'Erro ao atualizar procedimento'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => proceduresApi.deactivate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['procedures-manage'] });
      qc.invalidateQueries({ queryKey: ['procedures'] });
      setDeleteTarget(null);
    },
  });

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <SectionHeader
        title="Procedimentos"
        subtitle="Catálogo de exames disponíveis para agendamento"
        action={
          <button className="btn-primary flex items-center gap-2" onClick={() => { setFormError(''); setCreateOpen(true); }}>
            <Plus size={15} /> Novo procedimento
          </button>
        }
      />

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            className="input pl-9 w-full"
            placeholder="Buscar por nome ou código TUSS..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            className="w-4 h-4 rounded accent-cyan-500"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
          />
          Incluir inativos
        </label>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700">
                  {['Nome','TUSS','Modalidade','Duração','Req.','Status',''].map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-slate-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <SkeletonRows rows={8} cols={7} />
              </tbody>
            </table>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="Nenhum procedimento encontrado"
            description={search ? 'Tente outro termo de busca.' : 'Cadastre o primeiro procedimento.'}
            action={
              <button className="btn-primary flex items-center gap-2" onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> Novo procedimento
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-700">
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Nome</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">TUSS</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Modalidade</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Duração</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Req.</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-800/60">
                {filtered.map(p => (
                  <tr key={p.id} className="hover:bg-navy-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-slate-200 font-medium">{p.name}</p>
                      {p.name_abbrev && (
                        <p className="text-slate-500 text-xs">{p.name_abbrev}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300 text-xs">{p.tuss_code}</td>
                    <td className="px-4 py-3"><ModalityBadge type={p.modality_type} /></td>
                    <td className="px-4 py-3 text-slate-400">{p.duration_minutes} min</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        {p.requires_fasting   && <span className="text-amber-400 text-xs">Jejum</span>}
                        {p.requires_contrast  && <span className="text-purple-400 text-xs">Contraste</span>}
                        {p.requires_referral  && <span className="text-blue-400 text-xs">Encaminhamento</span>}
                        {!p.requires_fasting && !p.requires_contrast && !p.requires_referral && (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                        p.is_active
                          ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300'
                          : 'bg-slate-800/40 border-slate-700/40 text-slate-500'
                      }`}>
                        {p.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          className="btn-ghost p-1.5"
                          onClick={() => { setFormError(''); setEditTarget(p); }}
                          title="Editar"
                        >
                          <Pencil size={14} />
                        </button>
                        {p.is_active && (
                          <button
                            className="btn-ghost p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/20"
                            onClick={() => setDeleteTarget(p)}
                            title="Desativar"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal criar */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo procedimento" size="lg">
        <ProcedureForm
          onSubmit={data => createMut.mutate(data)}
          loading={createMut.isPending}
          error={formError}
        />
      </Modal>

      {/* Modal editar */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Editar procedimento" size="lg">
        {editTarget && (
          <ProcedureForm
            defaultValues={{
              name:                     editTarget.name,
              name_abbrev:              editTarget.name_abbrev ?? '',
              tuss_code:                editTarget.tuss_code,
              cbhpm_code:               editTarget.cbhpm_code ?? '',
              modality_type:            editTarget.modality_type ?? '',
              body_part:                editTarget.body_part ?? '',
              duration_minutes:         editTarget.duration_minutes,
              requires_fasting:         editTarget.requires_fasting,
              fasting_hours:            editTarget.fasting_hours ?? undefined,
              requires_contrast:        editTarget.requires_contrast,
              requires_referral:        editTarget.requires_referral,
              preparation_instructions: editTarget.preparation_instructions ?? '',
            }}
            onSubmit={data => updateMut.mutate({ id: editTarget.id, data })}
            loading={updateMut.isPending}
            error={formError}
          />
        )}
      </Modal>

      {/* Confirmar desativação */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Desativar procedimento"
        message={`Deseja desativar "${deleteTarget?.name}"? Agendamentos existentes não serão afetados.`}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
        loading={deleteMut.isPending}
        danger
      />
    </div>
  );
}
