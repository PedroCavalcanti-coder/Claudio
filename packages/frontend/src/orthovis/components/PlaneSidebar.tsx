import React, { useRef, useEffect, useCallback } from 'react'
import { useStore } from '../store'
import type { PlaneType } from '../store'
import { extractAxial, extractCoronal, extractSagital, renderSlice } from '../utils/mpr'

const PLANE_COLORS: Record<PlaneType, string> = { axial:'#f72585', sagital:'#4cc9f0', coronal:'#7bed9f' }
const DRAG_TYPE = 'application/x-orthovis-plane'

interface ThumbnailProps { plane: PlaneType }

function PlaneThumbnail({ plane }: ThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { volume, mpr, updateMpr, setDraggingPlane } = useStore()
  const color = PLANE_COLORS[plane]

  const idx = !volume ? 0 : plane==='axial'?mpr.axialIndex:plane==='sagital'?mpr.sagittalIndex:mpr.coronalIndex
  const total = !volume ? 1 : plane==='axial'?volume.depth:plane==='sagital'?volume.width:volume.height

  const render = useCallback(() => {
    const c = canvasRef.current; if (!c || !volume) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle='#000'; ctx.fillRect(0,0,c.width,c.height)
    const slice = plane==='axial'?extractAxial(volume,idx):plane==='sagital'?extractSagital(volume,idx):extractCoronal(volume,idx)
    const img = renderSlice(slice, mpr.windowCenter, mpr.windowWidth, mpr.invert, mpr.colormap, mpr.brightness, mpr.contrast)
    const tmp=document.createElement('canvas'); tmp.width=slice.width; tmp.height=slice.height
    tmp.getContext('2d')!.putImageData(img,0,0)
    const s=Math.min(c.width/slice.width, c.height/slice.height)
    const dw=slice.width*s, dh=slice.height*s
    ctx.imageSmoothingEnabled=true
    ctx.drawImage(tmp,(c.width-dw)/2,(c.height-dh)/2,dw,dh)
    ctx.font='bold 10px DM Mono,monospace'; ctx.fillStyle='rgba(255,255,255,0.6)'
    ctx.fillText(`${idx+1}`,4,c.height-4)
  }, [volume, mpr, plane, idx])

  useEffect(() => { render() }, [render])

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault(); if (!volume) return
    const d = e.deltaY > 0 ? 1 : -1
    if (plane==='axial') updateMpr({ axialIndex: Math.max(0, Math.min(volume.depth-1, mpr.axialIndex+d)) })
    else if (plane==='sagital') updateMpr({ sagittalIndex: Math.max(0, Math.min(volume.width-1, mpr.sagittalIndex+d)) })
    else updateMpr({ coronalIndex: Math.max(0, Math.min(volume.height-1, mpr.coronalIndex+d)) })
  }

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData(DRAG_TYPE, plane); setDraggingPlane(plane) }}
      onDragEnd={() => setDraggingPlane(null)}
      style={{ background:'var(--bg-elevated)', borderRadius:'var(--r-md)', overflow:'hidden', border:`1px solid ${color}30`, cursor:'grab', userSelect:'none' }}
    >
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 8px' }}>
        <span style={{ fontSize:9, fontWeight:700, color, letterSpacing:'0.1em', textTransform:'uppercase', fontFamily:'var(--font-d)' }}>{plane}</span>
        <span style={{ fontSize:9, color:'var(--text-m)', fontFamily:'var(--font-m)' }}>{idx+1} / {total}</span>
      </div>
      <canvas ref={canvasRef} width={180} height={100} onWheel={handleWheel}
        style={{ display:'block', width:'100%', height:100, background:'#000', cursor:'grab' }}/>
      <div style={{ padding:'2px 8px 4px' }}>
        <input type="range" min={0} max={Math.max(0,total-1)} value={idx}
          onChange={e => {
            const v = +e.target.value
            if (plane==='axial') updateMpr({ axialIndex: v })
            else if (plane==='sagital') updateMpr({ sagittalIndex: v })
            else updateMpr({ coronalIndex: v })
          }}
          onClick={e => e.stopPropagation()}
          style={{ width:'100%', height:3, appearance:'none', background:'var(--bg-hover)', borderRadius:2, cursor:'pointer', accentColor:color }}
        />
      </div>
    </div>
  )
}

export function PlaneSidebar() {
  const { volume } = useStore()

  return (
    <aside style={{ width:204, minWidth:204, background:'var(--bg-surface)', borderRight:'1px solid var(--border-s)', display:'flex', flexDirection:'column', overflow:'hidden', flexShrink:0 }}>
      <div style={{ padding:'7px 10px 5px', borderBottom:'1px solid var(--border-s)', flexShrink:0 }}>
        <span style={{ fontSize:9, color:'var(--text-m)', textTransform:'uppercase', letterSpacing:'0.1em' }}>Planos</span>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:8, display:'flex', flexDirection:'column', gap:8 }}>
        {!volume ? (
          <div style={{ height:120, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, color:'var(--text-d)', fontSize:11, textAlign:'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8">
              <rect x="2" y="2" width="9" height="9" rx="1"/><rect x="13" y="2" width="9" height="9" rx="1"/>
              <rect x="2" y="13" width="9" height="9" rx="1"/><rect x="13" y="13" width="9" height="9" rx="1"/>
            </svg>
            <span>Carregue um volume</span>
          </div>
        ) : (
          <>
            <PlaneThumbnail plane="axial"/>
            <PlaneThumbnail plane="sagital"/>
            <PlaneThumbnail plane="coronal"/>
          </>
        )}
      </div>

      {volume && (
        <div style={{ padding:'5px 8px', borderTop:'1px solid var(--border-s)', fontSize:9, color:'var(--text-d)', lineHeight:1.5 }}>
          ↕ Scroll para navegar · Arrastar para viewport
        </div>
      )}
    </aside>
  )
}
