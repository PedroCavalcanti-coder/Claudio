import { useEffect, useRef, useCallback, useState } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import { Enums as csEnums } from '@cornerstonejs/core';
import { buildImageIds } from '../cornerstone/wadoLoader';
import type { SeriesInfo } from '../viewerTypes';

interface Props {
  viewportId:  string;
  renderingEngineId: string;
  series:      SeriesInfo | null;
  studyUID:    string;
  isActive:    boolean;
  onActivate:  () => void;
  onMetaUpdate?: (meta: ViewportMeta) => void;
  invert?:     boolean;
  rotation?:   number;
}

export interface ViewportMeta {
  instanceIndex: number;
  totalInstances: number;
  ww: number;
  wc: number;
  zoom: number;
}

export default function DicomViewport({
  viewportId, renderingEngineId, series, studyUID,
  isActive, onActivate, onMetaUpdate, invert, rotation,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<ViewportMeta>({ instanceIndex: 0, totalInstances: 0, ww: 400, wc: 40, zoom: 1 });
  const [loadState, setLoadState] = useState<'idle'|'loading'|'loaded'|'error'>('idle');
  const animFrameRef = useRef<number>(0);

  const getViewport = useCallback((): cornerstone.Types.IStackViewport | null => {
    try {
      const engine = cornerstone.getRenderingEngine(renderingEngineId);
      return engine?.getViewport(viewportId) as cornerstone.Types.IStackViewport ?? null;
    } catch { return null; }
  }, [renderingEngineId, viewportId]);

  const updateMeta = useCallback(() => {
    const vp = getViewport();
    if (!vp) return;
    try {
      const idx   = (vp as any).getCurrentImageIdIndex?.() ?? 0;
      const total = (vp as any).getImageIds?.()?.length ?? 0;
      const props = vp.getProperties();
      const camera = vp.getCamera();
      const zoom = (camera?.parallelScale ? 1 / camera.parallelScale : 1);
      const next: ViewportMeta = {
        instanceIndex: idx + 1,
        totalInstances: total,
        ww: props.voiRange ? Math.round(props.voiRange.upper - props.voiRange.lower) : 400,
        wc: props.voiRange ? Math.round((props.voiRange.upper + props.voiRange.lower) / 2) : 40,
        zoom: Math.round(zoom * 100) / 100,
      };
      setMeta(next);
      onMetaUpdate?.(next);
    } catch {}
  }, [getViewport, onMetaUpdate]);

  useEffect(() => {
    if (!series || !containerRef.current) return;

    const engine = cornerstone.getRenderingEngine(renderingEngineId);
    if (!engine) return;

    setLoadState('loading');

    const sopUIDs = series.instances.map(i => i.sop_instance_uid);
    // o token é injetado em runtime pelo loader (nunca na URL)
    const imageIds = buildImageIds(studyUID, series.series_instance_uid, sopUIDs);

    if (!imageIds.length) { setLoadState('error'); return; }

    const existing = engine.getViewport(viewportId);
    if (!existing) {
      engine.enableElement({
        viewportId,
        element:  containerRef.current,
        type:     csEnums.ViewportType.STACK,
      });
    }

    const vp = engine.getViewport(viewportId) as cornerstone.Types.IStackViewport;

    vp.setStack(imageIds, 0)
      .then(() => {
        vp.render();
        setLoadState('loaded');
        updateMeta();
      })
      .catch(() => setLoadState('error'));

    const el = containerRef.current;
    const onRender = () => {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(updateMeta);
    };
    el.addEventListener(csEnums.Events.IMAGE_RENDERED, onRender);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      el.removeEventListener(csEnums.Events.IMAGE_RENDERED, onRender);
    };
  }, [series, studyUID, viewportId, renderingEngineId, updateMeta]);

  useEffect(() => {
    const vp = getViewport();
    if (!vp) return;
    try {
      (vp as any).setProperties({ invert: invert ?? false });
      vp.render();
    } catch {}
  }, [invert, getViewport]);

  useEffect(() => {
    const vp = getViewport();
    if (!vp || rotation === undefined) return;
    try {
      try { (vp as any).setProperties({ rotation: rotation }); } catch {}
      vp.render();
    } catch {}
  }, [rotation, getViewport]);

  return (
    <div
      className={`viewport-cell w-full h-full relative ${isActive ? 'active' : ''}`}
      onClick={onActivate}
    >
      <div ref={containerRef} className="w-full h-full" />

      {loadState === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-20 gap-3">
          <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full spinner" />
          <p className="text-accent/70 text-xs font-mono tracking-widest">CARREGANDO DICOM</p>
        </div>
      )}

      {loadState === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20 gap-2">
          <div className="w-8 h-8 text-danger text-2xl flex items-center justify-center font-mono">✕</div>
          <p className="text-danger text-xs font-mono">ERRO AO CARREGAR</p>
        </div>
      )}

      {loadState === 'idle' && !series && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 border border-dashed border-border rounded-lg flex items-center justify-center">
            <span className="text-muted text-xl">+</span>
          </div>
          <p className="text-muted text-xs font-mono tracking-wider">ARRASTE UMA SÉRIE</p>
        </div>
      )}

      {loadState === 'loaded' && series && (
        <>
          <div className="vp-overlay top-2 left-2">
            <div className="text-[10px] leading-relaxed">
              <div className="text-accent/90 font-semibold">{series.series_description || series.modality}</div>
              <div className="text-accent/50">S: {series.series_number}</div>
            </div>
          </div>

          <div className="vp-overlay top-2 right-2 text-right">
            <div className="text-[10px] leading-relaxed">
              <div className="text-accent/70">{meta.instanceIndex}/{meta.totalInstances}</div>
              <div className="wl-tag">W:{meta.ww} L:{meta.wc}</div>
            </div>
          </div>

          <div className="vp-overlay bottom-2 left-2 text-[10px] text-accent/50">
            Zoom {(meta.zoom * 100).toFixed(0)}%
          </div>

          <div className="vp-overlay bottom-2 right-2 text-[10px] text-accent/50">
            {series.modality}
          </div>

          {isActive && (
            <div className="absolute top-1 left-1/2 -translate-x-1/2 flex items-center gap-1 z-20">
              <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
