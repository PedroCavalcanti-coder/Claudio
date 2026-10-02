import { useViewerStore } from '../stores/viewerStore';
import type { SeriesInfo } from '../viewerTypes';
import { Layers, ChevronLeft, ChevronRight, Image } from 'lucide-react';

interface Props {
  onSeriesSelect: (seriesIndex: number, viewportIndex?: number) => void;
}

const modalityColors: Record<string, string> = {
  CT: 'text-blue-400 bg-blue-400/10 border-blue-500/30',
  MR: 'text-purple-400 bg-purple-400/10 border-purple-500/30',
  US: 'text-green-400 bg-green-400/10 border-green-500/30',
  DX: 'text-yellow-400 bg-yellow-400/10 border-yellow-500/30',
  CR: 'text-orange-400 bg-orange-400/10 border-orange-500/30',
  NM: 'text-pink-400 bg-pink-400/10 border-pink-500/30',
  PT: 'text-red-400 bg-red-400/10 border-red-500/30',
};

export default function SeriesPanel({ onSeriesSelect }: Props) {
  const { study, showSeriesPanel, toggleSeriesPanel, seriesPerViewport, activeViewport } = useViewerStore();
  const series = study?.series ?? [];

  const selectedSeriesIndex = seriesPerViewport[activeViewport] ?? 0;

  return (
    <>
      {/* Collapse toggle */}
      <button
        onClick={toggleSeriesPanel}
        className="absolute top-1/2 -translate-y-1/2 z-30 flex items-center justify-center
                   w-5 h-12 rounded-r-md bg-panel border border-l-0 border-border
                   text-muted hover:text-accent hover:border-accent/30 transition-all"
        style={{ left: showSeriesPanel ? 224 : 0 }}
      >
        {showSeriesPanel ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
      </button>

      {/* Panel */}
      <aside
        className="flex flex-col h-full glass-panel border-r border-border transition-all duration-200 shrink-0 overflow-hidden"
        style={{ width: showSeriesPanel ? 224 : 0, opacity: showSeriesPanel ? 1 : 0 }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
          <Layers size={13} className="text-accent shrink-0" />
          <span className="text-xs font-display font-semibold text-accent/80 tracking-widest uppercase">
            Séries
          </span>
          <span className="ml-auto text-[10px] font-mono text-muted">{series.length}</span>
        </div>

        {/* List */}
        <div className="thumb-list flex-1 p-2 space-y-2">
          {series.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-muted">
              <Image size={20} className="opacity-40" />
              <p className="text-[10px] font-mono">Sem séries</p>
            </div>
          ) : (
            series.map((s, idx) => (
              <SeriesThumb
                key={s.id || idx}
                series={s}
                index={idx}
                isSelected={selectedSeriesIndex === idx}
                onClick={() => onSeriesSelect(idx)}
              />
            ))
          )}
        </div>

        {/* Footer */}
        {study && (
          <div className="px-3 py-2 border-t border-border shrink-0">
            <p className="text-[9px] font-mono text-muted/60 truncate">{study.study_instance_uid}</p>
          </div>
        )}
      </aside>
    </>
  );
}

function SeriesThumb({ series, index, isSelected, onClick }: {
  series: SeriesInfo; index: number; isSelected: boolean; onClick: () => void;
}) {
  const modColor = modalityColors[series.modality] ?? 'text-accent bg-accent/10 border-accent/30';

  return (
    <div
      className={`series-thumb p-1.5 ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      {/* Thumbnail image or placeholder */}
      <div className="w-full aspect-square rounded bg-black/60 mb-1.5 relative overflow-hidden flex items-center justify-center">
        {series.thumbnail_url ? (
          <img
            src={series.thumbnail_url}
            alt={series.series_description}
            className="w-full h-full object-cover"
            style={{ filter: 'brightness(0.9) contrast(1.1)' }}
          />
        ) : (
          <div className="flex flex-col items-center gap-1">
            <div className="text-muted/40 text-2xl font-mono font-bold">{series.modality}</div>
            <div className="text-muted/30 text-[9px]">{series.number_of_instances}i</div>
          </div>
        )}

        {/* Instance count badge */}
        <div className="absolute bottom-1 right-1 text-[9px] font-mono px-1 rounded
                        bg-black/70 text-accent/70 border border-accent/20">
          {series.number_of_instances}
        </div>

        {/* Modality badge */}
        <div className={`absolute top-1 left-1 text-[8px] font-mono font-bold px-1 rounded border ${modColor}`}>
          {series.modality}
        </div>
      </div>

      {/* Series info */}
      <div className="px-0.5">
        <p className="text-[10px] font-ui text-slate-300 truncate leading-tight">
          {series.series_description || `Série ${index + 1}`}
        </p>
        <p className="text-[9px] font-mono text-muted mt-0.5">
          S:{series.series_number} · {series.number_of_instances}i
        </p>
      </div>

      {/* Active indicator */}
      {isSelected && (
        <div className="absolute inset-0 rounded-md border border-accent/50 pointer-events-none" />
      )}
    </div>
  );
}
