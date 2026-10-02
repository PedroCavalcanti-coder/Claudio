import { useState, useEffect, useRef, useCallback } from 'react';
import * as dicomParser from 'dicom-parser';
import { X, ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2, Loader2 } from 'lucide-react';
import api from '../../api/client';

const API_FULL = import.meta.env.VITE_API_URL ?? '/api/v1';

interface Volume {
  voxels:    Float32Array;
  width:     number;
  height:    number;
  depth:     number;
  spacingX:  number;
  spacingY:  number;
  spacingZ:  number;
  wc:        number;
  ww:        number;
}

function applyWL(pixels: Float32Array, rows: number, cols: number, wc: number, ww: number): ImageData {
  const data = new Uint8ClampedArray(rows * cols * 4);
  const lo = wc - ww / 2;
  for (let i = 0; i < rows * cols; i++) {
    const n = Math.max(0, Math.min(1, (pixels[i] - lo) / (ww || 1)));
    const v = Math.round(n * 255);
    const idx = i * 4;
    data[idx] = data[idx + 1] = data[idx + 2] = v;
    data[idx + 3] = 255;
  }
  return new ImageData(data, cols, rows);
}

function getAxial(v: Volume, z: number): ImageData {
  const zi = Math.max(0, Math.min(v.depth - 1, Math.round(z)));
  const n  = v.width * v.height;
  return applyWL(v.voxels.slice(zi * n, zi * n + n), v.height, v.width, v.wc, v.ww);
}

function getSagital(v: Volume, x: number): ImageData {
  const xi = Math.max(0, Math.min(v.width - 1, Math.round(x)));
  const W = v.width, H = v.height, D = v.depth;
  const px = new Float32Array(H * D);
  for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
      px[(D - 1 - z) * H + y] = v.voxels[xi + y * W + z * W * H];
  return applyWL(px, D, H, v.wc, v.ww);
}

function getCoronal(v: Volume, y: number): ImageData {
  const yi = Math.max(0, Math.min(v.height - 1, Math.round(y)));
  const W = v.width, H = v.height, D = v.depth;
  const px = new Float32Array(W * D);
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++)
      px[(D - 1 - z) * W + x] = v.voxels[x + yi * W + z * W * H];
  return applyWL(px, D, W, v.wc, v.ww);
}

function slicePos(pos: number[], orient: number[]): number {
  const [rx, ry, rz, cx, cy, cz] = orient;
  const nx = ry * cz - rz * cy;
  const ny = rz * cx - rx * cz;
  const nz = rx * cy - ry * cx;
  return pos[0] * nx + pos[1] * ny + pos[2] * nz;
}

function Viewport({
  label, color, imageData,
  index, maxIndex, onIndexChange,
  zoom, onWheel,
}: {
  label: string; color: string;
  imageData: ImageData | null;
  index: number; maxIndex: number;
  onIndexChange: (i: number) => void;
  zoom: number;
  onWheel: (e: React.WheelEvent) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !imageData) return;
    const ctx = c.getContext('2d')!;

    const off = new OffscreenCanvas(imageData.width, imageData.height);
    off.getContext('2d')!.putImageData(imageData, 0, 0);

    c.width  = c.offsetWidth  || 300;
    c.height = c.offsetHeight || 300;

    const cw = c.width, ch = c.height;
    const iw = imageData.width, ih = imageData.height;
    const base = Math.min(cw / iw, ch / ih);
    const sc = base * zoom;
    const dx = (cw - iw * sc) / 2;
    const dy = (ch - ih * sc) / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off as any, dx, dy, iw * sc, ih * sc);

    ctx.fillStyle = color;
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.fillText(label, 8, 18);

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(`${index + 1}/${maxIndex + 1}`, 8, ch - 8);
  }, [imageData, zoom, label, color, index, maxIndex]);

  return (
    <div
      style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
      onWheel={onWheel}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', aspectRatio: '1', display: 'block', cursor: 'crosshair' }}
      />
      <input
        type="range" min={0} max={maxIndex} value={index}
        onChange={e => onIndexChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: color, height: 3, cursor: 'pointer' }}
      />
    </div>
  );
}

// implementação própria (não reusa o OrthoVis) para manter o bundle do portal do paciente leve
interface Props {
  studyId:       string;
  portalToken:   string;
  procedureName?: string;
  onClose:       () => void;
}

export default function DicomViewerLite({ studyId, portalToken, procedureName, onClose }: Props) {
  const [volume,    setVolume]    = useState<Volume | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [progress,  setProgress]  = useState(0);
  const [phase,     setPhase]     = useState('Buscando instâncias…');
  const [error,     setError]     = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  const [axIdx,  setAxIdx]  = useState(0);
  const [sagIdx, setSagIdx] = useState(0);
  const [corIdx, setCorIdx] = useState(0);
  const [wc, setWc]         = useState(400);
  const [ww, setWw]         = useState(1500);
  const [zoom, setZoom]     = useState(1);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // 1. Lista de instâncias
        setPhase('Buscando instâncias…');
        const r = await api.get(`/patient-portal/exams/${studyId}/instances`, {
          headers: { 'X-Portal-Token': portalToken },
        });
        const instances: any[] = r.data.data ?? [];
        if (!instances.length) { setError('Este estudo não possui imagens disponíveis.'); setLoading(false); return; }

        // 2. Busca os buffers em paralelo (concorrência 6)
        const buffers: (ArrayBuffer | null)[] = new Array(instances.length).fill(null);
        const CONC = 6;
        let done = 0;

        setPhase(`Baixando 0/${instances.length} imagens…`);
        for (let i = 0; i < instances.length; i += CONC) {
          if (cancelled) return;
          const chunk = instances.slice(i, i + CONC);
          await Promise.all(chunk.map(async (inst, ci) => {
            try {
              const resp = await fetch(
                `${API_FULL}/patient-portal/exams/${studyId}/instances/${inst.id}/stream`,
                { headers: { 'X-Portal-Token': portalToken } }
              );
              if (resp.ok) buffers[i + ci] = await resp.arrayBuffer();
            } catch { /* skip */ }
            done++;
            if (!cancelled) {
              setProgress(Math.round((done / instances.length) * 60));
              setPhase(`Baixando ${done}/${instances.length} imagens…`);
            }
          }));
        }

        if (cancelled) return;

        // 3. Parseia cada DICOM e extrai metadados + pixels
        interface ParsedSlice {
          px:      Float32Array;
          rows:    number; cols: number;
          pos:     number[]; orient: number[];
          sp:      number[]; thick: number;
          wc:      number;   ww: number;
          sortKey: number;
        }

        const slices: ParsedSlice[] = [];
        setPhase('Processando imagens…');
        let parsed = 0;

        for (const buf of buffers) {
          if (!buf) continue;
          try {
            const bytes = new Uint8Array(buf);
            const ds    = dicomParser.parseDicom(bytes);

            const g  = (tag: string) => { try { return ds.string(tag)?.trim(); } catch { return undefined; } };
            const gf = (tag: string) => { try { return ds.floatString(tag); } catch { return undefined; } };
            const ga = (tag: string) => { const s = g(tag); return s ? s.split('\\').map(Number) : undefined; };

            const rows   = ds.uint16('x00280010') || 512;
            const cols   = ds.uint16('x00280011') || 512;
            const bits   = ds.uint16('x00280100') || 16;
            const pixRep = ds.uint16('x00280103') || 0;
            const slope  = gf('x00281053') ?? 1;
            const intrc  = gf('x00281052') ?? 0;
            const wcS    = g('x00281050'); const wwS = g('x00281051');
            const wcV    = wcS ? parseFloat(wcS.split('\\')[0]) : 400;
            const wwV    = wwS ? parseFloat(wwS.split('\\')[0]) : 1500;
            const pos    = ga('x00200032') || [0, 0, parsed * 1];
            const orient = ga('x00200037') || [1, 0, 0, 0, 1, 0];
            const sp     = ga('x00280030') || [1, 1];
            const thick  = parseFloat(g('x00180050') || '1') || 1;

            const pixEl = ds.elements['x7fe00010'];
            if (!pixEl) continue;

            const n   = rows * cols;
            const off = pixEl.dataOffset;
            let raw: Int16Array | Uint16Array | Uint8Array;

            if (bits === 16) {
              raw = pixRep === 1
                ? new Int16Array(buf.slice(off, off + n * 2))
                : new Uint16Array(buf.slice(off, off + n * 2));
            } else {
              raw = new Uint8Array(buf, off, n);
            }

            const px = new Float32Array(n);
            for (let j = 0; j < n; j++) px[j] = (raw[j] as number) * slope + intrc;

            slices.push({
              px, rows, cols, pos, orient, sp, thick, wc: wcV, ww: wwV,
              sortKey: slicePos(pos, orient),
            });
          } catch { /* skip malformed */ }

          parsed++;
          if (!cancelled) setProgress(60 + Math.round((parsed / buffers.filter(Boolean).length) * 30));
        }

        if (cancelled) return;
        if (!slices.length) { setError('Não foi possível decodificar as imagens.'); setLoading(false); return; }

        // 4. Ordena por posição e monta o volume
        slices.sort((a, b) => a.sortKey - b.sortKey);

        const W = slices[0].cols;
        const H = slices[0].rows;
        const D = slices.length;
        const voxels = new Float32Array(W * H * D);
        for (let z = 0; z < D; z++) {
          voxels.set(slices[z].px, z * W * H);
        }

        const spX = slices[0].sp[1] || 1;
        const spY = slices[0].sp[0] || 1;
        const spZ = D > 1
          ? Math.abs(slices[1].sortKey - slices[0].sortKey) || slices[0].thick
          : slices[0].thick;

        const vol: Volume = {
          voxels, width: W, height: H, depth: D,
          spacingX: spX, spacingY: spY, spacingZ: spZ,
          wc: slices[0].wc, ww: slices[0].ww,
        };

        setVolume(vol);
        setWc(vol.wc);
        setWw(vol.ww);
        setAxIdx(Math.floor(D / 2));
        setSagIdx(Math.floor(W / 2));
        setCorIdx(Math.floor(H / 2));
        setProgress(100);
        setLoading(false);

      } catch (e: any) {
        if (!cancelled) { setError(e.message ?? 'Erro ao carregar imagens.'); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  }, [studyId, portalToken]);

  const axImg  = volume ? getAxial(volume, axIdx)      : null;
  const sagImg = volume ? getSagital(volume, sagIdx)   : null;
  const corImg = volume ? getCoronal(volume, corIdx)   : null;

  const resetView = () => {
    if (!volume) return;
    setAxIdx(Math.floor(volume.depth  / 2));
    setSagIdx(Math.floor(volume.width / 2));
    setCorIdx(Math.floor(volume.height / 2));
    setZoom(1);
    setWc(volume.wc); setWw(volume.ww);
  };

  const wheelHandler = useCallback((setter: (v: number) => void, max: number) =>
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) { setZoom(z => Math.max(0.5, Math.min(4, z - e.deltaY * 0.003))); return; }
      setter(v => Math.max(0, Math.min(max - 1, v + (e.deltaY > 0 ? 1 : -1))));
    }, []);

  const isSingle = volume && volume.depth <= 1;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', flexDirection: 'column',
        background: '#07101F',
        ...(fullscreen ? {} : {}),
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: '#0C1828',
        borderBottom: '1px solid #1C2D46', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg,#22D3EE,#0891B2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#07101F', fontFamily: 'JetBrains Mono, monospace' }}>Rx</div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#D4E8F8', fontFamily: 'Outfit, sans-serif' }}>{procedureName ?? 'Imagens do Exame'}</p>
            <p style={{ fontSize: 10, color: '#4E6880', fontFamily: 'JetBrains Mono, monospace' }}>
              {volume ? `${volume.depth} fatia${volume.depth !== 1 ? 's' : ''} · ${volume.width}×${volume.height}` : loading ? phase : 'Sem imagens'}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {volume && (
            <>
              <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} title="Aumentar zoom" style={{ width: 28, height: 28, borderRadius: 6, background: '#152034', border: '1px solid #1C2D46', color: '#7090AE', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ZoomIn size={13} />
              </button>
              <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} title="Reduzir zoom" style={{ width: 28, height: 28, borderRadius: 6, background: '#152034', border: '1px solid #1C2D46', color: '#7090AE', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ZoomOut size={13} />
              </button>
              <button onClick={resetView} title="Resetar" style={{ width: 28, height: 28, borderRadius: 6, background: '#152034', border: '1px solid #1C2D46', color: '#7090AE', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <RotateCcw size={12} />
              </button>
            </>
          )}
          <button onClick={() => setFullscreen(f => !f)} style={{ width: 28, height: 28, borderRadius: 6, background: '#152034', border: '1px solid #1C2D46', color: '#7090AE', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', color: '#F87171', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 8, gap: 8 }}>

        {loading && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <Loader2 size={28} style={{ color: '#22D3EE', animation: 'spin 1s linear infinite' }} className="animate-spin" />
            <p style={{ color: '#7090AE', fontSize: 13, fontFamily: 'Outfit, sans-serif' }}>{phase}</p>
            <div style={{ width: 200, height: 3, borderRadius: 2, background: '#1C2D46', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#22D3EE,#06B6D4)', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
            <p style={{ color: '#4E6880', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>{progress}%</p>
          </div>
        )}

        {!loading && error && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: '#F87171', fontSize: 13, textAlign: 'center', padding: 24 }}>{error}</p>
          </div>
        )}

        {!loading && !error && volume && (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '0 4px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#4E6880', fontFamily: 'JetBrains Mono, monospace' }}>
                <span>WL</span>
                <input type="range" min={-1000} max={3000} value={wc} onChange={e => setWc(Number(e.target.value))} style={{ width: 80, accentColor: '#22D3EE' }} />
                <span style={{ color: '#7090AE', minWidth: 40 }}>{wc}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#4E6880', fontFamily: 'JetBrains Mono, monospace' }}>
                <span>WW</span>
                <input type="range" min={1} max={4000} value={ww} onChange={e => setWw(Number(e.target.value))} style={{ width: 80, accentColor: '#22D3EE' }} />
                <span style={{ color: '#7090AE', minWidth: 40 }}>{ww}</span>
              </div>
              <span style={{ fontSize: 10, color: '#4E6880', fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto' }}>Scroll = navegar · Ctrl+Scroll = zoom</span>
            </div>

            <div style={{ flex: 1, display: 'flex', gap: 6, minHeight: 0, flexWrap: 'wrap' }}>

              <Viewport
                label="AXIAL"
                color="#F72585"
                imageData={axImg}
                index={axIdx}
                maxIndex={volume.depth - 1}
                onIndexChange={setAxIdx}
                zoom={zoom}
                onWheel={wheelHandler(setAxIdx, volume.depth)}
              />

              {!isSingle && (
                <Viewport
                  label="SAGITAL"
                  color="#4CC9F0"
                  imageData={sagImg}
                  index={sagIdx}
                  maxIndex={volume.width - 1}
                  onIndexChange={setSagIdx}
                  zoom={zoom}
                  onWheel={wheelHandler(setSagIdx, volume.width)}
                />
              )}

              {/* série única (radiografia) não tem profundidade suficiente para sagital/coronal */}
              {!isSingle && (
                <Viewport
                  label="CORONAL"
                  color="#7BED9F"
                  imageData={corImg}
                  index={corIdx}
                  maxIndex={volume.height - 1}
                  onIndexChange={setCorIdx}
                  zoom={zoom}
                  onWheel={wheelHandler(setCorIdx, volume.height)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
