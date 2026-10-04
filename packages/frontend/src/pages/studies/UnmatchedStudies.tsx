import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Trash2, Search } from 'lucide-react';
import { toast } from '../../components/ui/Toast';
import { studiesApi, patientsApi } from '../../api/endpoints';
import { EmptyState, Modal, Spinner, Field } from '../../components/ui';
import { formatDate, getErrorMessage } from '../../utils/format';

interface Unmatched {
  id: string; accession_number?: string; dicom_patient_name?: string; dicom_patient_id?: string;
  modality_type?: string; study_description?: string; study_date?: string; number_of_instances: number;
  reason?: string; received_at: string;
}

/**
 * Fila de conciliação: estudos enviados pelo equipamento (C-STORE) cujo AccessionNumber/PatientID
 * não corresponde a nenhum agendamento ou paciente. O técnico vincula a um paciente ou descarta —
 * o sistema nunca inventa um paciente para "encaixar" o exame.
 */
export default function UnmatchedStudies() {
  const qc = useQueryClient();
  const [target, setTarget] = useState<Unmatched | null>(null);
  const [term, setTerm] = useState('');

  const list = useQuery({
    queryKey: ['studies-unmatched'],
    queryFn:  () => studiesApi.unmatched(),
    select:   r => (r.data as any).data as Unmatched[],
    refetchInterval: 30_000,
  });

  const patients = useQuery({
    queryKey: ['unmatched-pt-search', term],
    queryFn:  () => patientsApi.list({ q: term.trim(), limit: 8 }),
    select:   r => (r.data as any).data as { id: string; name: string; medical_record_number: string; birth_date: string }[],
    enabled:  !!target && term.trim().length >= 3,
  });

  const done = () => { qc.invalidateQueries({ queryKey: ['studies-unmatched'] }); qc.invalidateQueries({ queryKey: ['studies-pending'] }); setTarget(null); setTerm(''); };

  const match = useMutation({
    mutationFn: (patientId: string) => studiesApi.matchUnmatched(target!.id, patientId),
    onSuccess:  () => { toast.success('Estudo vinculado ao paciente'); done(); },
    onError:    (e) => toast.error(getErrorMessage(e)),
  });
  const discard = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => studiesApi.discardUnmatched(id, reason),
    onSuccess:  () => { toast.success('Estudo descartado da fila (permanece no Orthanc)'); done(); },
    onError:    (e) => toast.error(getErrorMessage(e)),
  });

  const rows = list.data ?? [];
  return (
    <div className="card overflow-hidden">
      <p className="px-4 py-3 text-xs text-slate-500 border-b border-navy-700">
        Estudos recebidos do equipamento sem agendamento ou paciente correspondente. Confira o nome/ID que o
        equipamento enviou e vincule ao paciente certo.
      </p>
      {list.isLoading ? <div className="p-8 flex justify-center"><Spinner /></div>
        : rows.length === 0 ? <EmptyState icon={Link2} title="Nada para conciliar" description="Todos os estudos recebidos já estão vinculados." />
        : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-navy-700">
              {['Recebido', 'Nome no equipamento', 'ID / Acesso', 'Modal.', 'Imagens', 'Motivo', 'Ações'].map(h => (
                <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-3 uppercase tracking-wide whitespace-nowrap">{h}</th>))}
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-navy-800/30">
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(r.received_at)}</td>
                  <td className="px-4 py-3 text-slate-200">{r.dicom_patient_name || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-cyan-500">{r.dicom_patient_id || '—'}<br />{r.accession_number || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{r.modality_type || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{r.number_of_instances}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[220px]">{r.reason}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button className="btn-primary px-2 py-1 text-xs" onClick={() => { setTarget(r); setTerm(''); }}><Link2 size={12} /> Vincular</button>
                      <button className="btn-ghost px-2 py-1 text-xs" disabled={discard.isPending} onClick={() => {
                        const reason = window.prompt('Motivo do descarte (ex.: exame de teste):') ?? undefined;
                        if (reason !== undefined) discard.mutate({ id: r.id, reason: reason || undefined });
                      }}><Trash2 size={12} /> Descartar</button>
                    </div>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>)}

      <Modal open={!!target} onClose={() => setTarget(null)} title="Vincular estudo a um paciente" size="md">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Equipamento enviou: <strong className="text-slate-300">{target?.dicom_patient_name || '—'}</strong>
            {target?.dicom_patient_id ? <> · ID <span className="font-mono">{target.dicom_patient_id}</span></> : null}
          </p>
          <Field label="Buscar paciente (nome, CPF ou CNS)">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input className="input pl-9" autoFocus value={term} onChange={e => setTerm(e.target.value)} placeholder="Nome (3+ letras por palavra), CPF ou CNS…" />
            </div>
          </Field>
          {patients.isFetching && <Spinner size={14} />}
          <ul className="divide-y divide-navy-800/50 max-h-56 overflow-y-auto">
            {(patients.data ?? []).map(p => (
              <li key={p.id} className="py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-slate-200 text-sm truncate">{p.name}</p>
                  <p className="text-xs text-slate-500 font-mono">{p.medical_record_number} · {formatDate(p.birth_date)}</p>
                </div>
                <button className="btn-primary px-2 py-1 text-xs" disabled={match.isPending} onClick={() => match.mutate(p.id)}>Vincular</button>
              </li>))}
          </ul>
        </div>
      </Modal>
    </div>
  );
}
