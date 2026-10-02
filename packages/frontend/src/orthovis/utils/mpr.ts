import type { VolumeData, ColorMap } from '../store'
import { applyWindowLevel } from './render'

export interface Slice { pixels: Float32Array; width: number; height: number }

export function extractAxial(v: VolumeData, z: number): Slice {
  const zi = Math.max(0, Math.min(v.depth-1, Math.round(z)))
  const n = v.width * v.height
  return { pixels: v.voxels.slice(zi*n, zi*n+n), width: v.width, height: v.height }
}
export function extractCoronal(v: VolumeData, y: number): Slice {
  const yi = Math.max(0, Math.min(v.height-1, Math.round(y)))
  const px = new Float32Array(v.width * v.depth)
  const W=v.width, H=v.height
  for (let z=0;z<v.depth;z++) for (let x=0;x<W;x++)
    px[(v.depth-1-z)*W+x] = v.voxels[x+yi*W+z*W*H]
  return { pixels: px, width: v.width, height: v.depth }
}
export function extractSagital(v: VolumeData, x: number): Slice {
  const xi = Math.max(0, Math.min(v.width-1, Math.round(x)))
  const px = new Float32Array(v.height * v.depth)
  const W=v.width, H=v.height
  for (let z=0;z<v.depth;z++) for (let y=0;y<H;y++)
    px[(v.depth-1-z)*H+y] = v.voxels[xi+y*W+z*W*H]
  return { pixels: px, width: v.height, height: v.depth }
}

export function renderSlice(
  s: Slice, wc: number, ww: number,
  invert: boolean, colormap: ColorMap,
  brightness: number, contrast: number
): ImageData {
  return applyWindowLevel(s.pixels, s.height, s.width, wc, ww, 1, 0, invert, colormap, brightness, contrast)
}

export function extractSlab(v: VolumeData, plane: 'axial'|'sagital'|'coronal', idx: number, thick: number, mode: 'mip'|'minip'|'avg'): Slice {
  if (thick <= 1) return plane==='axial'?extractAxial(v,idx):plane==='sagital'?extractSagital(v,idx):extractCoronal(v,idx)
  const half = Math.floor(thick/2)
  const slices: Slice[] = []
  for (let i=-half;i<=half;i++) slices.push(plane==='axial'?extractAxial(v,idx+i):plane==='sagital'?extractSagital(v,idx+i):extractCoronal(v,idx+i))
  const base = slices[0]
  const result = new Float32Array(base.pixels.length)
  if (mode==='mip') { result.fill(-Infinity); for(const s of slices) for(let i=0;i<s.pixels.length;i++) if(s.pixels[i]>result[i])result[i]=s.pixels[i] }
  else if (mode==='minip') { result.fill(Infinity); for(const s of slices) for(let i=0;i<s.pixels.length;i++) if(s.pixels[i]<result[i])result[i]=s.pixels[i] }
  else { for(const s of slices) for(let i=0;i<s.pixels.length;i++) result[i]+=s.pixels[i]; for(let i=0;i<result.length;i++) result[i]/=slices.length }
  return { pixels: result, width: base.width, height: base.height }
}
