import { useViewerStore } from '../stores/viewerStore';
import type { ViewportMeta } from './DicomViewport';

interface Props {
  meta?: ViewportMeta;
}

export default function StatusBar({ meta }: Props) {
  const { study, activeTool, activeViewport, layout, isPlaying, cineSpeed } = useViewerStore();
  const seriesCount    = study?.series?.length ?? 0;
  const totalInstances = study?.series?.reduce((s, se) => s + se.number_of_instances, 0) ?? 0;

  const toolLabels: Record<string, string> = {
    WindowLevel:   'W/L — Clique+Arraste para ajustar janela/nível',
    Pan:           'Pan — Clique+Arraste para mover',
    Zoom:          'Zoom — Clique+Arraste para zoom | Scroll para zoom rápido',
    StackScroll:   'Scroll — Scroll do mouse para navegar instâncias',
    Length:        'Régua — Clique para marcar início, clique novamente para finalizar',
    Angle:         'Ângulo — 3 cliques para definir o ângulo',
    EllipticalROI: 'ROI Elipse — Arraste para desenhar região de interesse',
    RectangleROI:  'ROI Retângulo — Arraste para desenhar região de interesse',
    ArrowAnnotate: 'Seta — Clique e arraste para criar seta + texto',
    Bidirectional: 'Bidirecional — 2 cliques para medida em cruz',
    CobbAngle:     'Ângulo de Cobb — 4 cliques para definir as duas linhas',
    Probe:         'HU Probe — Clique em qualquer ponto para valor HU',
  };

  return (
    <footer className="flex items-center gap-4 px-3 py-1 border-t border-border bg-panel shrink-0 text-[10px] font-mono text-muted">
      {/* Study info */}
      <div className="flex items-center gap-3">
        {study && (
          <>
            <span className="text-accent/70">{study.patient_name ?? 'Paciente'}</span>
            <span className="vdivider h-3" />
            <span>{seriesCount} série{seriesCount !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{totalInstances} instâncias</span>
          </>
        )}
      </div>

      {/* Active tool hint */}
      <div className="flex-1 text-center text-muted/50">
        {toolLabels[activeTool] ?? activeTool}
      </div>

      {/* Right: viewport info */}
      <div className="flex items-center gap-3 shrink-0">
        {isPlaying && (
          <span className="text-accent animate-pulse">▶ {cineSpeed}fps</span>
        )}
        {meta && meta.totalInstances > 0 && (
          <>
            <span className="text-slate-400">{meta.instanceIndex}/{meta.totalInstances}</span>
            <span className="vdivider h-3" />
            <span>W:{meta.ww} L:{meta.wc}</span>
            <span className="vdivider h-3" />
            <span>Zoom:{(meta.zoom * 100).toFixed(0)}%</span>
          </>
        )}
        <span className="vdivider h-3" />
        <span className="text-muted/50">VP#{activeViewport + 1} · {layout.toUpperCase()}</span>
      </div>
    </footer>
  );
}
