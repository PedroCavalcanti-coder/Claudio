import React, { useState, useRef } from 'react'
import { useStore } from '../store'
import type { GridLayout } from '../store'

const sm = { width:14, height:14, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.7, strokeLinecap:'round' as const, strokeLinejoin:'round' as const }
const IFlipH  = () => <svg {...sm}><line x1="12" y1="3" x2="12" y2="21"/><polyline points="4,9 12,4 20,9" opacity=".5"/><polyline points="4,15 12,20 20,15" opacity=".5"/></svg>
const IFlipV  = () => <svg {...sm}><line x1="3" y1="12" x2="21" y2="12"/><polyline points="9,4 4,12 9,20" opacity=".5"/><polyline points="15,4 20,12 15,20" opacity=".5"/></svg>
const IRotCW  = () => <svg {...sm}><path d="M21 2v6h-6M21 13a9 9 0 11-3-7.7L21 8"/></svg>
const IRotCCW = () => <svg {...sm}><path d="M3 2v6h6M3 13a9 9 0 103-7.7L3 8"/></svg>
const IInvert = () => <svg {...sm}><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 000 18z" fill="currentColor" stroke="none"/></svg>
const IReset  = () => <svg {...sm}><path d="M3 12a9 9 0 1018 0 9 9 0 00-18 0"/><path d="M12 8v4l3 3"/></svg>

function Tooltip({ label, shortcut, children }: { label: string; shortcut?: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false)
  const timer = useRef<any>(null)
  return (
    <div style={{ position:'relative' }}
      onMouseEnter={() => { timer.current = setTimeout(() => setShow(true), 1200) }}
      onMouseLeave={() => { clearTimeout(timer.current); setShow(false) }}>
      {children}
      {show && (
        <div style={{ position:'absolute', bottom:'calc(100% + 8px)', left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-panel)', border:'1px solid var(--border-b)', borderRadius:'var(--r-md)',
          padding:'4px 9px', whiteSpace:'nowrap', fontSize:11, color:'var(--text-p)',
          zIndex:9999, boxShadow:'var(--shadow-f)', display:'flex', alignItems:'center', gap:6, pointerEvents:'none' }}>
          <span>{label}</span>
          {shortcut && <kbd style={{ background:'var(--bg-overlay)', border:'1px solid var(--border-b)', borderRadius:3, padding:'1px 5px', fontSize:10, color:'var(--cyan)', fontFamily:'var(--font-m)' }}>{shortcut}</kbd>}
        </div>
      )}
    </div>
  )
}

const GRID_OPTS: { id: GridLayout; label: string }[] = [
  { id:'1x1', label:'1×1' },
  { id:'1x2', label:'1×2' },
  { id:'2x1', label:'2×1' },
  { id:'2x2', label:'2×2' },
]

const div = <div style={{ width:1, height:20, background:'var(--border-s)', margin:'0 4px', flexShrink:0 }}/>

export function ViewerToolbar() {
  const {
    workMode, setWorkMode,
    gridLayout, setGridLayout,
    volume,
    showNotes, setShowNotes,
    setShowExport, setShowReport, setShowPriors,
    mpr, updateMpr,
    cineActive, cineFps, setCineActive, setCineFps,
    activeViewportId, viewports, updateViewport,
    studyMeta,
  } = useStore()

  // Notas e Laudo exigem vínculo com o RIS/PACS; arquivos soltos via drag&drop não têm studyMeta
  const pacsLinked = studyMeta !== null

  const vp = viewports[activeViewportId]
  const applyImg = (action: string) => {
    if (!vp) return
    if (action === 'flipH')  updateViewport(activeViewportId, { flipH: !vp.flipH })
    if (action === 'flipV')  updateViewport(activeViewportId, { flipV: !vp.flipV })
    if (action === 'rotCW')  updateViewport(activeViewportId, { rotation: (vp.rotation + 90) % 360 })
    if (action === 'rotCCW') updateViewport(activeViewportId, { rotation: (vp.rotation - 90 + 360) % 360 })
    if (action === 'invert') updateViewport(activeViewportId, { invert: !vp.invert })
    if (action === 'reset')  updateViewport(activeViewportId, { zoom:1, panX:0, panY:0, rotation:0, flipH:false, flipV:false, invert:false })
  }

  const imgBtn = (action: string, label: string, Icon: React.FC, active?: boolean) => (
    <Tooltip label={label} key={action}>
      <button onClick={() => applyImg(action)} style={{
        width:28, height:28, borderRadius:'var(--r-sm)', display:'flex', alignItems:'center', justifyContent:'center',
        background: active ? 'var(--cyan-d)' : 'var(--bg-elevated)',
        border: `1px solid ${active ? 'var(--cyan)' : 'var(--border-d)'}`,
        color: active ? 'var(--cyan)' : 'var(--text-m)',
      }}>
        <Icon />
      </button>
    </Tooltip>
  )

  const modeBtn = (m: typeof workMode, label: string) => (
    <button onClick={() => setWorkMode(m)} style={{
      padding:'4px 10px', borderRadius:'var(--r-md)', fontSize:11, fontWeight:700, letterSpacing:'0.04em',
      background: workMode===m ? 'var(--cyan-d)' : 'var(--bg-elevated)',
      border: `1px solid ${workMode===m ? 'var(--cyan)' : 'var(--border-d)'}`,
      color: workMode===m ? 'var(--cyan)' : 'var(--text-s)',
    }}>{label}</button>
  )

  return (
    <header style={{ display:'flex', alignItems:'center', gap:3, height:44, padding:'0 10px', background:'var(--bg-base)', borderBottom:'1px solid var(--border-s)', flexShrink:0, overflowX:'auto' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7l10 5 10-5-10-5z" fill="var(--cyan)" opacity=".9"/>
          <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="var(--cyan)" strokeWidth="1.5"/>
        </svg>
        <span style={{ fontFamily:'var(--font-d)', fontSize:14, fontWeight:800, letterSpacing:'-0.02em' }}>OrthoVis</span>
      </div>

      {div}

      <div style={{ display:'flex', gap:2, flexShrink:0 }}>
        {modeBtn('2d', '2D')}
        {modeBtn('mpr', 'MPR')}
        {modeBtn('3d', '3D')}
      </div>

      {div}

      {workMode === '2d' && (
        <>
          <div style={{ display:'flex', gap:2, flexShrink:0 }}>
            {GRID_OPTS.map(g => (
              <button key={g.id} onClick={() => setGridLayout(g.id)} style={{ padding:'3px 7px', borderRadius:'var(--r-sm)', fontSize:10, fontWeight:700,
                background: gridLayout===g.id ? 'var(--cyan-d)' : 'transparent',
                color: gridLayout===g.id ? 'var(--cyan)' : 'var(--text-m)',
                border: gridLayout===g.id ? '1px solid var(--cyan)' : '1px solid transparent' }}>
                {g.label}
              </button>
            ))}
          </div>
          {div}
          <Tooltip label={cineActive ? 'Pausar cine' : 'Reproduzir cine (Espaço)'}>
            <button onClick={() => setCineActive(!cineActive)} style={{
              display:'flex', alignItems:'center', gap:4, padding:'3px 8px',
              borderRadius:'var(--r-sm)', fontSize:10, flexShrink:0,
              background: cineActive ? 'rgba(247,37,133,0.15)' : 'var(--bg-elevated)',
              border: `1px solid ${cineActive ? 'rgba(247,37,133,0.5)' : 'var(--border-d)'}`,
              color: cineActive ? '#f72585' : 'var(--text-m)',
            }}>
              {cineActive
                ? <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                : <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              }
              {cineActive ? 'Pausar' : 'Cine'}
            </button>
          </Tooltip>
          <input type="range" min={1} max={30} step={1} value={cineFps}
            onChange={e => setCineFps(+e.target.value)}
            style={{ width:52, height:3, accentColor:'#f72585', flexShrink:0 }}
            title={`${cineFps} fps`}/>
          <span style={{ fontSize:9, color:'var(--text-m)', minWidth:28, flexShrink:0 }}>{cineFps} fps</span>
          {div}
        </>
      )}

      {workMode !== '3d' && (
        <>
          {div}
          <div style={{ display:'flex', gap:2, flexShrink:0, alignItems:'center' }}>
            {imgBtn('flipH',  'Espelhar horizontal', IFlipH,  vp?.flipH)}
            {imgBtn('flipV',  'Espelhar vertical',   IFlipV,  vp?.flipV)}
            {imgBtn('rotCW',  'Girar 90° →',         IRotCW)}
            {imgBtn('rotCCW', 'Girar 90° ←',         IRotCCW)}
            {imgBtn('invert', 'Inverter cores',       IInvert, vp?.invert)}
            {imgBtn('reset',  'Resetar vista',        IReset)}
          </div>
        </>
      )}

      {workMode === '3d' && (
        <>
          <div style={{ display:'flex', gap:4, alignItems:'center', flexShrink:0 }}>
            <span style={{ fontSize:9, color:'var(--text-m)' }}>WC</span>
            <input type="range" min={-1000} max={2000} step={10} value={mpr.windowCenter}
              onChange={e=>updateMpr({windowCenter:+e.target.value})} style={{ width:80, height:3, accentColor:'var(--cyan)' }}/>
            <span style={{ fontSize:9, color:'var(--text-m)', minWidth:32 }}>{Math.round(mpr.windowCenter)}</span>
            <span style={{ fontSize:9, color:'var(--text-m)' }}>WW</span>
            <input type="range" min={1} max={4000} step={10} value={mpr.windowWidth}
              onChange={e=>updateMpr({windowWidth:+e.target.value})} style={{ width:80, height:3, accentColor:'var(--cyan)' }}/>
            <span style={{ fontSize:9, color:'var(--text-m)', minWidth:32 }}>{Math.round(mpr.windowWidth)}</span>
          </div>
        </>
      )}

      <div style={{ flex:1 }}/>

      {volume && (
        <>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', padding:'0 5px', flexShrink:0 }}>
            <span style={{ fontSize:11, fontWeight:700 }}>{volume.modality}</span>
            <span style={{ fontSize:9, color:'var(--text-m)', fontFamily:'var(--font-m)' }}>{volume.width}×{volume.height}×{volume.depth}</span>
          </div>
          {div}
        </>
      )}

      <div style={{ display:'flex', gap:4, flexShrink:0 }}>
        <Tooltip label={pacsLinked ? 'Notas clínicas' : 'Disponível apenas para estudos do PACS'}>
          <button
            onClick={() => pacsLinked && setShowNotes(!showNotes)}
            disabled={!pacsLinked}
            aria-disabled={!pacsLinked}
            style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', borderRadius:'var(--r-sm)', fontSize:10,
              background: !pacsLinked ? 'var(--bg-base)' : (showNotes ? 'var(--cyan-d)' : 'var(--bg-elevated)'),
              border:`1px solid ${!pacsLinked ? 'var(--border-s)' : (showNotes?'var(--cyan)':'var(--border-d)')}`,
              color: !pacsLinked ? 'var(--text-d)' : (showNotes?'var(--cyan)':'var(--text-s)'),
              cursor: pacsLinked ? 'pointer' : 'not-allowed',
              opacity: pacsLinked ? 1 : 0.55,
            }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
            Notas
          </button>
        </Tooltip>
        <Tooltip label={pacsLinked ? 'Exames anteriores do paciente' : 'Disponível apenas para estudos do PACS'}>
          <button
            onClick={() => pacsLinked && setShowPriors(true)}
            disabled={!pacsLinked}
            aria-disabled={!pacsLinked}
            style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', borderRadius:'var(--r-sm)', fontSize:10,
              background: !pacsLinked ? 'var(--bg-base)' : 'var(--bg-elevated)',
              border:`1px solid ${!pacsLinked ? 'var(--border-s)' : 'var(--border-d)'}`,
              color: !pacsLinked ? 'var(--text-d)' : 'var(--text-s)',
              cursor: pacsLinked ? 'pointer' : 'not-allowed', opacity: pacsLinked ? 1 : 0.55 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 106 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
            Anteriores
          </button>
        </Tooltip>
        <Tooltip label="Exportar imagem (Canvas.toBlob)">
          <button onClick={() => setShowExport(true)} style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', borderRadius:'var(--r-sm)', fontSize:10, background:'var(--green-d)', border:'1px solid rgba(6,214,160,0.25)', color:'var(--green)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar
          </button>
        </Tooltip>
        <Tooltip label={pacsLinked ? 'Gerar laudo PDF' : 'Disponível apenas para estudos do PACS'}>
          <button
            onClick={() => pacsLinked && setShowReport(true)}
            disabled={!pacsLinked}
            aria-disabled={!pacsLinked}
            style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', borderRadius:'var(--r-sm)', fontSize:10,
              background: !pacsLinked ? 'var(--bg-base)' : 'rgba(139,92,246,0.13)',
              border:`1px solid ${!pacsLinked ? 'var(--border-s)' : 'rgba(139,92,246,0.3)'}`,
              color: !pacsLinked ? 'var(--text-d)' : 'var(--purple)',
              cursor: pacsLinked ? 'pointer' : 'not-allowed',
              opacity: pacsLinked ? 1 : 0.55,
            }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
            Laudo
          </button>
        </Tooltip>
      </div>
    </header>
  )
}
