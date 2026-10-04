import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '../store'
import { toast } from '../../components/ui/Toast'
import { examNotesApi, reportsApi } from '../../api/endpoints'
import { MarkdownTextarea, type MarkdownTextareaHandle } from '../../components/MarkdownTextarea'

type Tab = 'dados'|'achados'|'exportar'

function captureViewport(vpId: string, vp?: { panX?: number; panY?: number; zoom?: number; rotation?: number; flipH?: boolean; flipV?: boolean }): string | null {
  const el = document.querySelector(`[data-vpid="${vpId}"]`) as HTMLElement
  if (!el) return null
  const canvases = el.querySelectorAll('canvas')
  if (!canvases.length) return null
  const imgC = canvases[0] as HTMLCanvasElement                 // imagem em resolução nativa
  const annC = canvases[canvases.length-1] as HTMLCanvasElement // anotações em coords da caixa

  // Moldura = caixa do viewport, reproduzindo object-fit:contain + pan/zoom/rotação da tela
  const W = annC.width  || el.clientWidth  || imgC.width  || 512
  const H = annC.height || el.clientHeight || imgC.height || 512
  const out = document.createElement('canvas'); out.width=W; out.height=H
  const ctx = out.getContext('2d')!
  ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H)
  if (imgC.width>0&&imgC.height>0) {
    const baseScale = Math.min(W/imgC.width, H/imgC.height)
    const zoom = vp?.zoom || 1
    const dw = imgC.width  * baseScale * zoom
    const dh = imgC.height * baseScale * zoom
    ctx.save()
    ctx.translate(W/2 + (vp?.panX||0), H/2 + (vp?.panY||0))
    ctx.rotate(((vp?.rotation||0)*Math.PI)/180)
    ctx.scale(vp?.flipH?-1:1, vp?.flipV?-1:1)
    ctx.imageSmoothingEnabled=false
    ctx.drawImage(imgC, -dw/2, -dh/2, dw, dh)
    ctx.restore()
  }
  if (annC!==imgC&&annC.width>0) ctx.drawImage(annC,0,0,W,H)
  return out.toDataURL('image/jpeg',0.88)
}

// Declarado fora de ReportModal: se ficasse dentro, o React recriaria o componente a
// cada render e o input perderia o foco entre keystrokes.
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div style={{ fontSize: 9, color: 'var(--text-m)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 5 }}>{label}</div>
    {children}
  </div>
)

export function ReportModal({ onClose }: { onClose: () => void }) {
  const { galleryImages, volume, viewports, studyMeta } = useStore()

  // Notas vêm do banco quando há estudo do PACS; caso contrário, lista vazia
  const { data: notes = [] } = useQuery({
    queryKey: ['exam-notes', studyMeta?.studyId],
    queryFn:  () => examNotesApi.listByStudy(studyMeta!.studyId).then(r => r.data.data),
    enabled:  !!studyMeta?.studyId,
    staleTime: 30_000,
  })
  const [tab, setTab] = useState<Tab>('dados')

  const [doctor, setDoctor]   = useState('')
  const [crm, setCrm]         = useState('')
  const [inst, setInst]       = useState('')

  // Pré-preenchida do RIS (clinical_indication do appointment), mas editável
  const [indication, setIndication] = useState(studyMeta?.clinicalIndication ?? '')
  const [technique, setTechnique]   = useState('')
  const [findings, setFindings]     = useState('')
  const [impression, setImpression] = useState('')
  const [recs, setRecs]             = useState('')

  const [cidCodes, setCidCodes] = useState<{ code: string; description: string }[]>([])
  const [cidQuery, setCidQuery] = useState('')
  const { data: cidResults = [] } = useQuery({
    queryKey: ['cid10', cidQuery],
    queryFn:  () => reportsApi.cid10(cidQuery).then(r => (r.data as any).data),
    enabled:  cidQuery.trim().length >= 2,
    staleTime: 60_000,
  })
  const addCid = (c: { code: string; description: string }) => {
    setCidCodes(prev => prev.some(x => x.code === c.code) ? prev : [...prev, c])
    setCidQuery('')
  }
  const removeCid = (code: string) => setCidCodes(prev => prev.filter(c => c.code !== code))

  const [inclGallery, setInclGallery] = useState(true)
  const [inclAnns, setInclAnns]       = useState(true)
  const [inclCapture, setInclCapture] = useState(true)
  const [generating, setGenerating]   = useState(false)
  const [capturing, setCapturing]     = useState(false)

  const [sending, setSending]   = useState(false)
  const [sendResult, setSendResult] = useState<{ ok: boolean; id?: string; message?: string } | null>(null)
  const [alreadySigned, setAlreadySigned] = useState(false)

  // Auto-texto injeta o snippet no campo atualmente focado, rastreado via focusedField
  const indicationRef = useRef<MarkdownTextareaHandle>(null)
  const techniqueRef  = useRef<MarkdownTextareaHandle>(null)
  const findingsRef   = useRef<MarkdownTextareaHandle>(null)
  const impressionRef = useRef<MarkdownTextareaHandle>(null)
  const recsRef       = useRef<MarkdownTextareaHandle>(null)
  const fieldRefs: Record<string, React.RefObject<MarkdownTextareaHandle | null>> = {
    indication: indicationRef, technique: techniqueRef,
    findings:   findingsRef,   impression: impressionRef,
    recs:       recsRef,
  }
  const [focusedField, setFocusedField] = useState<keyof typeof fieldRefs>('findings')

  const [autoTextQuery, setAutoTextQuery] = useState('')
  const { data: autoTexts = [] } = useQuery({
    queryKey: ['report-auto-texts', autoTextQuery],
    queryFn:  () => reportsApi.autoTexts({ q: autoTextQuery || undefined }).then(r => (r.data as any).data),
    staleTime: 60_000,
  })
  const insertAutoText = (text: string) => {
    fieldRefs[focusedField]?.current?.insertAtCursor(text)
  }

  // Carrega laudo existente do estudo (se houver) pra editar em vez de criar duplicata
  useEffect(() => {
    if (!studyMeta?.studyId) return
    let cancelled = false
    reportsApi.getByStudy(studyMeta.studyId)
      .then(r => {
        if (cancelled) return
        const rep = (r.data as any).data?.report
        if (!rep) return
        setSendResult({ ok: true, id: rep.id, message: rep.status === 'signed' || rep.status === 'amended' ? 'Assinado' : undefined })
        setAlreadySigned(rep.status === 'signed' || rep.status === 'amended')

        // content_json guarda o snapshot completo do form; as colunas da tabela são só fallback
        const snap = (rep.content_json && typeof rep.content_json === 'object') ? rep.content_json : {}

        const findingsVal   = snap.findings   ?? rep.findings
        const impressionVal  = snap.impression ?? snap.conclusion ?? rep.conclusion
        const techniqueVal   = snap.technique  ?? rep.technique
        const recsVal        = snap.recs       ?? snap.recommendations ?? rep.recommendations
        const indicationVal  = snap.indication
        const doctorVal      = snap.doctor ?? rep.radiologist_name
        const crmVal         = snap.crm ?? (rep.crm ? `${rep.crm}${rep.crm_uf ? '/' + rep.crm_uf : ''}` : undefined)
        const instVal        = snap.inst
        const cidVal         = (Array.isArray(rep.cid10_codes) && rep.cid10_codes.length) ? rep.cid10_codes : (snap.cid10 || [])

        if (findingsVal)   setFindings(findingsVal)
        if (impressionVal) setImpression(impressionVal)
        if (techniqueVal)  setTechnique(techniqueVal)
        if (recsVal)       setRecs(recsVal)
        if (indicationVal) setIndication(indicationVal)
        if (doctorVal)     setDoctor(prev => prev || doctorVal)
        if (crmVal)        setCrm(prev => prev || crmVal)
        if (instVal)       setInst(prev => prev || instVal)
        if (cidVal?.length) setCidCodes(cidVal)
      })
      .catch(() => { /* sem laudo existente ainda — ok, será criado ao salvar */ })
    return () => { cancelled = true }
  }, [studyMeta?.studyId])

  const totalAnns = Object.values(viewports).reduce((a,v)=>a+(v.annotations?.length||0),0)
  const allNotes  = notes.map(n=>n.content).filter(t=>t.trim()).join('\n\n')

  const buildHtml = useCallback(async (captureScreenshots: boolean) => {
    const now     = new Date()
    const dateStr = now.toLocaleDateString('pt-BR',{year:'numeric',month:'long',day:'numeric'})
    const timeStr = now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})

    let captures: {label:string; src:string}[] = []
    if (captureScreenshots && inclCapture) {
      for (const [id, vp] of Object.entries(viewports)) {
        const src = captureViewport(id, vp)
        if (src) captures.push({ label: `${vp.plane.charAt(0).toUpperCase()+vp.plane.slice(1)} — Slice ${(vp.currentIndex||0)+1}`, src })
      }
    }

    const gallerySlice = inclGallery ? galleryImages.slice(0,8) : []

    const annRows = inclAnns ? Object.entries(viewports).flatMap(([,vp]) =>
      (vp.annotations||[]).map(a => ({
        plane: vp.plane,
        slice: a.sliceIndex+1,
        type: a.shape.type,
        color: a.color,
      }))
    ) : []

    const sectionHtml = (title: string, content: string) => content.trim() ? `
      <div class="sec"><div class="stitle">${title}</div><div class="box">${content.replace(/\n/g,'<br/>')}</div></div>` : ''

    const gridHtml = (imgs: {label:string;src:string}[], heading: string) => imgs.length ? `
      <div class="sec"><div class="stitle">${heading}</div>
      <div class="grid">${imgs.map(i=>`<div class="img-card"><img src="${i.src}" alt="${i.label}"/><div class="img-label">${i.label}</div></div>`).join('')}
      </div></div>` : ''

    const annTableHtml = annRows.length ? `
      <div class="sec"><div class="stitle">Medições e Anotações (${annRows.length})</div>
      <table><thead><tr><th>#</th><th>Plano</th><th>Corte</th><th>Tipo</th></tr></thead>
      <tbody>${annRows.map((r,i)=>`<tr><td>${i+1}</td><td style="color:${r.plane==='axial'?'#f72585':r.plane==='sagital'?'#4cc9f0':'#7bed9f'}">${r.plane}</td><td>${r.slice}</td><td>${r.type}</td></tr>`).join('')}
      </tbody></table></div>` : ''

    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
<title>Laudo — OrthoVis</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Times New Roman',serif;font-size:12pt;color:#1a1a1a;background:white;padding:40px;max-width:820px;margin:0 auto}
.hdr{border-bottom:3px solid #1a3a5c;padding-bottom:14px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end}
.hdr h1{font-size:18pt;font-weight:bold;color:#1a3a5c;letter-spacing:.03em}
.hdr .meta{font-size:9pt;color:#666;text-align:right;line-height:1.6}
.sec{margin-bottom:20px}
.stitle{font-size:9.5pt;font-weight:bold;color:#1a3a5c;text-transform:uppercase;letter-spacing:.12em;border-bottom:1.5px solid #c8d8e8;padding-bottom:4px;margin-bottom:10px}
.row{display:flex;gap:18px;margin-bottom:8px}
.field{flex:1}.field label{font-size:8.5pt;color:#888;display:block;margin-bottom:2px;text-transform:uppercase;letter-spacing:.06em}
.field span{font-size:11pt;font-family:'Times New Roman',serif}
.box{background:#f9fafb;border:1px solid #dde5ee;border-radius:5px;padding:12px 14px;font-size:11pt;line-height:1.75;white-space:pre-wrap;min-height:60px;color:#1a1a1a}
.box.empty{color:#aaa;font-style:italic}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:6px}
.img-card{border:1px solid #dde5ee;border-radius:5px;overflow:hidden;page-break-inside:avoid;background:#000}
.img-card img{width:100%;height:190px;object-fit:contain;background:#000;display:block}
.img-label{font-size:8pt;color:#666;padding:3px 8px;text-align:center;background:#f0f4f8;font-family:monospace}
table{width:100%;border-collapse:collapse;font-size:10pt}
th{background:#1a3a5c;color:white;padding:5px 8px;text-align:left;font-size:9pt;font-weight:600;letter-spacing:.05em}
td{padding:4px 8px;border-bottom:1px solid #eee}
tr:last-child td{border-bottom:none}
tr:nth-child(even){background:#f9fafb}
.footer{margin-top:40px;border-top:1.5px solid #c8d8e8;padding-top:16px;display:flex;justify-content:space-between;align-items:flex-end}
.sig-block{text-align:center}.sig-line{width:220px;border-bottom:1px solid #1a1a1a;margin:0 auto 6px;height:40px}
.sig-name{font-weight:bold;font-size:11pt}.sig-sub{font-size:9pt;color:#666}
.wm{font-size:8pt;color:#bbb;line-height:1.6}
@media print{body{padding:20px}.no-print{display:none!important}}
</style></head><body>

<div class="hdr">
  <div><h1>LAUDO RADIOLÓGICO</h1><div style="font-size:9pt;color:#888;margin-top:3px">OrthoVis DICOM Workstation v4.0</div></div>
  <div class="meta">${dateStr}<br/>${timeStr}<br/>${volume?.studyDate?`Exame: ${volume.studyDate}`:''}</div>
</div>

<div class="sec"><div class="stitle">Dados do Paciente</div>
<div class="row">
  <div class="field"><label>Nome</label><span>${studyMeta?.patientName || volume?.patientName || '—'}</span></div>
  <div class="field"><label>Prontuário</label><span>${studyMeta?.medicalRecordNumber || '—'}</span></div>
  <div class="field"><label>Data de Nascimento</label><span>${studyMeta?.birthDate || '—'}</span></div>
  <div class="field"><label>Sexo</label><span>${studyMeta?.gender === 'M' ? 'Masculino' : studyMeta?.gender === 'F' ? 'Feminino' : (studyMeta?.gender || '—')}</span></div>
</div></div>

<div class="sec"><div class="stitle">Dados do Exame</div>
<div class="row">
  <div class="field"><label>Procedimento</label><span>${studyMeta?.procedureName || '—'}</span></div>
  <div class="field"><label>Modalidade</label><span>${volume?.modality||'—'}</span></div>
  <div class="field"><label>Data do Exame</label><span>${volume?.studyDate||'—'}</span></div>
  <div class="field"><label>Acesso</label><span>${studyMeta?.accessionNumber || '—'}</span></div>
</div>
${volume?`<div class="row">
  <div class="field"><label>Série</label><span>${volume.seriesDescription||'—'}</span></div>
  <div class="field"><label>Dimensões</label><span>${volume.width}×${volume.height}×${volume.depth} px</span></div>
  <div class="field"><label>Espaçamento</label><span>${volume.spacingX.toFixed(2)}×${volume.spacingY.toFixed(2)}×${volume.spacingZ.toFixed(2)} mm</span></div>
</div>`:''}</div>

${studyMeta?.requestingPhysician ? `
<div class="sec"><div class="stitle">Médico Solicitante</div>
<div class="row">
  <div class="field"><label>Nome</label><span>${studyMeta.requestingPhysician.name}</span></div>
  <div class="field"><label>CRM</label><span>${studyMeta.requestingPhysician.crm || '—'}</span></div>
  <div class="field"><label>Especialidade</label><span>${studyMeta.requestingPhysician.specialty || '—'}</span></div>
</div></div>` : ''}

<div class="sec"><div class="stitle">Médico Responsável (Radiologista)</div>
<div class="row">
  <div class="field"><label>Nome</label><span>${doctor||'________________________________'}</span></div>
  <div class="field"><label>CRM</label><span>${crm||'________________'}</span></div>
  <div class="field"><label>Instituição</label><span>${inst||'________________________________'}</span></div>
</div></div>

${sectionHtml('Indicação Clínica', indication)}
${sectionHtml('Técnica', technique)}
${sectionHtml('Achados', findings||(allNotes?`(Notas do estudo)\n${allNotes}`:''))}
${sectionHtml('Impressão Diagnóstica', impression)}
${sectionHtml('Conduta / Recomendações', recs)}
${annTableHtml}
${gridHtml(captures, 'Capturas do Estudo')}
${gridHtml(gallerySlice.map(g=>({label:g.label,src:g.dataUrl})), 'Galeria de Imagens')}

<div class="footer">
  <div class="wm">OrthoVis DICOM Workstation v4.0<br/>Gerado em ${dateStr} às ${timeStr}<br/>Este documento é de uso exclusivo do profissional de saúde</div>
  <div class="sig-block">
    <div class="sig-line"></div>
    <div class="sig-name">${doctor||'Médico Responsável'}</div>
    <div class="sig-sub">${crm?`CRM: ${crm}`:''}${inst?` · ${inst}`:''}</div>
  </div>
</div>

</body></html>`
  }, [notes, galleryImages, viewports, volume, studyMeta, indication, technique, findings, impression, recs, inclGallery, inclAnns, inclCapture, doctor, crm, inst])

  // Espelha a validação server-side pra mostrar os erros antes do usuário tentar assinar
  const validationErrors = useMemo(() => {
    const errs: { field: string; message: string }[] = []
    if (!findings.trim())       errs.push({ field: 'findings',    message: 'Achados é obrigatório' })
    if (!impression.trim())     errs.push({ field: 'impression',  message: 'Impressão diagnóstica é obrigatória' })
    if (!doctor.trim())         errs.push({ field: 'doctor',      message: 'Nome do radiologista é obrigatório' })
    if (!/^\d{3,6}/.test(crm.trim())) errs.push({ field: 'crm',  message: 'CRM válido é obrigatório (3-6 dígitos)' })
    return errs
  }, [findings, impression, doctor, crm])
  const canSign = validationErrors.length === 0

  // Upsert idempotente do laudo: id em memória → busca existente → cria; se o create colidir
  // (409, corrida com o useEffect ou outra aba), recupera o existente em vez de propagar o erro
  const ensureReportId = useCallback(async (): Promise<{ id: string; signed: boolean }> => {
    if (sendResult?.id) return { id: sendResult.id, signed: alreadySigned || !!sendResult.message?.includes('Assinad') }
    if (!studyMeta?.studyId) throw new Error('Estudo não identificado. Abra o viewer pelo RIS/PACS.')

    try {
      const ex = await reportsApi.getByStudy(studyMeta.studyId)
      const rep = (ex.data as any).data?.report
      if (rep?.id) {
        const signed = rep.status === 'signed' || rep.status === 'amended'
        setSendResult({ ok: true, id: rep.id, message: signed ? 'Assinado' : undefined })
        if (signed) setAlreadySigned(true)
        return { id: rep.id, signed }
      }
    } catch { /* sem laudo / erro transitório → tenta criar */ }

    try {
      const res = await reportsApi.create({ study_id: studyMeta.studyId } as any)
      const id = (res.data as any).data?.id
      setSendResult({ ok: true, id })
      return { id, signed: false }
    } catch (e: any) {
      if (e.response?.status === 409) {
        const ex = await reportsApi.getByStudy(studyMeta.studyId)
        const rep = (ex.data as any).data?.report
        if (rep?.id) {
          const signed = rep.status === 'signed' || rep.status === 'amended'
          setSendResult({ ok: true, id: rep.id, message: signed ? 'Assinado' : undefined })
          if (signed) setAlreadySigned(true)
          return { id: rep.id, signed }
        }
      }
      throw e
    }
  }, [sendResult, studyMeta, alreadySigned])

  // Persiste snapshot completo em content_json (inclusive campos sem coluna própria,
  // como CRM/instituição/indicação) pra reabrir o laudo exatamente de onde parou
  const persistDraft = useCallback(async (): Promise<string> => {
    const { id, signed } = await ensureReportId()
    if (signed) return id   // laudo assinado é imutável — nunca faz PATCH (evita 422/"erro de servidor")
    const html = await buildHtml(false)
    await reportsApi.update(id, {
      technique:       technique || undefined,
      findings:        findings || undefined,
      conclusion:      impression || undefined,
      recommendations: recs || undefined,
      report_simple:   impression || findings || undefined,
      content_html:    html,
      content_json:    { doctor, crm, inst, indication, technique, findings, impression, recs, cid10: cidCodes },
    } as any)
    return id
  }, [ensureReportId, alreadySigned, buildHtml, technique, findings, impression, recs, doctor, crm, inst, indication, cidCodes])

  // Não envia HTML: salva via persistDraft e deixa o servidor renderizar o PDF canônico,
  // idêntico ao que será assinado — evita divergência entre preview e documento final
  const generateReport = useCallback(async () => {
    if (!studyMeta?.studyId) { toast.error('Crie ou abra um laudo no RIS antes de renderizar o PDF'); return }
    setGenerating(true)
    try {
      const reportId = await persistDraft()
      const blob = (await reportsApi.renderPdf(reportId)).data as unknown as Blob
      const url  = URL.createObjectURL(blob)
      const win  = window.open(url, '_blank')
      if (!win) toast.info('PDF gerado. Permita popups para abrir automaticamente.')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      const msg = e.response?.data?.message ?? e.message ?? 'Falha ao renderizar PDF'
      toast.error(msg)
    } finally { setGenerating(false) }
  }, [studyMeta, persistDraft])

  const exportComplete = useCallback(async () => {
    if (!studyMeta?.studyId) { toast.error('Disponível apenas para estudos do PACS'); return }
    setCapturing(true)
    try {
      const reportId = await persistDraft()
      const html     = await buildHtml(true)
      const blob = (await reportsApi.renderPdf(reportId, html)).data as unknown as Blob
      const url  = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      const msg = e.response?.data?.message ?? e.message ?? 'Falha ao gerar laudo completo'
      toast.error(msg)
    } finally { setCapturing(false) }
  }, [buildHtml, studyMeta, persistDraft])

  const sendToServer = useCallback(async () => {
    if (!studyMeta?.studyId) {
      setSendResult({ ok: false, message: 'Estudo não identificado. Abra o viewer pelo RIS/PACS.' })
      return
    }
    if (alreadySigned) {
      setSendResult({ ok: false, message: 'Laudo já assinado. Use "Adendo" na página de Laudos do RIS para alterações.' })
      return
    }
    setSending(true)
    try {
      const reportId = await persistDraft()
      setSendResult({ ok: true, id: reportId })
      toast.success('Rascunho salvo')
    } catch (e: any) {
      const msg = e.response?.data?.message ?? e.message ?? 'Erro de conexão com o servidor'
      setSendResult({ ok: false, message: msg })
      toast.error(msg)
    } finally {
      setSending(false)
    }
  }, [studyMeta, alreadySigned, persistDraft])

  // Assinatura definitiva: trilha criptográfica conforme CFM 1.821 (parcial — sem
  // ICP-Brasil A1/A3, que exigiria certificado físico); laudo assinado vira imutável
  const signReport = useCallback(async () => {
    if (!sendResult?.id) { toast.error('Salve o rascunho antes de assinar'); return }
    if (!canSign) {
      toast.error(`Campos obrigatórios: ${validationErrors.map(e => e.message).join('; ')}`)
      return
    }
    setSending(true)
    try {
      const html = await buildHtml(false)
      await reportsApi.sign(sendResult.id, {
        content_html:       html,
        findings:           findings.trim(),
        conclusion:         impression.trim(),
        technique:          technique.trim() || undefined,
        recommendations:    recs.trim()      || undefined,
        doctor_name:        doctor.trim(),
        doctor_crm:         crm.trim(),
        doctor_institution: inst.trim()      || undefined,
        cid10_codes:        cidCodes,
      })
      toast.success('Laudo assinado e enviado ao RIS/PACS')
      setSendResult({ ok: true, id: sendResult.id, message: 'Assinado' })
    } catch (e: any) {
      const msg = e.response?.data?.message ?? e.message ?? 'Falha ao assinar laudo'
      toast.error(msg)
    } finally { setSending(false) }
  }, [sendResult, buildHtml, canSign, validationErrors, findings, impression, technique, recs, doctor, crm, inst, cidCodes])

  const saveSession = () => {
    const s = {
      savedAt: new Date().toISOString(),
      volume: volume ? { modality:volume.modality, patientName:volume.patientName } : null,
      report: { doctor, crm, inst, indication, technique, findings, impression, recs },
      notes: notes.map(n=>n.content).filter(t=>t.trim()),
    }
    const b = new Blob([JSON.stringify(s,null,2)],{type:'application/json'})
    const a = document.createElement('a'); a.href=URL.createObjectURL(b); a.download='orthovis-sessao.json'; a.click()
  }

  const TAB_STYLE = (active: boolean) => ({
    flex:1, padding:'7px 4px', background:active?'var(--bg-elevated)':'transparent',
    borderBottom:active?'2px solid var(--purple)':'2px solid transparent',
    color:active?'var(--text-p)':'var(--text-m)', fontSize:11, fontWeight:active?600:400,
    cursor:'pointer', transition:'all .14s',
  } as React.CSSProperties)

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.88)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:680, maxWidth:'100%', maxHeight:'92vh', background:'var(--bg-elevated)', border:'1px solid var(--border-b)', borderRadius:'var(--r-xl)', boxShadow:'var(--shadow-m)', display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 18px', borderBottom:'1px solid var(--border-s)', background:'var(--bg-panel)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:30, height:30, borderRadius:'var(--r-md)', background:'rgba(139,92,246,0.13)', border:'1px solid rgba(139,92,246,0.3)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--purple)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
            <div>
              <div style={{ fontFamily:'var(--font-d)', fontSize:13, fontWeight:700 }}>Laudo Radiológico</div>
              <div style={{ fontSize:10, color:'var(--text-m)' }}>Relatório médico completo com capturas</div>
            </div>
          </div>
          <button onClick={onClose} style={{ color:'var(--text-m)', fontSize:16, lineHeight:1 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border-s)', background:'var(--bg-panel)', flexShrink:0 }}>
          {([['dados','Paciente & Médico'],['achados','Achados Clínicos'],['exportar','Exportar']] as [Tab,string][]).map(([t,l])=>(
            <button key={t} onClick={()=>setTab(t)} style={TAB_STYLE(tab===t)}>{l}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex:1, overflowY:'auto', padding:'14px 18px', display:'flex', flexDirection:'column', gap:12 }}>

          {/* ── Tab: Dados ── */}
          {tab==='dados'&&<>
            {/* Paciente — pré-preenchido do PACS quando disponível */}
            {studyMeta ? (
              <div style={{ background:'var(--cyan-d)', borderRadius:'var(--r-md)', padding:'10px 14px', border:'1px solid rgba(0,184,217,0.25)' }}>
                <div style={{ fontSize:9, color:'var(--cyan)', textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:700, marginBottom:8 }}>
                  Paciente · do PACS
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:10 }}>
                  {[
                    ['Nome',         studyMeta.patientName || '—'],
                    ['Prontuário',   studyMeta.medicalRecordNumber || '—'],
                    ['Nascimento',   studyMeta.birthDate || '—'],
                    ['Sexo',         studyMeta.gender === 'M' ? 'Masculino' : studyMeta.gender === 'F' ? 'Feminino' : (studyMeta.gender || '—')],
                    ['Procedimento', studyMeta.procedureName || '—'],
                    ['Acesso',       studyMeta.accessionNumber || '—'],
                  ].map(([k,v])=>(
                    <div key={k}>
                      <div style={{ fontSize:9, color:'var(--text-m)', textTransform:'uppercase', letterSpacing:'0.06em' }}>{k}</div>
                      <div style={{ fontSize:11.5, color:'var(--text-p)', fontWeight:600, marginTop:2 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : volume && (
              <div style={{ background:'var(--bg-elevated)', borderRadius:'var(--r-md)', padding:'8px 12px', border:'1px solid var(--border-d)', display:'flex', gap:16, flexWrap:'wrap' }}>
                {[['Paciente',volume.patientName||'—'],['Modalidade',volume.modality],['Dimensões',`${volume.width}×${volume.height}×${volume.depth}`]].map(([k,v])=>(
                  <div key={k}><div style={{ fontSize:9, color:'var(--text-m)', textTransform:'uppercase', letterSpacing:'0.08em' }}>{k}</div><div style={{ fontSize:11, color:'var(--text-p)', fontWeight:600 }}>{v}</div></div>
                ))}
              </div>
            )}

            {/* Médico Solicitante — autopreenchido (read-only) quando vem do PACS */}
            {studyMeta?.requestingPhysician ? (
              <Field label="Médico Solicitante · do PACS">
                <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1.5fr', gap:8 }}>
                  <input
                    value={studyMeta.requestingPhysician.name}
                    readOnly
                    style={{ padding:'6px 8px', fontSize:12, borderRadius:'var(--r-sm)', opacity:0.85, cursor:'not-allowed' }}
                  />
                  <input
                    value={studyMeta.requestingPhysician.crm ?? '—'}
                    readOnly
                    style={{ padding:'6px 8px', fontSize:12, borderRadius:'var(--r-sm)', opacity:0.85, cursor:'not-allowed' }}
                  />
                  <input
                    value={studyMeta.requestingPhysician.specialty ?? '—'}
                    readOnly
                    style={{ padding:'6px 8px', fontSize:12, borderRadius:'var(--r-sm)', opacity:0.85, cursor:'not-allowed' }}
                  />
                </div>
              </Field>
            ) : null}

            {/* Médico Responsável — o radiologista que está laudando, sempre editável */}
            <Field label="Médico Responsável (Radiologista)">
              <div style={{ display:'flex', gap:8, marginBottom:6 }}>
                <input value={doctor} onChange={e=>setDoctor(e.target.value)} placeholder="Nome completo" style={{ flex:2, padding:'6px 8px', fontSize:12, borderRadius:'var(--r-sm)' }}/>
                <input value={crm} onChange={e=>setCrm(e.target.value)} placeholder="CRM" style={{ flex:1, padding:'6px 8px', fontSize:12, borderRadius:'var(--r-sm)' }}/>
              </div>
              <input value={inst} onChange={e=>setInst(e.target.value)} placeholder="Instituição / Hospital" style={{ width:'100%', padding:'6px 8px', fontSize:12, borderRadius:'var(--r-sm)' }}/>
            </Field>
          </>}

          {/* ── Tab: Achados ── */}
          {tab==='achados'&&<>
            {/* Picker de auto-textos — insere snippet no campo atualmente focado */}
            {autoTexts.length > 0 || autoTextQuery ? (
              <div style={{ background:'var(--bg-panel)', border:'1px solid var(--border-d)', borderRadius:'var(--r-md)', padding:'8px 10px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                  <span style={{ fontSize:10, color:'var(--text-m)', textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600 }}>
                    Auto-textos · destino: <span style={{ color:'var(--purple)' }}>{focusedField}</span>
                  </span>
                  <input
                    type="text"
                    value={autoTextQuery}
                    onChange={e => setAutoTextQuery(e.target.value)}
                    placeholder="Buscar atalho ou título…"
                    style={{ flex:1, fontSize:11, padding:'4px 8px', borderRadius:'var(--r-sm)',
                             background:'var(--bg-overlay)', border:'1px solid var(--border-s)',
                             color:'var(--text-p)', outline:'none' }}
                  />
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                  {autoTexts.slice(0, 16).map((at: any) => (
                    <button
                      key={at.id}
                      type="button"
                      title={at.title}
                      onClick={() => insertAutoText(at.content)}
                      style={{ fontSize:10, padding:'3px 8px', borderRadius:'var(--r-xs)',
                               background:'var(--bg-overlay)', border:'1px solid var(--border-s)',
                               color:'var(--text-s)', cursor:'pointer' }}
                    >
                      {at.shortcut || at.title}
                    </button>
                  ))}
                  {autoTexts.length === 0 && (
                    <span style={{ fontSize:10, color:'var(--text-d)' }}>Nenhum atalho encontrado.</span>
                  )}
                </div>
              </div>
            ) : null}

            <Field label="Indicação Clínica">
              <MarkdownTextarea ref={indicationRef} value={indication} onChange={setIndication}
                placeholder="Motivo do exame, hipótese diagnóstica..." rows={2}
                onFocus={() => setFocusedField('indication')}/>
            </Field>
            <Field label="Técnica">
              <MarkdownTextarea ref={techniqueRef} value={technique} onChange={setTechnique}
                placeholder="Protocolo utilizado, contraste, parâmetros..." rows={2}
                onFocus={() => setFocusedField('technique')}/>
            </Field>
            <Field label={`Achados (${notes.filter(n=>n.content.trim()).length} nota(s) do estudo detectada(s))`}>
              <MarkdownTextarea ref={findingsRef} value={findings} onChange={setFindings}
                placeholder={allNotes || 'Descrição detalhada das imagens, estruturas avaliadas...'}
                rows={5}
                onFocus={() => setFocusedField('findings')}/>
            </Field>
            <Field label="Impressão Diagnóstica">
              <MarkdownTextarea ref={impressionRef} value={impression} onChange={setImpression}
                placeholder="Conclusão, diagnóstico principal..." rows={3}
                onFocus={() => setFocusedField('impression')}/>
            </Field>
            <Field label="Conduta / Recomendações">
              <MarkdownTextarea ref={recsRef} value={recs} onChange={setRecs}
                placeholder="Tratamento sugerido, exames complementares, seguimento..." rows={2}
                onFocus={() => setFocusedField('recs')}/>
            </Field>

            {/* Diagnóstico estruturado — CID-10 */}
            <Field label="Diagnóstico (CID-10)">
              <div style={{ position:'relative' }}>
                <input
                  value={cidQuery}
                  onChange={e => setCidQuery(e.target.value)}
                  placeholder="Buscar por código (ex.: J18) ou descrição (ex.: pneumonia)…"
                  style={{ width:'100%', padding:'6px 9px', fontSize:12, borderRadius:'var(--r-md)',
                           background:'var(--bg-overlay)', border:'1px solid var(--border-d)', color:'var(--text-p)', outline:'none' }}
                />
                {cidQuery.trim().length >= 2 && cidResults.length > 0 && (
                  <div style={{ position:'absolute', zIndex:20, top:'100%', left:0, right:0, marginTop:4, maxHeight:180,
                                overflowY:'auto', background:'var(--bg-elevated)', border:'1px solid var(--border-b)',
                                borderRadius:'var(--r-md)', boxShadow:'var(--shadow-m)' }}>
                    {cidResults.map((c: any) => (
                      <button key={c.code} type="button" onClick={() => addCid({ code: c.code, description: c.description })}
                        style={{ display:'block', width:'100%', textAlign:'left', padding:'6px 10px', fontSize:11,
                                 background:'transparent', border:'none', borderBottom:'1px solid var(--border-s)',
                                 color:'var(--text-s)', cursor:'pointer' }}>
                        <strong style={{ color:'var(--purple)' }}>{c.code}</strong> — {c.description}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {cidCodes.length > 0 && (
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
                  {cidCodes.map(c => (
                    <span key={c.code} title={c.description}
                      style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'3px 6px 3px 9px',
                               fontSize:11, borderRadius:'var(--r-sm)', background:'rgba(139,92,246,0.13)',
                               border:'1px solid rgba(139,92,246,0.3)', color:'var(--purple)' }}>
                      <strong>{c.code}</strong>
                      <button type="button" onClick={() => removeCid(c.code)}
                        style={{ background:'none', border:'none', color:'var(--purple)', cursor:'pointer', fontSize:13, lineHeight:1 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </Field>
          </>}

          {/* ── Tab: Exportar ── */}
          {tab==='exportar'&&<>
            <div style={{ background:'var(--bg-panel)', borderRadius:'var(--r-md)', padding:12, border:'1px solid var(--border-d)' }}>
              <div style={{ fontSize:10, color:'var(--text-s)', marginBottom:10, fontWeight:600 }}>O que incluir no PDF</div>
              <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                {[
                  {v:inclCapture, set:setInclCapture, l:`Capturas dos viewports ativos (${Object.keys(viewports).length} janelas)`, note:'Screenshot em tempo real com anotações'},
                  {v:inclGallery, set:setInclGallery, l:`Galeria de imagens (${galleryImages.length})`, note:'Imagens exportadas e salvas manualmente'},
                  {v:inclAnns,    set:setInclAnns,    l:`Tabela de anotações (${totalAnns})`, note:'Lista detalhada de medições por plano e corte'},
                ].map(({v,set,l,note})=>(
                  <label key={l} style={{ display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer' }}>
                    <input type="checkbox" checked={v} onChange={e=>set(e.target.checked)} style={{ accentColor:'var(--purple)', width:13, height:13, marginTop:2 }}/>
                    <div>
                      <div style={{ fontSize:12, color:'var(--text-s)' }}>{l}</div>
                      <div style={{ fontSize:10, color:'var(--text-m)' }}>{note}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Exportar Completo card */}
            <div style={{ borderRadius:'var(--r-lg)', border:'1px solid rgba(139,92,246,0.35)', background:'rgba(139,92,246,0.07)', padding:'14px 16px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <div style={{ width:28, height:28, borderRadius:'var(--r-md)', background:'rgba(139,92,246,0.2)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--purple)' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
                <div style={{ fontFamily:'var(--font-d)', fontSize:13, fontWeight:700, color:'var(--purple)' }}>Exportar Completo</div>
              </div>
              <div style={{ fontSize:11, color:'var(--text-s)', lineHeight:1.6, marginBottom:12 }}>
                Gera um único PDF com o laudo médico completo + capturas em tempo real de todos os viewports com suas anotações + galeria + tabela de medições. Ideal para entrega ao paciente ou arquivamento clínico.
              </div>
              <button onClick={exportComplete} disabled={capturing} style={{ width:'100%', padding:'9px 18px', borderRadius:'var(--r-md)', fontSize:12, fontWeight:700, background:capturing?'var(--bg-overlay)':'var(--purple)', border:`1px solid ${capturing?'var(--border-d)':'var(--purple)'}`, color:capturing?'var(--text-m)':'#fff', cursor:capturing?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                {capturing
                  ? <><div style={{ width:13, height:13, border:'2px solid rgba(255,255,255,0.2)', borderTopColor:'#fff', borderRadius:'50%', animation:'ov-spin 0.7s linear infinite' }}/> Capturando viewports…</>
                  : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Exportar Estudo Completo (PDF)</>
                }
              </button>
            </div>

            {/* ── Assinar e Enviar ao RIS/PACS ─────────────────────────── */}
            {studyMeta && (
              <div style={{ borderRadius:'var(--r-lg)', border:'1px solid rgba(0,184,217,0.35)', background:'rgba(0,184,217,0.06)', padding:'14px 16px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <div style={{ width:28, height:28, borderRadius:'var(--r-md)', background:'rgba(0,184,217,0.18)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--cyan)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 12l2 2 4-4"/><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  </div>
                  <div style={{ fontFamily:'var(--font-d)', fontSize:13, fontWeight:700, color:'var(--cyan)' }}>Enviar ao RIS/PACS</div>
                </div>
                <div style={{ fontSize:10, color:'var(--text-m)', lineHeight:1.6, marginBottom:10 }}>
                  Salva o laudo no servidor para assinatura digital pelo radiologista.
                  Paciente: <strong style={{ color:'var(--text-s)' }}>{studyMeta.patientName || '—'}</strong>
                </div>

                {sendResult && (
                  <div style={{ marginBottom:10, padding:'8px 10px', borderRadius:'var(--r-sm)',
                    background: sendResult.ok ? 'rgba(6,214,160,0.1)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${sendResult.ok ? 'rgba(6,214,160,0.4)' : 'rgba(239,68,68,0.4)'}`,
                    fontSize:11, color: sendResult.ok ? 'var(--green)' : '#f87171', lineHeight:1.5 }}>
                    {sendResult.ok
                      ? `✓ Laudo salvo com sucesso! ID: ${sendResult.id?.slice(0,8)}…`
                      : `✗ ${sendResult.message}`
                    }
                  </div>
                )}

                {/* Lista de erros de validação (espelha o que o server vai exigir pra assinar) */}
                {validationErrors.length > 0 && (
                  <div style={{
                    padding: '8px 12px', borderRadius: 'var(--r-md)',
                    background: 'var(--amber-d)', border: '1px solid var(--amber)',
                    fontSize: 11, color: 'var(--amber)', lineHeight: 1.55,
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Antes de assinar, preencha:</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {validationErrors.map(e => <li key={e.field}>{e.message}</li>)}
                    </ul>
                  </div>
                )}

                {/* Laudo já assinado → bloqueia edição/criação (somente leitura) */}
                {alreadySigned && (
                  <div style={{ marginBottom:10, padding:'8px 10px', borderRadius:'var(--r-sm)',
                    background:'rgba(245,158,11,0.12)', border:'1px solid rgba(245,158,11,0.4)',
                    fontSize:11, color:'var(--amber)', lineHeight:1.5 }}>
                    ⚠ Laudo já assinado — somente leitura. Alterações apenas por <strong>Adendo</strong> na página de Laudos do RIS.
                  </div>
                )}
                {/* Dois botões: Salvar rascunho + Assinar definitivamente */}
                <div style={{ display:'flex', gap:8 }}>
                  <button
                    onClick={sendToServer}
                    disabled={sending || alreadySigned}
                    style={{ flex:1, padding:'9px 14px', borderRadius:'var(--r-md)', fontSize:12, fontWeight:600,
                      background: (sending || alreadySigned) ? 'var(--bg-overlay)' : 'var(--bg-elevated)',
                      border:`1px solid ${(sending || alreadySigned) ? 'var(--border-d)' : 'var(--border-b)'}`,
                      color: (sending || alreadySigned) ? 'var(--text-m)' : 'var(--text-p)',
                      cursor: (sending || alreadySigned) ? 'not-allowed' : 'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}
                  >
                    {alreadySigned ? 'Laudo assinado' : (sending && !sendResult?.message?.includes('Assinad') ? 'Salvando…' : sendResult?.id && !sendResult?.message?.includes('Assinad') ? '✓ Rascunho salvo' : 'Salvar rascunho')}
                  </button>
                  <button
                    onClick={signReport}
                    disabled={sending || !canSign || !sendResult?.id || sendResult?.message?.includes('Assinad')}
                    title={!canSign ? 'Preencha os campos obrigatórios primeiro' : (!sendResult?.id ? 'Salve o rascunho antes de assinar' : '')}
                    style={{ flex:1.4, padding:'9px 14px', borderRadius:'var(--r-md)', fontSize:12, fontWeight:700,
                      background: (sending || !canSign || !sendResult?.id) ? 'var(--bg-overlay)' : 'rgba(0,184,217,0.85)',
                      border:`1px solid ${(sending || !canSign || !sendResult?.id) ? 'var(--border-d)' : 'var(--cyan)'}`,
                      color: (sending || !canSign || !sendResult?.id) ? 'var(--text-m)' : '#000',
                      cursor: (sending || !canSign || !sendResult?.id) ? 'not-allowed' : 'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}
                  >
                    {sendResult?.message?.includes('Assinad')
                      ? '✓ Assinado'
                      : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 12l2 2 4-4"/><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Assinar definitivamente</>
                    }
                  </button>
                </div>
              </div>
            )}

            <div style={{ borderRadius:'var(--r-md)', border:'1px solid var(--border-d)', background:'var(--bg-panel)', padding:'12px 14px' }}>
              <div style={{ fontSize:11, color:'var(--text-s)', fontWeight:600, marginBottom:6 }}>Apenas o laudo (sem capturas)</div>
              <div style={{ fontSize:10, color:'var(--text-m)', marginBottom:10 }}>Gera apenas o relatório médico, sem screenshots dos viewports.</div>
              <button onClick={generateReport} disabled={generating} style={{ width:'100%', padding:'7px 18px', borderRadius:'var(--r-md)', fontSize:12, fontWeight:600, background:generating?'var(--bg-overlay)':'var(--cyan-d)', border:`1px solid ${generating?'var(--border-d)':'var(--cyan)'}`, color:generating?'var(--text-m)':'var(--cyan)', cursor:generating?'not-allowed':'pointer' }}>
                {generating ? 'Gerando…' : (alreadySigned ? 'Baixar PDF do laudo assinado' : 'Gerar PDF do Laudo')}
              </button>
            </div>
          </>}

        </div>

        {/* Footer */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderTop:'1px solid var(--border-s)', background:'var(--bg-panel)', flexShrink:0 }}>
          <button onClick={saveSession} style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:'var(--r-md)', fontSize:11, background:'var(--bg-overlay)', border:'1px solid var(--border-d)', color:'var(--text-s)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v14a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Salvar Sessão JSON
          </button>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onClose} style={{ padding:'6px 14px', borderRadius:'var(--r-md)', fontSize:12, background:'var(--bg-overlay)', border:'1px solid var(--border-d)', color:'var(--text-s)' }}>Fechar</button>
            {tab !== 'exportar' && (
              <button onClick={()=>setTab(tab==='dados'?'achados':'exportar')} style={{ padding:'6px 16px', borderRadius:'var(--r-md)', fontSize:12, fontWeight:600, background:'var(--purple)', border:'none', color:'#fff' }}>
                {tab==='dados'?'Achados →':'Exportar →'}
              </button>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes ov-spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
