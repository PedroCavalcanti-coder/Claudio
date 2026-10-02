import { useStore } from '../store'

const HINTS: Record<string,string> = {
  windowing:'Drag H→WC/WW · Shift+Scroll→WW · Scroll→fatias',
  pan:'Drag→mover · Scroll→fatias',
  zoom:'Drag→zoom · Ctrl+Scroll→zoom',
  ruler:'Click+drag→medir em cm',
  angle:'Click 3x→medir ângulo',
  probe:'Click→HU do pixel',
  arrow:'Click+drag→seta',
  circle:'Click+drag→elipse+área',
  rectangle:'Click+drag→retângulo+área',
  freehand:'Click+drag→traço livre',
  text:'Click→inserir texto',
  eraser:'Click sobre anotação→apagar',
}

export function ViewerStatusBar() {
  const { workMode, volume, mpr, viewports, activeViewportId, activeTool, isLoading, loadingPhase, loadingProgress, gridLayout } = useStore()
  const vp = viewports[activeViewportId]
  const totalAnns = Object.values(viewports).reduce((a,v)=>a+(v.annotations?.length||0),0)

  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', height:24, padding:'0 12px', background:'var(--bg-base)', borderTop:'1px solid var(--border-s)', flexShrink:0, gap:16 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
        {isLoading ? (
          <>
            <div style={{ width:64, height:3, background:'var(--bg-overlay)', borderRadius:2, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${loadingProgress}%`, background:'linear-gradient(90deg,var(--cyan),var(--green))', borderRadius:2, transition:'width .15s' }}/>
            </div>
            <span style={{ fontSize:10, color:'var(--text-m)', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{loadingPhase}</span>
          </>
        ) : (
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ width:5, height:5, borderRadius:'50%', background:'var(--green)', boxShadow:'0 0 5px var(--green)' }}/>
            <span style={{ fontSize:10, color:'var(--green)', fontWeight:700 }}>Pronto</span>
            {volume && <><span style={{ color:'var(--text-d)' }}>·</span><span style={{ fontSize:10, color:'var(--text-m)', fontFamily:'var(--font-m)' }}>{volume.modality} {volume.width}×{volume.height}×{volume.depth}</span></>}
            {totalAnns > 0 && <><span style={{ color:'var(--text-d)' }}>·</span><span style={{ fontSize:10, color:'var(--cyan)' }}>{totalAnns} ann.</span></>}
          </div>
        )}
      </div>

      <div style={{ flex:1, display:'flex', justifyContent:'center', overflow:'hidden' }}>
        {workMode !== '3d' && (
          <span style={{ fontSize:10, color:'var(--text-d)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {HINTS[activeTool] || ''}
          </span>
        )}
        {workMode === '3d' && (
          <span style={{ fontSize:10, color:'var(--text-d)' }}>Drag → orbitar · Scroll → zoom · Shift+Scroll → Window Width</span>
        )}
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
        {workMode === '2d' && vp && (
          <>
            <span style={{ fontSize:10, color:'var(--text-m)', fontFamily:'var(--font-m)', textTransform:'uppercase' }}>{vp.plane}</span>
            <span style={{ fontSize:10, color:'var(--text-m)', fontFamily:'var(--font-m)' }}>WC {Math.round(vp.windowCenter)} WW {Math.round(vp.windowWidth)}</span>
            <span style={{ fontSize:10, color:'var(--text-m)', fontFamily:'var(--font-m)' }}>{(vp.zoom*100).toFixed(0)}%</span>
            <span style={{ fontSize:9, color:'var(--text-d)' }}>Grid {gridLayout}</span>
          </>
        )}
        {workMode === 'mpr' && (
          <>
            <span style={{ fontSize:10, color:'#f72585', fontFamily:'var(--font-m)' }}>AX {mpr.axialIndex+1}</span>
            <span style={{ fontSize:10, color:'#4cc9f0', fontFamily:'var(--font-m)' }}>SAG {mpr.sagittalIndex+1}</span>
            <span style={{ fontSize:10, color:'#7bed9f', fontFamily:'var(--font-m)' }}>COR {mpr.coronalIndex+1}</span>
            <span style={{ fontSize:10, color:'var(--text-m)', fontFamily:'var(--font-m)' }}>WC {Math.round(mpr.windowCenter)} WW {Math.round(mpr.windowWidth)}</span>
          </>
        )}
        <span style={{ fontSize:9, color:'var(--text-d)', letterSpacing:'0.06em' }}>OrthoVis v4</span>
      </div>
    </div>
  )
}
