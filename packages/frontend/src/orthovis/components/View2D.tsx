import React from 'react'
import { useStore } from '../store'
import { SliceViewport } from './SliceViewport'
import type { GridLayout } from '../store'

const GRID_CSS: Record<GridLayout, React.CSSProperties> = {
  '1x1': { gridTemplateColumns:'1fr', gridTemplateRows:'1fr' },
  '1x2': { gridTemplateColumns:'1fr 1fr', gridTemplateRows:'1fr' },
  '2x1': { gridTemplateColumns:'1fr', gridTemplateRows:'1fr 1fr' },
  '2x2': { gridTemplateColumns:'1fr 1fr', gridTemplateRows:'1fr 1fr' },
}

const GRID_VP_IDS: Record<GridLayout, string[]> = {
  '1x1': ['vp-0'],
  '1x2': ['vp-0', 'vp-1'],
  '2x1': ['vp-0', 'vp-1'],
  '2x2': ['vp-0', 'vp-1', 'vp-2', 'vp-3'],
}

export function View2D() {
  const { gridLayout, volume, activeViewportId, setActiveViewport } = useStore()

  if (!volume) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg-void)', flexDirection:'column', gap:14, padding:40 }}>
        <div style={{ color:'rgba(0,180,217,0.12)' }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.5">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <h2 style={{ fontFamily:'var(--font-d)', fontSize:22, fontWeight:700, color:'var(--text-p)', letterSpacing:'-0.02em', textAlign:'center' }}>OrthoVis DICOM Workstation</h2>
        <p style={{ fontSize:12, color:'var(--text-m)', textAlign:'center', lineHeight:1.7, maxWidth:420 }}>
          Carregue arquivos via <strong style={{color:'var(--text-s)'}}>Abrir</strong> na toolbar<br/>
          ou volte à tela inicial clicando em <strong style={{color:'var(--red)'}}>Sair</strong>.
        </p>
        <div style={{ display:'flex', gap:7, flexWrap:'wrap', justifyContent:'center' }}>
          {['.dcm / .dicom','.nii / .nii.gz','.npy'].map(f=>(
            <span key={f} style={{ fontSize:10, padding:'3px 10px', borderRadius:100, background:'rgba(0,180,217,0.07)', border:'1px solid rgba(0,180,217,0.15)', color:'var(--cyan)', fontFamily:'var(--font-m)' }}>{f}</span>
          ))}
        </div>
      </div>
    )
  }

  const vpIds = GRID_VP_IDS[gridLayout]

  return (
    <div style={{ flex:1, display:'grid', gap:2, background:'#020406', ...GRID_CSS[gridLayout] }}>
      {vpIds.map(id => (
        <SliceViewport
          key={id}
          vpId={id}
          isActive={activeViewportId === id}
          onClick={() => setActiveViewport(id)}
        />
      ))}
    </div>
  )
}
