import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, PenLine, CheckCircle, Download, RotateCcw } from 'lucide-react';
import { reportsApi } from '../../api/endpoints';
import type { Report } from '../../types';
import {
  Modal, Spinner, EmptyState, Pagination, Alert,
  Field, SectionHeader,
} from '../../components/ui';
import { formatDate, formatDateTime, reportStatusBadge, reportStatusLabel, getErrorMessage } from '../../utils/format';

function ReportEditor({ report, onClose }: { report: Report; onClose: () => void }) {
  const qc = useQueryClient();
  const [content] = useState(report.content_html ?? '');
  const [findings, setFindings]     = useState(report.findings ?? '');
  const [conclusion, setConclusion] = useState(report.conclusion ?? '');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const updateMut = useMutation({
    mutationFn: () => reportsApi.update(report.id, { findings, conclusion, content_html: content }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['reports'] }); setSuccess('Laudo salvo!'); },
    onError:    (err) => setError(getErrorMessage(err)),
  });

  const signMut = useMutation({
    // Nome/CRM do signatário vêm do cadastro do radiologista, no backend.
    mutationFn: async () => {
      // Grava o texto atual antes de assinar (o laudo assinado é renderizado dos campos estruturados).
      await reportsApi.update(report.id, { findings, conclusion, content_html: content });
      return reportsApi.sign(report.id, {
        findings:        findings.trim(),
        conclusion:      conclusion.trim(),
        technique:       report.technique,
        recommendations: report.recommendations,
      });
    },
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['reports'] }); onClose(); },
    onError:    (err) => setError(getErrorMessage(err)),
  });

  const isEditable = ['draft','review'].includes(report.status);

  return (
    <div className="space-y-4">
      {error   && <Alert type="error"   message={error}   onClose={() => setError('')} />}
      {success && <Alert type="success" message={success} onClose={() => setSuccess('')} />}

      <div className="grid grid-cols-2 gap-3 text-xs text-slate-500 p-3 rounded-lg bg-navy-800/50 border border-navy-700">
        <div><span className="text-slate-600">Acesso:</span> <span className="font-mono text-cyan-500">{report.accession_number}</span></div>
        <div><span className="text-slate-600">Modalidade:</span> <span className="text-slate-400">{report.modality_type}</span></div>
        <div><span className="text-slate-600">Data:</span> <span className="text-slate-400">{formatDate(report.study_date)}</span></div>
        <div><span className="text-slate-600">Paciente:</span> <span className="text-slate-400">{report.patient_name}</span></div>
      </div>

      <Field label="Achados">
        <textarea
          className="input resize-none h-28"
          placeholder="Descreva os achados do exame..."
          value={findings}
          onChange={e => setFindings(e.target.value)}
          disabled={!isEditable}
        />
      </Field>

      <Field label="Conclusão">
        <textarea
          className="input resize-none h-20"
          placeholder="Conclusão diagnóstica..."
          value={conclusion}
          onChange={e => setConclusion(e.target.value)}
          disabled={!isEditable}
        />
      </Field>

      <div className="flex gap-3 justify-end pt-3 border-t border-navy-700">
        <button className="btn-ghost" onClick={onClose}>Fechar</button>
        {isEditable && (<>
          <button className="btn-ghost" onClick={() => updateMut.mutate()} disabled={updateMut.isPending}>
            {updateMut.isPending ? <Spinner size={14} /> : <><PenLine size={14} /> Salvar Rascunho</>}
          </button>
          <button
            className="btn-primary"
            onClick={() => signMut.mutate()}
            disabled={signMut.isPending || !findings.trim() || !conclusion.trim()}
          >
            {signMut.isPending ? <Spinner size={14} /> : <><CheckCircle size={14} /> Assinar Laudo</>}
          </button>
        </>)}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const qc = useQueryClient();
  const [page, setPage]       = useState(1);
  const [tab, setTab]         = useState<'all'|'draft'|'signed'>('all');
  const [selected, setSelected] = useState<Report|null>(null);
  const [amendTarget, setAmendTarget] = useState<Report|null>(null);
  const [amendReason, setAmendReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['reports', page, tab],
    queryFn:  () => reportsApi.list({ page, limit: 15, status: tab === 'all' ? undefined : tab }),
    select:   r => r.data,
    refetchInterval: 30_000,
  });

  const amendMut = useMutation({
    mutationFn: () => reportsApi.amend(amendTarget!.id, amendReason),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['reports'] }); setAmendTarget(null); setAmendReason(''); },
  });

  const getPdfMut = useMutation({
    mutationFn: (id: string) => reportsApi.getPdf(id),
    onSuccess:  (res) => {
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30_000); // libera memória após a aba abrir
    },
  });

  const reports: Report[] = data?.data ?? [];

  return (
    <div className="space-y-5 animate-fade-in">
      <SectionHeader
        title="Laudos"
        subtitle="Gestão e assinatura de laudos radiológicos"
      />

      <div className="flex gap-1 p-1 bg-navy-900 rounded-lg w-fit border border-navy-700">
        {([['all','Todos'],['draft','Rascunhos'],['signed','Assinados']] as const).map(([v,l]) => (
          <button key={v}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              tab === v ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-300'
            }`}
            onClick={() => { setTab(v); setPage(1); }}
          >{l}</button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                {['Paciente','Data Estudo','Modalidade','Status','Radiologista','Atualizado','Ações'].map(h => (
                  <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-3 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({length:8}).map((_,i) => (
                  <tr key={i} className="border-b border-navy-800/50">
                    {Array.from({length:7}).map((_,j) => <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>)}
                  </tr>
                ))
              ) : reports.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState icon={FileText} title="Nenhum laudo encontrado" />
                </td></tr>
              ) : reports.map((r) => (
                <tr key={r.id} className="border-b border-navy-800/30 table-row-hover">
                  <td className="px-4 py-3">
                    <p className="text-slate-200 font-medium">{r.patient_name}</p>
                    <p className="text-slate-500 text-xs font-mono">{r.medical_record_number}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{formatDate(r.study_date)}</td>
                  <td className="px-4 py-3">
                    <span className="badge badge-info">{r.modality_type}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${reportStatusBadge[r.status]}`}>
                      {reportStatusLabel[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{r.radiologist_name}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{formatDateTime(r.updated_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setSelected(r)}>
                        <PenLine size={12} /> {['draft','review'].includes(r.status) ? 'Editar' : 'Ver'}
                      </button>
                      {r.status === 'signed' && (<>
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => getPdfMut.mutate(r.id)} disabled={getPdfMut.isPending}>
                          <Download size={12} />
                        </button>
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAmendTarget(r)}>
                          <RotateCcw size={12} />
                        </button>
                      </>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="flex justify-between items-center px-4 py-3 border-t border-navy-700">
            <span className="text-slate-500 text-xs">{data.pagination.total} laudos</span>
            <Pagination page={page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Editor de Laudo" size="lg">
        {selected && <ReportEditor report={selected} onClose={() => setSelected(null)} />}
      </Modal>

      <Modal open={!!amendTarget} onClose={() => setAmendTarget(null)} title="Reabrir para Emenda" size="sm">
        <div className="space-y-4">
          <p className="text-slate-400 text-sm">Informe o motivo da emenda do laudo:</p>
          <textarea className="input resize-none h-20" value={amendReason} onChange={e => setAmendReason(e.target.value)} placeholder="Motivo da emenda..." />
          <div className="flex gap-3 justify-end">
            <button className="btn-ghost" onClick={() => setAmendTarget(null)}>Cancelar</button>
            <button className="btn-primary" disabled={amendReason.length < 5 || amendMut.isPending} onClick={() => amendMut.mutate()}>
              {amendMut.isPending ? <Spinner size={14} /> : 'Reabrir Laudo'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
