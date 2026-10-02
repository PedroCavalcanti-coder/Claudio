/**
 * NotesPanel — painel clínico com 3 abas:
 *   • Notas       → persistidas em ris.exam_notes, auto-save, busca, markdown
 *   • Anotações   → medições/marcações sobre as imagens (state-only, ver SliceViewport)
 *   • Galeria     → screenshots exportados (state-only, ver ExportModal)
 *
 * Persistência: tudo da aba "Notas" vai pro backend via examNotesApi.
 *   - Auto-save 1.2s debounced.
 *   - Busca client-side (até crescer demais — aí tem GIN trgm no SQL).
 *   - Preview markdown leve (sem dep), toggle Editor/Preview.
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useStore } from '../store'
import type { AnnotationShape, PlaneType } from '../store'
import { toast } from '../../components/ui/Toast'
import { examNotesApi, type ExamNote } from '../../api/endpoints'
import { renderMarkdown } from './markdown'

function spacing(plane: PlaneType, vol: { spacingX:number; spacingY:number; spacingZ:number }) {
  if (plane === 'axial')   return { spX: vol.spacingX, spY: vol.spacingY }
  if (plane === 'sagital') return { spX: vol.spacingY, spY: vol.spacingZ }
  return                          { spX: vol.spacingX, spY: vol.spacingZ }
}

function measure(shape: AnnotationShape, spX: number, spY: number): string {
  const mm = (ax:number,ay:number,bx:number,by:number) =>
    Math.sqrt(((bx-ax)*spX)**2+((by-ay)*spY)**2)
  switch (shape.type) {
    case 'ruler':
      return shape.p1&&shape.p2 ? `${(mm(shape.p1.x,shape.p1.y,shape.p2.x,shape.p2.y)/10).toFixed(2)} cm` : ''
    case 'bidirectional':
      if (!shape.p1||!shape.p2||!shape.p3||!shape.p4) return ''
      return `L ${(mm(shape.p1.x,shape.p1.y,shape.p2.x,shape.p2.y)/10).toFixed(2)} · T ${(mm(shape.p3.x,shape.p3.y,shape.p4.x,shape.p4.y)/10).toFixed(2)} cm`
    case 'angle':  return `${(shape.degrees??0).toFixed(1)}°`
    case 'cobb':   return `Cobb ${(shape.degrees??0).toFixed(1)}°`
    case 'probe':  return `HU ${Math.round(shape.hu??0)}`
    case 'roi_ellipse': case 'roi_rect':
      return shape.huMean!==undefined ? `μ ${shape.huMean.toFixed(0)}  σ ${(shape.huStd??0).toFixed(0)} HU` : ''
    case 'circle':
      return shape.radius!==undefined ? `r ${(shape.radius*(spX+spY)/2/10).toFixed(2)} cm` : ''
    case 'rectangle':
      return shape.p1&&shape.p2 ? `${(Math.abs(shape.p2.x-shape.p1.x)*spX/10).toFixed(2)}×${(Math.abs(shape.p2.y-shape.p1.y)*spY/10).toFixed(2)} cm` : ''
    case 'text':     return shape.text ? `"${shape.text.slice(0,30)}"` : ''
    case 'arrow':    return 'Seta'
    case 'freehand': return 'Traço livre'
    case 'polygon':  return 'Polígono'
    default: return ''
  }
}

const TYPE_LABEL: Record<string,string> = {
  ruler:'Régua', bidirectional:'RECIST', angle:'Ângulo', cobb:'Cobb',
  probe:'HU Probe', roi_ellipse:'ROI Elipse', roi_rect:'ROI Ret.',
  circle:'Elipse', rectangle:'Retângulo', arrow:'Seta',
  freehand:'Lápis', polygon:'Polígono', text:'Texto',
}
const PLANE_COLOR: Record<string,string> = { axial:'var(--ax)', sagital:'var(--sag)', coronal:'var(--cor)' }

const TEMPLATES = [
  { label: 'Exame Normal', text: 'Exame dentro dos limites normais para a faixa etária.\n\nEstrutura óssea sem alterações.\nPartes moles sem evidência de processo expansivo.\n\nConclusão: Exame sem alterações significativas.' },
  { label: 'TC de Crânio', text: '# TC de Crânio sem contraste\n\nParênquima cerebral com densidade e morfologia habituais.\nSistema ventricular de calibre normal.\nEspaços subaracnóideos normais.\nLinha média centrada.\nEstrutura óssea craniana íntegra.\n\n**Conclusão:** ' },
  { label: 'TC de Tórax', text: '# TC de Tórax\n\nPulmões com expansibilidade normal.\nCampos pulmonares sem consolidações, nódulos ou derrames.\nMediastino centrado, sem linfonodomegalias.\nEstrutura cardíaca e vascular sem alterações.\nEspaço pleural livre bilateralmente.\n\n**Conclusão:** ' },
  { label: 'TC de Abdome', text: '# TC de Abdome\n\nFígado, vesícula, vias biliares, pâncreas, baço e rins sem alterações significativas.\nAlças intestinais com calibre e distribuição normais.\nEstrutura óssea axial íntegra.\n\n**Conclusão:** ' },
  { label: 'Achado Relevante', text: '## Achado clínico\n\n- **Localização:** \n- **Dimensões:** \n- **Características:** \n\n_Correlação clínica:_ \n\n**Conduta sugerida:** ' },
  { label: 'Medições', text: '## Relatório de medições\n\n- Estrutura avaliada: \n- Maior dimensão: \n- Menor dimensão: \n- Área aproximada: \n\n_Comparação com exame anterior:_ ' },
]

function wordCount(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  return { words: words.length, chars: text.length }
}

// Hook simples de debounce — dispara fn após delay sem mudanças no value.
function useDebouncedEffect(value: unknown, delay: number, fn: () => void) {
  useEffect(() => {
    const t = setTimeout(fn, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delay])
}

// ── component ─────────────────────────────────────────────────────────────────
export function NotesPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { galleryImages, deleteGalleryImage,
    viewports, volume, removeAnnotation, updateViewport, setActiveViewport,
    clearAnnotations, studyMeta } = useStore()

  // Persistência só ativa quando estudo está vinculado ao PACS.
  const studyId = studyMeta?.studyId ?? null

  // ── Server state ────────────────────────────────────────────────────────────
  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['exam-notes', studyId],
    queryFn:  () => examNotesApi.listByStudy(studyId!).then(r => r.data.data),
    enabled:  !!studyId,
    staleTime: 30_000,
  })

  const createMut = useMutation({
    mutationFn: () => examNotesApi.create(studyId!, { content: '' }).then(r => r.data.data),
    onSuccess: (note) => {
      qc.setQueryData(['exam-notes', studyId], (old: ExamNote[] = []) => [note, ...old])
      setActiveId(note.id)
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      examNotesApi.update(id, { content }).then(r => r.data.data),
    onMutate: ({ id, content }) => {
      // Optimistic update — UI responde instantânea
      qc.setQueryData(['exam-notes', studyId], (old: ExamNote[] = []) =>
        old.map(n => n.id === id ? { ...n, content, updated_at: new Date().toISOString() } : n)
      )
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => examNotesApi.remove(id),
    onSuccess: (_, id) => {
      qc.setQueryData(['exam-notes', studyId], (old: ExamNote[] = []) => old.filter(n => n.id !== id))
      setActiveId(prev => prev === id ? '' : prev)
    },
  })

  // ── Local UI state ──────────────────────────────────────────────────────────
  const [activeId, setActiveId] = useState<string>('')
  const [draft, setDraft] = useState<string>('')        // texto em edição (não vai pro server até auto-save)
  const [tab, setTab] = useState<'notes'|'ann'|'gallery'>('notes')
  const [showTemplates, setShowTemplates] = useState(false)
  const [viewMode, setViewMode] = useState<'edit'|'preview'>('edit')
  const [query, setQuery] = useState('')                 // busca client-side
  const [savedAt, setSavedAt] = useState<number>(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Mantém o draft sincronizado com a nota ativa quando muda de nota
  useEffect(() => {
    const n = notes.find(x => x.id === activeId)
    setDraft(n?.content ?? '')
    setSavedAt(n ? new Date(n.updated_at).getTime() : 0)
  }, [activeId, notes])

  // Seleciona primeira nota ao carregar
  useEffect(() => {
    if (!activeId && notes.length > 0) setActiveId(notes[0].id)
  }, [notes, activeId])

  // Auto-save: 1.2s sem digitar → patch no backend
  useDebouncedEffect(draft, 1200, () => {
    if (!activeId) return
    const cur = notes.find(n => n.id === activeId)
    if (!cur || cur.content === draft) return
    updateMut.mutate({ id: activeId, content: draft }, {
      onSuccess: () => setSavedAt(Date.now()),
    })
  })

  // Busca client-side
  const visibleNotes = useMemo(() => {
    if (!query.trim()) return notes
    const q = query.toLowerCase()
    return notes.filter(n => (n.content || '').toLowerCase().includes(q) || (n.title || '').toLowerCase().includes(q))
  }, [notes, query])

  const current = notes.find(n => n.id === activeId)

  const annGroups = useMemo(() => {
    const groups: { vpId:string; plane:string; sliceIndex:number; anns: typeof viewports[string]['annotations'] }[] = []
    Object.entries(viewports).forEach(([vpId, vp]) => {
      const bySlice = new Map<number, typeof vp.annotations>()
      vp.annotations.forEach(a => {
        const k = a.sliceIndex ?? 0
        if (!bySlice.has(k)) bySlice.set(k, [])
        bySlice.get(k)!.push(a)
      })
      bySlice.forEach((anns, sliceIndex) => groups.push({ vpId, plane: vp.plane, sliceIndex, anns }))
    })
    return groups.sort((a,b) => a.plane.localeCompare(b.plane) || a.sliceIndex-b.sliceIndex)
  }, [viewports])

  const totalAnns = Object.values(viewports).reduce((s,v)=>s+v.annotations.length,0)

  const exportAnnCsv = () => {
    const rows = ['Viewport,Plano,Slice,Tipo,Medição,Cor,Criado']
    Object.entries(viewports).forEach(([vpId, vp]) => {
      const sp = volume ? spacing(vp.plane as PlaneType, volume) : { spX:1, spY:1 }
      vp.annotations.forEach(a => {
        rows.push([vpId, vp.plane, a.sliceIndex??0, a.shape.type,
          measure(a.shape, sp.spX, sp.spY), a.color,
          new Date(a.createdAt).toLocaleString('pt-BR')].join(','))
      })
    })
    const b = new Blob([rows.join('\n')],{type:'text/csv'})
    const el = document.createElement('a'); el.href=URL.createObjectURL(b); el.download='anotacoes.csv'; el.click()
  }

  const navTo = (vpId: string, sliceIndex: number) => {
    updateViewport(vpId, { currentIndex: sliceIndex }); setActiveViewport(vpId)
  }

  // wrap envolve a seleção (ou insere marcadores com cursor no meio, se nada selecionado);
  // prefix prefixa cada linha da seleção/linha atual; block insere um trecho na posição atual
  type FormatAction =
    | { mode: 'wrap';   left: string; right: string; placeholder: string }
    | { mode: 'prefix'; prefix: string }
    | { mode: 'block';  text: string }

  const applyFormat = (action: FormatAction) => {
    const ta = textareaRef.current; if (!ta) return
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const sel   = draft.slice(start, end)

    let next = draft
    let caretStart = start
    let caretEnd   = end

    if (action.mode === 'wrap') {
      const { left, right, placeholder } = action
      if (sel) {
        next = draft.slice(0, start) + left + sel + right + draft.slice(end)
        caretStart = start + left.length
        caretEnd   = caretStart + sel.length
      } else {
        next = draft.slice(0, start) + left + placeholder + right + draft.slice(end)
        caretStart = start + left.length
        caretEnd   = caretStart + placeholder.length
      }
    } else if (action.mode === 'prefix') {
      // Mantém a seleção sobre o conteúdo, não sobre o prefixo inserido
      const lineStart = draft.lastIndexOf('\n', start - 1) + 1
      const lineEnd   = end > start ? end : (draft.indexOf('\n', start) === -1 ? draft.length : draft.indexOf('\n', start))
      const block     = draft.slice(lineStart, lineEnd)
      const prefixed  = block.split('\n').map(l => l.length ? action.prefix + l : l).join('\n')
      next = draft.slice(0, lineStart) + prefixed + draft.slice(lineEnd)
      caretStart = lineStart + action.prefix.length
      caretEnd   = caretStart + (prefixed.length - block.length - action.prefix.length + block.length)
    } else {
      const needsLeadingBreak = start > 0 && draft[start - 1] !== '\n'
      const insertion = (needsLeadingBreak ? '\n' : '') + action.text
      next = draft.slice(0, start) + insertion + draft.slice(end)
      caretStart = start + insertion.length
      caretEnd   = caretStart
    }

    setDraft(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(caretStart, caretEnd)
    })
  }

  const applyTemplate = async (template: string) => {
    if (!current) return
    const proceed = !draft.trim() || await toast.confirm('Substituir o conteúdo atual da nota pelo template?', 'Substituir nota?')
    if (proceed) setDraft(template)
    setShowTemplates(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const createNote = () => {
    if (!studyId) { toast.error('Notas só são persistidas para estudos do PACS'); return }
    createMut.mutate()
  }

  const { words, chars } = current ? wordCount(draft) : { words: 0, chars: 0 }
  const isDirty = !!current && current.content !== draft
  const justSaved = !isDirty && Date.now() - savedAt < 3000 && savedAt > 0

  const TAB_BTN = (t: 'notes'|'ann'|'gallery', label: string) => (
    <button key={t} onClick={()=>setTab(t)} style={{ flex:1, padding:'6px 4px', fontSize:9, color:tab===t?'var(--cyan)':'var(--text-m)', borderBottom:tab===t?'2px solid var(--cyan)':'2px solid transparent', textTransform:'uppercase', letterSpacing:'0.05em', lineHeight:1.4, whiteSpace:'nowrap' }}>
      {label}
    </button>
  )

  return (
    <div style={{ width:300, minWidth:300, background:'var(--bg-surface)', borderLeft:'1px solid var(--border-s)', display:'flex', flexDirection:'column', overflow:'hidden', flexShrink:0 }}>
      <style>{`
        .md-h { font-family: var(--font-d); font-weight: 700; color: var(--text-p); margin: 8px 0 4px; }
        .md-h1 { font-size: 14px; border-bottom: 1px solid var(--border-d); padding-bottom: 4px; }
        .md-h2 { font-size: 13px; color: var(--cyan); }
        .md-h3 { font-size: 12px; color: var(--text-s); }
        .md-p { font-size: 12px; line-height: 1.6; color: var(--text-p); margin: 4px 0; }
        .md-ul, .md-ol { padding-left: 20px; margin: 4px 0; font-size: 12px; color: var(--text-p); }
        .md-ul li, .md-ol li { margin: 2px 0; line-height: 1.55; }
        .md-q { border-left: 2px solid var(--cyan); padding: 4px 10px; margin: 6px 0; background: var(--bg-overlay); color: var(--text-s); font-style: italic; font-size: 12px; }
        .md-hr { border: none; border-top: 1px solid var(--border-d); margin: 10px 0; }
        .md-code { background: var(--bg-overlay); padding: 1px 5px; border-radius: 3px; font-family: var(--font-m); font-size: 11px; color: var(--cyan); }
        .md-link { color: var(--cyan); text-decoration: underline; }
        .md-br { height: 4px; }
        .md-empty { color: var(--text-d); font-style: italic; padding: 12px; font-size: 11px; text-align: center; }
        .md-preview strong { color: var(--text-p); font-weight: 700; }
        .md-preview em { color: var(--text-s); }
      `}</style>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 12px', borderBottom:'1px solid var(--border-s)', background:'var(--bg-base)', flexShrink:0 }}>
        <span style={{ fontFamily:'var(--font-d)', fontSize:12, fontWeight:700 }}>Painel Clínico</span>
        <button onClick={onClose} aria-label="Fechar painel" style={{ color:'var(--text-m)', fontSize:14, lineHeight:1 }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border-s)', flexShrink:0, background:'var(--bg-base)' }}>
        {TAB_BTN('notes', `Notas (${notes.length})`)}
        {TAB_BTN('ann',   `Anotações (${totalAnns})`)}
        {TAB_BTN('gallery',`Galeria (${galleryImages.length})`)}
      </div>

      {/* ── NOTAS TAB ─────────────────────────────────────────────────────── */}
      {tab==='notes'&&(
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {/* Aviso quando estudo é local (não vinculado ao PACS) */}
          {!studyId && (
            <div style={{ padding:'10px 12px', fontSize:11, color:'var(--amber)', background:'var(--amber-d)', borderBottom:'1px solid var(--border-s)', textAlign:'center', lineHeight:1.5 }}>
              Notas não são salvas para arquivos locais.<br/>Abra o estudo pelo RIS para persistir.
            </div>
          )}

          {/* Note list + actions bar */}
          <div style={{ flexShrink:0, borderBottom:'1px solid var(--border-s)', background:'var(--bg-base)' }}>
            {/* Busca */}
            {studyId && notes.length > 1 && (
              <div style={{ padding:'5px 8px', borderBottom:'1px solid var(--border-s)' }}>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar nas notas…"
                  style={{ width:'100%', padding:'4px 8px', fontSize:10, borderRadius:'var(--r-sm)', border:'1px solid var(--border-d)', background:'var(--bg-overlay)', color:'var(--text-p)' }}
                />
              </div>
            )}

            {/* Note rows */}
            <div style={{ maxHeight:110, overflowY:'auto' }}>
              {isLoading ? (
                <div style={{ padding:'10px 12px', fontSize:10, color:'var(--text-d)', textAlign:'center' }}>Carregando…</div>
              ) : visibleNotes.length===0 ? (
                <div style={{ padding:'10px 12px', fontSize:10, color:'var(--text-d)', textAlign:'center' }}>
                  {query ? 'Nenhuma nota corresponde.' : 'Nenhuma nota ainda'}
                </div>
              ) : visibleNotes.map((n,i) => (
                <button key={n.id} onClick={()=>setActiveId(n.id)} style={{
                  width:'100%', display:'flex', alignItems:'center', gap:8, padding:'5px 10px',
                  background:activeId===n.id?'var(--cyan-d)':'transparent',
                  borderBottom:'1px solid var(--border-s)', textAlign:'left', cursor:'pointer',
                  borderLeft:activeId===n.id?'3px solid var(--cyan)':'3px solid transparent',
                }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, fontWeight:activeId===n.id?600:400, color:activeId===n.id?'var(--cyan)':'var(--text-s)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {(n.title || n.content.split('\n')[0].replace(/^#+\s*/, '')).trim() || `Nota ${i+1}`}
                    </div>
                    <div style={{ fontSize:9, color:'var(--text-d)' }}>{new Date(n.updated_at).toLocaleDateString('pt-BR')}</div>
                  </div>
                  <div style={{ fontSize:9, color:'var(--text-m)', flexShrink:0 }}>
                    {n.content.trim().split(/\s+/).filter(Boolean).length}p
                  </div>
                </button>
              ))}
            </div>

            {/* Buttons row */}
            <div style={{ display:'flex', gap:4, padding:'5px 8px' }}>
              <button
                onClick={createNote}
                disabled={!studyId || createMut.isPending}
                style={{ flex:1, padding:'4px 0', borderRadius:'var(--r-sm)', fontSize:10, background:'var(--cyan-d)', border:'1px solid var(--cyan)', color:'var(--cyan)', opacity: studyId ? 1 : 0.4, cursor: studyId ? 'pointer' : 'not-allowed' }}
              >
                + Nova
              </button>
              <div style={{ position:'relative' }}>
                <button onClick={()=>setShowTemplates(s=>!s)} disabled={!current} style={{ padding:'4px 8px', borderRadius:'var(--r-sm)', fontSize:10, background:'var(--bg-overlay)', border:'1px solid var(--border-d)', color:'var(--text-m)', opacity: current ? 1 : 0.4 }}>
                  Template ▾
                </button>
                {showTemplates&&(
                  <div style={{ position:'absolute', top:'calc(100% + 4px)', right:0, zIndex:100, width:190, background:'var(--bg-panel)', border:'1px solid var(--border-b)', borderRadius:'var(--r-md)', boxShadow:'var(--shadow-f)', overflow:'hidden' }}>
                    {TEMPLATES.map(t=>(
                      <button key={t.label} onClick={()=>applyTemplate(t.text)} style={{ width:'100%', padding:'7px 10px', textAlign:'left', fontSize:11, color:'var(--text-s)', background:'transparent', borderBottom:'1px solid var(--border-s)', cursor:'pointer' }}
                        onMouseEnter={e=>(e.currentTarget.style.background='var(--bg-overlay)')}
                        onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                        {t.label}
                      </button>
                    ))}
                    <button onClick={()=>setShowTemplates(false)} style={{ width:'100%', padding:'5px 10px', fontSize:10, color:'var(--text-m)', background:'transparent', cursor:'pointer' }}>Fechar</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Editor area */}
          {current ? (
            <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

              {/* Toggle Edit / Preview + formatação */}
              <div style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', borderBottom:'1px solid var(--border-s)', flexShrink:0, flexWrap:'wrap' }}>
                <div style={{ display:'flex', gap:1, padding:1, borderRadius:'var(--r-sm)', background:'var(--bg-overlay)' }}>
                  {(['edit','preview'] as const).map(m => (
                    <button key={m} onClick={()=>setViewMode(m)} style={{
                      padding:'3px 8px', fontSize:9, borderRadius:'var(--r-xs)',
                      background: viewMode===m ? 'var(--cyan-d)' : 'transparent',
                      color:      viewMode===m ? 'var(--cyan)'   : 'var(--text-m)',
                      textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:600,
                    }}>{m === 'edit' ? 'Editar' : 'Preview'}</button>
                  ))}
                </div>
                {viewMode === 'edit' && (
                  <>
                    <div style={{ width:1,height:16,background:'var(--border-s)',margin:'0 2px' }}/>
                    {([
                      { label:'B',  title:'Negrito — envolve a seleção (Ctrl+B)',          action: { mode:'wrap',   left:'**', right:'**', placeholder:'texto' } as FormatAction },
                      { label:'I',  title:'Itálico — envolve a seleção (Ctrl+I)',          action: { mode:'wrap',   left:'_',  right:'_',  placeholder:'texto' } as FormatAction },
                      { label:'•',  title:'Lista — prefixa cada linha selecionada com "- "', action: { mode:'prefix', prefix:'- ' } as FormatAction },
                      { label:'1.', title:'Lista numerada — prefixa com "1. "',             action: { mode:'prefix', prefix:'1. ' } as FormatAction },
                      { label:'H',  title:'Título — prefixa a linha com "## "',              action: { mode:'prefix', prefix:'## ' } as FormatAction },
                      { label:'—',  title:'Separador horizontal',                            action: { mode:'block',  text:'---\n' } as FormatAction },
                    ]).map(({label,title,action})=>(
                      <button key={label} title={title} onClick={()=>applyFormat(action)}
                        style={{ minWidth:22,height:22,padding:'0 5px',borderRadius:'var(--r-xs)',fontSize:10,background:'var(--bg-overlay)',border:'1px solid var(--border-s)',color:'var(--text-m)',fontWeight:label==='B'?700:400,fontStyle:label==='I'?'italic':'normal' }}>
                        {label}
                      </button>
                    ))}
                  </>
                )}
                <div style={{ flex:1 }}/>
                <span style={{ fontSize:8, color:'var(--text-d)', whiteSpace:'nowrap' }}>
                  {words}p · {chars}c
                  {' · '}
                  {updateMut.isPending ? <span style={{color:'var(--amber)'}}>salvando…</span>
                    : isDirty            ? <span style={{color:'var(--text-d)'}}>não salvo</span>
                    : justSaved          ? <span style={{color:'var(--green)'}}>✓ salvo</span>
                    :                       <span>sincronizado</span>}
                </span>
              </div>

              {viewMode === 'edit' ? (
                <textarea ref={textareaRef}
                  value={draft}
                  onChange={e=>setDraft(e.target.value)}
                  onKeyDown={e => {
                    // Atalhos Markdown — mesma ação dos botões do toolbar
                    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
                      const key = e.key.toLowerCase()
                      if (key === 'b') { e.preventDefault(); applyFormat({ mode:'wrap', left:'**', right:'**', placeholder:'texto' }) }
                      else if (key === 'i') { e.preventDefault(); applyFormat({ mode:'wrap', left:'_', right:'_', placeholder:'texto' }) }
                    }
                  }}
                  placeholder="Observações clínicas, achados, diagnóstico diferencial…&#10;Suporta Markdown: # título, **negrito**, _itálico_, - listas"
                  style={{ flex:1, resize:'none', padding:'10px 12px', fontSize:12, lineHeight:1.65, background:'var(--bg-overlay)', border:'none', borderRadius:0, color:'var(--text-p)', minHeight:0, outline:'none', fontFamily:'var(--font-m)' }}/>
              ) : (
                <div
                  className="md-preview"
                  style={{ flex:1, overflowY:'auto', padding:'12px 14px', background:'var(--bg-overlay)' }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
                />
              )}

              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 10px', borderTop:'1px solid var(--border-s)', flexShrink:0 }}>
                <span style={{ fontSize:9, color:'var(--text-d)' }}>{new Date(current.created_at).toLocaleString('pt-BR')}</span>
                <button onClick={async () => {
                  if (await toast.confirm('Excluir esta nota? Esta ação não pode ser desfeita.', 'Excluir nota?')) {
                    deleteMut.mutate(current.id)
                  }
                }}
                  style={{ padding:'3px 8px', borderRadius:'var(--r-sm)', fontSize:10, background:'var(--red-d)', border:'1px solid rgba(239,71,111,0.25)', color:'var(--red)' }}>Excluir</button>
              </div>
            </div>
          ) : (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, color:'var(--text-d)' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" opacity={0.5}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
              <span style={{ fontSize:11 }}>{studyId ? 'Selecione ou crie uma nota' : 'Estudo sem vínculo com PACS'}</span>
              {studyId && (
                <button onClick={createNote} disabled={createMut.isPending} style={{ padding:'5px 14px', borderRadius:'var(--r-md)', fontSize:11, background:'var(--cyan-d)', border:'1px solid var(--cyan)', color:'var(--cyan)' }}>+ Nova Nota</button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ANOTAÇÕES TAB ─────────────────────────────────────────────────── */}
      {tab==='ann'&&(
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'5px 10px', borderBottom:'1px solid var(--border-s)', flexShrink:0 }}>
            <span style={{ fontSize:9, color:'var(--text-m)' }}>{totalAnns} anotação(ões) · {annGroups.length} corte(s)</span>
            {totalAnns>0&&<button onClick={exportAnnCsv} style={{ padding:'2px 7px', borderRadius:'var(--r-sm)', fontSize:9, background:'var(--bg-overlay)', border:'1px solid var(--border-d)', color:'var(--text-m)' }}>CSV ↓</button>}
          </div>

          <div style={{ flex:1, overflowY:'auto', padding:8, display:'flex', flexDirection:'column', gap:8 }}>
            {annGroups.length===0?(
              <div style={{ height:120, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8, color:'var(--text-d)', fontSize:11, textAlign:'center' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity={0.5}><path d="M3 21L21 3M9 15l2-2M12 12l2-2M15 9l2-2M6 18l2-2"/></svg>
                <span>Nenhuma anotação</span>
                <span style={{ fontSize:10 }}>Use as ferramentas no painel lateral</span>
              </div>
            ):annGroups.map(g=>{
              const sp=volume?spacing(g.plane as PlaneType,volume):{spX:1,spY:1}
              const pc=PLANE_COLOR[g.plane]||'var(--text-s)'
              return(
                <div key={`${g.vpId}-${g.sliceIndex}`} style={{ background:'var(--bg-panel)', borderRadius:'var(--r-md)', border:'1px solid var(--border-d)', overflow:'hidden' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'5px 8px', borderBottom:'1px solid var(--border-s)', background:'var(--bg-overlay)' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <div style={{ width:6,height:6,borderRadius:'50%',background:pc,flexShrink:0 }}/>
                      <span style={{ fontSize:9, fontWeight:700, color:pc, textTransform:'uppercase', letterSpacing:'0.08em' }}>{g.plane}</span>
                      <span style={{ fontSize:9, color:'var(--text-m)' }}>corte {g.sliceIndex+1}</span>
                    </div>
                    <div style={{ display:'flex', gap:4 }}>
                      <button onClick={()=>navTo(g.vpId,g.sliceIndex)} style={{ padding:'2px 7px', borderRadius:3, fontSize:8, background:'var(--cyan-d)', border:'1px solid var(--cyan-b)', color:'var(--cyan)' }}>Ir →</button>
                      <button onClick={()=>g.anns.forEach(a=>removeAnnotation(g.vpId,a.id))} style={{ padding:'2px 7px', borderRadius:3, fontSize:8, background:'var(--red-d)', border:'1px solid rgba(239,71,111,.25)', color:'var(--red)' }}>✕ {g.anns.length}</button>
                    </div>
                  </div>
                  {g.anns.map(ann=>{
                    const val=measure(ann.shape,sp.spX,sp.spY)
                    return(
                      <div key={ann.id} style={{ display:'flex', alignItems:'center', gap:7, padding:'5px 8px', borderBottom:'1px solid var(--border-s)' }}>
                        <div style={{ width:8,height:8,borderRadius:'50%',background:ann.color,flexShrink:0,boxShadow:`0 0 4px ${ann.color}60` }}/>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:10, fontWeight:600, color:'var(--text-s)' }}>{TYPE_LABEL[ann.shape.type]||ann.shape.type}</div>
                          {val&&<div style={{ fontSize:9, color:'var(--cyan)', fontFamily:'var(--font-m)' }}>{val}</div>}
                        </div>
                        <button onClick={()=>removeAnnotation(g.vpId,ann.id)} style={{ color:'var(--text-d)', fontSize:12, lineHeight:1, flexShrink:0, padding:'0 2px' }}>✕</button>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {totalAnns>0&&(
            <div style={{ padding:'6px 10px', borderTop:'1px solid var(--border-s)', flexShrink:0 }}>
              <button onClick={()=>Object.keys(viewports).forEach(vpId=>clearAnnotations(vpId))}
                style={{ width:'100%', padding:'5px', borderRadius:'var(--r-sm)', fontSize:10, background:'var(--red-d)', border:'1px solid rgba(239,71,111,.25)', color:'var(--red)' }}>
                Limpar todas as anotações
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── GALERIA TAB ───────────────────────────────────────────────────── */}
      {tab==='gallery'&&(
        <div style={{ flex:1, overflowY:'auto', padding:8 }}>
          {galleryImages.length===0?(
            <div style={{ height:120, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-d)', fontSize:11, textAlign:'center' }}>Exporte imagens<br/>para vê-las aqui</div>
          ):(
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
              {galleryImages.map(img=>(
                <div key={img.id} style={{ position:'relative' }}>
                  <div style={{ borderRadius:'var(--r-sm)', overflow:'hidden', border:'1px solid var(--border-d)', background:'#000', aspectRatio:'4/3' }}>
                    <img src={img.dataUrl} style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }} alt={img.label}/>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:2, marginTop:2, padding:'0 2px' }}>
                    <span style={{ flex:1, fontSize:8, color:'var(--text-m)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{img.label}</span>
                    <button onClick={()=>deleteGalleryImage(img.id)} aria-label={`Remover ${img.label}`} style={{ fontSize:9, color:'var(--text-d)', lineHeight:1, flexShrink:0 }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
