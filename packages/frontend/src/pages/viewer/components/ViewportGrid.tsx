import { useEffect, useRef, useCallback, useState } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import { annotation } from '@cornerstonejs/tools';
import DicomViewport from './DicomViewport';
import type { ViewportMeta } from './DicomViewport';
import { useViewerStore } from '../stores/viewerStore';
import { createToolGroup, registerAllTools } from '../cornerstone/tools';
import { initCornerstoneOnce } from '../cornerstone/init';

const RENDERING_ENGINE_ID = 'RIS_PACS_ENGINE';

// Layout → viewport IDs + grid config
const LAYOUT_CONFIG = {
  '1x1': { ids: ['VP_0'],                  cols: 1, rows: 1 },
  '1x2': { ids: ['VP_0','VP_1'],           cols: 2, rows: 1 },
  '2x1': { ids: ['VP_0','VP_1'],           cols: 1, rows: 2 },
  '2x2': { ids: ['VP_0','VP_1','VP_2','VP_3'], cols: 2, rows: 2 },
  'mpr': { ids: ['VP_0','VP_1','VP_2'],    cols: 3, rows: 1 },
};

interface Props {
  onMetaUpdate: (meta: ViewportMeta) => void;
}

export default function ViewportGrid({ onMetaUpdate }: Props) {
  const {
    layout, study, activeViewport, setActiveViewport,
    seriesPerViewport, isPlaying, cineSpeed,
  } = useViewerStore();

  const [csReady, setCsReady]         = useState(false);
  const [invert, setInvert]           = useState(false);
  const [rotation, setRotation]       = useState(0);
  const engineRef                     = useRef<cornerstone.RenderingEngine | null>(null);
  const cineIntervalRef               = useRef<ReturnType<typeof setInterval> | null>(null);

  const config = LAYOUT_CONFIG[layout];

  // Initialize Cornerstone once
  useEffect(() => {
    initCornerstoneOnce().then(() => {
      registerAllTools();
      if (!cornerstone.getRenderingEngine(RENDERING_ENGINE_ID)) {
        engineRef.current = new cornerstone.RenderingEngine(RENDERING_ENGINE_ID);
      } else {
        engineRef.current = cornerstone.getRenderingEngine(RENDERING_ENGINE_ID)!;
      }
      setCsReady(true);
    });
    return () => {
      try { cornerstone.getRenderingEngine(RENDERING_ENGINE_ID)?.destroy(); } catch { /* ok */ }
    };
  }, []);

  // Create tool group whenever layout changes
  useEffect(() => {
    if (!csReady) return;
    createToolGroup(config.ids);
  }, [csReady, layout]);

  // Cine playback
  useEffect(() => {
    if (cineIntervalRef.current) clearInterval(cineIntervalRef.current);
    if (!isPlaying || !csReady) return;

    cineIntervalRef.current = setInterval(() => {
      const engine = cornerstone.getRenderingEngine(RENDERING_ENGINE_ID);
      if (!engine) return;
      const vpId = config.ids[activeViewport] ?? config.ids[0];
      try {
        const vp = engine.getViewport(vpId) as cornerstone.Types.IStackViewport;
        const ids   = (vp as any).getImageIds?.() ?? [];
        const curr  = (vp as any).getCurrentImageIdIndex?.() ?? 0;
        const next  = (curr + 1) % ids.length;
        (vp as any).setImageIdIndex?.(next).then(() => vp.render());
      } catch { /* ok */ }
    }, Math.round(1000 / cineSpeed));

    return () => {
      if (cineIntervalRef.current) clearInterval(cineIntervalRef.current);
    };
  }, [isPlaying, cineSpeed, activeViewport, csReady, config.ids]);

  const handleReset = useCallback(() => {
    const engine = cornerstone.getRenderingEngine(RENDERING_ENGINE_ID);
    if (!engine) return;
    engine.getViewports().forEach(vp => {
      try {
        (vp as cornerstone.Types.IStackViewport).resetCamera();
        (vp as any).setProperties({ invert: false, rotation: 0 });
        vp.render();
      } catch { /* ok */ }
    });
    setInvert(false);
    setRotation(0);
  }, []);

  const handleInvert = useCallback(() => {
    setInvert(p => !p);
  }, []);

  const handleRotateCW = useCallback(() => {
    setRotation(p => (p + 90) % 360);
  }, []);

  const handleRotateCCW = useCallback(() => {
    setRotation(p => (p - 90 + 360) % 360);
  }, []);

  const handleFlipH = useCallback(() => {
    const engine = cornerstone.getRenderingEngine(RENDERING_ENGINE_ID);
    if (!engine) return;
    const vpId = config.ids[activeViewport] ?? config.ids[0];
    const vp   = engine.getViewport(vpId) as cornerstone.Types.IStackViewport;
    if (!vp) return;
    try {
      const cam = vp.getCamera();
      vp.setCamera({ ...cam, flipHorizontal: !(cam as any).flipHorizontal });
      vp.render();
    } catch { /* ok */ }
  }, [activeViewport, config.ids]);

  const handleFlipV = useCallback(() => {
    const engine = cornerstone.getRenderingEngine(RENDERING_ENGINE_ID);
    if (!engine) return;
    const vpId = config.ids[activeViewport] ?? config.ids[0];
    const vp   = engine.getViewport(vpId) as cornerstone.Types.IStackViewport;
    if (!vp) return;
    try {
      const cam = vp.getCamera();
      vp.setCamera({ ...cam, flipVertical: !(cam as any).flipVertical });
      vp.render();
    } catch { /* ok */ }
  }, [activeViewport, config.ids]);

  const handleClearAnnotations = useCallback(() => {
    annotation.state.removeAllAnnotations();
    const engine = cornerstone.getRenderingEngine(RENDERING_ENGINE_ID);
    engine?.getViewports().forEach(vp => { try { vp.render(); } catch { /* ok */ } });
  }, []);

  const handleExportFrame = useCallback(() => {
    const engine = cornerstone.getRenderingEngine(RENDERING_ENGINE_ID);
    if (!engine) return;
    const vpId   = config.ids[activeViewport] ?? config.ids[0];
    const vp     = engine.getViewport(vpId);
    if (!vp) return;
    try {
      const canvas = (vp as any).canvas as HTMLCanvasElement;
      const link   = document.createElement('a');
      link.download = `frame_${Date.now()}.jpg`;
      link.href     = canvas.toDataURL('image/jpeg', 0.95);
      link.click();
    } catch { /* ok */ }
  }, [activeViewport, config.ids]);

  // Expose handlers via window for Toolbar to call
  useEffect(() => {
    (window as any).__viewerHandlers = {
      reset:            handleReset,
      invert:           handleInvert,
      rotateCW:         handleRotateCW,
      rotateCCW:        handleRotateCCW,
      flipH:            handleFlipH,
      flipV:            handleFlipV,
      clearAnnotations: handleClearAnnotations,
      exportFrame:      handleExportFrame,
      getRenderingEngineId: () => RENDERING_ENGINE_ID,
    };
  }, [handleReset, handleInvert, handleRotateCW, handleRotateCCW, handleFlipH, handleFlipV, handleClearAnnotations, handleExportFrame]);

  if (!csReady) {
    return (
      <div className="flex-1 flex items-center justify-center bg-void">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-accent/30 border-t-accent rounded-full spinner" />
          <p className="text-accent/60 font-mono text-xs tracking-widest">INICIALIZANDO CORNERSTONE3D</p>
        </div>
      </div>
    );
  }

  const series = study?.series ?? [];

  return (
    <div
      className="flex-1 grid overflow-hidden"
      style={{
        gridTemplateColumns: `repeat(${config.cols}, 1fr)`,
        gridTemplateRows:    `repeat(${config.rows}, 1fr)`,
        gap: '2px',
        background: '#000',
      }}
    >
      {config.ids.map((vpId, idx) => {
        const seriesIdx    = seriesPerViewport[idx] ?? idx;
        const currentSeries = series[seriesIdx] ?? null;

        return (
          <DicomViewport
            key={vpId}
            viewportId={vpId}
            renderingEngineId={RENDERING_ENGINE_ID}
            series={currentSeries}
            studyUID={study?.study_instance_uid ?? ''}
            isActive={activeViewport === idx}
            onActivate={() => setActiveViewport(idx)}
            onMetaUpdate={activeViewport === idx ? onMetaUpdate : undefined}
            invert={invert}
            rotation={rotation}
          />
        );
      })}
    </div>
  );
}

// Export handlers getter for Toolbar
export function getViewerHandlers() {
  return (window as any).__viewerHandlers ?? {};
}

export { RENDERING_ENGINE_ID };
