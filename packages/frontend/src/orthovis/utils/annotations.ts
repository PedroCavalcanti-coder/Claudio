import type { Annotation, Point } from '../store'
import { imgToCanvas, dist, realMm } from './render'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function bg(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fs: number) {
  ctx.save(); ctx.font = `${fs}px DM Mono,monospace`
  const w = ctx.measureText(text).width + 8; const h = fs + 5
  ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(x - 2, y - h + 3, w, h); ctx.restore()
}
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fs: number) {
  bg(ctx, text, x, y, fs); ctx.fillText(text, x, y)
}

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const raw = text.split('\n')
  const out: string[] = []
  for (const para of raw) {
    const words = para.split(' ')
    let cur = ''
    for (const word of words) {
      const test = cur ? cur + ' ' + word : word
      if (ctx.measureText(test).width > maxW && cur) { out.push(cur); cur = word }
      else cur = test
    }
    out.push(cur)
  }
  return out
}
function dot(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, r = 3) {
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill()
}
function arrowhead(ctx: CanvasRenderingContext2D, from: Point, to: Point, sz: number) {
  const a = Math.atan2(to.y - from.y, to.x - from.x)
  ctx.beginPath(); ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - sz * Math.cos(a - Math.PI / 6), to.y - sz * Math.sin(a - Math.PI / 6))
  ctx.lineTo(to.x - sz * Math.cos(a + Math.PI / 6), to.y - sz * Math.sin(a + Math.PI / 6))
  ctx.closePath(); ctx.fill()
}
function tick(ctx: CanvasRenderingContext2D, p: Point, angle: number, len: number) {
  ctx.beginPath()
  ctx.moveTo(p.x + Math.cos(angle) * len, p.y + Math.sin(angle) * len)
  ctx.lineTo(p.x - Math.cos(angle) * len, p.y - Math.sin(angle) * len)
  ctx.stroke()
}
function statsBox(ctx: CanvasRenderingContext2D, cx: number, cy: number, ann: Annotation) {
  const sh = ann.shape
  if (sh.huMean === undefined) return
  const lines = [
    `μ ${sh.huMean.toFixed(0)} HU`,
    `σ ${sh.huStd?.toFixed(0)} HU`,
    `↑ ${sh.huMax?.toFixed(0)}  ↓ ${sh.huMin?.toFixed(0)}`,
  ]
  ctx.save()
  ctx.font = `${ann.fontSize - 1}px DM Mono,monospace`
  const lh = ann.fontSize + 3
  const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12
  const boxH = lines.length * lh + 8
  const bx = cx - boxW / 2, by = cy - boxH / 2
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(bx, by, boxW, boxH)
  ctx.strokeStyle = ann.color; ctx.lineWidth = 0.6; ctx.strokeRect(bx, by, boxW, boxH)
  ctx.fillStyle = ann.color
  lines.forEach((l, i) => { bg(ctx, l, bx + 4, by + lh * (i + 1) - 1, ann.fontSize - 1); ctx.fillText(l, bx + 4, by + lh * (i + 1) - 1) })
  ctx.restore()
}

// ─── Main renderer ───────────────────────────────────────────────────────────
export function renderAnnotations(
  ctx: CanvasRenderingContext2D, anns: Annotation[],
  cw: number, ch: number, iw: number, ih: number,
  px: number, py: number, zoom: number, spX = 1, spY = 1,
) {
  ctx.clearRect(0, 0, cw, ch)
  const toC = (p: Point) => imgToCanvas(p.x, p.y, cw, ch, iw, ih, px, py, zoom)

  for (const ann of anns) {
    ctx.save()
    ctx.strokeStyle = ann.color; ctx.fillStyle = ann.color
    ctx.lineWidth = ann.lineWidth; ctx.font = `${ann.fontSize}px DM Mono,monospace`
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3
    const sh = ann.shape

    // ── Ruler ──────────────────────────────────────────────────────────────
    if (sh.type === 'ruler' && sh.p1 && sh.p2) {
      const a = toC(sh.p1), b = toC(sh.p2)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2
      tick(ctx, a, ang, 6); tick(ctx, b, ang, 6); dot(ctx, a); dot(ctx, b)
      const mm = realMm(sh.p1, sh.p2, spX, spY)
      label(ctx, `${(mm / 10).toFixed(2)} cm`, (a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 4, ann.fontSize)
    }

    // ── Bidirectional (RECIST) ──────────────────────────────────────────────
    else if (sh.type === 'bidirectional' && sh.p1 && sh.p2 && sh.p3 && sh.p4) {
      const a = toC(sh.p1), b = toC(sh.p2), c = toC(sh.p3), d2 = toC(sh.p4)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      const ang1 = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2
      tick(ctx, a, ang1, 6); tick(ctx, b, ang1, 6); dot(ctx, a); dot(ctx, b)
      ctx.save(); ctx.setLineDash([4, 3])
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d2.x, d2.y); ctx.stroke()
      ctx.restore()
      const ang2 = Math.atan2(d2.y - c.y, d2.x - c.x) + Math.PI / 2
      tick(ctx, c, ang2, 5); tick(ctx, d2, ang2, 5)
      const mm1 = realMm(sh.p1, sh.p2, spX, spY)
      const mm2 = realMm(sh.p3, sh.p4, spX, spY)
      label(ctx, `L ${(mm1 / 10).toFixed(2)}cm`, (a.x + b.x) / 2 + 4, (a.y + b.y) / 2 - 6, ann.fontSize)
      label(ctx, `T ${(mm2 / 10).toFixed(2)}cm`, (c.x + d2.x) / 2 + 4, (c.y + d2.y) / 2 + ann.fontSize + 2, ann.fontSize)
    }

    // ── Arrow ───────────────────────────────────────────────────────────────
    else if (sh.type === 'arrow' && sh.p1 && sh.p2) {
      const a = toC(sh.p1), b = toC(sh.p2)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      arrowhead(ctx, a, b, 12); dot(ctx, a)
      const mm = realMm(sh.p1, sh.p2, spX, spY)
      label(ctx, `${(mm / 10).toFixed(2)} cm`, (a.x + b.x) / 2 + 6, (a.y + b.y) / 2 - 4, ann.fontSize)
    }

    // ── Circle / Elipse ─────────────────────────────────────────────────────
    else if (sh.type === 'circle' && sh.center && sh.radius != null) {
      const c = toC(sh.center), r = sh.radius * zoom
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke(); dot(ctx, c)
      const rm = sh.radius * (spX + spY) / 2
      const am = Math.PI * (sh.radius * spX) * (sh.radius * spY)
      label(ctx, `r ${(rm / 10).toFixed(2)}cm  A ${(am / 100).toFixed(2)}cm²`, c.x + r * 0.65, c.y - r * 0.65, ann.fontSize)
    }

    // ── ROI Elipse ──────────────────────────────────────────────────────────
    else if (sh.type === 'roi_ellipse' && sh.center && sh.radius != null) {
      const c = toC(sh.center), r = sh.radius * zoom
      ctx.save(); ctx.globalAlpha = 0.18
      ctx.fillStyle = ann.color; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke(); dot(ctx, c)
      const rm = sh.radius * (spX + spY) / 2
      label(ctx, `r ${(rm / 10).toFixed(2)}cm`, c.x + r * 0.65, c.y - r * 0.65, ann.fontSize)
      statsBox(ctx, c.x, c.y, ann)
    }

    // ── Rectangle ───────────────────────────────────────────────────────────
    else if (sh.type === 'rectangle' && sh.p1 && sh.p2) {
      const a = toC(sh.p1), b = toC(sh.p2)
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
      const wm = Math.abs(sh.p2.x - sh.p1.x) * spX, hm = Math.abs(sh.p2.y - sh.p1.y) * spY
      label(ctx, `${(wm / 10).toFixed(2)}×${(hm / 10).toFixed(2)}cm  A ${(wm * hm / 100).toFixed(2)}cm²`, Math.min(a.x, b.x), Math.min(a.y, b.y) - 4, ann.fontSize)
    }

    // ── ROI Retângulo ────────────────────────────────────────────────────────
    else if (sh.type === 'roi_rect' && sh.p1 && sh.p2) {
      const a = toC(sh.p1), b = toC(sh.p2)
      ctx.save(); ctx.globalAlpha = 0.18
      ctx.fillStyle = ann.color; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y)
      ctx.restore()
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
      const wm = Math.abs(sh.p2.x - sh.p1.x) * spX, hm = Math.abs(sh.p2.y - sh.p1.y) * spY
      label(ctx, `${(wm / 10).toFixed(2)}×${(hm / 10).toFixed(2)}cm`, Math.min(a.x, b.x), Math.min(a.y, b.y) - 4, ann.fontSize)
      statsBox(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2, ann)
    }

    // ── Text box ────────────────────────────────────────────────────────────
    else if (sh.type === 'text' && sh.position && sh.text) {
      const iw_b = sh.width  || 160
      const ih_b = sh.height || 70
      const tl   = toC(sh.position)
      const bw   = iw_b * zoom
      const bh   = ih_b * zoom
      const bcx  = tl.x + bw / 2
      const bcy  = tl.y + bh / 2
      const rot  = ((sh.textRotation || 0) * Math.PI) / 180
      const pad  = 8

      ctx.save()
      ctx.translate(bcx, bcy)
      ctx.rotate(rot)

      const bg2 = sh.bgColor || 'transparent'
      if (bg2 !== 'transparent') {
        ctx.globalAlpha = 0.82
        ctx.fillStyle   = bg2
        ctx.fillRect(-bw / 2, -bh / 2, bw, bh)
        ctx.globalAlpha = 1
      }

      ctx.shadowBlur = 0
      ctx.strokeStyle = ann.color
      ctx.lineWidth   = ann.lineWidth
      ctx.strokeRect(-bw / 2, -bh / 2, bw, bh)

      const fw = `${sh.italic ? 'italic ' : ''}${sh.bold ? 'bold ' : ''}${ann.fontSize}px DM Mono,monospace`
      ctx.font         = fw
      ctx.fillStyle    = ann.color
      ctx.shadowColor  = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur   = 3
      ctx.textAlign    = sh.align || 'left'
      ctx.textBaseline = 'top'

      const maxW  = bw - pad * 2
      const lineH = ann.fontSize * 1.45
      const lines = wrapTextLines(ctx, sh.text, maxW)
      const textX = sh.align === 'center' ? 0 : sh.align === 'right' ? bw / 2 - pad : -bw / 2 + pad
      lines.forEach((line, i) => {
        ctx.fillText(line, textX, -bh / 2 + pad + i * lineH, maxW)
      })

      ctx.restore()
    }

    // ── HU Probe ────────────────────────────────────────────────────────────
    else if (sh.type === 'probe' && sh.position) {
      const p = toC(sh.position), cs = 8
      ctx.beginPath()
      ctx.moveTo(p.x - cs, p.y); ctx.lineTo(p.x + cs, p.y)
      ctx.moveTo(p.x, p.y - cs); ctx.lineTo(p.x, p.y + cs)
      ctx.stroke(); dot(ctx, p, 3)
      label(ctx, `HU ${Math.round(sh.hu ?? 0)}`, p.x + 10, p.y - 4, ann.fontSize)
    }

    // ── Angle (3-point) ─────────────────────────────────────────────────────
    else if (sh.type === 'angle' && sh.p1 && sh.vertex && sh.p2) {
      const a = toC(sh.p1), v = toC(sh.vertex), b = toC(sh.p2)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(v.x, v.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      for (const pt of [a, v, b]) dot(ctx, pt)
      const r2 = Math.min(28, dist(a, v) * 0.4, dist(b, v) * 0.4)
      if (r2 > 6) {
        ctx.beginPath()
        ctx.arc(v.x, v.y, r2, Math.atan2(a.y - v.y, a.x - v.x), Math.atan2(b.y - v.y, b.x - v.x))
        ctx.stroke()
      }
      label(ctx, `${(sh.degrees ?? 0).toFixed(1)}°`, v.x + 12, v.y - 8, ann.fontSize)
    }

    // ── Cobb Angle (2 lines) ─────────────────────────────────────────────────
    else if (sh.type === 'cobb' && sh.p1 && sh.p2 && sh.p3 && sh.p4) {
      const a = toC(sh.p1), b = toC(sh.p2), c = toC(sh.p3), d2 = toC(sh.p4)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d2.x, d2.y); ctx.stroke()
      for (const pt of [a, b, c, d2]) dot(ctx, pt, 3)
      // Extended dashed lines to show where they would intersect
      ctx.save(); ctx.setLineDash([3, 4]); ctx.globalAlpha = 0.45
      ctx.beginPath(); ctx.moveTo(a.x - (b.x - a.x) * 0.5, a.y - (b.y - a.y) * 0.5); ctx.lineTo(b.x + (b.x - a.x) * 0.5, b.y + (b.y - a.y) * 0.5); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(c.x - (d2.x - c.x) * 0.5, c.y - (d2.y - c.y) * 0.5); ctx.lineTo(d2.x + (d2.x - c.x) * 0.5, d2.y + (d2.y - c.y) * 0.5); ctx.stroke()
      ctx.restore()
      const mx = (a.x + b.x + c.x + d2.x) / 4, my = (a.y + b.y + c.y + d2.y) / 4
      label(ctx, `Cobb ${(sh.degrees ?? 0).toFixed(1)}°`, mx + 8, my - 4, ann.fontSize)
    }

    // ── Freehand ────────────────────────────────────────────────────────────
    else if (sh.type === 'freehand' && sh.points && sh.points.length > 1) {
      ctx.beginPath(); const f = toC(sh.points[0]); ctx.moveTo(f.x, f.y)
      for (let i = 1; i < sh.points.length; i++) { const p = toC(sh.points[i]); ctx.lineTo(p.x, p.y) }
      ctx.stroke()
      let tot = 0; for (let i = 1; i < sh.points.length; i++) tot += realMm(sh.points[i - 1], sh.points[i], spX, spY)
      const last = toC(sh.points[sh.points.length - 1])
      label(ctx, `${(tot / 10).toFixed(2)} cm`, last.x + 6, last.y - 4, ann.fontSize)
    }

    // ── Polygon ─────────────────────────────────────────────────────────────
    else if (sh.type === 'polygon' && sh.points && sh.points.length > 1) {
      ctx.beginPath(); const f = toC(sh.points[0]); ctx.moveTo(f.x, f.y)
      for (let i = 1; i < sh.points.length; i++) { const p = toC(sh.points[i]); ctx.lineTo(p.x, p.y) }
      ctx.closePath()
      ctx.save(); ctx.globalAlpha = 0.14; ctx.fill(); ctx.restore()
      ctx.stroke()
      for (const pt of sh.points) dot(ctx, toC(pt), 3)
      // Perimeter + area (shoelace formula)
      let perim = 0; for (let i = 1; i < sh.points.length; i++) perim += realMm(sh.points[i - 1], sh.points[i], spX, spY)
      perim += realMm(sh.points[sh.points.length - 1], sh.points[0], spX, spY)
      let area = 0; const n = sh.points.length
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        area += sh.points[i].x * spX * sh.points[j].y * spY
        area -= sh.points[j].x * spX * sh.points[i].y * spY
      }
      area = Math.abs(area) / 2
      const cx2 = sh.points.reduce((s, p) => s + p.x, 0) / n
      const cy2 = sh.points.reduce((s, p) => s + p.y, 0) / n
      const cc = toC({ x: cx2, y: cy2 })
      label(ctx, `P ${(perim / 10).toFixed(2)}cm  A ${(area / 100).toFixed(2)}cm²`, cc.x + 4, cc.y - 4, ann.fontSize)
    }

    ctx.restore()
  }
}

// ─── Hit test ────────────────────────────────────────────────────────────────
export function hitTest(
  cx: number, cy: number, ann: Annotation,
  cw: number, ch: number, iw: number, ih: number,
  px: number, py: number, zoom: number, thr = 12,
): boolean {
  const toC = (p: Point) => imgToCanvas(p.x, p.y, cw, ch, iw, ih, px, py, zoom)
  const sh = ann.shape
  const dPt = (p: Point) => dist({ x: cx, y: cy }, toC(p))
  const dSeg = (p1: Point, p2: Point) => {
    const a = toC(p1), b = toC(p2), dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
    if (!l2) return dist({ x: cx, y: cy }, a)
    const t = Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / l2))
    return dist({ x: cx, y: cy }, { x: a.x + t * dx, y: a.y + t * dy })
  }

  if ((sh.type === 'ruler' || sh.type === 'arrow') && sh.p1 && sh.p2) return dSeg(sh.p1, sh.p2) < thr
  if (sh.type === 'bidirectional' && sh.p1 && sh.p2 && sh.p3 && sh.p4) return dSeg(sh.p1, sh.p2) < thr || dSeg(sh.p3, sh.p4) < thr
  if (sh.type === 'circle' && sh.center && sh.radius != null) return Math.abs(dist({ x: cx, y: cy }, toC(sh.center)) - sh.radius * zoom) < thr
  if ((sh.type === 'roi_ellipse') && sh.center && sh.radius != null) return dist({ x: cx, y: cy }, toC(sh.center)) < sh.radius * zoom + thr
  if ((sh.type === 'rectangle' || sh.type === 'roi_rect') && sh.p1 && sh.p2) {
    const a = toC(sh.p1), b = toC(sh.p2)
    return (Math.abs(cy - a.y) < thr || Math.abs(cy - b.y) < thr) && cx >= Math.min(a.x, b.x) && cx <= Math.max(a.x, b.x) ||
      (Math.abs(cx - a.x) < thr || Math.abs(cx - b.x) < thr) && cy >= Math.min(a.y, b.y) && cy <= Math.max(a.y, b.y)
  }
  if (sh.type === 'text' && sh.position) {
    const tl = toC(sh.position)
    const bw = (sh.width  || 160) * zoom
    const bh = (sh.height || 70)  * zoom
    const bcx = tl.x + bw / 2, bcy = tl.y + bh / 2
    const rot = -((sh.textRotation || 0) * Math.PI) / 180
    const rx = Math.cos(rot) * (cx - bcx) - Math.sin(rot) * (cy - bcy)
    const ry = Math.sin(rot) * (cx - bcx) + Math.cos(rot) * (cy - bcy)
    return Math.abs(rx) <= bw / 2 + thr && Math.abs(ry) <= bh / 2 + thr
  }
  if (sh.type === 'probe' && sh.position) return dPt(sh.position) < thr * 2
  if (sh.type === 'angle' && sh.p1 && sh.vertex && sh.p2) return dPt(sh.vertex) < thr || dSeg(sh.p1, sh.vertex) < thr || dSeg(sh.vertex, sh.p2) < thr
  if (sh.type === 'cobb' && sh.p1 && sh.p2 && sh.p3 && sh.p4) return dSeg(sh.p1, sh.p2) < thr || dSeg(sh.p3, sh.p4) < thr
  if ((sh.type === 'freehand' || sh.type === 'polygon') && sh.points) {
    for (let i = 0; i < sh.points.length - 1; i++) if (dSeg(sh.points[i], sh.points[i + 1]) < thr) return true
    if (sh.type === 'polygon' && sh.points.length > 2) return dSeg(sh.points[sh.points.length - 1], sh.points[0]) < thr
  }
  return false
}
