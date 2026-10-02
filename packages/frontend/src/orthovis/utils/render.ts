import type { ColorMap } from '../store'

export function applyWindowLevel(
  pixels: Float32Array | Int16Array | Uint16Array | Uint8Array,
  rows: number, cols: number,
  wc: number, ww: number,
  slope = 1, intercept = 0,
  invert = false,
  colormap: ColorMap = 'grayscale',
  brightness = 100, contrast = 100
): ImageData {
  const data = new Uint8ClampedArray(rows * cols * 4)
  const lo = wc - ww / 2
  const bf = brightness / 100, cf = contrast / 100
  const bc = (v: number) => Math.max(0, Math.min(255, Math.round((v * bf - 128) * cf + 128)))

  for (let i = 0; i < rows * cols; i++) {
    const hu = (pixels[i] as number) * slope + intercept
    let n = Math.max(0, Math.min(1, (hu - lo) / (ww || 1)))
    if (invert) n = 1 - n

    let r: number, g: number, b: number
    if (colormap === 'hot') {
      r = Math.min(255, n * 3 * 255); g = Math.min(255, Math.max(0, (n-1/3)*3*255)); b = Math.min(255, Math.max(0, (n-2/3)*3*255))
    } else if (colormap === 'cool') {
      r = Math.round(n*255); g = Math.round((1-n)*255); b = 255
    } else if (colormap === 'bone') {
      r = Math.round(n*0.94*255); g = Math.round(n*255); b = Math.min(255, Math.round(n*1.06*255))
    } else if (colormap === 'jet') {
      if(n<0.25){r=0;g=Math.round(n*4*255);b=255}
      else if(n<0.5){r=0;g=255;b=Math.round((1-(n-0.25)*4)*255)}
      else if(n<0.75){r=Math.round((n-0.5)*4*255);g=255;b=0}
      else{r=255;g=Math.round((1-(n-0.75)*4)*255);b=0}
    } else if (colormap === 'pet') {
      r = Math.round(Math.min(1, n*2)*255); g = n>0.5?Math.round((n-0.5)*2*255):0; b = 0
    } else {
      const v = Math.round(n * 255); r = g = b = v
    }

    const idx = i * 4
    data[idx] = bc(r); data[idx+1] = bc(g); data[idx+2] = bc(b); data[idx+3] = 255
  }
  return new ImageData(data, cols, rows)
}

export function imgToCanvas(ix: number, iy: number, cw: number, ch: number, iw: number, ih: number, px: number, py: number, zoom: number) {
  return { x: ix*zoom + (cw-iw*zoom)/2 + px, y: iy*zoom + (ch-ih*zoom)/2 + py }
}
export function canvasToImg(cx: number, cy: number, cw: number, ch: number, iw: number, ih: number, px: number, py: number, zoom: number) {
  return { x: (cx - (cw-iw*zoom)/2 - px) / zoom, y: (cy - (ch-ih*zoom)/2 - py) / zoom }
}
export function dist(a: {x:number;y:number}, b: {x:number;y:number}) {
  return Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2)
}
export function realMm(a: {x:number;y:number}, b: {x:number;y:number}, sx: number, sy: number) {
  return Math.sqrt(((b.x-a.x)*sx)**2 + ((b.y-a.y)*sy)**2)
}
