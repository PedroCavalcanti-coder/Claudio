import { useStore } from '../store'
import { PlaneSidebar } from './PlaneSidebar'
import { ToolPanel } from './ToolPanel'
import { ViewerToolbar } from './ViewerToolbar'
import { View2D } from './View2D'
import { MprView } from './MprView'
import { View3D } from './View3D'
import { NotesPanel } from './NotesPanel'
import { ExportModal } from './ExportModal'
import { ReportModal } from './ReportModal'
import { PriorsModal } from './PriorsModal'
import { ViewerStatusBar } from './ViewerStatusBar'

export function ViewerApp() {
  const { workMode, showNotes, setShowNotes, showExport, setShowExport, showReport, setShowReport, showPriors, setShowPriors, reportLocked } = useStore()

  return (
    <>
      <div style={{ width:'100%', height:'100%', background:'var(--bg-void)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <ViewerToolbar />
        {reportLocked && (
          <div style={{
            position:'absolute', top:52, left:'50%', transform:'translateX(-50%)', zIndex:120,
            display:'flex', alignItems:'center', gap:6, padding:'4px 12px', borderRadius:999,
            background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.4)',
            color:'#6ee7b7', fontSize:11, fontWeight:600, pointerEvents:'none',
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>
            Laudo assinado · somente leitura (baixe o PDF em "Laudo")
          </div>
        )}
        <div style={{ flex:1, minHeight:0, display:'flex', overflow:'hidden', position:'relative' }}>
          {workMode !== '3d' && <ToolPanel />}

          {workMode !== '3d' && <div style={{ width:56, flexShrink:0 }} />}

          {workMode === '2d' && <PlaneSidebar />}

          <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            {workMode === '2d'  && <View2D />}
            {workMode === 'mpr' && <MprView />}
            {workMode === '3d'  && <View3D />}
          </div>

          {showNotes && <NotesPanel onClose={() => setShowNotes(false)} />}
        </div>
        <ViewerStatusBar />
      </div>

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {showReport && <ReportModal onClose={() => setShowReport(false)} />}
      {showPriors && <PriorsModal onClose={() => setShowPriors(false)} />}
    </>
  )
}
