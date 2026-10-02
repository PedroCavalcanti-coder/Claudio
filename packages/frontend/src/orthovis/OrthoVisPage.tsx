/**
 * OrthoVisPage — wrapper React Router para o viewer OrthoVis embarcado.
 *
 * Substitui o fluxo antigo (iframe + window.open com ?studyUID=&token= na URL).
 * O studyUID vem de useParams; o token vem de sessionStorage. Sem URL externa.
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from './store'
import { ViewerApp } from './components/ViewerApp'
import { loadFiles } from './utils/loader'
import { reportsApi } from '../api/endpoints'
import './orthovis.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1'

// Acima deste nº de instâncias, o viewer (volume inteiro em RAM) pode travar a
// aba. Pedimos confirmação explícita antes de baixar/decodificar.
const LARGE_STUDY_LIMIT = 1500

export default function OrthoVisPage() {
  const { studyUID } = useParams<{ studyUID: string }>()
  const navigate = useNavigate()

  const {
    volume, setVolume, setIsLoading, setLoadingProgress, setStudyMeta,
    setActiveTool, activeViewportId, undoAnnotation, redoAnnotation,
    cineActive, setCineActive, clearAll, setReportLocked, reportLocked,
  } = useStore()

  const [phase, setPhase]     = useState('Conectando ao servidor…')
  const [progress, setLocal]  = useState(0)
  const [error, setError]     = useState<string | null>(null)
  const [largePrompt, setLargePrompt] = useState<{ count: number } | null>(null)
  const [confirmedLarge, setConfirmedLarge] = useState(false)

  useEffect(() => {
    if (!studyUID) return
    const token = sessionStorage.getItem('access_token') ?? ''
    if (!token) {
      setError('Sessão expirada. Faça login novamente.')
      return
    }

    // ReportModal lê de ov_token — mantém compatibilidade
    sessionStorage.setItem('ov_token', token)

    let cancelled = false

    ;(async () => {
      setIsLoading(true, 'Conectando ao servidor…')
      setError(null)

      try {
        const listRes = await fetch(
          `${API_BASE}/studies/dicom/${encodeURIComponent(studyUID)}/instances`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (!listRes.ok) {
          const body = await listRes.json().catch(() => ({}))
          throw new Error(body.message ?? `Servidor retornou HTTP ${listRes.status}`)
        }
        const { data } = await listRes.json()
        const { study, instances } = data
        if (cancelled) return

        setStudyMeta({
          studyId:              study.id,
          studyUid:             study.study_instance_uid,
          accessionNumber:      study.accession_number ?? null,
          patientName:          study.patient_name ?? '',
          birthDate:            study.birth_date ?? null,
          gender:               study.gender ?? null,
          medicalRecordNumber:  study.medical_record_number ?? null,
          procedureName:        study.procedure_name ?? null,
          clinicalIndication:   study.clinical_indication ?? null,
          requestingPhysician:  study.requesting_physician ?? null,
        })

        // Laudo assinado/aditado → viewer somente-leitura (oculta medição/anotação).
        reportsApi.getByStudy(study.id)
          .then(r => {
            const rep = (r.data as any)?.data
            const locked = !!rep && (rep.status === 'signed' || rep.status === 'amended')
            if (!cancelled) {
              setReportLocked(locked)
              // Garante ferramenta de navegação ativa (sem anotação herdada de outro estudo).
              if (locked) setActiveTool('windowing')
            }
          })
          .catch(() => { if (!cancelled) setReportLocked(false) })

        if (!instances?.length) {
          throw new Error('Este estudo não possui instâncias DICOM.')
        }

        if (instances.length > LARGE_STUDY_LIMIT && !confirmedLarge) {
          setLargePrompt({ count: instances.length })
          setIsLoading(false)
          return
        }
        setLargePrompt(null)

        const CONCURRENCY = 8
        const fileArr: File[] = new Array(instances.length).fill(null)
        let done = 0

        setPhase(`Baixando ${instances.length} imagem${instances.length > 1 ? 'ns' : ''}…`)
        setLoadingProgress(5)
        setLocal(5)

        for (let i = 0; i < instances.length; i += CONCURRENCY) {
          if (cancelled) return
          const chunk = instances.slice(i, i + CONCURRENCY)
          await Promise.all(chunk.map(async (inst: any, ci: number) => {
            const idx  = i + ci
            const resp = await fetch(
              `${API_BASE}/studies/${study.id}/instances/${inst.id}/stream`,
              { headers: { Authorization: `Bearer ${token}` } },
            )
            if (!resp.ok) {
              const msg =
                resp.status === 404 || resp.status === 502
                  ? `Imagem #${idx + 1} indisponível no servidor PACS — pode ter sido removida ou está em sincronização. Reenvie o estudo se persistir.`
                  : `Falha ao baixar instância #${idx + 1} (HTTP ${resp.status})`;
              throw new Error(msg);
            }
            const buf = await resp.arrayBuffer()
            fileArr[idx] = new File(
              [buf],
              `${inst.sop_instance_uid ?? `inst_${idx}`}.dcm`,
              { type: 'application/dicom' },
            )
            done++
            if (!cancelled) {
              const pct = 5 + Math.round((done / instances.length) * 55)
              setLocal(pct)
              setLoadingProgress(pct)
              setPhase(`Baixando ${done}/${instances.length}…`)
            }
          }))
        }

        if (cancelled) return

        const validFiles = fileArr.filter(Boolean)
        const vol = await loadFiles(validFiles, (ph, pct) => {
          if (cancelled) return
          setPhase(ph)
          setLocal(pct)
          setIsLoading(true, ph)
          setLoadingProgress(pct)
        })
        if (cancelled) return

        setVolume(vol)
        setIsLoading(false)
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message ?? 'Erro ao carregar estudo')
          setIsLoading(false)
        }
      }
    })()

    return () => { cancelled = true }
  }, [studyUID, setVolume, setIsLoading, setLoadingProgress, setStudyMeta, confirmedLarge])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return

      if (e.key === ' ') {
        setCineActive(!cineActive); e.preventDefault(); return
      }

      // Laudo assinado → só atalhos de NAVEGAÇÃO (janela/pan/zoom). Anotação,
      // medição e undo/redo ficam desativados (estudo imutável).
      if (reportLocked) {
        const nav: Record<string, any> = { 'w':'windowing','p':'pan','z':'zoom' }
        if (nav[e.key.toLowerCase()]) { setActiveTool(nav[e.key.toLowerCase()]); e.preventDefault() }
        return
      }

      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
        undoAnnotation(activeViewportId); e.preventDefault(); return
      }
      if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        redoAnnotation(activeViewportId); e.preventDefault(); return
      }

      const map: Record<string, any> = {
        'w':'windowing','p':'pan','z':'zoom',
        'r':'ruler','b':'bidirectional',
        'a':'angle','k':'cobb',
        'h':'probe','q':'roi_ellipse','d':'roi_rect',
        's':'arrow','c':'circle','e':'rectangle',
        'f':'freehand','g':'polygon','t':'text','x':'eraser',
      }
      if (map[e.key.toLowerCase()]) { setActiveTool(map[e.key.toLowerCase()]); e.preventDefault() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [setActiveTool, activeViewportId, undoAnnotation, redoAnnotation, setCineActive, cineActive, reportLocked])

  useEffect(() => {
    return () => { clearAll() }
  }, [clearAll])

  if (largePrompt && !confirmedLarge) {
    return (
      <div className="orthovis-root" style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{
          maxWidth: 460, padding: 24, borderRadius: 12,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)',
          textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ fontSize: 14, color: '#fbbf24', fontWeight: 700 }}>Estudo grande</div>
          <div style={{ fontSize: 12, color: '#fde68a', lineHeight: 1.6 }}>
            Este estudo tem <strong>{largePrompt.count.toLocaleString('pt-BR')}</strong> imagens.
            Ele será aberto em <strong>modo streaming</strong>: o plano axial 2D fica em
            resolução total (decodificado sob demanda) e MPR/3D usam uma prévia reduzida —
            evitando travar a aba. O download das imagens ainda pode levar alguns instantes.
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'center', marginTop: 8 }}>
            <button
              onClick={() => navigate(-1)}
              style={{ padding: '8px 16px', borderRadius: 6, background: 'rgba(255,255,255,0.06)',
                       border: '1px solid rgba(255,255,255,0.12)', color: '#D4E8F8', fontSize: 12 }}
            >← Voltar</button>
            <button
              onClick={() => setConfirmedLarge(true)}
              style={{ padding: '8px 16px', borderRadius: 6, background: 'rgba(245,158,11,0.85)',
                       border: '1px solid #f59e0b', color: '#1a1205', fontSize: 12, fontWeight: 700 }}
            >Carregar mesmo assim</button>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="orthovis-root" style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{
          maxWidth: 420, padding: 24, borderRadius: 12,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)',
          textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ fontSize: 14, color: '#f87171', fontWeight: 700 }}>Falha ao carregar estudo</div>
          <div style={{ fontSize: 12, color: '#fca5a5' }}>{error}</div>
          <button
            onClick={() => navigate(-1)}
            style={{
              marginTop: 8, padding: '8px 16px', borderRadius: 6,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              color: '#D4E8F8', fontSize: 12,
            }}
          >← Voltar</button>
        </div>
      </div>
    )
  }

  if (!volume) {
    return (
      <div className="orthovis-root" style={{ display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16 }}>
        <div style={{ width:48, height:48, border:'3px solid rgba(34,211,238,0.15)', borderTopColor:'#22D3EE', borderRadius:'50%', animation:'ov-spin .8s linear infinite' }}/>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontFamily:'Outfit, sans-serif', fontWeight:600, fontSize:14, color:'#D4E8F8' }}>OrthoVis</div>
          <div style={{ fontSize:11, color:'#7090B0', marginTop:4 }}>{phase}</div>
          <div style={{ marginTop:10, width:240, height:3, background:'rgba(255,255,255,0.08)', borderRadius:2, overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${progress}%`, background:'linear-gradient(90deg,#22D3EE,#A78BFA)', transition:'width .25s' }}/>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="orthovis-root">
      <ViewerApp />
    </div>
  )
}
