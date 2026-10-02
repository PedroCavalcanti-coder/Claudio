import React, { useRef, useState, useCallback, useEffect } from 'react'
import { useStore } from '../store'
import { loadFiles } from '../utils/loader'
import { toast } from '../../components/ui/Toast'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api/v1'

const FEATURES = [
  { icon: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>, label: 'Grid 1×1 · 1×2 · 2×2', desc: 'Múltiplos viewports sincronizados' },
  { icon: <><path d="M3 12h18M12 3v18"/><circle cx="12" cy="12" r="3"/></>, label: 'MPR Multiplanar', desc: 'Axial · Sagital · Coronal com crosshairs' },
  { icon: <><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></>, label: 'Renderização 3D', desc: 'DVR e MIP com ray casting WebGL' },
  { icon: <><path d="M3 21L21 3M9 15l2-2M12 12l2-2M15 9l2-2"/></>, label: 'Ferramentas clínicas', desc: 'Régua · Ângulo · Cobb · ROI · HU Probe' },
]

const FORMATS = ['DICOM (.dcm)', 'NIfTI (.nii)', 'NIfTI GZ (.nii.gz)', 'NumPy (.npy)', 'Pasta DICOM']

const CSS = `
@keyframes ov-pulse { 0%,100%{opacity:.45;transform:scale(1)} 50%{opacity:.7;transform:scale(1.04)} }
@keyframes ov-float { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-6px)} }
@keyframes ov-spin { to{transform:rotate(360deg)} }
@keyframes ov-fadein { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }

.ov-root { animation: ov-fadein .45s ease both }

.ov-drop-zone { transition: border-color .2s, box-shadow .2s, background .2s }
.ov-drop-zone:hover { border-color: rgba(0,184,217,.5) !important }

.ov-btn-primary {
  transition: all .18s;
  box-shadow: 0 0 0 0 rgba(0,184,217,.4);
}
.ov-btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 24px rgba(0,184,217,.35);
  filter: brightness(1.08);
}
.ov-btn-primary:active { transform: translateY(0) }

.ov-btn-secondary { transition: all .18s }
.ov-btn-secondary:hover {
  border-color: var(--cyan) !important;
  color: var(--cyan) !important;
  transform: translateY(-1px);
}
.ov-btn-secondary:active { transform: translateY(0) }

.ov-feature-card { transition: all .2s }
.ov-feature-card:hover {
  border-color: rgba(0,184,217,.25) !important;
  transform: translateY(-3px);
  box-shadow: 0 12px 40px rgba(0,0,0,.6);
}

.ov-format-badge { transition: all .15s }
.ov-format-badge:hover { border-color: var(--cyan) !important; color: var(--cyan) !important }

/* ── Responsive ─────────────────────────────────────────── */
@media (max-width: 900px) {
  .ov-main   { flex-direction: column !important; gap: 24px !important }
  .ov-hero   { max-width: 100% !important; text-align: center; align-items: center !important }
  .ov-stats  { justify-content: center !important }
  .ov-feats  { display: none !important }
  .ov-cards  { grid-template-columns: 1fr 1fr !important }
}
@media (max-width: 600px) {
  .ov-title  { font-size: 32px !important; line-height: 1.15 !important }
  .ov-sub    { font-size: 13px !important }
  .ov-header { padding: 0 16px !important }
  .ov-scroll { padding: 20px 14px 32px !important; gap: 20px !important }
  .ov-drop-inner { padding: 28px 16px !important }
  .ov-btn-row { flex-direction: column !important }
  .ov-cards  { grid-template-columns: 1fr !important }
  .ov-stat   { padding: 10px 14px !important }
}
`

export function LandingScreen() {
  const { setVolume, setIsLoading, setLoadingProgress, setStudyMeta } = useStore()
  const fileRef   = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase]     = useState('')
  const [autoError, setAutoError] = useState('')

  // Auto-load quando o viewer é aberto via RIS/PACS com ?studyUID=
  useEffect(() => {
    const params   = new URLSearchParams(window.location.search)
    const studyUID = params.get('studyUID')
    const token    = params.get('token') ?? ''
    if (!studyUID) return

    // Persiste token pra outros componentes (ex. ReportModal) reusarem a mesma sessão
    if (token) sessionStorage.setItem('ov_token', token)

    let cancelled = false

    ;(async () => {
      setLoading(true)
      setPhase('Conectando ao servidor…')
      setIsLoading(true, 'Conectando ao servidor…')
      setAutoError('')

      try {
        const listRes = await fetch(`${API_BASE}/studies/dicom/${encodeURIComponent(studyUID)}/instances`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!listRes.ok) {
          const body = await listRes.json().catch(() => ({}))
          throw new Error(body.message ?? `Servidor retornou HTTP ${listRes.status}`)
        }
        const { data } = await listRes.json()
        const { study, instances } = data

        if (cancelled) return

        setStudyMeta({ studyId: study.id, studyUid: study.study_instance_uid, patientName: study.patient_name ?? '' })

        if (!instances?.length) {
          throw new Error('Este estudo não possui instâncias DICOM. Faça o upload das imagens primeiro.')
        }

        const CONCURRENCY = 8
        const fileArr: File[] = new Array(instances.length).fill(null)
        let done = 0

        setPhase(`Baixando ${instances.length} imagem${instances.length > 1 ? 'ns' : ''}…`)
        setLoadingProgress(5)

        for (let i = 0; i < instances.length; i += CONCURRENCY) {
          if (cancelled) return
          const chunk = instances.slice(i, i + CONCURRENCY)
          await Promise.all(chunk.map(async (inst: any, ci: number) => {
            const idx  = i + ci
            const resp = await fetch(
              `${API_BASE}/studies/${study.id}/instances/${inst.id}/stream`,
              { headers: { Authorization: `Bearer ${token}` } }
            )
            if (!resp.ok) throw new Error(`Falha ao baixar instância #${idx + 1} (HTTP ${resp.status})`)
            const buf  = await resp.arrayBuffer()
            fileArr[idx] = new File(
              [buf],
              `${inst.sop_instance_uid ?? `inst_${idx}`}.dcm`,
              { type: 'application/dicom' }
            )
            done++
            if (!cancelled) {
              const pct = 5 + Math.round((done / instances.length) * 55)
              setProgress(pct)
              setLoadingProgress(pct)
              setPhase(`Baixando ${done}/${instances.length}…`)
            }
          }))
        }

        if (cancelled) return

        setIsLoading(false)
        const validFiles = fileArr.filter(Boolean)
        await handleLoad(validFiles)

      } catch (e: any) {
        if (!cancelled) {
          setPhase('')
          setLoading(false)
          setIsLoading(false)
          setAutoError(e.message ?? 'Erro desconhecido ao carregar estudo')
        }
      }
    })()

    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoad = useCallback(async (files: File[]) => {
    if (!files.length) return
    setLoading(true); setPhase('Iniciando…'); setProgress(0)
    setIsLoading(true, 'Iniciando carregamento…')
    try {
      const vol = await loadFiles(files, (ph, pct) => {
        setPhase(ph); setProgress(pct)
        setIsLoading(true, ph); setLoadingProgress(pct)
      })
      setVolume(vol)
    } catch (e: any) {
      setPhase(''); setLoading(false)
      toast.error(e.message || 'Erro ao carregar arquivos')
    } finally {
      setIsLoading(false)
    }
  }, [setVolume, setIsLoading, setLoadingProgress])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    const files: File[] = []
    const process = (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) return new Promise(r => (entry as FileSystemFileEntry).file(f => { files.push(f); r() }))
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      return new Promise(r => {
        const read = () => reader.readEntries(async es => { if (!es.length) r(); else { await Promise.all(es.map(process)); read() } })
        read()
      })
    }
    const entries = Array.from(e.dataTransfer.items).map(i => i.webkitGetAsEntry()).filter(Boolean) as FileSystemEntry[]
    Promise.all(entries.map(process)).then(() => { if (files.length) handleLoad(files) })
  }, [handleLoad])

  return (
    <div className="ov-root" style={{ width:'100%', height:'100%', background:'var(--bg-void)', display:'flex', flexDirection:'column', overflow:'hidden', position:'relative' }}>
      <style>{CSS}</style>

      {/* Banner de erro do auto-load */}
      {autoError && (
        <div style={{ position:'absolute', top:56, left:'50%', transform:'translateX(-50%)', zIndex:100,
          maxWidth:520, width:'calc(100% - 32px)',
          background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.4)',
          borderRadius:10, padding:'10px 16px', display:'flex', alignItems:'flex-start', gap:10 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.6" style={{ flexShrink:0, marginTop:1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, color:'#f87171', fontWeight:600, marginBottom:2 }}>Falha ao carregar estudo</div>
            <div style={{ fontSize:11, color:'#fca5a5', lineHeight:1.5 }}>{autoError}</div>
          </div>
          <button onClick={() => setAutoError('')} aria-label="Fechar alerta" style={{ color:'#f87171', fontSize:14, lineHeight:1, background:'none', border:'none', cursor:'pointer' }}>✕</button>
        </div>
      )}

      {/* Background glows */}
      <div style={{ position:'absolute', inset:0, pointerEvents:'none', overflow:'hidden', zIndex:0 }}>
        {/* Grid dots */}
        <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%', opacity:.025 }} xmlns="http://www.w3.org/2000/svg">
          <defs><pattern id="g" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--cyan)"/></pattern></defs>
          <rect width="100%" height="100%" fill="url(#g)"/>
        </svg>
        {/* Cyan orb top-left */}
        <div style={{ position:'absolute', top:'-15%', left:'-8%', width:600, height:600, borderRadius:'50%', background:'radial-gradient(circle, rgba(0,184,217,.13) 0%, transparent 70%)', animation:'ov-pulse 6s ease-in-out infinite' }}/>
        {/* Purple orb bottom-right */}
        <div style={{ position:'absolute', bottom:'-18%', right:'-5%', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(139,92,246,.1) 0%, transparent 70%)', animation:'ov-pulse 8s ease-in-out infinite 2s' }}/>
        {/* Horizontal line */}
        <div style={{ position:'absolute', top:'46px', left:0, right:0, height:'1px', background:'var(--border-s)' }}/>
      </div>

      {/* ── Header ──────────────────────────────────────────── */}
      <header className="ov-header" style={{ position:'relative', zIndex:10, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 32px', height:46, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {/* Logo */}
          <div style={{ position:'relative', width:28, height:28 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5z" fill="var(--cyan)" opacity=".9"/>
              <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="var(--cyan)" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
            <div style={{ position:'absolute', inset:-3, borderRadius:8, background:'radial-gradient(circle,rgba(0,184,217,.22) 0%,transparent 70%)', animation:'ov-pulse 4s ease-in-out infinite' }}/>
          </div>
          <span style={{ fontFamily:'var(--font-d)', fontSize:17, fontWeight:800, letterSpacing:'-0.03em', color:'var(--text-p)' }}>OrthoVis</span>
          <span style={{ fontSize:9, color:'var(--cyan)', letterSpacing:'0.18em', fontWeight:600, padding:'2px 6px', background:'var(--cyan-d)', borderRadius:4, border:'1px solid var(--cyan-b)' }}>v4 · BETA</span>
        </div>
        <span style={{ fontSize:10, color:'var(--text-m)', letterSpacing:'0.08em', textTransform:'uppercase', fontFamily:'var(--font-m)' }}>Medical Imaging Workstation</span>
      </header>

      {/* ── Scrollable body ──────────────────────────────────── */}
      <div className="ov-scroll" style={{ position:'relative', zIndex:5, flex:1, overflowY:'auto', display:'flex', flexDirection:'column', alignItems:'center', gap:32, padding:'36px 24px 48px' }}>

        {/* ── Main 2-col area ─────────────────────────────── */}
        <div className="ov-main" style={{ display:'flex', gap:32, width:'100%', maxWidth:1040, alignItems:'flex-start' }}>

          {/* ── LEFT: hero ───────────────────────────────── */}
          <div className="ov-hero" style={{ flex:'0 0 400px', display:'flex', flexDirection:'column', gap:20, paddingTop:8 }}>
            {/* Badge */}
            <div style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'4px 12px', borderRadius:100, background:'var(--cyan-d)', border:'1px solid var(--cyan-b)', width:'fit-content' }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background:'var(--cyan)', boxShadow:'0 0 8px var(--cyan)' }}/>
              <span style={{ fontSize:10, color:'var(--cyan)', fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase' }}>DICOM Viewer Profissional</span>
            </div>

            {/* Title */}
            <h1 className="ov-title" style={{ fontFamily:'var(--font-d)', fontSize:42, fontWeight:800, lineHeight:1.1, letterSpacing:'-0.03em', color:'var(--text-p)' }}>
              Visualize<br/>
              <span style={{ background:'linear-gradient(135deg, var(--cyan) 0%, #4cc9f0 50%, var(--purple) 100%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
                imagens médicas
              </span><br/>
              com precisão
            </h1>

            {/* Subtitle */}
            <p className="ov-sub" style={{ fontSize:14, color:'var(--text-s)', lineHeight:1.7, maxWidth:340 }}>
              Workstation DICOM completo no navegador — sem instalação, sem servidor, 100% local.
            </p>

            {/* Feature list */}
            <div className="ov-feats" style={{ display:'flex', flexDirection:'column', gap:10, marginTop:4 }}>
              {FEATURES.map(f => (
                <div key={f.label} style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                  <div style={{ width:28, height:28, flexShrink:0, borderRadius:'var(--r-md)', background:'var(--cyan-d)', border:'1px solid var(--cyan-b)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{f.icon}</svg>
                  </div>
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--text-p)', marginBottom:1 }}>{f.label}</div>
                    <div style={{ fontSize:10, color:'var(--text-m)' }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Stats row */}
            <div className="ov-stats" style={{ display:'flex', gap:10, marginTop:4, flexWrap:'wrap' }}>
              {[['900+', 'Slices'], ['4', 'Formatos'], ['3', 'Modos'], ['WebGL', 'Engine']].map(([v, l]) => (
                <div key={l} className="ov-stat" style={{ padding:'10px 16px', borderRadius:'var(--r-lg)', background:'var(--bg-surface)', border:'1px solid var(--border-s)', textAlign:'center', minWidth:64 }}>
                  <div style={{ fontSize:15, fontWeight:800, color:'var(--cyan)', fontFamily:'var(--font-d)', lineHeight:1 }}>{v}</div>
                  <div style={{ fontSize:9, color:'var(--text-m)', marginTop:3, textTransform:'uppercase', letterSpacing:'0.08em' }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: upload ────────────────────────────── */}
          <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:14 }}>

            {/* Drop zone card */}
            <div
              className="ov-drop-zone"
              onDragOver={e => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              style={{
                borderRadius:'var(--r-xl)',
                background: drag ? 'rgba(0,184,217,.05)' : 'var(--bg-surface)',
                border: `2px dashed ${drag ? 'var(--cyan)' : 'rgba(255,255,255,.12)'}`,
                boxShadow: drag ? '0 0 60px rgba(0,184,217,.12), inset 0 0 40px rgba(0,184,217,.04)' : '0 8px 40px rgba(0,0,0,.5)',
              }}
            >
              <div className="ov-drop-inner" style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:18, padding:'44px 32px' }}>

                {/* Upload icon */}
                <div style={{ position:'relative', animation: drag ? 'ov-float 1.5s ease-in-out infinite' : undefined }}>
                  <div style={{ width:72, height:72, borderRadius:'var(--r-xl)', background: drag ? 'var(--cyan-d)' : 'var(--bg-elevated)', border:`1px solid ${drag ? 'var(--cyan)' : 'var(--border-b)'}`, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .2s' }}>
                    {loading ? (
                      <div style={{ width:28, height:28, border:'3px solid rgba(0,184,217,.15)', borderTopColor:'var(--cyan)', borderRadius:'50%', animation:'ov-spin .8s linear infinite' }}/>
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={drag ? 'var(--cyan)' : 'var(--text-s)'} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ transition:'stroke .2s' }}>
                        <path d="M4 22h14a2 2 0 002-2V7.5L14.5 2H6a2 2 0 00-2 2v4"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <path d="M2 15h10M9 18l3-3-3-3"/>
                      </svg>
                    )}
                  </div>
                  {/* Glow ring */}
                  {drag && <div style={{ position:'absolute', inset:-8, borderRadius:20, border:'1px solid rgba(0,184,217,.3)', animation:'ov-pulse 1s ease-in-out infinite' }}/>}
                </div>

                {/* Text */}
                <div style={{ textAlign:'center' }}>
                  <h2 style={{ fontFamily:'var(--font-d)', fontSize:20, fontWeight:700, color: drag ? 'var(--cyan)' : 'var(--text-p)', marginBottom:6, transition:'color .2s' }}>
                    {loading ? phase || 'Carregando…' : drag ? 'Solte aqui!' : 'Arraste seus arquivos DICOM'}
                  </h2>
                  {!loading && (
                    <p style={{ fontSize:12, color:'var(--text-m)', lineHeight:1.6 }}>
                      {drag ? 'Arquivos ou pasta DICOM completa' : 'Arraste arquivos ou uma pasta — ou use os botões abaixo'}
                    </p>
                  )}
                </div>

                {/* Progress bar */}
                {loading && (
                  <div style={{ width:'100%', maxWidth:320 }}>
                    <div style={{ height:3, borderRadius:2, background:'var(--bg-overlay)', overflow:'hidden', marginBottom:6 }}>
                      <div style={{ height:'100%', width:`${progress}%`, background:'linear-gradient(90deg,var(--cyan),var(--purple))', borderRadius:2, transition:'width .3s' }}/>
                    </div>
                    <div style={{ textAlign:'center', fontSize:10, color:'var(--text-m)' }}>{Math.round(progress)}% — {phase}</div>
                  </div>
                )}

                {/* Buttons */}
                {!loading && (
                  <div className="ov-btn-row" style={{ display:'flex', gap:10, width:'100%', maxWidth:360, justifyContent:'center' }}>
                    <button
                      className="ov-btn-primary"
                      onClick={() => folderRef.current?.click()}
                      style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'12px 20px', borderRadius:'var(--r-md)', fontSize:13, fontWeight:700, fontFamily:'var(--font-d)', background:'var(--cyan)', color:'#000', border:'none', letterSpacing:'0.01em' }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                      Abrir Pasta
                    </button>
                    <button
                      className="ov-btn-secondary"
                      onClick={() => fileRef.current?.click()}
                      style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'12px 20px', borderRadius:'var(--r-md)', fontSize:13, background:'var(--bg-overlay)', border:'1px solid var(--border-d)', color:'var(--text-s)', fontFamily:'var(--font-d)', fontWeight:600 }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      Escolher Arquivo
                    </button>
                  </div>
                )}

                {/* Format badges */}
                {!loading && (
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'center' }}>
                    {FORMATS.map(f => (
                      <span key={f} className="ov-format-badge" style={{ fontSize:10, padding:'3px 9px', borderRadius:100, background:'var(--bg-overlay)', border:'1px solid var(--border-s)', color:'var(--text-m)', cursor:'default' }}>{f}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Info strip */}
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 16px', borderRadius:'var(--r-md)', background:'var(--bg-surface)', border:'1px solid var(--border-s)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="1.6"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span style={{ fontSize:10, color:'var(--text-m)', lineHeight:1.5 }}>
                <span style={{ color:'var(--green)', fontWeight:600 }}>100% local</span> — nenhum dado é enviado a servidores. Todo o processamento ocorre no seu navegador.
              </span>
            </div>
          </div>
        </div>

        {/* ── Feature cards ───────────────────────────────── */}
        <div className="ov-cards" style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, width:'100%', maxWidth:1040 }}>
          {[
            { color:'var(--cyan)',   icon:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></>, title:'Visualizador 2D', desc:'4 viewports independentes com windowing, pan, zoom e cine playback' },
            { color:'#4cc9f0',       icon:<><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="21"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/></>, title:'HU Probe & ROI', desc:'Medir unidades Hounsfield com estatísticas de região (μ, σ, min, max)' },
            { color:'var(--purple)', icon:<><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></>, title:'Volume 3D WebGL', desc:'Ray casting volumétrico com DVR anatômico e MIP em tempo real' },
            { color:'var(--green)',  icon:<><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>, title:'Laudo & Exportação', desc:'Gerar laudo PDF, exportar imagem do canvas e anotações clínicas' },
          ].map(c => (
            <div key={c.title} className="ov-feature-card" style={{ padding:'18px 16px', borderRadius:'var(--r-lg)', background:'var(--bg-surface)', border:'1px solid var(--border-s)' }}>
              <div style={{ width:36, height:36, borderRadius:'var(--r-md)', background:`rgba(${c.color === 'var(--cyan)' ? '0,184,217' : c.color === 'var(--purple)' ? '139,92,246' : c.color === 'var(--green)' ? '6,214,160' : '76,201,240'},.12)`, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:12, border:`1px solid ${c.color === 'var(--cyan)' ? 'rgba(0,184,217,.25)' : c.color === 'var(--purple)' ? 'rgba(139,92,246,.25)' : c.color === 'var(--green)' ? 'rgba(6,214,160,.25)' : 'rgba(76,201,240,.25)'}` }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c.color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{c.icon}</svg>
              </div>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text-p)', fontFamily:'var(--font-d)', marginBottom:5 }}>{c.title}</div>
              <div style={{ fontSize:10, color:'var(--text-m)', lineHeight:1.6 }}>{c.desc}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display:'flex', alignItems:'center', gap:16, color:'var(--text-d)', fontSize:10 }}>
          <span>OrthoVis v4 — Medical Imaging Workstation</span>
          <span style={{ width:3, height:3, borderRadius:'50%', background:'var(--border-b)' }}/>
          <span>WebGL · Canvas 2D · Web Workers</span>
          <span style={{ width:3, height:3, borderRadius:'50%', background:'var(--border-b)' }}/>
          <span>Nenhum dado é transmitido</span>
        </div>

      </div>

      {/* Hidden inputs */}
      <input ref={fileRef}   type="file" accept=".dcm,.dicom,.nii,.nii.gz,.npy" multiple hidden onChange={e=>{if(e.target.files)handleLoad(Array.from(e.target.files));e.target.value=''}}/>
      <input ref={folderRef} type="file" {...({webkitdirectory:''} as any)} multiple hidden onChange={e=>{if(e.target.files)handleLoad(Array.from(e.target.files));e.target.value=''}}/>
    </div>
  )
}
