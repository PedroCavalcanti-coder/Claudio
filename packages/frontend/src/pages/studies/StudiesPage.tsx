import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileImage, ExternalLink, Clock,
  EyeOff, Hourglass, BadgeCheck, Download, Info,
} from 'lucide-react';
import { useOpenInViewer } from '../../utils/viewer';
import { studiesApi, reportsApi } from '../../api/endpoints';
import StudyDetailModal from './StudyDetailModal';
import type { Study } from '../../types';
import { EmptyState, SectionHeader, Pagination, Spinner } from '../../components/ui';
import { formatDate, modalityLabel, studyStatusLabel } from '../../utils/format';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface StudyWithReport extends Study {
  report_id?:        string;
  report_status?:    string;
  radiologist_name?: string;
  display_status?:   string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function hoursColor(h?: number) {
  if (!h) return 'text-slate-500';
  if (h > 24) return 'text-red-400';
  if (h > 8)  return 'text-amber-400';
  return 'text-emerald-400';
}

async function openReportDownload(reportId: string) {
  // O backend transmite o PDF (ou HTML, em fallback) com o content-type correto.
  const res  = await reportsApi.download(reportId);
  const blob = res.data as Blob;
  const isPdf = blob.type.includes('pdf');
  const url  = URL.createObjectURL(blob);
  if (isPdf) {
    // PDF → força download como arquivo .pdf
    const a = document.createElement('a');
    a.href = url;
    a.download = `laudo-${reportId.slice(0, 8)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    // HTML legado → abre em nova aba para impressão/salvar como PDF
    window.open(url, '_blank');
  }
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ── Flags de Status ───────────────────────────────────────────────────────────
// Usa as classes .badge-* do design system (definidas em index.css) que adaptam
// cor automaticamente aos temas Claro, Escuro e Conforto via CSS vars.
function StatusFlags({ study }: { study: StudyWithReport }) {
  // 1. Laudado / assinado → verde
  if (study.report_status === 'signed' || study.report_status === 'amended') {
    return (
      <div className="flex flex-col gap-1">
        <span className="badge badge-success inline-flex items-center gap-1.5">
          <BadgeCheck size={11} /> Laudado
        </span>
        {study.radiologist_name && (
          <span className="text-slate-500 text-xs truncate max-w-[140px]">{study.radiologist_name}</span>
        )}
      </div>
    );
  }

  // 2. Em análise — rascunho ou em revisão → âmbar
  if (study.report_status === 'draft' || study.report_status === 'review') {
    return (
      <div className="flex flex-col gap-1">
        <span className="badge badge-warning inline-flex items-center gap-1.5">
          <Hourglass size={11} /> Em análise
        </span>
        {study.radiologist_name && (
          <span className="text-slate-500 text-xs truncate max-w-[140px]">{study.radiologist_name}</span>
        )}
      </div>
    );
  }

  // 3. Aguardando radiologista — imagens disponíveis, nenhum laudo ainda → info (azul-teal)
  if (study.status === 'complete' && !study.report_id) {
    return (
      <span className="badge badge-info inline-flex items-center gap-1.5">
        <EyeOff size={11} /> Não lido
      </span>
    );
  }

  // 4. Fallback — status do estudo (receiving / received / incomplete / archived / etc)
  return (
    <span className="badge badge-neutral">{studyStatusLabel[study.status] ?? study.status ?? '—'}</span>
  );
}

// ── Página ─────────────────────────────────────────────────────────────────────
export default function StudiesPage() {
  const [tab, setTab]   = useState<'pending' | 'all'>('pending');
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const openInViewer = useOpenInViewer();

  const { data: pendingData, isLoading: loadingPending } = useQuery({
    queryKey: ['studies-pending'],
    queryFn:  () => studiesApi.pending(),
    select:   r => r.data.data as StudyWithReport[],
    enabled:  tab === 'pending',
    refetchInterval: 30_000,
  });

  const { data: allData, isLoading: loadingAll } = useQuery({
    queryKey: ['studies-all', page],
    queryFn:  () => studiesApi.list({ page, limit: 15 }),
    select:   r => r.data,
    enabled:  tab === 'all',
  });

  const studies: StudyWithReport[] =
    tab === 'pending' ? (pendingData ?? []) : (allData?.data ?? []);
  const isLoading = tab === 'pending' ? loadingPending : loadingAll;

  const handleDownload = async (study: StudyWithReport) => {
    if (!study.report_id) return;
    setDownloading(study.report_id);
    try {
      await openReportDownload(study.report_id);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <SectionHeader
        title="Estudos DICOM"
        subtitle="Exames recebidos e seu status de laudo"
      />

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-navy-900 rounded-lg w-fit border border-navy-700">
        {(['pending','all'] as const).map(t => (
          <button
            key={t}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-150 ${
              tab === t
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-500 hover:text-slate-300'
            }`}
            onClick={() => { setTab(t); setPage(1); }}
          >
            {t === 'pending' ? 'Aguardando Laudo' : 'Todos os Estudos'}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700">
                {['Acesso','Paciente / Procedimento','Data','Modal.','Séries','Aguardando','Status','Ações'].map(h => (
                  <th key={h} className="text-left text-xs text-slate-500 font-medium px-4 py-3 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({length: 8}).map((_, i) => (
                  <tr key={i} className="border-b border-navy-800/50">
                    {Array.from({length: 8}).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : studies.length === 0 ? (
                <tr><td colSpan={8}>
                  <EmptyState
                    icon={FileImage}
                    title="Nenhum estudo encontrado"
                    description={tab === 'pending' ? 'Todos os estudos foram laudados.' : 'Nenhum estudo no sistema ainda.'}
                  />
                </td></tr>
              ) : studies.map(s => {
                const isLaudado = s.report_status === 'signed' || s.report_status === 'amended';
                return (
                  <tr key={s.id} className="border-b border-navy-800/30 hover:bg-navy-800/20 transition-colors">
                    {/* Acesso */}
                    <td className="px-4 py-3 font-mono text-cyan-500 text-xs whitespace-nowrap">
                      {s.accession_number || '—'}
                    </td>

                    {/* Paciente / Procedimento */}
                    <td className="px-4 py-3">
                      <p className="text-slate-200 font-medium">{s.patient_name}</p>
                      <p className="text-slate-500 text-xs truncate max-w-[200px]">
                        {s.procedure_name || s.study_description || s.medical_record_number}
                      </p>
                    </td>

                    {/* Data */}
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {formatDate(s.study_date)}
                    </td>

                    {/* Modalidade */}
                    <td className="px-4 py-3">
                      <span className="badge badge-info">{modalityLabel[s.modality_type] ?? s.modality_type}</span>
                    </td>

                    {/* Séries */}
                    <td className="px-4 py-3 text-slate-400 text-center text-xs">
                      <span>{s.number_of_series}s</span>
                      <span className="text-slate-600"> / </span>
                      <span>{s.number_of_instances}i</span>
                    </td>

                    {/* Aguardando */}
                    <td className="px-4 py-3">
                      {(s as any).hours_waiting !== undefined ? (
                        <span className={`flex items-center gap-1 text-xs font-mono ${hoursColor((s as any).hours_waiting)}`}>
                          <Clock size={11} />
                          {Number((s as any).hours_waiting).toFixed(0)}h
                        </span>
                      ) : '—'}
                    </td>

                    {/* Status flags */}
                    <td className="px-4 py-3">
                      <StatusFlags study={s} />
                    </td>

                    {/* Ações */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          className="btn-ghost px-2.5 py-1.5 text-xs text-slate-400 hover:text-cyan-300 hover:bg-navy-800/40"
                          onClick={() => setDetailId(s.id)}
                          title="Ver detalhes da realização"
                        >
                          <Info size={12} />
                        </button>
                        <button
                          className="btn-primary px-2.5 py-1.5 text-xs"
                          onClick={() => openInViewer(s.study_instance_uid)}
                          title="Abrir no OrthoVis viewer"
                        >
                          <ExternalLink size={12} />
                        </button>
                        {isLaudado && s.report_id && (
                          <button
                            className="btn-ghost px-2.5 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/20"
                            onClick={() => handleDownload(s)}
                            disabled={downloading === s.report_id}
                            title="Baixar laudo (PDF)"
                          >
                            {downloading === s.report_id
                              ? <Spinner size={12} />
                              : <Download size={12} />
                            }
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {tab === 'all' && allData?.pagination && allData.pagination.totalPages > 1 && (
          <div className="flex justify-between items-center px-4 py-3 border-t border-navy-700">
            <span className="text-slate-500 text-xs">{allData.pagination.total} estudos</span>
            <Pagination page={page} totalPages={allData.pagination.totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* Legenda — cores via tokens do design system (theme-aware) */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <EyeOff size={11} style={{ color: 'var(--color-info)' }} /> Não lido — imagens aguardando radiologista
        </span>
        <span className="flex items-center gap-1.5">
          <Hourglass size={11} style={{ color: 'var(--color-warning)' }} /> Em análise — laudo em andamento
        </span>
        <span className="flex items-center gap-1.5">
          <BadgeCheck size={11} style={{ color: 'var(--color-success)' }} /> Laudado — laudo assinado
        </span>
        <span className="flex items-center gap-1.5">
          <Download size={11} style={{ color: 'var(--color-success)' }} /> Disponível para download
        </span>
      </div>

      {detailId && <StudyDetailModal studyId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
