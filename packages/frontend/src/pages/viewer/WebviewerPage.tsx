// Volume carregado no store do OrthoVis → renderiza <ViewerApp/> fullscreen (.orthovis-root é position:fixed e cobre o AppLayout)
import { useEffect, useRef, useState, useCallback } from 'react';
import { FolderOpen, FileImage, Loader2, Monitor, AlertCircle } from 'lucide-react';
import { SectionHeader } from '../../components/ui';
import { useStore } from '../../orthovis/store';
import { loadFiles } from '../../orthovis/utils/loader';
import { ViewerApp } from '../../orthovis/components/ViewerApp';
import '../../orthovis/orthovis.css';

const SUPPORTED = ['.dcm', '.nii', '.nii.gz', '.npy'];

export default function WebviewerPage() {
  const fileRef   = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const {
    volume, setVolume, clearAll,
    setActiveTool, activeViewportId, undoAnnotation, redoAnnotation,
    cineActive, setCineActive,
  } = useStore();

  const [drag, setDrag]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [phase, setPhase]       = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    return () => { clearAll(); };
  }, [clearAll]);

  useEffect(() => {
    if (!volume) return;
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;

      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        undoAnnotation(activeViewportId); e.preventDefault(); return;
      }
      if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        redoAnnotation(activeViewportId); e.preventDefault(); return;
      }
      if (e.key === ' ') {
        setCineActive(!cineActive); e.preventDefault(); return;
      }

      const map: Record<string, any> = {
        'w':'windowing','p':'pan','z':'zoom',
        'r':'ruler','b':'bidirectional',
        'a':'angle','k':'cobb',
        'h':'probe','q':'roi_ellipse','d':'roi_rect',
        's':'arrow','c':'circle','e':'rectangle',
        'f':'freehand','g':'polygon','t':'text','x':'eraser',
      };
      if (map[e.key.toLowerCase()]) { setActiveTool(map[e.key.toLowerCase()]); e.preventDefault(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [volume, setActiveTool, activeViewportId, undoAnnotation, redoAnnotation, setCineActive, cineActive]);

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const valid = files.filter(f => {
      const n = f.name.toLowerCase();
      return n.endsWith('.dcm') || n.endsWith('.dicom') || n.endsWith('.nii') ||
             n.endsWith('.nii.gz') || n.endsWith('.npy') || f.type === 'application/dicom';
    });
    if (!valid.length) {
      setError('Nenhum arquivo suportado encontrado (.dcm, .nii, .nii.gz, .npy).');
      return;
    }

    setError(null);
    setLoading(true);
    setProgress(0);
    setPhase('Iniciando…');

    try {
      const vol = await loadFiles(valid, (ph, pct) => {
        setPhase(ph);
        setProgress(pct);
      });
      setVolume(vol);
    } catch (e: any) {
      setError(e.message ?? 'Erro ao carregar arquivos');
      setLoading(false);
    }
  }, [setVolume]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const collected: File[] = [];
    const processEntry = (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) {
        return new Promise(r => (entry as FileSystemFileEntry).file(f => { collected.push(f); r(); }));
      }
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      return new Promise(r => {
        const read = () => reader.readEntries(async es => {
          if (!es.length) { r(); return; }
          await Promise.all(es.map(processEntry));
          read();
        });
        read();
      });
    };
    const entries = Array.from(e.dataTransfer.items)
      .map(i => i.webkitGetAsEntry())
      .filter(Boolean) as FileSystemEntry[];
    Promise.all(entries.map(processEntry)).then(() => handleFiles(collected));
  }, [handleFiles]);

  if (volume) {
    return (
      <div className="orthovis-root">
        <ViewerApp />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 animate-fade-in" style={{ maxWidth: 720, margin: '0 auto' }}>
      <SectionHeader
        title="Webviewer Local"
        subtitle="Visualize arquivos DICOM/NIfTI/NumPy diretamente no navegador — sem envio ao servidor"
      />

      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => !loading && fileRef.current?.click()}
        style={{
          borderRadius: 16,
          padding: '52px 40px',
          textAlign: 'center',
          cursor: loading ? 'wait' : 'pointer',
          border: `2px dashed ${drag ? 'var(--cyan-500)' : 'var(--navy-700)'}`,
          background: drag ? 'var(--color-accent-subtle)' : 'var(--navy-900)',
          boxShadow: drag ? '0 0 40px var(--color-accent-ring)' : 'var(--shadow-sm)',
          transition: 'all 0.2s ease',
        }}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".dcm,.dicom,.nii,.nii.gz,.npy,application/dicom"
          hidden
          onChange={e => { if (e.target.files) handleFiles(Array.from(e.target.files)); e.target.value = ''; }}
        />

        <div style={{
          width: 70, height: 70, borderRadius: 18, margin: '0 auto 18px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: drag ? 'var(--color-accent-subtle)' : 'var(--navy-800)',
          border: '1px solid var(--navy-700)',
          boxShadow: drag ? '0 0 20px var(--color-accent-ring)' : 'none',
          transition: 'all 0.2s ease',
        }}>
          {loading
            ? <Loader2 size={30} className="animate-spin text-cyan-500" />
            : <Monitor size={30} color={drag ? 'var(--cyan-500)' : 'var(--sl-500)'} strokeWidth={1.5} />
          }
        </div>

        <p style={{
          fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 17,
          color: drag ? 'var(--cyan-500)' : 'var(--sl-200)',
          marginBottom: 8, transition: 'color 0.15s',
        }}>
          {loading ? phase || 'Carregando…' : drag ? 'Solte aqui!' : 'Arraste arquivos ou pasta DICOM'}
        </p>
        <p style={{ fontSize: 13, color: 'var(--sl-500)' }}>
          {loading
            ? `${Math.round(progress)}% concluído`
            : 'Ou clique para selecionar — quando carregar, o OrthoVis abre em tela cheia'}
        </p>

        {loading && (
          <div style={{ marginTop: 18, maxWidth: 320, marginInline: 'auto' }}>
            <div style={{
              height: 4, borderRadius: 2,
              background: 'var(--navy-800)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: 'linear-gradient(90deg, var(--cyan-500), var(--cyan-400))',
                transition: 'width 0.25s ease',
              }} />
            </div>
          </div>
        )}
      </div>

      {!loading && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn-primary" onClick={() => fileRef.current?.click()}>
            <FileImage size={14} /> Selecionar Arquivos
          </button>
          <button className="btn-ghost" onClick={() => folderRef.current?.click()}>
            <FolderOpen size={14} /> Abrir Pasta Completa
          </button>
          <input
            ref={folderRef}
            type="file"
            {...({ webkitdirectory: '' } as any)}
            multiple
            hidden
            onChange={e => { if (e.target.files) handleFiles(Array.from(e.target.files)); e.target.value = ''; }}
          />
        </div>
      )}

      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: 'var(--color-danger-bg)',
          border: '1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)',
          color: 'var(--color-danger)',
          fontSize: 13, display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} /> {error}
        </div>
      )}

      <div style={{
        padding: '11px 16px', borderRadius: 10,
        background: 'var(--navy-800)', border: '1px solid var(--navy-700)',
        fontSize: 12, color: 'var(--sl-500)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 600, color: 'var(--sl-400)' }}>Formatos suportados:</span>
        {SUPPORTED.map(ext => (
          <code key={ext} style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
            color: 'var(--cyan-500)',
            padding: '2px 6px', borderRadius: 4,
            background: 'var(--navy-900)',
          }}>{ext}</code>
        ))}
        <span style={{ color: 'var(--sl-700)', marginLeft: 'auto' }}>100% local · nenhum envio ao servidor</span>
      </div>
    </div>
  );
}
