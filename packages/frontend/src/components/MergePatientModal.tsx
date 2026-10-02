import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { GitMerge, Search, AlertTriangle } from 'lucide-react';
import { patientsApi } from '../api/endpoints';
import { Modal, Spinner } from './ui';
import { toast } from './ui/Toast';
import type { Patient } from '../types';

// Merge de cadastro duplicado: estudos/agendamentos do duplicado migram para o sobrevivente, que é inativado (não excluído).
export default function MergePatientModal({ survivor, onClose, onMerged }: {
  survivor: Patient; onClose: () => void; onMerged: () => void;
}) {
  const [term, setTerm]         = useState('');
  const [query, setQuery]       = useState('');
  const [selected, setSelected] = useState<Patient | null>(null);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['merge-search', query],
    queryFn:  () => patientsApi.list({ q: query, limit: 10, page: 1 }),
    enabled:  query.length >= 3,
    select:   r => ((r.data as any).data as Patient[]).filter(p => p.id !== survivor.id),
  });

  const mergeMut = useMutation({
    mutationFn: () => patientsApi.merge(survivor.id, selected!.id),
    onSuccess: () => { toast.success('Pacientes mesclados'); onMerged(); onClose(); },
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Falha ao mesclar'),
  });

  return (
    <Modal open onClose={onClose} title="Mesclar paciente duplicado" size="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          Manter: <strong className="text-slate-200">{survivor.name}</strong>
          <span className="text-slate-500"> (Pront. {survivor.medical_record_number})</span>
        </p>

        <div className="flex gap-2">
          <input className="input flex-1" placeholder="Buscar duplicado por nome, CPF ou CNS…"
            value={term} onChange={e => setTerm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setQuery(term.trim()); }} />
          <button className="btn-ghost shrink-0" onClick={() => setQuery(term.trim())}><Search size={14} /></button>
        </div>

        <div className="card max-h-56 overflow-y-auto divide-y divide-navy-800/60">
          {isFetching ? (
            <div className="p-4 text-center"><Spinner size={16} /></div>
          ) : query.length < 3 ? (
            <div className="p-4 text-xs text-slate-500 text-center">Digite ao menos 3 caracteres e busque.</div>
          ) : !results.length ? (
            <div className="p-4 text-xs text-slate-500 text-center">Nenhum outro paciente encontrado.</div>
          ) : results.map(p => (
            <button key={p.id} onClick={() => setSelected(p)}
              className={`w-full text-left px-3.5 py-2.5 transition-colors hover:bg-navy-800/50 ${selected?.id === p.id ? 'bg-cyan-900/20' : ''}`}>
              <div className="text-sm text-slate-200 font-medium">{p.name}</div>
              <div className="text-xs text-slate-500">
                Pront. {p.medical_record_number}{(p as any).cpf ? ` · CPF ${(p as any).cpf}` : ''}{(p as any).cns ? ` · CNS ${(p as any).cns}` : ''}{p.is_active === false ? ' · INATIVO' : ''}
              </div>
            </button>
          ))}
        </div>

        {selected && (
          <div className="flex gap-2 rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2.5 text-xs text-amber-300">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <strong>{selected.name}</strong> será absorvido por <strong>{survivor.name}</strong>: estudos, agendamentos e
              histórico passam para o sobrevivente e o duplicado é <strong>inativado</strong>. Ação registrada em auditoria.
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2 border-t border-navy-700">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-danger" disabled={!selected || mergeMut.isPending} onClick={() => mergeMut.mutate()}>
            {mergeMut.isPending ? <Spinner size={14} /> : <><GitMerge size={13} /> Mesclar no atual</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
