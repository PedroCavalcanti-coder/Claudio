import { create } from 'zustand';
import type { StudyMeta, LayoutMode, ToolName, WLPreset } from '../viewerTypes';

export const WL_PRESETS: WLPreset[] = [
  { name: 'Default',     ww: 400,  wc: 40   },
  { name: 'Pulmão',      ww: 1500, wc: -600 },
  { name: 'Mediastino',  ww: 350,  wc: 50   },
  { name: 'Osso',        ww: 2000, wc: 400  },
  { name: 'Abdome',      ww: 400,  wc: 50   },
  { name: 'Cérebro',     ww: 80,   wc: 40   },
  { name: 'AVC',         ww: 40,   wc: 40   },
  { name: 'Angio',       ww: 600,  wc: 200  },
];

interface ViewerStore {
  // Study
  study:             StudyMeta | null;
  isLoading:         boolean;
  error:             string | null;

  // Layout
  layout:            LayoutMode;
  activeViewport:    number;

  // Tool
  activeTool:        ToolName;

  // Per-viewport state
  seriesPerViewport: Record<number, number>; // viewportIndex → seriesIndex

  // UI panels
  showSeriesPanel:   boolean;
  showInfoPanel:     boolean;
  showMeasurements:  boolean;

  // Cine
  isPlaying:         boolean;
  cineSpeed:         number; // fps

  // Actions
  setStudy:          (s: StudyMeta | null) => void;
  setLoading:        (v: boolean) => void;
  setError:          (e: string | null) => void;
  setLayout:         (l: LayoutMode) => void;
  setActiveViewport: (i: number) => void;
  setActiveTool:     (t: ToolName) => void;
  setSeriesForViewport: (vp: number, series: number) => void;
  toggleSeriesPanel: () => void;
  toggleInfoPanel:   () => void;
  toggleMeasurements:() => void;
  setPlaying:        (v: boolean) => void;
  setCineSpeed:      (fps: number) => void;
  reset:             () => void;
}

const initial = {
  study: null, isLoading: false, error: null,
  layout: '1x1' as LayoutMode, activeViewport: 0,
  activeTool: 'WindowLevel' as ToolName,
  seriesPerViewport: { 0: 0, 1: 1, 2: 2, 3: 3 },
  showSeriesPanel: true, showInfoPanel: false, showMeasurements: false,
  isPlaying: false, cineSpeed: 15,
};

export const useViewerStore = create<ViewerStore>((set) => ({
  ...initial,
  setStudy:    (study)   => set({ study }),
  setLoading:  (isLoading) => set({ isLoading }),
  setError:    (error)   => set({ error }),
  setLayout:   (layout)  => set({ layout }),
  setActiveViewport: (activeViewport) => set({ activeViewport }),
  setActiveTool:     (activeTool)     => set({ activeTool }),
  setSeriesForViewport: (vp, series)  =>
    set(s => ({ seriesPerViewport: { ...s.seriesPerViewport, [vp]: series } })),
  toggleSeriesPanel:  () => set(s => ({ showSeriesPanel:  !s.showSeriesPanel })),
  toggleInfoPanel:    () => set(s => ({ showInfoPanel:    !s.showInfoPanel })),
  toggleMeasurements: () => set(s => ({ showMeasurements: !s.showMeasurements })),
  setPlaying:    (isPlaying)  => set({ isPlaying }),
  setCineSpeed:  (cineSpeed)  => set({ cineSpeed }),
  reset:         ()           => set(initial),
}));
