import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useStore } from '../store'
import { toast } from '../../components/ui/Toast'
import { studiesApi } from '../../api/endpoints'

type Fmt = 'png'|'jpeg'|'webp'
type Target = 'active'|'all'

// Watermark configurável pela clínica via env (cai pra default neutro)
const CLINIC_LABEL = import.meta.env.VITE_CLINIC_NAME || 'RIS / PACS'

function slugify(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
}

export function ExportModal({ onClose }: { onClose: () => void }) {
  const { activeViewportId, viewports, volume, addGalleryImage, studyMeta } = useStore()

  // Filename smart default: MRN_modal_plano_corteN_yyyymmdd-hhmm
  const defaultName = useMemo(() => {
    const ts = new Date().toISOString().slice(0,16).replace(/[-:T]/g,'').replace(/(\d{8})(\d{4})/, '$1-$2')
    const mrn   = studyMeta?.medicalRecordNumber ? slugify(studyMeta.medicalRecordNumber) : 'estudo'
    const mod   = volume?.modality?.toLowerCase() || 'img'
    const plane = viewports[activeViewportId]?.plane || 'view'
    const sli   = (viewports[activeViewportId]?.currentIndex ?? 0) + 1
    return `${mrn}_${mod}_${plane}_corte${sli}_${ts}`
  }, [studyMeta, volume, viewports, activeViewportId])

  const [name, setName] = useState(defaultName)
  const [fmt, setFmt] = useState<Fmt>('png')
  const [quality, setQuality] = useState(92)
  const [scale, setScale] = useState('1')
  const [target, setTarget] = useState<Target>('active')
  const [withAnns, setWithAnns] = useState(true)
  const [withInfo, setWithInfo] = useState(true)
  const [bg, setBg] = useState('#000000')
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [sendingPacs, setSendingPacs] = useState(false)
  const [pacsProgress, setPacsProgress] = useState<{ done:number; total:number } | null>(null)
  const [preview, setPreview] = useState<string|null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>|null>(null)

  // Quando mudar de viewport/slice, atualiza nome default (a menos que o user já editou)
  const [nameTouched, setNameTouched] = useState(false)
  useEffect(() => {
    if (!nameTouched) setName(defaultName)
  }, [defaultName, nameTouched])

  const buildOne = useCallback(async (vpId: string, sf: number): Promise<HTMLCanvasElement|null> => {
    const el = document.querySelector(`[data-vpid="${vpId}"]`) as HTMLElement
    if (!el) return null
    const canvases = el.querySelectorAll('canvas')
    if (!canvases.length) return null
    const imgC = canvases[0] as HTMLCanvasElement       // imagem em resolução nativa do slice
    const annC = canvases[canvases.length-1] as HTMLCanvasElement // anotações em coords da caixa (inset:0)

    // Moldura de saída = caixa do viewport, pra reproduzir a geometria exata da tela
    const boxW = annC.width  || el.clientWidth  || imgC.width  || 512
    const boxH = annC.height || el.clientHeight || imgC.height || 512
    const W = Math.round(boxW*sf)
    const H = Math.round(boxH*sf)
    const out = document.createElement('canvas'); out.width=W; out.height=H
    const ctx = out.getContext('2d')!
    ctx.fillStyle=bg; ctx.fillRect(0,0,W,H)
    const vp = viewports[vpId]
    if (imgC.width>0&&imgC.height>0) {
      // Reproduz o "object-fit: contain" do CSS — sem isso a imagem sai em resolução nativa, fora de escala
      const baseScale = Math.min(boxW/imgC.width, boxH/imgC.height)
      const zoom = vp?.zoom || 1
      const dw = imgC.width  * baseScale * zoom * sf
      const dh = imgC.height * baseScale * zoom * sf
      ctx.save()
      // pan é em px de tela (transform CSS é o passo mais externo) → escala por sf
      ctx.translate(W/2 + (vp?.panX||0)*sf, H/2 + (vp?.panY||0)*sf)
      ctx.rotate(((vp?.rotation||0)*Math.PI)/180)
      ctx.scale(vp?.flipH?-1:1, vp?.flipV?-1:1)
      ctx.imageSmoothingEnabled=false
      ctx.drawImage(imgC, -dw/2, -dh/2, dw, dh)
      ctx.restore()
    }
    // annC já está em coordenadas da caixa (pan/zoom embutidos no render) → só escala
    if (withAnns&&annC!==imgC&&annC.width>0) ctx.drawImage(annC,0,0,W,H)
    if (withInfo) {
      ctx.save()
      ctx.font=`${9*sf}px DM Mono,monospace`
      ctx.fillStyle='rgba(255,255,255,0.55)'
      const pName = studyMeta?.patientName || volume?.patientName
      if (pName) ctx.fillText(pName, 6*sf, 15*sf)
      const planeLabel = vp?.plane ? vp.plane.charAt(0).toUpperCase()+vp.plane.slice(1) : ''
      if (planeLabel) ctx.fillText(`${planeLabel} · Slice ${(vp?.currentIndex||0)+1}`, 6*sf, H-6*sf)
      ctx.fillStyle='rgba(255,255,255,0.28)'
      ctx.font=`${8*sf}px DM Mono,monospace`
      const wmW = ctx.measureText(CLINIC_LABEL).width
      ctx.fillText(CLINIC_LABEL, W - wmW - 6*sf, H-6*sf)
      ctx.restore()
    }
    return out
  }, [activeViewportId, viewports, bg, withAnns, withInfo, volume, studyMeta])

  const buildAll = useCallback(async (sf: number): Promise<HTMLCanvasElement|null> => {
    const ids = Object.keys(viewports)
    const tiles: HTMLCanvasElement[] = []
    for (const id of ids) {
      const c = await buildOne(id, sf)
      if (c) tiles.push(c)
    }
    if (!tiles.length) return null
    const cols = tiles.length <= 2 ? tiles.length : 2
    const rows = Math.ceil(tiles.length/cols)
    const tw = tiles[0].width, th = tiles[0].height
    const out = document.createElement('canvas')
    out.width = tw*cols; out.height = th*rows
    const ctx = out.getContext('2d')!
    ctx.fillStyle = bg; ctx.fillRect(0,0,out.width,out.height)
    tiles.forEach((t,i) => {
      const col=i%cols, row=Math.floor(i/cols)
      ctx.drawImage(t, col*tw, row*th)
      ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=1
      ctx.strokeRect(col*tw+0.5, row*th+0.5, tw-1, th-1)
    })
    return out
  }, [buildOne, viewports, bg])

  const build = useCallback(async (sf: number) => {
    return target === 'all' ? buildAll(sf) : buildOne(activeViewportId, sf)
  }, [target, buildAll, buildOne, activeViewportId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      build(parseFloat(scale)*0.35).then(c => {
        if (c) {
          const m = fmt==='jpeg'?'image/jpeg':fmt==='webp'?'image/webp':'image/png'
          setPreview(c.toDataURL(m, fmt==='png'?1:quality/100))
        }
      })
    }, 120)
  }, [build, fmt, quality, scale])

  const mime = () => fmt==='jpeg'?'image/jpeg':fmt==='webp'?'image/webp':'image/png'

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const c = await build(parseFloat(scale))
      if (!c) { toast.info('Nada para exportar'); return }
      const m = mime(); const q = fmt==='png'?1:quality/100
      const blob = await new Promise<Blob|null>(res=>c.toBlob(res,m,q))
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href=url; a.download=`${name}.${fmt}`; a.click()
      URL.revokeObjectURL(url)
      addGalleryImage(c.toDataURL(m,q), `${name}.${fmt}`)
    } finally { setSaving(false) }
  }, [build, scale, fmt, quality, name, addGalleryImage])

  const copyClipboard = useCallback(async () => {
    if (!navigator.clipboard?.write) { toast.error('Clipboard API não disponível neste navegador'); return }
    setCopying(true)
    try {
      const c = await build(1)
      if (!c) return
      const blob = await new Promise<Blob|null>(res=>c.toBlob(res,'image/png',1))
      if (!blob) return
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch(e) { toast.error('Falha ao copiar: '+String(e)) }
    finally { setCopying(false) }
  }, [build])

  // Envia como DICOM Secondary Capture; 1 SC por viewport quando target='all'
  const sendToPacs = useCallback(async () => {
    if (!studyMeta?.studyId) { toast.error('Estudo sem vínculo ao PACS'); return }
    setSendingPacs(true)
    try {
      const vpIds = target === 'all' ? Object.keys(viewports) : [activeViewportId]
      setPacsProgress({ done: 0, total: vpIds.length })
      let ok = 0

      for (let i = 0; i < vpIds.length; i++) {
        const vpId = vpIds[i]
        const c = await buildOne(vpId, parseFloat(scale))
        if (!c) { setPacsProgress({ done: i+1, total: vpIds.length }); continue }
        const blob = await new Promise<Blob|null>(res => c.toBlob(res, 'image/png', 1))
        if (!blob) { setPacsProgress({ done: i+1, total: vpIds.length }); continue }
        const vp = viewports[vpId]
        const label = `${(vp?.plane||'view')}_corte${(vp?.currentIndex||0)+1}`
        try {
          await studiesApi.uploadSecondaryCapture(studyMeta.studyId, blob, label)
          ok++
        } catch (err: any) {
          toast.error(`Falha no viewport ${i+1}: ${err.response?.data?.message ?? err.message}`)
        }
        setPacsProgress({ done: i+1, total: vpIds.length })
      }

      if (ok > 0) toast.success(`${ok} captura${ok>1?'s':''} enviada${ok>1?'s':''} ao PACS`)
    } finally {
      setSendingPacs(false)
      setTimeout(() => setPacsProgress(null), 1500)
    }
  }, [studyMeta, target, viewports, activeViewportId, buildOne, scale])

  const vpCount = Object.keys(viewports).length

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.85)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:740, maxWidth:'100%', maxHeight:'92vh', background:'var(--bg-elevated)', border:'1px solid var(--border-b)', borderRadius:'var(--r-xl)', boxShadow:'var(--shadow-m)', display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 18px', borderBottom:'1px solid var(--border-s)', background:'var(--bg-panel)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:30, height:30, borderRadius:'var(--r-md)', background:'var(--green-d)', border:'1px solid rgba(6,214,160,0.25)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--green)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </div>
            <div>
              <div style={{ fontFamily:'var(--font-d)', fontSize:13, fontWeight:700 }}>Exportar Imagem</div>
              <div style={{ fontSize:10, color:'var(--text-m)' }}>Canvas direto — sem perda de qualidade</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ color:'var(--text-m)', fontSize:16, lineHeight:1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ display:'flex', flex:1, minHeight:0, overflow:'hidden' }}>

          {/* Preview pane */}
          <div style={{ width:220, padding:12, borderRight:'1px solid var(--border-s)', background:'var(--bg-surface)', display:'flex', flexDirection:'column', gap:8, flexShrink:0 }}>
            <div style={{ fontSize:9, color:'var(--text-m)', textTransform:'uppercase', letterSpacing:'0.1em' }}>Preview</div>
            <div style={{ flex:1, background:'#000', borderRadius:'var(--r-md)', border:'1px solid var(--border-d)', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', minHeight:140 }}>
              {preview
                ? <img src={preview} style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain', imageRendering:'pixelated' }} alt="preview"/>
                : <div style={{ width:18, height:18, border:'2px solid rgba(0,180,217,0.2)', borderTopColor:'var(--cyan)', borderRadius:'50%', animation:'ov-spin 0.8s linear infinite' }}/>
              }
            </div>
            <div style={{ fontSize:9, color:'var(--text-m)', textAlign:'center' }}>
              {target==='all' ? `${vpCount} viewports` : 'Viewport ativo'}
            </div>
          </div>

          {/* Controls */}
          <div style={{ flex:1, overflowY:'auto', padding:'12px 16px', display:'flex', flexDirection:'column', gap:12 }}>

            {/* Target */}
            <div>
              <div style={{ fontSize:9, color:'var(--text-m)', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:5 }}>O que exportar</div>
              <div style={{ display:'flex', gap:5 }}>
                {([['active','Viewport ativo','Exporta apenas a janela selecionada'],['all','Todos os viewports','Grade com todos os viewports em mosaico']] as [Target,string,string][]).map(([v,l,d])=>(
                  <button key={v} onClick={()=>setTarget(v)} style={{ flex:1, padding:'6px 8px', borderRadius:'var(--r-md)', background:target===v?'var(--cyan-d)':'var(--bg-overlay)', border:`1px solid ${target===v?'var(--cyan)':'var(--border-d)'}`, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                    <span style={{ fontSize:11, fontWeight:600, color:target===v?'var(--cyan)':'var(--text-p)' }}>{l}</span>
                    <span style={{ fontSize:9, color:'var(--text-m)', textAlign:'center', lineHeight:1.3 }}>{d}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* File name */}
            <div>
              <div style={{ fontSize:9, color:'var(--text-m)', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:5 }}>Nome do arquivo</div>
              <div style={{ display:'flex' }}>
                <input value={name} onChange={e=>{ setName(e.target.value); setNameTouched(true); }} style={{ flex:1, padding:'6px 8px', borderRadius:'var(--r-sm) 0 0 var(--r-sm)', borderRight:'none' }}/>
                <span style={{ padding:'6px 8px', background:'var(--bg-hover)', border:'1px solid var(--border-d)', borderRadius:'0 var(--r-sm) var(--r-sm) 0', color:'var(--cyan)', fontSize:11 }}>.{fmt}</span>
              </div>
            </div>

            {/* Format */}
            <div>
              <div style={{ fontSize:9, color:'var(--text-m)', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:5 }}>Formato</div>
              <div style={{ display:'flex', gap:5 }}>
                {(['png','jpeg','webp'] as Fmt[]).map(f=>(
                  <button key={f} onClick={()=>setFmt(f)} style={{ flex:1, padding:'6px 4px', borderRadius:'var(--r-md)', background:fmt===f?'var(--cyan-d)':'var(--bg-overlay)', border:`1px solid ${fmt===f?'var(--cyan)':'var(--border-d)'}`, display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                    <span style={{ fontSize:12, fontWeight:700, color:fmt===f?'var(--cyan)':'var(--text-p)' }}>{f.toUpperCase()}</span>
                    <span style={{ fontSize:9, color:'var(--text-m)' }}>{f==='png'?'Sem perda':f==='jpeg'?'Menor':'Moderno'}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Quality (lossy only) */}
            {fmt!=='png'&&(
              <div>
                <div style={{ fontSize:9, color:'var(--text-m)', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:5 }}>Qualidade <span style={{color:'var(--cyan)'}}>{quality}%</span></div>
                <input type="range" min={10} max={100} step={1} value={quality} onChange={e=>setQuality(+e.target.value)} style={{ width:'100%' }}/>
              </div>
            )}

            {/* Scale */}
            <div>
              <div style={{ fontSize:9, color:'var(--text-m)', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:5 }}>Resolução</div>
              <div style={{ display:'flex', gap:5 }}>
                {(['0.5','1','2','4'] as const).map(s=>(
                  <button key={s} onClick={()=>setScale(s)} style={{ flex:1, padding:'5px 3px', borderRadius:'var(--r-md)', background:scale===s?'rgba(139,92,246,0.13)':'var(--bg-overlay)', border:`1px solid ${scale===s?'var(--purple)':'var(--border-d)'}`, display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                    <span style={{ fontSize:12, fontWeight:700, color:scale===s?'var(--purple)':'var(--text-p)' }}>{s==='0.5'?'½×':s+'×'}</span>
                    <span style={{ fontSize:8, color:'var(--text-m)' }}>{s==='0.5'?'Draft':s==='1'?'Original':s==='2'?'HD':'4K'}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Options */}
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              {[
                {v:withAnns,set:setWithAnns,l:'Incluir anotações e medições'},
                {v:withInfo,set:setWithInfo,l:'Incluir informações do paciente e plano'},
              ].map(({v,set,l})=>(
                <label key={l} style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, color:'var(--text-s)', cursor:'pointer' }}>
                  <input type="checkbox" checked={v} onChange={e=>set(e.target.checked)} style={{ accentColor:'var(--cyan)', width:13, height:13 }}/>{l}
                </label>
              ))}
            </div>

            {/* Background */}
            <div>
              <div style={{ fontSize:9, color:'var(--text-m)', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:5 }}>Fundo</div>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap', alignItems:'center' }}>
                {['#000000','#111827','#1e293b','#ffffff'].map(c=>(
                  <button key={c} onClick={()=>setBg(c)} style={{ width:22, height:22, borderRadius:'50%', background:c, border:`2px solid ${bg===c?'var(--cyan)':'var(--border-d)'}`, cursor:'pointer' }}/>
                ))}
                <input type="color" value={bg} onChange={e=>setBg(e.target.value)} style={{ width:22, height:22, borderRadius:'50%', border:'2px solid var(--border-d)', padding:1, cursor:'pointer', background:'none' }}/>
                <span style={{ fontSize:10, color:'var(--text-m)', marginLeft:4 }}>{bg}</span>
              </div>
            </div>

          </div>
        </div>

        {/* Progresso de envio ao PACS */}
        {pacsProgress && (
          <div style={{ padding:'6px 16px', borderTop:'1px solid var(--border-s)', background:'var(--bg-panel)', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:10, color:'var(--text-s)', marginBottom:4 }}>
              <span>Enviando captura{pacsProgress.total > 1 ? 's' : ''} ao PACS…</span>
              <span style={{ fontFamily:'var(--font-m)' }}>{pacsProgress.done}/{pacsProgress.total}</span>
            </div>
            <div style={{ height:3, borderRadius:2, background:'var(--bg-overlay)', overflow:'hidden' }}>
              <div style={{
                height:'100%',
                width:`${pacsProgress.total ? Math.round(pacsProgress.done/pacsProgress.total*100) : 0}%`,
                background:'linear-gradient(90deg, var(--cyan), var(--purple))',
                transition:'width 0.2s ease',
              }}/>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, padding:'10px 16px', borderTop:'1px solid var(--border-s)', background:'var(--bg-panel)', flexShrink:0, flexWrap:'wrap' }}>
          <button onClick={copyClipboard} disabled={copying} style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:'var(--r-md)', fontSize:11, background:'var(--bg-overlay)', border:'1px solid var(--border-d)', color:copying?'var(--text-m)':'var(--text-s)', cursor:copying?'not-allowed':'pointer' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            {copying ? 'Copiando…' : 'Copiar PNG'}
          </button>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={onClose} style={{ padding:'6px 14px', borderRadius:'var(--r-md)', fontSize:12, background:'var(--bg-overlay)', border:'1px solid var(--border-d)', color:'var(--text-s)' }}>Cancelar</button>
            <button
              onClick={sendToPacs}
              disabled={sendingPacs || !studyMeta?.studyId}
              title={studyMeta?.studyId ? 'Envia como DICOM Secondary Capture (vinculado ao estudo)' : 'Disponível apenas para estudos do PACS'}
              style={{
                display:'flex', alignItems:'center', gap:5, padding:'6px 14px', borderRadius:'var(--r-md)',
                fontSize:12, fontWeight:600,
                background: studyMeta?.studyId ? 'rgba(34,211,238,0.13)' : 'var(--bg-overlay)',
                border: `1px solid ${studyMeta?.studyId ? 'var(--cyan)' : 'var(--border-d)'}`,
                color: studyMeta?.studyId ? 'var(--cyan)' : 'var(--text-d)',
                opacity: (sendingPacs || !studyMeta?.studyId) ? 0.6 : 1,
                cursor: (sendingPacs || !studyMeta?.studyId) ? 'not-allowed' : 'pointer',
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v13M5 9l7-7 7 7"/><rect x="3" y="15" width="18" height="6" rx="1"/></svg>
              {sendingPacs ? 'Enviando…' : 'Enviar ao PACS'}
            </button>
            <button onClick={save} disabled={saving} style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 18px', borderRadius:'var(--r-md)', fontSize:12, fontWeight:600, background:'var(--green)', border:'none', color:'#000', opacity:saving?0.6:1, cursor:saving?'not-allowed':'pointer' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              {saving ? 'Salvando…' : 'Exportar'}
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes ov-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
