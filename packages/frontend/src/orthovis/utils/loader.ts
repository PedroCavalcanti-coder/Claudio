import type { VolumeData, SliceSource } from '../store'

type Progress = (phase: string, pct: number) => void

// ─── Transfer Syntax UIDs ────────────────────────────────────────────────────
const TS_JPEG_BASELINE    = '1.2.840.10008.1.2.4.50'
const TS_JPEG_EXTENDED    = '1.2.840.10008.1.2.4.51'
const TS_JPEG_LS_NH       = '1.2.840.10008.1.2.4.57'  // JPEG Lossless, non-hierarchical
const TS_JPEG_LS_SV1      = '1.2.840.10008.1.2.4.70'  // JPEG Lossless, SV1 (most common lossless CT/MR)
const TS_JPEG_LS_LOSSLESS = '1.2.840.10008.1.2.4.80'  // JPEG-LS Lossless
const TS_JPEG_LS_NEAR     = '1.2.840.10008.1.2.4.81'  // JPEG-LS Near-Lossless
const TS_J2K_LOSSLESS     = '1.2.840.10008.1.2.4.90'  // JPEG 2000 Lossless
const TS_J2K_LOSSY        = '1.2.840.10008.1.2.4.91'  // JPEG 2000 Lossy
const TS_RLE              = '1.2.840.10008.1.2.5'      // RLE Lossless

const JPEG_LOSSY      = new Set([TS_JPEG_BASELINE, TS_JPEG_EXTENDED])
const JPEG_LOSSLESS   = new Set([TS_JPEG_LS_NH, TS_JPEG_LS_SV1])
const JPEG_LS         = new Set([TS_JPEG_LS_LOSSLESS, TS_JPEG_LS_NEAR])
const JPEG2000        = new Set([TS_J2K_LOSSLESS, TS_J2K_LOSSY])

// ─── Public entry point ──────────────────────────────────────────────────────
export async function loadFiles(files: File[], onProgress: Progress): Promise<VolumeData> {
  if (!files.length) throw new Error('Nenhum arquivo selecionado')
  const name = files[0].name.toLowerCase()
  if (files.length === 1 && (name.endsWith('.nii') || name.endsWith('.nii.gz') || name.endsWith('.gz')))
    return loadNifti(files[0], onProgress)
  if (files.length === 1 && name.endsWith('.npy'))
    return loadNpy(files[0], onProgress)
  const dcm = files.filter(f => {
    const n = f.name.toLowerCase()
    return n.endsWith('.dcm') || n.endsWith('.dicom') || !n.includes('.')
  })
  if (dcm.length > 0) return loadDicomStack(dcm, onProgress)
  throw new Error('Formato não suportado. Use .dcm, .nii, .nii.gz ou .npy')
}

// ─── RLE Lossless decoder (DICOM spec PS3.5 §G) ──────────────────────────────
function decodeRLE(
  frame: Uint8Array,
  rows: number, cols: number,
  bits: number, pixRep: number,
): Float32Array {
  const view = new DataView(frame.buffer, frame.byteOffset)
  const numSegs = view.getUint32(0, true)
  const offsets: number[] = []
  for (let i = 0; i < numSegs; i++) offsets.push(view.getUint32(4 + i * 4, true))

  const n = rows * cols

  function decodeSeg(base: number): Uint8Array {
    const out = new Uint8Array(n)
    let src = base, dst = 0
    while (dst < n && src < frame.length) {
      const h = view.getInt8(src++)
      if (h >= 0) {
        const cnt = Math.min(h + 1, n - dst)
        for (let i = 0; i < cnt; i++) out[dst++] = frame[src++]
      } else if (h !== -128) {
        const cnt = Math.min(-h + 1, n - dst)
        const val = frame[src++]
        for (let i = 0; i < cnt; i++) out[dst++] = val
      }
    }
    return out
  }

  const px = new Float32Array(n)
  if (bits <= 8) {
    const seg = decodeSeg(offsets[0])
    for (let i = 0; i < n; i++) px[i] = seg[i]
  } else {
    const hi = decodeSeg(offsets[0])
    const lo = decodeSeg(offsets[1])
    for (let i = 0; i < n; i++) {
      let v = (hi[i] << 8) | lo[i]
      if (pixRep === 1 && v > 32767) v -= 65536
      px[i] = v
    }
  }
  return px
}

// ─── JPEG Lossless decoder (via jpeg-lossless-decoder-js) ───────────────────
let _losslessDecoder: any = null
async function getLosslessDecoder() {
  if (_losslessDecoder) return _losslessDecoder
  try {
    const mod = await import('jpeg-lossless-decoder-js')
    // The package exports { lossless: { Decoder } } in some versions, or default
    const Ctor = (mod as any).lossless?.Decoder || (mod as any).Decoder || (mod as any).default?.lossless?.Decoder
    if (!Ctor) throw new Error('API incompatível')
    _losslessDecoder = Ctor
    return Ctor
  } catch {
    return null
  }
}

async function decodeJpegLossless(
  frame: Uint8Array,
  rows: number, cols: number,
  bits: number, pixRep: number,
): Promise<Float32Array | null> {
  const Decoder = await getLosslessDecoder()
  if (!Decoder) return null
  try {
    const dec = new Decoder()
    const result = dec.decode(
      frame.buffer,
      frame.byteOffset,
      frame.byteLength,
      /* byteDecodeOut */ undefined,
    )
    const n = rows * cols
    const px = new Float32Array(n)
    if (bits <= 8) {
      for (let i = 0; i < n; i++) px[i] = result[i]
    } else {
      for (let i = 0; i < n; i++) {
        let v = result[i]
        if (pixRep === 1 && v > 32767) v -= 65536
        px[i] = v
      }
    }
    return px
  } catch {
    return null
  }
}

// ─── JPEG Baseline decoder (browser-native via OffscreenCanvas) ──────────────
async function decodeJpegBaseline(
  frame: Uint8Array,
  rows: number, cols: number,
): Promise<Float32Array | null> {
  try {
    const copy = frame.buffer instanceof ArrayBuffer
      ? frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength)
      : new Uint8Array(frame).buffer
    const blob = new Blob([copy as ArrayBuffer], { type: 'image/jpeg' })
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(cols, rows)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const img = ctx.getImageData(0, 0, cols, rows)
    const px = new Float32Array(cols * rows)
    for (let i = 0; i < px.length; i++) px[i] = img.data[i * 4] // R channel (grayscale)
    return px
  } catch {
    return null
  }
}

// ─── Extract first encapsulated frame from sequence ──────────────────────────
function readEncapsulatedFrame(bytes: Uint8Array, dataOffset: number): Uint8Array | null {
  if (dataOffset + 8 > bytes.length) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const u32 = (o: number) => view.getUint32(o, true)

  const ITEM_TAG  = 0xE000FFFE  // (FFFE,E000) little-endian
  const SEQ_DELIM = 0xE0DDFFFE  // (FFFE,E0DD) little-endian

  let off = dataOffset
  // Skip Basic Offset Table item
  if (u32(off) !== ITEM_TAG) return null
  off += 4
  const botLen = u32(off); off += 4 + botLen

  // First data item
  if (off + 8 > bytes.length) return null
  const tag = u32(off)
  if (tag === SEQ_DELIM || tag !== ITEM_TAG) return null
  off += 4
  const fLen = u32(off); off += 4

  if (fLen === 0 || fLen === 0xFFFFFFFF || off + fLen > bytes.length) return null
  return bytes.slice(off, off + fLen)
}

// ─── Compute correct slice position from DICOM image orientation ─────────────
// Projects ImagePositionPatient onto the normal of the imaging plane.
// This is the DICOM-standard way to sort slices regardless of gantry tilt or plane.
function slicePos(pos: number[], orient: number[]): number {
  const [rx, ry, rz, cx, cy, cz] = orient
  // Normal vector = cross product of row and column direction cosines
  const nx = ry * cz - rz * cy
  const ny = rz * cx - rx * cz
  const nz = rx * cy - ry * cx
  return pos[0] * nx + pos[1] * ny + pos[2] * nz
}

// ─── Per-slice metadata (cabeçalho, sem pixels) ──────────────────────────────
interface SliceMeta {
  file: File
  rows: number; cols: number
  pos: number[]; orient: number[]
  wc: number; ww: number
  slope: number; intercept: number
  sp: number[]; thick: number
  mod: string; pat: string; date: string; desc: string
  seriesUID: string; transferSyntax: string
}

// Parse só o cabeçalho de um arquivo DICOM (NÃO decodifica os pixels) — barato.
// Permite ordenar/dimensionar a série antes de decidir entre volume cheio e streaming.
async function parseMeta(file: File, dicomParser: any): Promise<SliceMeta | null> {
  try {
    const buf   = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const ds    = dicomParser.parseDicom(bytes)
    const g  = (t: string) => { try { return ds.string(t)?.trim() } catch { return undefined } }
    const gf = (t: string) => { try { return ds.floatString(t) } catch { return undefined } }
    const ga = (t: string) => { const s = g(t); return s ? s.split('\\').map(Number) : undefined }
    if (!ds.elements['x7fe00010']) return null
    const wcS = g('x00281050'), wwS = g('x00281051')
    return {
      file,
      rows: ds.uint16('x00280010') || 512,
      cols: ds.uint16('x00280011') || 512,
      pos:    ga('x00200032') || [0, 0, 0],
      orient: ga('x00200037') || [1, 0, 0, 0, 1, 0],
      wc: wcS ? parseFloat(wcS.split('\\')[0]) : 400,
      ww: wwS ? parseFloat(wwS.split('\\')[0]) : 1500,
      slope:     gf('x00281053') ?? 1,
      intercept: gf('x00281052') ?? 0,
      sp:    ga('x00280030') || [1, 1],
      thick: parseFloat(g('x00180050') || '1') || 1,
      mod:  g('x00080060') || 'CT',
      pat:  (g('x00100010') || '').replace(/\^/g, ' '),
      date: g('x00080020') || '',
      desc: g('x0008103e') || '',
      seriesUID:      g('x0020000e') || 'unknown',
      transferSyntax: g('x00020010') || '',
    }
  } catch { return null }
}

// Decodifica o pixel data de UM arquivo → Float32 em HU (rescale aplicado).
async function decodeDicomFile(file: File, dicomParser: any): Promise<{ px: Float32Array; rows: number; cols: number } | null> {
  let buf: ArrayBuffer, bytes: Uint8Array, ds: any
  try {
    buf   = await file.arrayBuffer()
    bytes = new Uint8Array(buf)
    ds    = dicomParser.parseDicom(bytes)
  } catch { return null }

  const g  = (t: string) => { try { return ds.string(t)?.trim() } catch { return undefined } }
  const gf = (t: string) => { try { return ds.floatString(t) } catch { return undefined } }

  const rows   = ds.uint16('x00280010') || 512
  const cols   = ds.uint16('x00280011') || 512
  const bits   = ds.uint16('x00280100') || 16
  const pixRep = ds.uint16('x00280103') || 0
  const slope  = gf('x00281053') ?? 1
  const intercept = gf('x00281052') ?? 0
  const transferSyntax = g('x00020010') || ''

  const pixEl = ds.elements['x7fe00010']
  if (!pixEl) return null

  let px: Float32Array | null = null
  const isEncapsulated = !!pixEl.hadUndefinedLength

  if (isEncapsulated) {
    const frame = readEncapsulatedFrame(bytes, pixEl.dataOffset)
    if (!frame) return null
    if (JPEG_LOSSY.has(transferSyntax)) {
      px = await decodeJpegBaseline(frame, rows, cols)
    } else if (JPEG_LOSSLESS.has(transferSyntax)) {
      px = await decodeJpegLossless(frame, rows, cols, bits, pixRep)
      if (!px) px = await decodeJpegBaseline(frame, rows, cols)
    } else if (transferSyntax === TS_RLE) {
      px = decodeRLE(frame, rows, cols, bits, pixRep)
    } else {
      return null // JPEG 2000 / JPEG-LS / desconhecido — não suportado
    }
  } else {
    const n   = rows * cols
    const off = pixEl.dataOffset
    let raw: Int16Array | Uint16Array | Uint8Array
    if (bits === 16) {
      raw = pixRep === 1
        ? new Int16Array(buf.slice(off, off + n * 2))
        : new Uint16Array(buf.slice(off, off + n * 2))
    } else {
      raw = new Uint8Array(buf, off, n)
    }
    px = new Float32Array(n)
    for (let j = 0; j < n; j++) px[j] = (raw[j] as number)
  }

  if (!px) return null
  if (slope !== 1 || intercept !== 0) {
    for (let j = 0; j < px.length; j++) px[j] = px[j] * slope + intercept
  }
  return { px, rows, cols }
}

// ─── Limites de streaming ──────────────────────────────────────────────────
// O alvo é uma estação forte (≥32 GB RAM), então priorizamos QUALIDADE: o
// volume cheio (full-res) é mantido para praticamente qualquer estudo real
// (ex.: 512²×1700 cortes ou 1024²×430). Mantemos abaixo de ~2 GB por
// Float32Array para não esbarrar no teto de alocação de ArrayBuffer do
// navegador — acima disso a alocação falharia e quebraria a abertura.
// Só estudos gigantescos caem em streaming, e mesmo aí a prévia é densa.
const STREAM_VOXEL_BUDGET  = 450_000_000   // ~1,8 GB Float32 — full-res p/ quase tudo
// Volume de prévia (subamostrado) alvo: ~180M voxels (~720 MB) — bem denso.
const REDUCED_VOXEL_BUDGET = 180_000_000

// ─── DICOM stack loader ──────────────────────────────────────────────────────
async function loadDicomStack(files: File[], onProg: Progress): Promise<VolumeData> {
  const { default: dicomParser } = await import('dicom-parser')

  // ── Pass 1: cabeçalhos (sem decodificar pixels) ──────────────────────────
  const bySeriesUID = new Map<string, SliceMeta[]>()
  for (let i = 0; i < files.length; i++) {
    if (i % 20 === 0) onProg(`Lendo cabeçalhos ${i + 1}/${files.length}`, Math.round((i / files.length) * 25))
    const m = await parseMeta(files[i], dicomParser)
    if (!m) continue
    if (!bySeriesUID.has(m.seriesUID)) bySeriesUID.set(m.seriesUID, [])
    bySeriesUID.get(m.seriesUID)!.push(m)
  }

  // Maior série (folder pode ter localizer + diagnóstica)
  let metas: SliceMeta[] = []
  for (const [, arr] of bySeriesUID) if (arr.length > metas.length) metas = arr
  if (!metas.length) throw new Error('Nenhuma fatia DICOM válida encontrada.')

  // Formatos comprimidos não suportados → erro claro
  const ts0 = metas[0].transferSyntax
  if (JPEG2000.has(ts0)) throw new Error('Série em JPEG 2000 (não suportado ainda — converta para uncompressed).')
  if (JPEG_LS.has(ts0))  throw new Error('Série em JPEG-LS (não suportado ainda — converta para uncompressed).')

  // Ordena pela projeção no plano + dedup por posição
  metas.sort((a, b) => slicePos(a.pos, a.orient) - slicePos(b.pos, b.orient))
  const seen = new Set<number>()
  const uniq: SliceMeta[] = []
  for (const m of metas) {
    const key = Math.round(slicePos(m.pos, m.orient) * 100)
    if (!seen.has(key)) { seen.add(key); uniq.push(m) }
  }
  metas = uniq

  const r0 = metas[0]
  const W = r0.cols, H = r0.rows, D = metas.length

  // Espaçamento Z real (média das distâncias entre cortes)
  let spZ = r0.thick
  if (D > 1) {
    let tot = 0
    for (let i = 0; i < D - 1; i++) {
      const a = metas[i].pos, b = metas[i + 1].pos
      tot += Math.sqrt((b[0]-a[0])**2 + (b[1]-a[1])**2 + (b[2]-a[2])**2)
    }
    spZ = tot / (D - 1) || spZ
  }

  const common = {
    windowCenter: r0.wc, windowWidth: r0.ww,
    rescaleSlope: r0.slope, rescaleIntercept: r0.intercept,
    modality: r0.mod, patientName: r0.pat, studyDate: r0.date,
    fileType: 'dicom' as const,
  }
  const spacingX = r0.sp[1] || 1
  const spacingY = r0.sp[0] || 1

  // ── Caminho normal: volume cheio (séries pequenas — comportamento idêntico) ──
  if (W * H * D <= STREAM_VOXEL_BUDGET) {
    const voxels = new Float32Array(W * H * D)
    for (let z = 0; z < D; z++) {
      if (z % 5 === 0) onProg('Construindo volume…', 25 + Math.round((z / D) * 73))
      const dec = await decodeDicomFile(metas[z].file, dicomParser)
      if (dec && dec.rows === H && dec.cols === W) voxels.set(dec.px, z * W * H)
    }
    onProg('Pronto', 100)
    return {
      voxels, width: W, height: H, depth: D,
      spacingX, spacingY, spacingZ: spZ,
      ...common, seriesDescription: r0.desc, stream: null,
    } as any
  }

  // ── Streaming: prévia subamostrada + axial full-res sob demanda ────────────
  // Fatores de redução até caber no orçamento de prévia.
  let sx = 1, sy = 1, sz = 1
  const reducedSize = () => Math.ceil(W / sx) * Math.ceil(H / sy) * Math.ceil(D / sz)
  while (reducedSize() > REDUCED_VOXEL_BUDGET) {
    if (sx <= sz && sy <= sz) { sx++; sy++ } else { sz++ }
  }
  const rW = Math.ceil(W / sx), rH = Math.ceil(H / sy), rD = Math.ceil(D / sz)
  const reduced = new Float32Array(rW * rH * rD)

  for (let zr = 0; zr < rD; zr++) {
    if (zr % 2 === 0) onProg(`Construindo prévia ${zr + 1}/${rD}…`, 25 + Math.round((zr / rD) * 73))
    const z = Math.min(D - 1, zr * sz)
    const dec = await decodeDicomFile(metas[z].file, dicomParser)
    if (!dec || dec.rows !== H || dec.cols !== W) continue
    // Box-average in-plane → reduz resolução mantendo informação
    for (let yr = 0; yr < rH; yr++) {
      const y0 = yr * sy, y1 = Math.min(H, y0 + sy)
      for (let xr = 0; xr < rW; xr++) {
        const x0 = xr * sx, x1 = Math.min(W, x0 + sx)
        let sum = 0, cnt = 0
        for (let y = y0; y < y1; y++) { const row = y * W; for (let x = x0; x < x1; x++) { sum += dec.px[row + x]; cnt++ } }
        reduced[zr * rW * rH + yr * rW + xr] = cnt ? sum / cnt : 0
      }
    }
  }

  // Fonte full-res axial sob demanda (cache LRU; decodifica 1 corte por vez).
  const cache = new Map<number, Float32Array>()
  const LRU_MAX = 96
  const inflight = new Map<number, Promise<Float32Array | null>>()
  const clamp = (z: number) => Math.max(0, Math.min(D - 1, Math.round(z)))
  const touch = (z: number, px: Float32Array) => {
    cache.delete(z); cache.set(z, px)
    while (cache.size > LRU_MAX) { const oldest = cache.keys().next().value as number; cache.delete(oldest) }
  }
  const ensureSlice = (zRaw: number): Promise<Float32Array | null> => {
    const z = clamp(zRaw)
    const hit = cache.get(z); if (hit) return Promise.resolve(hit)
    const pending = inflight.get(z); if (pending) return pending
    const p = (async () => {
      const dec = await decodeDicomFile(metas[z].file, dicomParser)
      inflight.delete(z)
      if (!dec) return null
      touch(z, dec.px)
      return dec.px
    })()
    inflight.set(z, p)
    return p
  }
  const stream: SliceSource = {
    fullWidth: W, fullHeight: H, fullDepth: D,
    fullSpacingX: spacingX, fullSpacingY: spacingY,
    getSlice: (z) => cache.get(clamp(z)) ?? null,
    ensureSlice,
    prefetch: (z) => { for (const dz of [0, 1, -1, 2, -2, 3, -3]) { const zz = z + dz; if (zz >= 0 && zz < D) void ensureSlice(zz) } },
  }

  onProg('Pronto', 100)
  return {
    voxels: reduced, width: rW, height: rH, depth: rD,
    spacingX: spacingX * sx, spacingY: spacingY * sy, spacingZ: spZ * sz,
    ...common,
    seriesDescription: `${r0.desc} [streaming · ${D} cortes axiais full-res · prévia ${rW}×${rH}×${rD}]`,
    stream,
  } as any
}

// ─── NIfTI loader ────────────────────────────────────────────────────────────
async function loadNifti(file: File, onProg: Progress): Promise<VolumeData> {
  onProg('Lendo NIfTI…', 10)
  const nifti = await import('nifti-reader-js')
  let buf = await file.arrayBuffer()
  if (nifti.isCompressed(buf)) { onProg('Descomprimindo…', 30); buf = nifti.decompress(buf) as ArrayBuffer }
  if (!nifti.isNIFTI(buf)) throw new Error('Arquivo NIfTI inválido')
  const hdr = nifti.readHeader(buf)
  const W = hdr.dims[1], H = hdr.dims[2], D = hdr.dims[3]
  const offset = Math.floor((hdr as any).vox_offset || 352)
  const n = W * H * D
  onProg('Decodificando voxels…', 60)
  const TYPES: any = { 2: Uint8Array, 4: Int16Array, 8: Int32Array, 16: Float32Array, 64: Float64Array, 512: Uint16Array }
  const T = TYPES[hdr.datatypeCode] || Float32Array
  const raw = new T(buf, offset, n)
  const voxels = new Float32Array(n)
  for (let i = 0; i < n; i++) voxels[i] = raw[i]
  let mn = Infinity, mx = -Infinity
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 10000))) {
    if (voxels[i] < mn) mn = voxels[i]
    if (voxels[i] > mx) mx = voxels[i]
  }
  onProg('Pronto', 100)
  return {
    voxels, width: W, height: H, depth: D,
    spacingX: hdr.pixDims[1] || 1, spacingY: hdr.pixDims[2] || 1, spacingZ: hdr.pixDims[3] || 1,
    windowCenter: (mx + mn) / 2, windowWidth: mx - mn,
    rescaleSlope: 1, rescaleIntercept: 0,
    modality: 'MR', patientName: 'NIfTI', studyDate: '', seriesDescription: file.name, fileType: 'nifti',
  } as any
}

// ─── NumPy loader ─────────────────────────────────────────────────────────────
async function loadNpy(file: File, onProg: Progress): Promise<VolumeData> {
  onProg('Lendo NPY…', 20)
  const buf  = await file.arrayBuffer()
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 6))
  if (magic !== '\x93NUMPY') throw new Error('Arquivo NPY inválido')
  const view  = new DataView(buf)
  const major = view.getUint8(6)
  const hLen  = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true)
  const hStart = major === 1 ? 10 : 12
  const hStr  = new TextDecoder().decode(new Uint8Array(buf, hStart, hLen))
  const m     = hStr.match(/'shape':\s*\(([^)]+)\)/)
  const shape = m ? m[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : [1, 1, 1]
  const W = shape[shape.length > 2 ? shape.length - 1 : 1] || 1
  const H = shape[shape.length > 2 ? shape.length - 2 : 0] || 1
  const D = shape.length >= 3 ? shape[0] : 1
  const dtype = (hStr.match(/'descr':\s*'([^']+)'/) || [])[1] || '<f4'
  const T: any = { '<f4': Float32Array, '<i2': Int16Array, '<u2': Uint16Array, '<u1': Uint8Array }
  const raw    = new (T[dtype] || Float32Array)(buf, hStart + hLen)
  const voxels = Float32Array.from(raw)
  let mn = Infinity, mx = -Infinity
  for (const v of voxels) { if (v < mn) mn = v; if (v > mx) mx = v }
  onProg('Pronto', 100)
  return {
    voxels, width: W, height: H, depth: D,
    spacingX: 1, spacingY: 1, spacingZ: 1,
    windowCenter: (mx + mn) / 2, windowWidth: mx - mn || 1,
    rescaleSlope: 1, rescaleIntercept: 0,
    modality: 'OT', patientName: '', studyDate: '', seriesDescription: file.name, fileType: 'numpy',
  } as any
}
