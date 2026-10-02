import { X, Database, User, Calendar, Hash, Cpu, ChevronRight } from 'lucide-react';
import { useViewerStore } from '../stores/viewerStore';

export default function InfoPanel() {
  const { study, showInfoPanel, toggleInfoPanel, seriesPerViewport, activeViewport } = useViewerStore();
  const seriesIdx = seriesPerViewport[activeViewport] ?? 0;
  const series    = study?.series?.[seriesIdx];

  if (!showInfoPanel) return null;

  const sections = [
    {
      title: 'Paciente',
      icon:  User,
      rows:  [
        ['Nome',      study?.patient_name        || '—'],
        ['ID',        study?.patient_id          || '—'],
      ],
    },
    {
      title: 'Estudo',
      icon:  Database,
      rows:  [
        ['UID (Estudo)', study?.study_instance_uid?.slice(0, 24) + '...' || '—'],
        ['Data',         study?.study_date        || '—'],
        ['Modalidade',   study?.modality_type     || '—'],
        ['Nº Acesso',    study?.accession_number  || '—'],
      ],
    },
    {
      title: 'Série',
      icon:  Cpu,
      rows:  [
        ['UID (Série)',   (series?.series_instance_uid?.slice(0, 24) ?? '') + '...'],
        ['Nº Série',      String(series?.series_number  ?? '—')],
        ['Descrição',     series?.series_description ?? '—'],
        ['Modalidade',    series?.modality           ?? '—'],
        ['Instâncias',    String(series?.number_of_instances ?? 0)],
      ],
    },
  ];

  return (
    <aside className="w-64 h-full glass-panel border-l border-border flex flex-col animate-slide-left shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Database size={13} className="text-accent" />
          <span className="text-xs font-display font-semibold text-accent/80 tracking-widest uppercase">
            Info DICOM
          </span>
        </div>
        <button onClick={toggleInfoPanel} className="text-muted hover:text-accent transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {sections.map(sec => (
          <div key={sec.title}>
            <div className="flex items-center gap-1.5 mb-2">
              <sec.icon size={11} className="text-accent/60" />
              <span className="text-[9px] font-mono text-accent/60 uppercase tracking-widest">{sec.title}</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="space-y-1">
              {sec.rows.map(([k, v]) => (
                <div key={k} className="dicom-tag">
                  <span className="tag-key text-[9px] w-20 shrink-0">{k}</span>
                  <span className="tag-val text-[10px] truncate">{v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Instance dimensions */}
        {series?.instances?.[0] && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Hash size={11} className="text-accent/60" />
              <span className="text-[9px] font-mono text-accent/60 uppercase tracking-widest">Dimensões</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="space-y-1">
              <div className="dicom-tag">
                <span className="tag-key text-[9px] w-20 shrink-0">Linhas</span>
                <span className="tag-val text-[10px]">{series.instances[0].rows}</span>
              </div>
              <div className="dicom-tag">
                <span className="tag-key text-[9px] w-20 shrink-0">Colunas</span>
                <span className="tag-val text-[10px]">{series.instances[0].columns}</span>
              </div>
              <div className="dicom-tag">
                <span className="tag-key text-[9px] w-20 shrink-0">Frames</span>
                <span className="tag-val text-[10px]">{series.instances[0].number_of_frames}</span>
              </div>
            </div>
          </div>
        )}

        {/* All series quick list */}
        {(study?.series?.length ?? 0) > 1 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Calendar size={11} className="text-accent/60" />
              <span className="text-[9px] font-mono text-accent/60 uppercase tracking-widest">Todas as séries</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <div className="space-y-1">
              {study!.series.map((s, i) => (
                <div key={s.id} className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] cursor-pointer
                  transition-colors ${i === seriesIdx ? 'bg-accent/10 text-accent border border-accent/20' : 'text-muted hover:text-slate-300'}`}>
                  <ChevronRight size={9} />
                  <span className="font-mono">{s.series_number}.</span>
                  <span className="truncate">{s.series_description || s.modality}</span>
                  <span className="ml-auto font-mono text-muted/60">{s.number_of_instances}i</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
