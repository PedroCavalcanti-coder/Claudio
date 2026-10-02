import { useState } from 'react';
import {
  Move, ZoomIn, Ruler, TriangleRight, Circle,
  Square, ArrowUpRight, Minus, Crosshair, RotateCw, RotateCcw,
  FlipHorizontal, FlipVertical, SunMedium, Play, Pause, SkipBack,
  Info, Download, RefreshCw, Layers,
  ChevronDown, Activity, Eye, Trash2, Contrast,
} from 'lucide-react';
import { useViewerStore, WL_PRESETS } from '../stores/viewerStore';
import { setActiveTool } from '../cornerstone/tools';
import type { ToolName, LayoutMode } from '../viewerTypes';
import * as cornerstone from '@cornerstonejs/core';

interface ToolDef {
  name:    ToolName;
  icon:    React.ElementType;
  label:   string;
  group?:  string;
}

const TOOLS: ToolDef[] = [
  { name: 'WindowLevel',   icon: SunMedium,        label: 'W/L',     group: 'nav'   },
  { name: 'Pan',           icon: Move,              label: 'Pan',     group: 'nav'   },
  { name: 'Zoom',          icon: ZoomIn,            label: 'Zoom',    group: 'nav'   },
  { name: 'StackScroll',   icon: Layers,            label: 'Scroll',  group: 'nav'   },
  { name: 'Length',        icon: Ruler,             label: 'Régua',   group: 'measure' },
  { name: 'Angle',         icon: TriangleRight,     label: 'Ângulo',  group: 'measure' },
  { name: 'CobbAngle',     icon: Activity,          label: 'Cobb',    group: 'measure' },
  { name: 'EllipticalROI', icon: Circle,            label: 'ROI Eli', group: 'measure' },
  { name: 'RectangleROI',  icon: Square,            label: 'ROI Ret', group: 'measure' },
  { name: 'Bidirectional', icon: Minus,             label: 'Bidiret', group: 'measure' },
  { name: 'Probe',         icon: Crosshair,         label: 'HU',      group: 'measure' },
  { name: 'ArrowAnnotate', icon: ArrowUpRight,      label: 'Seta',    group: 'annot'  },
];

const LAYOUTS: { mode: LayoutMode; label: string; icon: string }[] = [
  { mode: '1x1', label: '1×1', icon: '▣' },
  { mode: '1x2', label: '1×2', icon: '▣▣' },
  { mode: '2x1', label: '2×1', icon: '▤' },
  { mode: '2x2', label: '2×2', icon: '⊞' },
  { mode: 'mpr', label: 'MPR', icon: '⊟' },
];

interface Props {
  renderingEngineId: string;
  onResetView:       () => void;
  onClearAnnotations:() => void;
  onExportFrame:     () => void;
  onInvert:          () => void;
  onRotateCW:        () => void;
  onRotateCCW:       () => void;
  onFlipH:           () => void;
  onFlipV:           () => void;
  invert:            boolean;
}

export default function Toolbar({
  renderingEngineId, onResetView, onClearAnnotations, onExportFrame,
  onInvert, onRotateCW, onRotateCCW, onFlipH, onFlipV, invert,
}: Props) {
  const {
    activeTool, setActiveTool: storeSetActiveTool,
    layout, setLayout,
    showSeriesPanel, toggleSeriesPanel,
    showInfoPanel, toggleInfoPanel,
    isPlaying, setPlaying,
    cineSpeed, setCineSpeed,
  } = useViewerStore();

  const [showWLDropdown, setShowWLDropdown] = useState(false);

  function handleToolClick(tool: ToolName) {
    storeSetActiveTool(tool);
    setActiveTool(tool);
  }

  function applyWLPreset(ww: number, wc: number) {
    const engine = cornerstone.getRenderingEngine(renderingEngineId);
    if (!engine) return;
    engine.getViewports().forEach(vp => {
      try {
        (vp as cornerstone.Types.IStackViewport).setProperties({
          voiRange: { lower: wc - ww / 2, upper: wc + ww / 2 },
        });
        vp.render();
      } catch { /* ok */ }
    });
    setShowWLDropdown(false);
  }

  const groups = [
    { key: 'nav',     label: 'Navegação' },
    { key: 'measure', label: 'Medidas'   },
    { key: 'annot',   label: 'Anotação'  },
  ];

  return (
    <header className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-panel shrink-0 relative z-20">
      {/* Logo mark */}
      <div className="flex items-center gap-2 mr-3 pr-3 border-r border-border">
        <div className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #0099cc, #004488)' }}>
          <span className="text-white text-[9px] font-display font-bold">R</span>
        </div>
        <span className="text-[10px] font-mono text-accent/50 tracking-widest hidden lg:block">DICOM</span>
      </div>

      {/* Tool groups */}
      {groups.map(g => (
        <div key={g.key} className="flex items-center gap-0.5 pr-2 mr-1 border-r border-border/50">
          <span className="text-[8px] font-mono text-muted/40 uppercase tracking-widest mr-1 hidden xl:block">
            {g.label}
          </span>
          {TOOLS.filter(t => t.group === g.key).map(tool => (
            <button
              key={tool.name}
              className={`tool-btn ${activeTool === tool.name ? 'active' : ''}`}
              onClick={() => handleToolClick(tool.name)}
              title={tool.label}
            >
              <tool.icon size={14} />
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      ))}

      {/* Image ops */}
      <div className="flex items-center gap-0.5 pr-2 mr-1 border-r border-border/50">
        <span className="text-[8px] font-mono text-muted/40 uppercase tracking-widest mr-1 hidden xl:block">Imagem</span>

        {/* W/L Presets dropdown */}
        <div className="relative">
          <button
            className={`tool-btn ${showWLDropdown ? 'active' : ''}`}
            onClick={() => setShowWLDropdown(p => !p)}
            title="Presets W/L"
          >
            <Contrast size={14} />
            <span className="flex items-center gap-0.5">Preset <ChevronDown size={8} /></span>
          </button>
          {showWLDropdown && (
            <div className="absolute top-full left-0 mt-1 glass-panel rounded-lg p-1 z-50 min-w-[140px] animate-fade-in shadow-2xl shadow-black/80">
              {WL_PRESETS.map(p => (
                <button
                  key={p.name}
                  className="w-full text-left px-2 py-1.5 text-[10px] rounded hover:bg-accent/10 hover:text-accent transition-colors font-mono flex justify-between gap-4"
                  onClick={() => applyWLPreset(p.ww, p.wc)}
                >
                  <span className="font-ui font-medium text-slate-300">{p.name}</span>
                  <span className="text-muted">W:{p.ww} L:{p.wc}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className={`tool-btn ${invert ? 'active' : ''}`} onClick={onInvert} title="Inverter">
          <Eye size={14} />
          <span>Inv</span>
        </button>
        <button className="tool-btn" onClick={onRotateCW} title="Girar direita">
          <RotateCw size={14} />
          <span>CW</span>
        </button>
        <button className="tool-btn" onClick={onRotateCCW} title="Girar esquerda">
          <RotateCcw size={14} />
          <span>CCW</span>
        </button>
        <button className="tool-btn" onClick={onFlipH} title="Espelhar H">
          <FlipHorizontal size={14} />
          <span>↔</span>
        </button>
        <button className="tool-btn" onClick={onFlipV} title="Espelhar V">
          <FlipVertical size={14} />
          <span>↕</span>
        </button>
        <button className="tool-btn" onClick={onResetView} title="Resetar">
          <RefreshCw size={14} />
          <span>Reset</span>
        </button>
      </div>

      {/* Cine */}
      <div className="flex items-center gap-0.5 pr-2 mr-1 border-r border-border/50">
        <span className="text-[8px] font-mono text-muted/40 uppercase tracking-widest mr-1 hidden xl:block">Cine</span>
        <button className="tool-btn" onClick={() => setPlaying(!isPlaying)} title={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>
        <button className="tool-btn" onClick={() => setPlaying(false)} title="Stop">
          <SkipBack size={14} />
          <span>Stop</span>
        </button>
        <div className="flex items-center gap-1 px-1">
          <span className="text-[9px] font-mono text-muted">{cineSpeed}fps</span>
          <input
            type="range" min={1} max={60} value={cineSpeed}
            onChange={e => setCineSpeed(parseInt(e.target.value))}
            className="w-14 h-1 accent-cyan-400"
          />
        </div>
      </div>

      {/* Layout */}
      <div className="flex items-center gap-0.5 pr-2 mr-1 border-r border-border/50">
        <span className="text-[8px] font-mono text-muted/40 uppercase tracking-widest mr-1 hidden xl:block">Layout</span>
        {LAYOUTS.map(l => (
          <button
            key={l.mode}
            className={`tool-btn ${layout === l.mode ? 'active' : ''}`}
            onClick={() => setLayout(l.mode)}
            title={l.label}
          >
            <span className="text-base leading-none">{l.icon}</span>
            <span>{l.label}</span>
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 ml-auto">
        <button className="tool-btn" onClick={onClearAnnotations} title="Limpar anotações">
          <Trash2 size={14} />
          <span>Limpar</span>
        </button>
        <button className="tool-btn" onClick={onExportFrame} title="Exportar frame">
          <Download size={14} />
          <span>Export</span>
        </button>
        <button className={`tool-btn ${showSeriesPanel ? 'active' : ''}`} onClick={toggleSeriesPanel} title="Séries">
          <Layers size={14} />
          <span>Séries</span>
        </button>
        <button className={`tool-btn ${showInfoPanel ? 'active' : ''}`} onClick={toggleInfoPanel} title="Info DICOM">
          <Info size={14} />
          <span>Info</span>
        </button>
      </div>
    </header>
  );
}
