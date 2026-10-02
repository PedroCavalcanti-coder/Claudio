import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '../store'
import type { Tool } from '../store'

const PRESETS = [
  { label: 'Cérebro',    wc: 40,   ww: 80   },
  { label: 'Subdural',   wc: 75,   ww: 215  },
  { label: 'AVC',        wc: 40,   ww: 40   },
  { label: 'Osso',       wc: 400,  ww: 1500 },
  { label: 'Pulmão',     wc: -600, ww: 1600 },
  { label: 'Abdome',     wc: 40,   ww: 400  },
  { label: 'Fígado',     wc: 60,   ww: 150  },
  { label: 'Angio',      wc: 300,  ww: 600  },
  { label: 'Mediastino', wc: 40,   ww: 400  },
  { label: 'Tecido',     wc: 50,   ww: 350  },
]

const sz = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const sm = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const INav       = () => <svg {...sz}><path d="M5 3l14 9-7 1-4 7-3-17z"/></svg>
const IRuler     = () => <svg {...sz}><path d="M3 21L21 3M9 15l2-2M12 12l2-2M15 9l2-2M6 18l2-2"/></svg>
const IAngle     = () => <svg {...sz}><path d="M3 20h18M3 20L9 8M9 8l10 12"/><path d="M9 14a4 4 0 004-4" strokeDasharray="2 2"/></svg>
const IProbe     = () => <svg {...sz}><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>
const IDraw      = () => <svg {...sz}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
const IShapes    = () => <svg {...sz}><rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="17" r="4"/></svg>
const IPresets   = () => <svg {...sz}><circle cx="12" cy="12" r="5"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
const IEraser    = () => <svg {...sz}><path d="M20 20H7L3 16l11-11 6 6-5.5 5.5"/><path d="M6.0 11.0l7 7"/></svg>

const IWindowing = () => <svg {...sm}><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="7" y="9" width="10" height="6" rx="1" fill="currentColor" opacity=".3"/><line x1="12" y1="5" x2="12" y2="19"/></svg>
const IPan       = () => <svg {...sm}><path d="M5 9l-2 3 2 3M19 9l2 3-2 3M9 5l3-2 3 2M9 19l3 2 3-2"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
const IZoom      = () => <svg {...sm}><circle cx="10" cy="10" r="6"/><line x1="21" y1="21" x2="15" y2="15"/><line x1="8" y1="10" x2="12" y2="10"/><line x1="10" y1="8" x2="10" y2="12"/></svg>
const IRulerSm   = () => <svg {...sm}><path d="M3 21L21 3M9 15l2-2M12 12l2-2M15 9l2-2"/></svg>
const IBidir     = () => <svg {...sm}><line x1="3" y1="12" x2="21" y2="12"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="6" x2="6" y2="6"/><line x1="18" y1="6" x2="21" y2="6"/><line x1="6" y1="3" x2="6" y2="6"/><line x1="18" y1="3" x2="18" y2="6"/></svg>
const IAngle3    = () => <svg {...sm}><path d="M3 20h18M3 20L9 8M9 8l10 12"/></svg>
const ICobb      = () => <svg {...sm}><line x1="3" y1="8" x2="15" y2="8"/><line x1="9" y1="16" x2="21" y2="16"/><line x1="11" y1="8" x2="11" y2="16" strokeDasharray="2 2" opacity=".7"/></svg>
const IProbeSm   = () => <svg {...sm}><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="3"/></svg>
const IRoiEl     = () => <svg {...sm}><ellipse cx="12" cy="12" rx="9" ry="6"/><ellipse cx="12" cy="12" rx="9" ry="6" fill="currentColor" opacity=".15" stroke="none"/></svg>
const IRoiRc     = () => <svg {...sm}><rect x="3" y="5" width="18" height="14" rx="1"/><rect x="3" y="5" width="18" height="14" rx="1" fill="currentColor" opacity=".15" stroke="none"/></svg>
const IArrow     = () => <svg {...sm}><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9,5 19,5 19,15"/></svg>
const IFreehand  = () => <svg {...sm}><path d="M4 20c2-8 6-12 10-10s2 8 4 10"/></svg>
const IPolygon   = () => <svg {...sm}><polygon points="12,3 21,8 18,19 6,19 3,8"/><circle cx="12" cy="3" r="1.5" fill="currentColor" stroke="none"/><circle cx="21" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="19" r="1.5" fill="currentColor" stroke="none"/><circle cx="6" cy="19" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r="1.5" fill="currentColor" stroke="none"/></svg>
const IText      = () => <svg {...sm}><text x="4" y="17" style={{ font:'bold 14px serif', fill:'currentColor', stroke:'none' }}>T</text></svg>
const ICircle    = () => <svg {...sm}><circle cx="12" cy="12" r="9"/></svg>
const IRect      = () => <svg {...sm}><rect x="3" y="5" width="18" height="14" rx="2"/></svg>
const ITrash     = () => <svg {...sm}><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>

type ToolItem  = { kind: 'tool';   id: Tool;   label: string; shortcut?: string; Icon: React.FC }
type ActionItem= { kind: 'action'; id: string; label: string; shortcut?: string; Icon: React.FC }
type Item = ToolItem | ActionItem

interface Group { id: string; label: string; Icon: React.FC; items: Item[] }

const GROUPS: Group[] = [
  {
    id: 'nav', label: 'Navegação', Icon: INav,
    items: [
      { kind:'tool', id:'windowing', label:'Windowing',  shortcut:'W', Icon:IWindowing },
      { kind:'tool', id:'pan',       label:'Pan / Mover', shortcut:'P', Icon:IPan },
      { kind:'tool', id:'zoom',      label:'Zoom',        shortcut:'Z', Icon:IZoom },
    ],
  },
  {
    id: 'measure', label: 'Medição', Icon: IRuler,
    items: [
      { kind:'tool', id:'ruler',        label:'Régua',             shortcut:'R', Icon:IRulerSm },
      { kind:'tool', id:'bidirectional',label:'Bidirecional RECIST',shortcut:'B', Icon:IBidir   },
    ],
  },
  {
    id: 'angle', label: 'Ângulo', Icon: IAngle,
    items: [
      { kind:'tool', id:'angle', label:'Ângulo 3 pontos', shortcut:'A', Icon:IAngle3 },
      { kind:'tool', id:'cobb',  label:'Ângulo de Cobb',  shortcut:'K', Icon:ICobb   },
    ],
  },
  {
    id: 'roi', label: 'HU / ROI', Icon: IProbe,
    items: [
      { kind:'tool', id:'probe',      label:'HU Probe',     shortcut:'H', Icon:IProbeSm },
      { kind:'tool', id:'roi_ellipse',label:'ROI Elipse',   shortcut:'Q', Icon:IRoiEl   },
      { kind:'tool', id:'roi_rect',   label:'ROI Retângulo',shortcut:'D', Icon:IRoiRc   },
    ],
  },
  {
    id: 'draw', label: 'Desenho', Icon: IDraw,
    items: [
      { kind:'tool', id:'arrow',   label:'Seta',    shortcut:'S', Icon:IArrow    },
      { kind:'tool', id:'freehand',label:'Lápis',   shortcut:'F', Icon:IFreehand },
      { kind:'tool', id:'polygon', label:'Polígono',shortcut:'G', Icon:IPolygon  },
      { kind:'tool', id:'text',    label:'Texto',   shortcut:'T', Icon:IText     },
    ],
  },
  {
    id: 'shapes', label: 'Formas', Icon: IShapes,
    items: [
      { kind:'tool', id:'circle',   label:'Elipse',    shortcut:'C', Icon:ICircle },
      { kind:'tool', id:'rectangle',label:'Retângulo', shortcut:'E', Icon:IRect   },
    ],
  },
  {
    id: 'presets', label: 'Presets W/L', Icon: IPresets,
    items: PRESETS.map(p => ({
      kind: 'action' as const,
      id: `preset_${p.label}`,
      label: `${p.label}  WC:${p.wc} WW:${p.ww}`,
      Icon: IPresets,
    })),
  },
  {
    id: 'eraser', label: 'Apagar', Icon: IEraser,
    items: [
      { kind:'tool',   id:'eraser',   label:'Apagar anotação', shortcut:'X', Icon:IEraser },
      { kind:'action', id:'clearAll', label:'Limpar tudo',              Icon:ITrash  },
    ],
  },
]

export function ToolPanel() {
  const {
    activeTool, setActiveTool,
    activeViewportId, viewports, updateViewport,
    annotationStyle, setAnnotationStyle,
    clearAnnotations, reportLocked,
  } = useStore()

  // Laudo assinado torna o estudo imutável: só navegação e presets ficam disponíveis
  const visibleGroups = reportLocked
    ? GROUPS.filter(g => g.id === 'nav' || g.id === 'presets')
    : GROUPS

  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [flyoutPos, setFlyoutPos] = useState({ top: 0, left: 56 })
  const sidebarRef = useRef<HTMLDivElement>(null)
  const groupRefs  = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node))
        setOpenGroup(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const toggleGroup = useCallback((groupId: string) => {
    if (openGroup === groupId) { setOpenGroup(null); return }
    const el = groupRefs.current[groupId]
    if (el) {
      const rect = el.getBoundingClientRect()
      const flyH = groupId === 'presets' ? 340 : groupId === 'image' ? 260 : 200
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - flyH - 8))
      setFlyoutPos({ top, left: rect.right + 4 })
    }
    setOpenGroup(groupId)
  }, [openGroup])

  const applyAction = useCallback((actionId: string) => {
    const vp = viewports[activeViewportId]
    if (!vp) return
    if (actionId.startsWith('preset_')) {
      const label = actionId.replace('preset_', '')
      const p = PRESETS.find(x => x.label === label)
      if (p) updateViewport(activeViewportId, { windowCenter: p.wc, windowWidth: p.ww })
    } else if (actionId === 'clearAll') clearAnnotations(activeViewportId)
    setOpenGroup(null)
  }, [viewports, activeViewportId, updateViewport, clearAnnotations])

  const activeGroup = GROUPS.find(g => g.items.some(i => i.kind === 'tool' && i.id === activeTool))
  const flyoutGroup = GROUPS.find(g => g.id === openGroup)

  return (
    <div
      ref={sidebarRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 56,
        background: 'var(--bg-base)',
        borderRight: '1px solid var(--border-s)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 6,
        paddingBottom: 10,
        gap: 2,
        overflowY: 'auto',
        overflowX: 'visible',
        zIndex: 50,
      }}
    >
      {visibleGroups.map(group => {
        const isActive  = group.id === openGroup
        const hasActive = group.id === activeGroup?.id
        return (
          <div
            key={group.id}
            ref={el => { groupRefs.current[group.id] = el }}
            style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}
          >
            <button
              title={group.label}
              onClick={() => toggleGroup(group.id)}
              style={{
                width: 40, height: 40,
                borderRadius: 'var(--r-md)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: 3,
                background: isActive ? 'var(--cyan-d)' : hasActive ? 'rgba(0,180,217,0.08)' : 'transparent',
                border: isActive ? '1px solid var(--cyan)' : hasActive ? '1px solid rgba(0,180,217,0.3)' : '1px solid transparent',
                color: isActive ? 'var(--cyan)' : hasActive ? 'var(--cyan)' : 'var(--text-m)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <group.Icon />
              {hasActive && !isActive && (
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--cyan)', position: 'absolute', bottom: 4 }} />
              )}
            </button>
          </div>
        )
      })}

      {!reportLocked && (
      <>
      <div style={{ width: 32, height: 1, background: 'var(--border-s)', margin: '6px 0' }} />

      <label
        title="Cor das anotações"
        style={{ width: 28, height: 28, borderRadius: '50%', border: `2px solid var(--border-d)`, cursor: 'pointer', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', flexShrink: 0 }}
      >
        <span style={{ position: 'absolute', inset: 1, background: annotationStyle.color, borderRadius: '50%' }} />
        <input type="color" value={annotationStyle.color} onChange={e => setAnnotationStyle({ color: e.target.value })} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
      </label>

      <select
        value={annotationStyle.lineWidth}
        onChange={e => setAnnotationStyle({ lineWidth: +e.target.value })}
        title="Espessura"
        style={{ width: 40, height: 22, fontSize: 9, background: 'var(--bg-elevated)', border: '1px solid var(--border-d)', color: 'var(--text-s)', borderRadius: 'var(--r-sm)', textAlign: 'center' }}
      >
        {[1, 2, 3, 4].map(w => <option key={w} value={w}>{w}px</option>)}
      </select>

      {activeTool === 'text' && (
        <>
          <div style={{ width: 32, height: 1, background: 'var(--border-s)', margin: '4px 0' }} />
          <button title="Negrito" onClick={() => setAnnotationStyle({ bold: !annotationStyle.bold })}
            style={{ width: 28, height: 28, borderRadius: 'var(--r-sm)', fontWeight: 700, fontSize: 13, background: annotationStyle.bold ? 'var(--cyan-d)' : 'var(--bg-overlay)', border: `1px solid ${annotationStyle.bold ? 'var(--cyan)' : 'var(--border-d)'}`, color: annotationStyle.bold ? 'var(--cyan)' : 'var(--text-m)' }}>B</button>
          <button title="Itálico" onClick={() => setAnnotationStyle({ italic: !annotationStyle.italic })}
            style={{ width: 28, height: 28, borderRadius: 'var(--r-sm)', fontStyle: 'italic', fontSize: 13, background: annotationStyle.italic ? 'var(--cyan-d)' : 'var(--bg-overlay)', border: `1px solid ${annotationStyle.italic ? 'var(--cyan)' : 'var(--border-d)'}`, color: annotationStyle.italic ? 'var(--cyan)' : 'var(--text-m)' }}>I</button>
          <button title={`Alinhamento: ${annotationStyle.align}`}
            onClick={() => setAnnotationStyle({ align: annotationStyle.align === 'left' ? 'center' : annotationStyle.align === 'center' ? 'right' : 'left' })}
            style={{ width: 28, height: 28, borderRadius: 'var(--r-sm)', background: 'var(--bg-overlay)', border: '1px solid var(--border-d)', color: 'var(--text-m)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {annotationStyle.align === 'left'   && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></>}
              {annotationStyle.align === 'center' && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></>}
              {annotationStyle.align === 'right'  && <><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></>}
            </svg>
          </button>
        </>
      )}
      </>
      )}

      {flyoutGroup && (
        <div
          style={{
            position: 'fixed',
            left: flyoutPos.left,
            top: flyoutPos.top,
            width: 234,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-b)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-f)',
            zIndex: 200,
            padding: '10px 10px 12px',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border-s)' }}>
            <flyoutGroup.Icon />
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-s)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {flyoutGroup.label}
            </span>
          </div>

          {flyoutGroup.id === 'presets' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => applyAction(`preset_${p.label}`)}
                  style={{
                    padding: '6px 8px', borderRadius: 'var(--r-sm)', fontSize: 10,
                    background: 'var(--bg-overlay)', border: '1px solid var(--border-d)',
                    color: 'var(--text-s)', cursor: 'pointer', textAlign: 'left',
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--text-p)', marginBottom: 1 }}>{p.label}</div>
                  <div style={{ color: 'var(--text-m)', fontSize: 9 }}>WC {p.wc} / WW {p.ww}</div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {flyoutGroup.items.map(item => {
                const isActiveTool = item.kind === 'tool' && item.id === activeTool
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.kind === 'tool') {
                        setActiveTool(item.id as Tool)
                        setOpenGroup(null)
                      } else {
                        applyAction(item.id)
                      }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '7px 10px',
                      borderRadius: 'var(--r-sm)',
                      background: isActiveTool ? 'var(--cyan-d)' : 'var(--bg-overlay)',
                      border: `1px solid ${isActiveTool ? 'var(--cyan)' : 'var(--border-d)'}`,
                      color: isActiveTool ? 'var(--cyan)' : 'var(--text-s)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ flexShrink: 0, opacity: 0.85 }}><item.Icon /></span>
                    <span style={{ flex: 1, fontSize: 11 }}>{item.kind === 'tool' && item.id === 'bidirectional' ? 'Bidirecional RECIST' : item.label}</span>
                    {item.kind === 'tool' && item.shortcut && (
                      <kbd style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 3,
                        background: isActiveTool ? 'rgba(0,0,0,0.25)' : 'var(--bg-elevated)',
                        border: '1px solid var(--border-s)', color: isActiveTool ? 'var(--cyan)' : 'var(--text-m)',
                        fontFamily: 'var(--font-m)',
                      }}>{item.shortcut}</kbd>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
