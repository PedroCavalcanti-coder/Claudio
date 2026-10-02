import React, { useRef, useEffect, useState } from 'react'
import { useStore } from '../store'
import { extractSlab, renderSlice } from '../utils/mpr'
import type { SlabMode } from '../store'

type Plane = 'axial' | 'sagital' | 'coronal'
const COLORS: Record<Plane,string> = { axial:'#f72585', sagital:'#4cc9f0', coronal:'#7bed9f' }
const LABELS: Record<Plane,string> = { axial:'AXIAL', sagital:'SAGITAL', coronal:'CORONAL' }

function MprPanel({ plane, flex }: { plane: Plane; flex?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { volume, mpr, updateMpr } = useStore()
  const [localZoom, setLocalZoom] = useState(1)
  const panRef = useRef({ down:false, lx:0, ly:0, px:0, py:0 })
  const [, setTick] = useState(0)
  const color = COLORS[plane]

  const idx = !volume ? 0 : plane==='axial'?mpr.axialIndex:plane==='sagital'?mpr.sagittalIndex:mpr.coronalIndex
  const total = !volume ? 1 : plane==='axial'?volume.depth:plane==='sagital'?volume.width:volume.height

  const crossX = !volume ? 0.5 : plane==='axial'?mpr.sagittalIndex/Math.max(1,volume.width-1):plane==='sagital'?mpr.coronalIndex/Math.max(1,volume.height-1):mpr.sagittalIndex/Math.max(1,volume.width-1)
  const crossY = !volume ? 0.5 : plane==='axial'?mpr.coronalIndex/Math.max(1,volume.height-1):(volume.depth-1-mpr.axialIndex)/Math.max(1,volume.depth-1)

  useEffect(() => {
    const c = canvasRef.current; const el = containerRef.current
    if (!c||!el||!volume) return
    const cw=el.clientWidth, ch=el.clientHeight
    if (!cw||!ch) return
    c.width=cw; c.height=ch
    const ctx=c.getContext('2d')!
    ctx.fillStyle='#000'; ctx.fillRect(0,0,cw,ch)

    const slice = extractSlab(volume, plane, idx, mpr.slabThickness, mpr.slabMode)
    const img = renderSlice(slice, mpr.windowCenter, mpr.windowWidth, mpr.invert, mpr.colormap, mpr.brightness, mpr.contrast)
    const tmp = document.createElement('canvas'); tmp.width=slice.width; tmp.height=slice.height
    tmp.getContext('2d')!.putImageData(img,0,0)

    const base=Math.min(cw/slice.width,ch/slice.height)*localZoom
    const dw=slice.width*base, dh=slice.height*base
    const dx=(cw-dw)/2+panRef.current.px, dy=(ch-dh)/2+panRef.current.py
    ctx.imageSmoothingEnabled=false
    ctx.drawImage(tmp,dx,dy,dw,dh)

    // Crosshairs
    const cxPx=dx+crossX*dw, cyPx=dy+crossY*dh
    const vCol = plane==='axial'?COLORS.sagital:plane==='sagital'?COLORS.coronal:COLORS.sagital
    const hCol = plane==='axial'?COLORS.coronal:COLORS.sagital
    ctx.save()
    ctx.globalAlpha=0.85; ctx.lineWidth=1; ctx.setLineDash([])
    ctx.strokeStyle=vCol; ctx.beginPath(); ctx.moveTo(cxPx,0); ctx.lineTo(cxPx,ch); ctx.stroke()
    ctx.strokeStyle=hCol; ctx.beginPath(); ctx.moveTo(0,cyPx); ctx.lineTo(cw,cyPx); ctx.stroke()
    ctx.restore()

    // Info overlays
    ctx.font='10px DM Mono,monospace'; ctx.fillStyle='rgba(255,255,255,0.5)'
    ctx.shadowColor='rgba(0,0,0,0.9)'; ctx.shadowBlur=3
    ctx.fillText(`${idx+1}/${total}`,8,ch-24)
    ctx.fillText(`Z:${(localZoom*100).toFixed(0)}%`,8,ch-10)
    if (mpr.slabThickness>1) ctx.fillText(`Slab:${mpr.slabThickness} (${mpr.slabMode.toUpperCase()})`,60,ch-10)
    ctx.shadowBlur=0
  }, [volume,mpr,plane,idx,total,crossX,crossY,localZoom,panRef.current.px,panRef.current.py])

  useEffect(() => {
    const el=containerRef.current; if(!el) return
    const ro=new ResizeObserver(()=>setTick(t=>t+1)); ro.observe(el); return ()=>ro.disconnect()
  },[])

  const getCoords = (e: React.MouseEvent) => {
    const c=canvasRef.current!; const el=containerRef.current!; if(!volume) return null
    const rect=c.getBoundingClientRect(); const cx=e.clientX-rect.left; const cy=e.clientY-rect.top
    const cw=el.clientWidth, ch=el.clientHeight
    let sliceW=0, sliceH=0
    if (plane==='axial'){sliceW=volume.width;sliceH=volume.height}
    else if (plane==='sagital'){sliceW=volume.height;sliceH=volume.depth}
    else{sliceW=volume.width;sliceH=volume.depth}
    const base=Math.min(cw/sliceW,ch/sliceH)*localZoom
    const dw=sliceW*base, dh=sliceH*base
    const dx=(cw-dw)/2+panRef.current.px, dy=(ch-dh)/2+panRef.current.py
    const nx=Math.max(0,Math.min(1,(cx-dx)/dw)); const ny=Math.max(0,Math.min(1,(cy-dy)/dh))
    return {nx,ny}
  }

  const handleClick=(e:React.MouseEvent)=>{
    if(!volume) return; const c=getCoords(e); if(!c) return; const {nx,ny}=c
    if(plane==='axial'){updateMpr({sagittalIndex:Math.round(nx*(volume.width-1)),coronalIndex:Math.round(ny*(volume.height-1))})}
    else if(plane==='sagital'){updateMpr({coronalIndex:Math.round(nx*(volume.height-1)),axialIndex:Math.round((1-ny)*(volume.depth-1))})}
    else{updateMpr({sagittalIndex:Math.round(nx*(volume.width-1)),axialIndex:Math.round((1-ny)*(volume.depth-1))})}
  }

  const handleWheel=(e:React.WheelEvent)=>{
    e.preventDefault(); if(!volume) return; const d=e.deltaY>0?1:-1
    if(e.ctrlKey){setLocalZoom(z=>Math.max(0.2,Math.min(10,z-d*0.1)));return}
    if(plane==='axial')updateMpr({axialIndex:Math.max(0,Math.min(volume.depth-1,mpr.axialIndex+d))})
    else if(plane==='sagital')updateMpr({sagittalIndex:Math.max(0,Math.min(volume.width-1,mpr.sagittalIndex+d))})
    else updateMpr({coronalIndex:Math.max(0,Math.min(volume.height-1,mpr.coronalIndex+d))})
  }

  return (
    <div ref={containerRef} style={{ position:'relative', flex:flex||'1', background:'#000', overflow:'hidden', border:`1px solid ${color}44` }}>
      <canvas ref={canvasRef} style={{ display:'block', width:'100%', height:'100%', cursor:'crosshair' }}
        onMouseDown={e=>{panRef.current={down:true,lx:e.clientX,ly:e.clientY,px:panRef.current.px,py:panRef.current.py};e.preventDefault()}}
        onMouseMove={e=>{if(!panRef.current.down)return; panRef.current.px+=e.clientX-panRef.current.lx; panRef.current.py+=e.clientY-panRef.current.ly; panRef.current.lx=e.clientX; panRef.current.ly=e.clientY; setTick(t=>t+1)}}
        onMouseUp={()=>{panRef.current.down=false}} onMouseLeave={()=>{panRef.current.down=false}}
        onClick={handleClick} onWheel={handleWheel}/>
      <div style={{ position:'absolute', top:8, left:10, fontFamily:'var(--font-d)', fontSize:12, fontWeight:700, letterSpacing:'0.1em', color, textShadow:'0 1px 4px rgba(0,0,0,0.9)', pointerEvents:'none' }}>{LABELS[plane]}</div>
      <div style={{ position:'absolute', bottom:8, right:10, fontSize:9, color:'rgba(255,255,255,0.35)', fontFamily:'var(--font-m)', pointerEvents:'none' }}>{idx+1}/{total}</div>
    </div>
  )
}

function MprControls() {
  const { mpr, updateMpr } = useStore()

  const presets = [
    {l:'Abdômen',wc:60,ww:400},{l:'Pulmão',wc:-600,ww:1500},{l:'Osso',wc:400,ww:1800},{l:'Cérebro',wc:40,ww:80},{l:'Fígado',wc:70,ww:160}
  ]

  return (
    <div style={{ width:200, minWidth:200, background:'var(--bg-surface)', borderLeft:'1px solid var(--border-s)', overflowY:'auto', padding:'10px 10px', display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ fontSize:9, color:'var(--cyan)', textTransform:'uppercase', letterSpacing:'0.1em' }}>Janela</div>

      {[
        {k:'windowCenter' as const,label:`WC: ${Math.round(mpr.windowCenter)}`,min:-2000,max:3000,step:10},
        {k:'windowWidth' as const,label:`WW: ${Math.round(mpr.windowWidth)}`,min:1,max:4000,step:10},
        {k:'brightness' as const,label:`Brilho: ${mpr.brightness}%`,min:0,max:200,step:5},
        {k:'contrast' as const,label:`Contraste: ${mpr.contrast}%`,min:0,max:200,step:5},
      ].map(({k,label,min,max,step})=>(
        <div key={k}>
          <div style={{ fontSize:10, color:'var(--text-s)', marginBottom:3 }}>{label}</div>
          <input type="range" min={min} max={max} step={step} value={mpr[k]}
            onChange={e=>updateMpr({[k]:+e.target.value})}
            style={{ width:'100%', height:3, appearance:'none', background:'var(--bg-hover)', borderRadius:2, cursor:'pointer' }}/>
        </div>
      ))}

      <div style={{ display:'flex', gap:4 }}>
        <button onClick={()=>updateMpr({invert:!mpr.invert})} style={{ flex:1, padding:'4px', borderRadius:'var(--r-sm)', fontSize:10, background:mpr.invert?'var(--cyan-d)':'var(--bg-overlay)', border:`1px solid ${mpr.invert?'var(--cyan)':'var(--border-s)'}`, color:mpr.invert?'var(--cyan)':'var(--text-s)' }}>Inverter</button>
        <button onClick={()=>updateMpr({windowCenter:400,windowWidth:1500,brightness:100,contrast:100,invert:false})} style={{ flex:1, padding:'4px', borderRadius:'var(--r-sm)', fontSize:10, background:'var(--bg-overlay)', border:'1px solid var(--border-s)', color:'var(--text-m)' }}>Reset</button>
      </div>

      <div style={{ fontSize:9, color:'var(--cyan)', textTransform:'uppercase', letterSpacing:'0.1em' }}>Presets</div>
      {presets.map(p=>(
        <button key={p.l} onClick={()=>updateMpr({windowCenter:p.wc,windowWidth:p.ww})}
          style={{ width:'100%', padding:'5px 8px', borderRadius:'var(--r-sm)', fontSize:10, background:'var(--bg-overlay)', border:'1px solid var(--border-s)', color:'var(--text-s)', display:'flex', justifyContent:'space-between', cursor:'pointer' }}>
          <span>{p.l}</span><span style={{color:'var(--text-m)',fontSize:9}}>C:{p.wc} W:{p.ww}</span>
        </button>
      ))}

      <div style={{ fontSize:9, color:'var(--cyan)', textTransform:'uppercase', letterSpacing:'0.1em' }}>Slab MPR</div>
      <div>
        <div style={{ fontSize:10, color:'var(--text-s)', marginBottom:3 }}>Espessura: {mpr.slabThickness}px</div>
        <input type="range" min={1} max={50} step={1} value={mpr.slabThickness}
          onChange={e=>updateMpr({slabThickness:+e.target.value})}
          style={{ width:'100%', height:3, appearance:'none', background:'var(--bg-hover)', borderRadius:2, cursor:'pointer' }}/>
      </div>
      <div style={{ display:'flex', gap:3 }}>
        {(['mip','minip','avg'] as SlabMode[]).map(m=>(
          <button key={m} onClick={()=>updateMpr({slabMode:m})}
            style={{ flex:1, padding:'4px 2px', borderRadius:'var(--r-sm)', fontSize:9, background:mpr.slabMode===m?'var(--cyan-d)':'var(--bg-overlay)', border:`1px solid ${mpr.slabMode===m?'var(--cyan)':'var(--border-s)'}`, color:mpr.slabMode===m?'var(--cyan)':'var(--text-m)', textTransform:'uppercase', fontWeight:700 }}>
            {m}
          </button>
        ))}
      </div>
    </div>
  )
}

export function MprView() {
  const { volume } = useStore()

  if (!volume) return (
    <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg-void)', color:'var(--text-d)', flexDirection:'column', gap:12 }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" opacity={0.4}>
        <rect x="2" y="2" width="9" height="9" rx="1"/><rect x="13" y="2" width="9" height="9" rx="1"/>
        <rect x="2" y="13" width="9" height="9" rx="1"/><rect x="13" y="13" width="9" height="9" rx="1"/>
      </svg>
      <span style={{fontSize:13}}>Carregue um volume para MPR</span>
    </div>
  )

  return (
    <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
      <div style={{ flex:1, display:'flex', overflow:'hidden', gap:2, background:'#020304' }}>
        {/* Axial large left */}
        <div style={{ flex:'1.4', display:'flex', flexDirection:'column', minWidth:0 }}>
          <MprPanel plane="axial"/>
        </div>
        {/* Sagital + Coronal stacked right */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', gap:2, minWidth:0 }}>
          <MprPanel plane="sagital"/>
          <MprPanel plane="coronal"/>
        </div>
      </div>
      <MprControls/>
    </div>
  )
}
