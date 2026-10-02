import { create } from 'zustand'

export type WorkMode = '2d' | 'mpr' | '3d'
export type GridLayout = '1x1' | '2x2' | '1x2' | '2x1'
export type Tool =
  'windowing' | 'pan' | 'zoom' |
  'ruler' | 'bidirectional' |
  'angle' | 'cobb' |
  'probe' | 'roi_ellipse' | 'roi_rect' |
  'arrow' | 'circle' | 'rectangle' | 'freehand' | 'polygon' | 'text' |
  'eraser'
export type ColorMap = 'grayscale' | 'hot' | 'cool' | 'jet' | 'bone' | 'pet'
export type SlabMode = 'mip' | 'minip' | 'avg'
export type PlaneType = 'axial' | 'sagital' | 'coronal'

export interface Point { x: number; y: number }

export interface AnnotationShape {
  type: 'ruler' | 'arrow' | 'circle' | 'rectangle' | 'text' | 'probe' | 'angle' | 'freehand' |
        'bidirectional' | 'cobb' | 'polygon' | 'roi_ellipse' | 'roi_rect'
  p1?: Point; p2?: Point
  p3?: Point; p4?: Point            // bidirectional perpendicular / cobb 2nd line
  center?: Point; radius?: number
  position?: Point; text?: string; hu?: number
  vertex?: Point; degrees?: number
  points?: Point[]
  // ROI statistics (computed at commit from volume voxels)
  huMean?: number; huStd?: number; huMin?: number; huMax?: number
  // Text box properties (used when type === 'text')
  width?: number         // box width in image pixels
  height?: number        // box height in image pixels
  textRotation?: number  // rotation in degrees, independent of viewport rotation
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  bgColor?: string       // background fill color
}

export interface Annotation {
  id: string; shape: AnnotationShape
  color: string; lineWidth: number; fontSize: number; createdAt: number
  sliceIndex: number
}

// Séries grandes demais p/ caber em RAM como volume Float32 cheio: `voxels` vira uma
// versão subamostrada (MPR/3D/sagital/coronal) e o axial é servido em full-res sob
// demanda via `stream`, decodificando 1 corte por vez com cache LRU.
export interface SliceSource {
  fullWidth: number; fullHeight: number; fullDepth: number
  fullSpacingX: number; fullSpacingY: number
  getSlice: (z: number) => Float32Array | null        // null se ainda não decodificado
  ensureSlice: (z: number) => Promise<Float32Array | null>
  prefetch: (z: number) => void
}

export interface VolumeData {
  voxels: Float32Array; width: number; height: number; depth: number
  spacingX: number; spacingY: number; spacingZ: number
  windowCenter: number; windowWidth: number
  rescaleSlope: number; rescaleIntercept: number
  modality: string; patientName: string; studyDate: string
  seriesDescription: string; fileType: string
  stream?: SliceSource | null   // presente só em séries gigantes demais p/ volume cheio
}

export interface MprState {
  axialIndex: number; sagittalIndex: number; coronalIndex: number
  windowCenter: number; windowWidth: number
  zoom: number; brightness: number; contrast: number
  invert: boolean; colormap: ColorMap
  slabThickness: number; slabMode: SlabMode
}

export interface ViewportState {
  id: string; plane: PlaneType; currentIndex: number
  windowCenter: number; windowWidth: number
  zoom: number; panX: number; panY: number
  rotation: number; flipH: boolean; flipV: boolean
  invert: boolean; brightness: number; contrast: number
  annotations: Annotation[]
  annotationHistory: Annotation[][] // undo stack
  annotationFuture: Annotation[][]  // redo stack
}

export interface AnnotationStyle {
  color: string; lineWidth: number; fontSize: number
  bold: boolean; italic: boolean; align: 'left'|'center'|'right'; bgColor: string
}

export interface Note { id: string; text: string; images: string[]; createdAt: number }

export interface StudyMeta {
  studyId:               string
  studyUid:              string
  accessionNumber?:      string | null
  patientName:           string
  birthDate?:            string | null      // ISO 'YYYY-MM-DD'
  gender?:               string | null      // 'M' | 'F' | 'O'
  medicalRecordNumber?:  string | null
  procedureName?:        string | null
  clinicalIndication?:   string | null
  // vem de appointment.requesting_physician_id ou, na ausência, do texto livre do DICOM
  requestingPhysician?: {
    name:      string
    crm?:      string | null
    specialty?: string | null
  } | null
}

export function genId() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

const defaultVP = (id: string, plane: PlaneType = 'axial'): ViewportState => ({
  id, plane, currentIndex: 0,
  windowCenter: 400, windowWidth: 1500,
  zoom: 1, panX: 0, panY: 0,
  rotation: 0, flipH: false, flipV: false,
  invert: false, brightness: 100, contrast: 100,
  annotations: [],
  annotationHistory: [],
  annotationFuture: [],
})

const defaultMpr = (): MprState => ({
  axialIndex: 0, sagittalIndex: 0, coronalIndex: 0,
  windowCenter: 400, windowWidth: 1500,
  zoom: 1, brightness: 100, contrast: 100,
  invert: false, colormap: 'grayscale',
  slabThickness: 1, slabMode: 'avg',
})

const INIT_VPS: Record<string, ViewportState> = {
  'vp-0': defaultVP('vp-0', 'axial'),
  'vp-1': defaultVP('vp-1', 'sagital'),
  'vp-2': defaultVP('vp-2', 'coronal'),
  'vp-3': defaultVP('vp-3', 'axial'),
}

interface Store {
  // Screen / routing
  screen: 'landing' | 'viewer'
  setScreen: (s: 'landing' | 'viewer') => void
  workMode: WorkMode
  setWorkMode: (m: WorkMode) => void

  // Volume
  volume: VolumeData | null
  setVolume: (v: VolumeData | null) => void
  maskVolume: VolumeData | null
  setMaskVolume: (v: VolumeData | null) => void

  // Loading
  isLoading: boolean; loadingPhase: string; loadingProgress: number
  setIsLoading: (v: boolean, phase?: string) => void
  setLoadingProgress: (p: number) => void

  // 2D viewports
  gridLayout: GridLayout
  setGridLayout: (l: GridLayout) => void
  activeViewportId: string
  setActiveViewport: (id: string) => void
  viewports: Record<string, ViewportState>
  updateViewport: (id: string, u: Partial<ViewportState>) => void
  setViewportPlane: (id: string, plane: PlaneType) => void
  addAnnotation: (vpId: string, ann: Annotation) => void
  removeAnnotation: (vpId: string, annId: string) => void
  updateAnnotation: (vpId: string, annId: string, update: Partial<Annotation>) => void
  clearAnnotations: (vpId: string) => void
  undoAnnotation: (vpId: string) => void
  redoAnnotation: (vpId: string) => void

  // MPR
  mpr: MprState
  updateMpr: (u: Partial<MprState>) => void

  // Tools
  activeTool: Tool
  setActiveTool: (t: Tool) => void
  annotationStyle: AnnotationStyle
  setAnnotationStyle: (s: Partial<AnnotationStyle>) => void

  // 3D
  render3dMode: 'mip' | 'dvr'
  setRender3dMode: (m: 'mip' | 'dvr') => void
  segLayers: { id: string; name: string; color: string; opacity: number; huMin: number; huMax: number; visible: boolean }[]
  addSegLayer: (name: string, huMin: number, huMax: number, color: string) => void
  updateSegLayer: (id: string, u: any) => void
  removeSegLayer: (id: string) => void

  // Cine playback
  cineActive: boolean
  cineFps: number
  setCineActive: (v: boolean) => void
  setCineFps: (fps: number) => void

  // Sidebar plane dragging
  draggingPlane: PlaneType | null
  setDraggingPlane: (p: PlaneType | null) => void

  // Notes & gallery
  notes: Note[]
  addNote: (text: string) => string
  updateNote: (id: string, text: string) => void
  deleteNote: (id: string) => void
  galleryImages: { id: string; dataUrl: string; label: string; ts: number }[]
  addGalleryImage: (img: string, label: string) => void
  deleteGalleryImage: (id: string) => void

  // Panels
  showNotes: boolean; setShowNotes: (v: boolean) => void
  showExport: boolean; setShowExport: (v: boolean) => void
  showReport: boolean; setShowReport: (v: boolean) => void
  showPriors: boolean; setShowPriors: (v: boolean) => void
  showMaskLoader: boolean; setShowMaskLoader: (v: boolean) => void

  // Metadados do estudo carregado via RIS/PACS (null quando carregado localmente).
  // A presença dessa estrutura é prova de origem PACS — funções como
  // "Notas" e "Laudo" só ficam habilitadas quando studyMeta !== null.
  studyMeta: StudyMeta | null
  setStudyMeta: (m: StudyMeta | null) => void

  // Laudo do estudo assinado/aditado → viewer em modo somente-leitura:
  // o médico apenas VISUALIZA as imagens (janela/pan/zoom) e baixa o laudo
  // assinado; ferramentas de medição/anotação ficam ocultas (estudo imutável).
  reportLocked: boolean
  setReportLocked: (v: boolean) => void

  clearAll: () => void
}

export const useStore = create<Store>((set) => ({
  screen: 'landing',
  setScreen: s => set({ screen: s }),
  workMode: '2d',
  setWorkMode: m => set({ workMode: m }),

  volume: null,
  setVolume: v => set(() => ({
    volume: v,
    screen: v ? 'viewer' : 'landing',
    workMode: '2d',
    mpr: v ? {
      ...defaultMpr(),
      axialIndex: Math.floor(v.depth / 2),
      sagittalIndex: Math.floor(v.width / 2),
      coronalIndex: Math.floor(v.height / 2),
      windowCenter: v.windowCenter,
      windowWidth: v.windowWidth,
    } : defaultMpr(),
    viewports: v ? {
      // axial usa a profundidade full-res (stream), não a do volume subamostrado
      'vp-0': { ...defaultVP('vp-0','axial'), windowCenter:v.windowCenter, windowWidth:v.windowWidth, currentIndex:Math.floor((v.stream?v.stream.fullDepth:v.depth)/2) },
      'vp-1': { ...defaultVP('vp-1','sagital'), windowCenter:v.windowCenter, windowWidth:v.windowWidth, currentIndex:Math.floor(v.width/2) },
      'vp-2': { ...defaultVP('vp-2','coronal'), windowCenter:v.windowCenter, windowWidth:v.windowWidth, currentIndex:Math.floor(v.height/2) },
      'vp-3': { ...defaultVP('vp-3','axial'), windowCenter:v.windowCenter, windowWidth:v.windowWidth, currentIndex:Math.floor((v.stream?v.stream.fullDepth:v.depth)/2) },
    } : INIT_VPS,
  })),

  maskVolume: null,
  setMaskVolume: v => set({ maskVolume: v }),

  isLoading: false, loadingPhase: '', loadingProgress: 0,
  setIsLoading: (v, phase='') => set({ isLoading: v, loadingPhase: phase }),
  setLoadingProgress: p => set({ loadingProgress: p }),

  gridLayout: '2x2',
  setGridLayout: l => set({ gridLayout: l }),
  activeViewportId: 'vp-0',
  setActiveViewport: id => set({ activeViewportId: id }),
  viewports: INIT_VPS,
  updateViewport: (id, u) => set(s => ({ viewports: { ...s.viewports, [id]: { ...s.viewports[id], ...u } } })),
  setViewportPlane: (id, plane) => set(s => {
    const vol = s.volume
    const idx = !vol ? 0 : plane==='axial'?Math.floor(vol.depth/2):plane==='sagital'?Math.floor(vol.width/2):Math.floor(vol.height/2)
    return { viewports: { ...s.viewports, [id]: { ...s.viewports[id], plane, currentIndex: idx } } }
  }),
  addAnnotation: (vpId, ann) => set(s => {
    const vp = s.viewports[vpId]
    return { viewports: { ...s.viewports, [vpId]: {
      ...vp,
      annotations: [...vp.annotations, ann],
      annotationHistory: [...vp.annotationHistory, vp.annotations].slice(-50),
      annotationFuture: [],
    }}}
  }),
  updateAnnotation: (vpId, annId, update) => set(s => ({
    viewports: { ...s.viewports, [vpId]: {
      ...s.viewports[vpId],
      annotations: s.viewports[vpId].annotations.map(a => a.id === annId ? { ...a, ...update } : a),
    }}
  })),
  removeAnnotation: (vpId, annId) => set(s => {
    const vp = s.viewports[vpId]
    return { viewports: { ...s.viewports, [vpId]: {
      ...vp,
      annotations: vp.annotations.filter(a => a.id !== annId),
      annotationHistory: [...vp.annotationHistory, vp.annotations].slice(-50),
      annotationFuture: [],
    }}}
  }),
  clearAnnotations: (vpId) => set(s => {
    const vp = s.viewports[vpId]
    if (!vp.annotations.length) return s
    return { viewports: { ...s.viewports, [vpId]: {
      ...vp,
      annotations: [],
      annotationHistory: [...vp.annotationHistory, vp.annotations].slice(-50),
      annotationFuture: [],
    }}}
  }),
  undoAnnotation: (vpId) => set(s => {
    const vp = s.viewports[vpId]
    if (!vp.annotationHistory.length) return s
    const prev = vp.annotationHistory[vp.annotationHistory.length - 1]
    return { viewports: { ...s.viewports, [vpId]: {
      ...vp,
      annotations: prev,
      annotationHistory: vp.annotationHistory.slice(0, -1),
      annotationFuture: [vp.annotations, ...vp.annotationFuture].slice(0, 50),
    }}}
  }),
  redoAnnotation: (vpId) => set(s => {
    const vp = s.viewports[vpId]
    if (!vp.annotationFuture.length) return s
    const next = vp.annotationFuture[0]
    return { viewports: { ...s.viewports, [vpId]: {
      ...vp,
      annotations: next,
      annotationHistory: [...vp.annotationHistory, vp.annotations].slice(-50),
      annotationFuture: vp.annotationFuture.slice(1),
    }}}
  }),

  mpr: defaultMpr(),
  updateMpr: u => set(s => ({ mpr: { ...s.mpr, ...u } })),

  activeTool: 'windowing',
  setActiveTool: t => set({ activeTool: t }),
  annotationStyle: { color: '#00d4ff', lineWidth: 2, fontSize: 14, bold: false, italic: false, align: 'left', bgColor: 'transparent' },
  setAnnotationStyle: s => set(st => ({ annotationStyle: { ...st.annotationStyle, ...s } })),

  render3dMode: 'dvr',
  setRender3dMode: m => set({ render3dMode: m }),
  segLayers: [
    { id: 'bone', name: 'Osso', color: '#e8d5a3', opacity: 1.0, huMin: 300, huMax: 3000, visible: true },
    { id: 'soft', name: 'Tecido Mole', color: '#c47a7a', opacity: 0.4, huMin: -100, huMax: 300, visible: true },
    { id: 'lung', name: 'Pulmão', color: '#7ab8f4', opacity: 0.6, huMin: -1000, huMax: -500, visible: false },
  ],
  addSegLayer: (name, huMin, huMax, color) => set(s => ({ segLayers: [...s.segLayers, { id:genId(), name, color, opacity:0.8, huMin, huMax, visible:true }] })),
  updateSegLayer: (id, u) => set(s => ({ segLayers: s.segLayers.map(l => l.id===id?{...l,...u}:l) })),
  removeSegLayer: id => set(s => ({ segLayers: s.segLayers.filter(l => l.id!==id) })),

  cineActive: false,
  cineFps: 10,
  setCineActive: v => set({ cineActive: v }),
  setCineFps: fps => set({ cineFps: fps }),

  draggingPlane: null,
  setDraggingPlane: p => set({ draggingPlane: p }),

  notes: [],
  addNote: text => { const id=genId(); set(s=>({notes:[...s.notes,{id,text,images:[],createdAt:Date.now()}]})); return id },
  updateNote: (id, text) => set(s => ({ notes: s.notes.map(n => n.id===id?{...n,text}:n) })),
  deleteNote: id => set(s => ({ notes: s.notes.filter(n => n.id!==id) })),
  galleryImages: [],
  addGalleryImage: (img, label) => set(s => ({ galleryImages:[...s.galleryImages,{id:genId(),dataUrl:img,label,ts:Date.now()}] })),
  deleteGalleryImage: id => set(s => ({ galleryImages: s.galleryImages.filter(g => g.id !== id) })),

  showNotes: false, setShowNotes: v => set({ showNotes: v }),
  showExport: false, setShowExport: v => set({ showExport: v }),
  showReport: false, setShowReport: v => set({ showReport: v }),
  showPriors: false, setShowPriors: v => set({ showPriors: v }),
  showMaskLoader: false, setShowMaskLoader: v => set({ showMaskLoader: v }),

  studyMeta: null,
  setStudyMeta: m => set({ studyMeta: m }),

  reportLocked: false,
  setReportLocked: v => set({ reportLocked: v }),

  clearAll: () => set({
    volume: null, maskVolume: null, screen: 'landing', workMode: '2d',
    viewports: INIT_VPS, mpr: defaultMpr(), galleryImages: [],
    cineActive: false, notes: [], studyMeta: null, reportLocked: false,
  }),
}))
