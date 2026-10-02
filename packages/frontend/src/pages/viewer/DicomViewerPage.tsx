import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import Toolbar                 from './components/Toolbar';
import SeriesPanel             from './components/SeriesPanel';
import InfoPanel               from './components/InfoPanel';
import StatusBar               from './components/StatusBar';
import ViewportGrid, { getViewerHandlers, RENDERING_ENGINE_ID } from './components/ViewportGrid';
import type { ViewportMeta }   from './components/DicomViewport';
import { useViewerStore }      from './stores/viewerStore';
import type { StudyMeta }      from './viewerTypes';
import { configureWadoLoader } from './cornerstone/wadoLoader';
import { AlertTriangle }       from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export default function DicomViewerPage() {
  const { studyUID } = useParams<{ studyUID: string }>();
  // Token do portal só em sessionStorage — nunca em query string (vazaria em logs/Referer/history)
  const portalToken = sessionStorage.getItem('portal_token');

  const { setStudy, setLoading, setError, setSeriesForViewport,
          error, isLoading, reset } = useViewerStore();
  const [vpMeta, setVpMeta] = useState<ViewportMeta | undefined>(undefined);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!studyUID || loadedRef.current) return;
    loadedRef.current = true;
    reset();

    const token = sessionStorage.getItem('access_token');
    configureWadoLoader(token);

    setLoading(true);

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const url = portalToken
      ? `${API_BASE}/portal/reports/${portalToken}/images`
      : `${API_BASE}/dicom/studies/${studyUID}/series`;

    axios.get(url, { headers })
      .then(res => {
        const data = res.data.data;

        let study: StudyMeta;

        if (portalToken) {
          study = {
            study_instance_uid: data.study_instance_uid ?? studyUID,
            patient_name:       data.patient?.name,
            accession_number:   data.study?.accession_number,
            modality_type:      data.study?.modality_type,
            study_date:         data.study?.study_date,
            series:             (data.series ?? []).map((s: any) => ({
              id:                  s.id,
              series_instance_uid: s.series_instance_uid,
              series_number:       s.series_number,
              series_description:  s.series_description ?? '',
              modality:            s.modality ?? '',
              number_of_instances: s.number_of_instances,
              thumbnail_url:       s.thumbnail_url,
              instances:           (s.instances ?? []).map((i: any) => ({
                id:               i.id,
                sop_instance_uid: i.sop_instance_uid,
                instance_number:  i.instance_number,
                rows:             i.rows ?? 512,
                columns:          i.columns ?? 512,
                number_of_frames: i.number_of_frames ?? 1,
              })),
            })),
          };
        } else {
          const d = data;
          study = {
            study_instance_uid: d.study_instance_uid ?? studyUID,
            accession_number:   d.accession_number,
            study_date:         d.study_date,
            modality_type:      d.modality_type,
            patient_name:       d.patient_name,
            patient_id:         d.patient_id,
            series:             (d.series ?? []).map((s: any) => ({
              id:                  s.id,
              series_instance_uid: s.series_instance_uid,
              series_number:       s.series_number,
              series_description:  s.series_description ?? '',
              modality:            s.modality ?? '',
              number_of_instances: s.number_of_instances,
              thumbnail_url:       s.thumbnail_url,
              instances:           (s.instances ?? []).map((i: any) => ({
                id:               i.id ?? i.sop_instance_uid,
                sop_instance_uid: i.sop_instance_uid,
                instance_number:  i.instance_number,
                rows:             i.rows ?? 512,
                columns:          i.columns ?? 512,
                number_of_frames: i.number_of_frames ?? 1,
              })),
            })),
          };
        }

        setStudy(study);
        study.series.forEach((_, i) => { if (i < 4) setSeriesForViewport(i, i); });
        setLoading(false);
      })
      .catch(err => {
        setError(err.response?.data?.message ?? 'Erro ao carregar estudo DICOM');
        setLoading(false);
      });

    return () => { loadedRef.current = false; };
  }, [studyUID, portalToken]);

  const h = getViewerHandlers();

  if (isLoading) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-5"
        style={{ background: '#03070f' }}>
        <div className="relative w-28 h-28">
          <div className="absolute inset-0 border border-cyan-400/20 rounded-xl" />
          <div className="absolute inset-3 border border-cyan-400/10 rounded-lg" />
          <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-70"
            style={{ top: '50%', animation: 'scanY 1.5s ease-in-out infinite' }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-cyan-400/20 border-t-cyan-400 rounded-full animate-spin" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-white font-display font-semibold tracking-wide">Carregando estudo</p>
          <p className="text-slate-500 text-xs font-mono mt-1 max-w-xs truncate">{studyUID}</p>
        </div>
        <style>{`@keyframes scanY{0%,100%{top:15%}50%{top:85%}}`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center"
        style={{ background: '#03070f' }}>
        <div className="flex flex-col items-center gap-4 p-8 rounded-2xl max-w-sm text-center"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <AlertTriangle size={32} className="text-red-400" />
          <div>
            <p className="text-red-300 font-display font-semibold">Erro ao carregar</p>
            <p className="text-slate-500 text-sm mt-1">{error}</p>
          </div>
          <button className="btn-ghost text-sm" onClick={() => window.history.back()}>← Voltar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden" style={{ background: '#03070f' }}>
      <Toolbar
        renderingEngineId={RENDERING_ENGINE_ID}
        onResetView={h.reset            ?? (() => {})}
        onClearAnnotations={h.clearAnnotations ?? (() => {})}
        onExportFrame={h.exportFrame    ?? (() => {})}
        onInvert={h.invert              ?? (() => {})}
        onRotateCW={h.rotateCW          ?? (() => {})}
        onRotateCCW={h.rotateCCW        ?? (() => {})}
        onFlipH={h.flipH                ?? (() => {})}
        onFlipV={h.flipV                ?? (() => {})}
        invert={false}
      />
      <div className="flex flex-1 overflow-hidden relative">
        <SeriesPanel onSeriesSelect={(seriesIndex) => {
          const { activeViewport, setSeriesForViewport } = useViewerStore.getState();
          setSeriesForViewport(activeViewport, seriesIndex);
        }} />
        <ViewportGrid onMetaUpdate={setVpMeta} />
        <InfoPanel />
      </div>
      <StatusBar meta={vpMeta} />
    </div>
  );
}
