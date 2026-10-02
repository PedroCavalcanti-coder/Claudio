import { useQuery } from '@tanstack/react-query'
import { useStore } from '../store'
import { studiesApi } from '../../api/endpoints'

/**
 * Exames anteriores (priors) do mesmo paciente. Lista os outros estudos e
 * permite abrir cada um numa nova aba para comparação lado a lado (o viewer
 * carrega um volume por vez; abrir em nova aba é a comparação prática sem
 * estourar a memória de uma única aba).
 */
export function PriorsModal({ onClose }: { onClose: () => void }) {
  const { studyMeta } = useStore()
  const studyId = studyMeta?.studyId

  const { data: priors = [], isLoading } = useQuery({
    queryKey: ['priors', studyId],
    queryFn:  () => studiesApi.priors(studyId!).then(r => (r.data as any).data),
    enabled:  !!studyId,
    staleTime: 60_000,
  })

  const openPrior = (uid: string) => {
    window.open(`/viewer/${encodeURIComponent(uid)}`, '_blank')
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,0.85)', backdropFilter:'blur(6px)',
               display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ width:560, maxWidth:'100%', maxHeight:'85vh', background:'var(--bg-elevated)',
                    border:'1px solid var(--border-b)', borderRadius:'var(--r-xl)', boxShadow:'var(--shadow-m)',
                    display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 18px',
                      borderBottom:'1px solid var(--border-s)', background:'var(--bg-panel)' }}>
          <div>
            <div style={{ fontFamily:'var(--font-d)', fontSize:13, fontWeight:700 }}>Exames anteriores</div>
            <div style={{ fontSize:10, color:'var(--text-m)' }}>{studyMeta?.patientName || 'Paciente'} · abrir em nova aba para comparar</div>
          </div>
          <button onClick={onClose} style={{ color:'var(--text-m)', fontSize:16, lineHeight:1 }}>✕</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'12px 16px' }}>
          {isLoading ? (
            <div style={{ textAlign:'center', padding:24, color:'var(--text-m)', fontSize:12 }}>Carregando…</div>
          ) : !priors.length ? (
            <div style={{ textAlign:'center', padding:24, color:'var(--text-m)', fontSize:12 }}>
              Nenhum exame anterior deste paciente.
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {priors.map((p: any) => (
                <button key={p.id} onClick={() => openPrior(p.study_instance_uid)}
                  style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 12px', textAlign:'left',
                           background:'var(--bg-overlay)', border:'1px solid var(--border-d)', borderRadius:'var(--r-md)',
                           cursor:'pointer', color:'var(--text-p)' }}>
                  <div style={{ width:38, height:38, borderRadius:'var(--r-md)', background:'var(--bg-panel)',
                                border:'1px solid var(--border-s)', display:'flex', alignItems:'center', justifyContent:'center',
                                fontFamily:'var(--font-m)', fontSize:11, fontWeight:700, color:'var(--cyan)', flexShrink:0 }}>
                    {(p.modality_type || '??').slice(0,3)}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600 }}>
                      {p.study_description || p.modality_type || 'Estudo'}
                      {p.report_status === 'signed' || p.report_status === 'amended'
                        ? <span style={{ marginLeft:8, fontSize:9, color:'var(--green)' }}>● laudado</span> : ''}
                    </div>
                    <div style={{ fontSize:10, color:'var(--text-m)' }}>
                      {p.study_date ? new Date(p.study_date).toLocaleDateString('pt-BR') : '—'}
                      {p.accession_number ? ` · ${p.accession_number}` : ''}
                      {typeof p.number_of_instances === 'number' ? ` · ${p.number_of_instances} img` : ''}
                    </div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color:'var(--text-m)', flexShrink:0 }}>
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
