import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useStore } from '../store'

const VERT = `attribute vec2 a;varying vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0,1);}`

// Uniforms empacotados em vec4 para caber no mínimo garantido de 16 slots do WebGL 1.0 (14 usados)
const FRAG = `precision mediump float;
uniform sampler2D u_atlas;
uniform vec4 u_vp;
uniform vec4 u_win;
uniform vec3 u_eye,u_fwd,u_right,u_up;
uniform vec2 u_pan;
uniform ivec2 u_ctrl;
uniform vec3 u_c0,u_c1,u_c2;
uniform vec4 u_tf0,u_tf1,u_tf2;
varying vec2 v;

float samp(vec3 p){
  if(any(lessThan(p,vec3(0.)))||any(greaterThan(p,vec3(1.))))return -1.;
  float z=p.z*(u_vp.z-1.);float zi=floor(z);float zf=fract(z);
  vec2 uv0=(vec2(mod(zi,u_vp.x),floor(zi/u_vp.x))+p.xy)/u_vp.xy;
  float zi1=min(zi+1.,u_vp.z-1.);
  vec2 uv1=(vec2(mod(zi1,u_vp.x),floor(zi1/u_vp.x))+p.xy)/u_vp.xy;
  return mix(texture2D(u_atlas,uv0).r,texture2D(u_atlas,uv1).r,zf);}

float toHU(float n){return n*u_win.w+u_win.z;}
float normWin(float hu){return clamp((hu-(u_win.x-u_win.y*.5))/max(u_win.y,1.),0.,1.);}

vec3 calcGrad(vec3 p){
  float d=.006;
  return normalize(vec3(
    samp(p+vec3(d,0,0))-samp(p-vec3(d,0,0)),
    samp(p+vec3(0,d,0))-samp(p-vec3(0,d,0)),
    samp(p+vec3(0,0,d))-samp(p-vec3(0,0,d)))+.001);}

void main(){
  vec2 sc=(v-.5)*2./u_vp.w;
  vec3 rd=normalize(u_fwd+sc.x*u_right+sc.y*u_up);
  vec3 ro=u_eye+u_pan.x*u_right+u_pan.y*u_up;
  vec3 bMn=vec3(-.5),bMx=vec3(.5);
  vec3 inv2=1./rd;
  vec3 t0=(bMn-ro)*inv2,t1=(bMx-ro)*inv2;
  float tN=max(max(min(t0.x,t1.x),min(t0.y,t1.y)),min(t0.z,t1.z));
  float tF=min(min(max(t0.x,t1.x),max(t0.y,t1.y)),max(t0.z,t1.z));
  if(tN>tF||tF<0.){gl_FragColor=vec4(.02,.04,.09,1.);return;}
  int steps=u_ctrl.x;
  float tS=max(tN,0.),stepSz=(tF-tS)/float(steps);
  if(u_ctrl.y==0){
    float mx=0.;
    for(int i=0;i<256;i++){if(i>=steps)break;
      vec3 pos=ro+(tS+float(i)*stepSz)*rd+.5;
      float s=samp(pos);if(s>=0.)mx=max(mx,s);}
    gl_FragColor=vec4(mix(vec3(.02,.04,.09),u_c0,normWin(toHU(mx))),1.);}
  else{
    vec4 acc=vec4(0.);
    vec3 L=normalize(vec3(1.,1.6,.7));
    for(int i=0;i<256;i++){if(i>=steps)break;
      vec3 pos=ro+(tS+float(i)*stepSz)*rd+.5;
      float s=samp(pos);if(s<0.)continue;
      float hu=toHU(s);
      vec4 col=vec4(0.);
      if(hu>=u_tf0.x){
        float t=clamp((hu-u_tf0.x)/max(u_tf0.y-u_tf0.x,1.),0.,1.);
        vec3 n2=calcGrad(pos);float NdotL=max(dot(n2,L),0.);
        vec3 H=normalize(L-rd);float spec=pow(max(dot(n2,H),0.),64.)*.4;
        float light=u_tf0.w+(1.-u_tf0.w)*NdotL+spec;
        col=vec4(u_c0*light,u_tf0.z*min(t*2.,1.));}
      else if(hu>=u_tf1.x){
        float t=clamp((hu-u_tf1.x)/max(u_tf1.y-u_tf1.x,1.),0.,1.);
        vec3 n2=calcGrad(pos);float NdotL=max(dot(n2,L),0.);
        float light=u_tf0.w+(1.-u_tf0.w)*NdotL*.75;
        col=vec4(u_c1*light,u_tf1.z*t);}
      else if(hu>=u_tf2.x){
        float t=clamp((hu-u_tf2.x)/max(u_tf2.y-u_tf2.x,1.),0.,1.);
        col=vec4(u_c2,u_tf2.z*t);}
      acc.rgb+=col.rgb*col.a*(1.-acc.a);
      acc.a+=col.a*(1.-acc.a);
      if(acc.a>.97)break;}
    gl_FragColor=vec4(acc.rgb,1.);}
}`

interface TFPreset {
  name: string
  c0: [number,number,number]; h0a: number; h0b: number; a0max: number
  c1: [number,number,number]; h1a: number; h1b: number; a1max: number
  c2: [number,number,number]; h2a: number; h2b: number; a2max: number
  ambient: number
  wc: number; ww: number
}

const PRESETS: TFPreset[] = [
  { name:'CT Geral',
    c0:[.9,.85,.7],  h0a:300,  h0b:2000, a0max:.9,
    c1:[.75,.4,.4],  h1a:-100, h1b:400,  a1max:.2,
    c2:[.4,.5,.7],   h2a:-600, h2b:-100, a2max:.04,
    ambient:.15, wc:40, ww:400 },
  { name:'Osso',
    c0:[1.,.97,.88], h0a:200,  h0b:2000, a0max:.97,
    c1:[.35,.22,.22],h1a:-100, h1b:200,  a1max:.05,
    c2:[0.,0.,0.],   h2a:-2000,h2b:-600, a2max:0,
    ambient:.1,  wc:400, ww:1500 },
  { name:'Tec. Mole',
    c0:[.75,.7,.65], h0a:400,  h0b:2000, a0max:.28,
    c1:[.82,.46,.46],h1a:-100, h1b:400,  a1max:.42,
    c2:[.3,.4,.6],   h2a:-600, h2b:-100, a2max:.03,
    ambient:.22, wc:50, ww:350 },
  { name:'Pulmão',
    c0:[.85,.78,.65],h0a:300,  h0b:2000, a0max:.7,
    c1:[.6,.35,.35], h1a:-100, h1b:300,  a1max:.1,
    c2:[.5,.62,.88], h2a:-900, h2b:-100, a2max:.1,
    ambient:.15, wc:-600, ww:1500 },
  { name:'Cérebro',
    c0:[.72,.68,.62],h0a:300,  h0b:2000, a0max:.45,
    c1:[.78,.58,.52],h1a:-50,  h1b:300,  a1max:.48,
    c2:[.2,.3,.5],   h2a:-600, h2b:-50,  a2max:.02,
    ambient:.28, wc:40, ww:80 },
  { name:'Angio',
    c0:[1.,.75,.18], h0a:150,  h0b:2000, a0max:.98,
    c1:[.85,.2,.2],  h1a:-100, h1b:150,  a1max:.16,
    c2:[0.,0.,0.],   h2a:-2000,h2b:-600, a2max:0,
    ambient:.05, wc:300, ww:600 },
  { name:'MIP Max',
    c0:[.9,.85,.7],  h0a:300,  h0b:2000, a0max:.9,
    c1:[.75,.4,.4],  h1a:-100, h1b:400,  a1max:.2,
    c2:[.4,.5,.7],   h2a:-600, h2b:-100, a2max:.04,
    ambient:.15, wc:40, ww:400 },
]

interface AtlasMeta { tex: WebGLTexture; cols: number; rows: number; depth: number }
type ULocs = Record<string, WebGLUniformLocation | null>

const U_NAMES = [
  'u_atlas','u_vp','u_win',
  'u_eye','u_fwd','u_right','u_up','u_pan','u_ctrl',
  'u_c0','u_c1','u_c2','u_tf0','u_tf1','u_tf2',
]

export function View3D() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const glRef        = useRef<WebGLRenderingContext | null>(null)
  const progRef      = useRef<WebGLProgram | null>(null)
  const uLocsRef     = useRef<ULocs>({})
  const atlasRef     = useRef<AtlasMeta | null>(null)
  const rafRef       = useRef(0)

  // Refs (não state) para não re-renderizar o componente a cada frame de drag
  const azRef     = useRef(30)
  const elevRef   = useRef(20)
  const zoomRef   = useRef(1.2)
  const panRef    = useRef({ x: 0, y: 0 })
  const stepsRef  = useRef(48)
  const presetRef = useRef(0)
  const modeRef   = useRef<'mip'|'dvr'>('dvr')
  const wcRef     = useRef(0)
  const wwRef     = useRef(400)
  const vminRef   = useRef(0)
  const vrangeRef = useRef(1)

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragRef = useRef<{ mode:'orbit'|'pan'; x:number; y:number } | null>(null)

  const {
    volume, mpr, updateMpr,
    render3dMode, setRender3dMode,
    segLayers, addSegLayer, updateSegLayer, removeSegLayer,
  } = useStore()

  const [presetIdx, setPresetIdx]       = useState(0)
  const [isDragging, setIsDragging]     = useState(false)
  const [qualityDisplay, setQualityDisplay] = useState(48)
  const [ready, setReady]               = useState(false)
  const [buildPct, setBuildPct]         = useState(0)
  const [building, setBuilding]         = useState(false)
  const [showSeg, setShowSeg]           = useState(true)
  const [newLayer, setNewLayer]         = useState({ name:'Nova', huMin:200, huMax:1800, color:'#4fc3f7' })
  const [localWC, setLocalWC]           = useState(mpr.windowCenter)
  const [localWW, setLocalWW]           = useState(mpr.windowWidth)

  useEffect(() => { modeRef.current = render3dMode }, [render3dMode])
  useEffect(() => {
    wcRef.current = mpr.windowCenter
    wwRef.current = mpr.windowWidth
    setLocalWC(mpr.windowCenter)
    setLocalWW(mpr.windowWidth)
  }, [mpr.windowCenter, mpr.windowWidth])

  const renderFrame = useCallback(() => {
    const gl = glRef.current, prog = progRef.current, atlas = atlasRef.current
    if (!gl || !prog || !atlas) return
    const c = canvasRef.current!
    const W = c.width, H = c.height; if (!W || !H) return
    const ul = uLocsRef.current
    gl.viewport(0, 0, W, H); gl.useProgram(prog)

    const az = azRef.current, el = elevRef.current
    const azR = az * Math.PI / 180, elR = el * Math.PI / 180
    const eye: [number,number,number] = [
      Math.cos(elR)*Math.sin(azR)*1.8,
      Math.sin(elR)*1.8,
      Math.cos(elR)*Math.cos(azR)*1.8,
    ]
    const fwd: [number,number,number] = [-eye[0]/1.8, -eye[1]/1.8, -eye[2]/1.8]
    const nx = (v:[number,number,number]) => {
      const l = Math.hypot(...v) || 1; return [v[0]/l,v[1]/l,v[2]/l] as [number,number,number]
    }
    const wup: [number,number,number] = [0,1,0]
    const right: [number,number,number] = [
      fwd[1]*wup[2]-fwd[2]*wup[1], fwd[2]*wup[0]-fwd[0]*wup[2], fwd[0]*wup[1]-fwd[1]*wup[0],
    ]
    const up: [number,number,number] = [
      right[1]*fwd[2]-right[2]*fwd[1], right[2]*fwd[0]-right[0]*fwd[2], right[0]*fwd[1]-right[1]*fwd[0],
    ]

    gl.uniform4f(ul.u_vp, atlas.cols, atlas.rows, atlas.depth, zoomRef.current)
    gl.uniform4f(ul.u_win, wcRef.current, wwRef.current, vminRef.current, vrangeRef.current)
    gl.uniform3fv(ul.u_eye, eye)
    gl.uniform3fv(ul.u_fwd, nx(fwd))
    gl.uniform3fv(ul.u_right, nx(right))
    gl.uniform3fv(ul.u_up, nx(up))
    gl.uniform2fv(ul.u_pan, [panRef.current.x, panRef.current.y])
    gl.uniform2i(ul.u_ctrl, stepsRef.current, modeRef.current === 'mip' ? 0 : 1)

    const p = PRESETS[presetRef.current]
    gl.uniform3fv(ul.u_c0, p.c0)
    gl.uniform3fv(ul.u_c1, p.c1)
    gl.uniform3fv(ul.u_c2, p.c2)
    gl.uniform4f(ul.u_tf0, p.h0a, p.h0b, p.a0max, p.ambient)
    gl.uniform4f(ul.u_tf1, p.h1a, p.h1b, p.a1max, 0)
    gl.uniform4f(ul.u_tf2, p.h2a, p.h2b, p.a2max, 0)

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlas.tex); gl.uniform1i(ul.u_atlas, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }, [])

  useEffect(() => {
    let active = true
    const loop = () => { if (!active) return; renderFrame(); rafRef.current = requestAnimationFrame(loop) }
    rafRef.current = requestAnimationFrame(loop)
    return () => { active = false; cancelAnimationFrame(rafRef.current) }
  }, [renderFrame])

  // Aumenta gradualmente os steps de ray marching quando o usuário para de interagir (qualidade x fps)
  const stopIdleBoost = () => {
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null }
  }
  const startIdleBoost = useCallback(() => {
    stopIdleBoost()
    const boost = () => {
      stepsRef.current = Math.min(256, stepsRef.current + 64)
      setQualityDisplay(stepsRef.current)
      if (stepsRef.current < 256) idleTimerRef.current = setTimeout(boost, 380)
    }
    idleTimerRef.current = setTimeout(boost, 520)
  }, [])

  useEffect(() => {
    if (!volume) { setReady(false); return }
    const canvas = canvasRef.current; if (!canvas) return
    let gl = glRef.current
    if (!gl) {
      gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false })
      if (!gl) return
      glRef.current = gl
    }
    setReady(false); setBuilding(true); setBuildPct(0); stepsRef.current = 48

    const D = volume.depth
    const cols = Math.ceil(Math.sqrt(D)), rows = Math.ceil(D / cols)
    const W = volume.width, H = volume.height

    let vmin = Infinity, vmax = -Infinity
    const step2 = Math.max(1, Math.floor(volume.voxels.length / 50000))
    for (let i = 0; i < volume.voxels.length; i += step2) {
      if (volume.voxels[i] < vmin) vmin = volume.voxels[i]
      if (volume.voxels[i] > vmax) vmax = volume.voxels[i]
    }
    const range = vmax - vmin || 1
    vminRef.current   = vmin
    vrangeRef.current = range

    let cancelled = false

    // Reduz o tile até o atlas caber em MAX_TEXTURE_SIZE da GPU
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    let tileW = W, tileH = H
    while (cols * tileW > maxTex || rows * tileH > maxTex) {
      tileW = Math.max(64, tileW >> 1)
      tileH = Math.max(64, tileH >> 1)
    }
    const atlasW = cols * tileW, atlasH = rows * tileH
    const atlasPixels = new Uint8Array(atlasW * atlasH)

    function buildShaderProg(gl: WebGLRenderingContext) {
      if (progRef.current) gl.deleteProgram(progRef.current)
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
          console.error('[View3D] shader compile error:', gl.getShaderInfoLog(s))
        return s
      }
      const prog = gl.createProgram()!
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        console.error('[View3D] program link error:', gl.getProgramInfoLog(prog))
      progRef.current = prog
      const buf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(prog, 'a')
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
      const ul: ULocs = {}
      U_NAMES.forEach(n => { ul[n] = gl.getUniformLocation(prog, n) })
      uLocsRef.current = ul
    }

    buildShaderProg(gl)

    // Limpa erros GL pendentes do shader antes de criar a textura, exigido por drivers mais estritos
    // eslint-disable-next-line no-empty
    while (gl.getError() !== gl.NO_ERROR) {}

    const tex = gl.createTexture()
    if (!tex) {
      console.error('[View3D] gl.createTexture() returned null — WebGL context may be lost')
      setBuilding(false)
      return
    }
    gl.bindTexture(gl.TEXTURE_2D, tex)
    const bindErr = gl.getError()
    if (bindErr !== gl.NO_ERROR) {
      console.error('[View3D] gl.bindTexture failed, error code:', bindErr)
      setBuilding(false)
      return
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    atlasRef.current = { tex, cols, rows, depth: D }

    const uploadTex = (final: boolean) => {
      if (cancelled) return
      gl.bindTexture(gl.TEXTURE_2D, tex)
      // LUMINANCE (1 byte/px) em vez de RGBA — reduz memória de GPU em 4x
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, atlasW, atlasH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, atlasPixels)
      if (final) { setBuildPct(100); setBuilding(false); setReady(true); startIdleBoost() }
    }

    const CHUNK = 5
    const buildChunk = (z0: number) => {
      if (cancelled) return
      const z1 = Math.min(z0 + CHUNK, D)
      for (let z = z0; z < z1; z++) {
        const col = z % cols, row = Math.floor(z / cols)
        for (let ty = 0; ty < tileH; ty++) for (let tx = 0; tx < tileW; tx++) {
          const sx = tileW < W ? Math.round(tx * (W - 1) / (tileW - 1)) : tx
          const sy = tileH < H ? Math.round(ty * (H - 1) / (tileH - 1)) : ty
          const v2 = (volume.voxels[sx + sy*W + z*W*H] - vmin) / range
          atlasPixels[(row*tileH + ty) * atlasW + (col*tileW + tx)] =
            Math.round(Math.max(0, Math.min(1, v2)) * 255)
        }
      }
      setBuildPct(Math.round(z1/D * 90) + 5)
      if (z0 === 0 || z1 % 20 === 0 || z1 === D) uploadTex(z1 === D)
      if (z1 < D) setTimeout(() => buildChunk(z1), 6)
    }
    buildChunk(0)
    return () => { cancelled = true }
  }, [volume, startIdleBoost])

  useEffect(() => {
    const el = containerRef.current, c = canvasRef.current; if (!el || !c) return
    const ro = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect(); c.width = width; c.height = height
    })
    ro.observe(el); return () => ro.disconnect()
  }, [])

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    const gl = glRef.current
    if (gl) {
      if (atlasRef.current?.tex) gl.deleteTexture(atlasRef.current.tex)
      if (progRef.current) gl.deleteProgram(progRef.current)
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 1) e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { mode: e.button === 1 || e.ctrlKey ? 'pan' : 'orbit', x: e.clientX, y: e.clientY }
    stepsRef.current = 36; setQualityDisplay(36); setIsDragging(true); stopIdleBoost()
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.x, dy = e.clientY - dragRef.current.y
    dragRef.current.x = e.clientX; dragRef.current.y = e.clientY
    if (dragRef.current.mode === 'orbit') {
      azRef.current   += dx * 0.32
      elevRef.current  = Math.max(-88, Math.min(88, elevRef.current - dy * 0.32))
    } else {
      panRef.current.x += dx * 0.0022; panRef.current.y -= dy * 0.0022
    }
  }
  const onPointerUp = () => {
    dragRef.current = null; setIsDragging(false); stepsRef.current = 64; startIdleBoost()
  }
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const d = e.deltaY > 0 ? 1 : -1
    if (e.shiftKey)    updateMpr({ windowWidth: Math.max(1, mpr.windowWidth + d * 80) })
    else if (e.altKey) updateMpr({ windowCenter: mpr.windowCenter + d * 20 })
    else               zoomRef.current = Math.max(0.3, Math.min(5, zoomRef.current - d * 0.08))
    stepsRef.current = 36; startIdleBoost()
  }

  const resetCamera = () => {
    azRef.current = 30; elevRef.current = 20; zoomRef.current = 1.2; panRef.current = { x:0, y:0 }
  }
  const applyPreset = (idx: number) => {
    setPresetIdx(idx); presetRef.current = idx
    const p = PRESETS[idx]
    updateMpr({ windowCenter: p.wc, windowWidth: p.ww })
    if (p.name === 'MIP Max') { setRender3dMode('mip'); modeRef.current = 'mip' }
    else                      { setRender3dMode('dvr'); modeRef.current = 'dvr' }
  }
  const applyMode = (m: 'mip'|'dvr') => { setRender3dMode(m); modeRef.current = m }

  const tb = (active: boolean): React.CSSProperties => ({
    padding: '3px 9px', borderRadius: 5, fontSize: 10, fontWeight: 700,
    background: active ? 'rgba(0,180,217,0.15)' : 'transparent',
    border: `1px solid ${active ? 'var(--cyan)' : 'rgba(255,255,255,0.1)'}`,
    color: active ? 'var(--cyan)' : 'var(--text-m)', cursor: 'pointer',
  })
  const inputSt: React.CSSProperties = {
    width: 58, padding: '2px 5px', fontSize: 10, textAlign: 'center',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-p)', borderRadius: 5,
  }

  return (
    <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

      <div ref={containerRef} style={{ flex:1, position:'relative', background:'#02040a', overflow:'hidden' }}>

        {(ready || building) && (
          <div style={{
            position:'absolute', top:0, left:0, right:0, zIndex:20,
            display:'flex', alignItems:'center', gap:6, flexWrap:'wrap',
            background:'linear-gradient(to bottom,rgba(2,4,10,.96),rgba(2,4,10,.72))',
            borderBottom:'1px solid rgba(255,255,255,0.06)',
            padding:'5px 10px', backdropFilter:'blur(6px)',
          }}>
            <select value={presetIdx} onChange={e => applyPreset(+e.target.value)}
              style={{ fontSize:10, padding:'3px 6px', background:'rgba(255,255,255,0.07)',
                border:'1px solid rgba(255,255,255,0.13)', color:'var(--text-p)',
                borderRadius:6, cursor:'pointer', minWidth:100 }}>
              {PRESETS.map((p,i) => <option key={i} value={i}>{p.name}</option>)}
            </select>
            <div style={{ width:1, height:14, background:'rgba(255,255,255,0.09)' }}/>
            <div style={{ display:'flex', gap:2 }}>
              <button style={tb(render3dMode==='dvr')} onClick={() => applyMode('dvr')}>DVR</button>
              <button style={tb(render3dMode==='mip')} onClick={() => applyMode('mip')}>MIP</button>
            </div>
            <div style={{ width:1, height:14, background:'rgba(255,255,255,0.09)' }}/>
            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ fontSize:9, color:'var(--text-m)' }}>WC</span>
              <input type="number" value={localWC} style={inputSt}
                onChange={e => setLocalWC(+e.target.value)}
                onBlur={() => updateMpr({ windowCenter: localWC })}
                onKeyDown={e => { if (e.key==='Enter') (e.target as HTMLInputElement).blur() }}/>
              <span style={{ fontSize:9, color:'var(--text-m)' }}>WW</span>
              <input type="number" value={localWW} style={inputSt}
                onChange={e => setLocalWW(+e.target.value)}
                onBlur={() => updateMpr({ windowWidth: Math.max(1, localWW) })}
                onKeyDown={e => { if (e.key==='Enter') (e.target as HTMLInputElement).blur() }}/>
            </div>
            <div style={{ flex:1 }}/>
            <button onClick={resetCamera} title="Resetar câmera"
              style={{ padding:'3px 8px', borderRadius:5, fontSize:9, background:'transparent',
                border:'1px solid rgba(255,255,255,0.08)', color:'var(--text-m)', cursor:'pointer' }}>
              ↺ Reset
            </button>
            <span style={{ fontSize:9, color:'var(--text-d)', fontFamily:'var(--font-m)', minWidth:36 }}>
              Q:{qualityDisplay}
            </span>
          </div>
        )}

        <canvas ref={canvasRef}
          style={{ display:'block', width:'100%', height:'100%', cursor: isDragging ? 'grabbing' : 'grab' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
          onWheel={onWheel} onContextMenu={e => e.preventDefault()}/>

        {(building || (!ready && volume)) && (
          <div style={{ position:'absolute', inset:0, background:'rgba(2,4,10,0.75)',
            display:'flex', alignItems:'center', justifyContent:'center', zIndex:10 }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12,
              background:'var(--bg-elevated)', border:'1px solid var(--border-b)',
              borderRadius:'var(--r-xl)', padding:'28px 44px', minWidth:240 }}>
              <div style={{ width:30, height:30, border:'3px solid rgba(0,180,217,0.15)',
                borderTopColor:'var(--cyan)', borderRadius:'50%', animation:'spin .8s linear infinite' }}/>
              <div style={{ fontSize:12, color:'var(--text-s)' }}>Construindo atlas de textura…</div>
              <div style={{ width:190, height:4, background:'var(--bg-overlay)', borderRadius:2 }}>
                <div style={{ height:'100%', width:`${buildPct}%`,
                  background:'linear-gradient(90deg,var(--cyan),var(--purple))', borderRadius:2, transition:'width .25s' }}/>
              </div>
              <div style={{ fontSize:10, color:'var(--text-m)' }}>{buildPct}% — renderizando progressivamente</div>
            </div>
          </div>
        )}

        {!volume && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center',
            justifyContent:'center', flexDirection:'column', gap:12, color:'var(--text-d)' }}>
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.7" opacity={0.35}>
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
            <span style={{ fontSize:13 }}>Carregue um volume para renderização 3D</span>
          </div>
        )}

        {ready && !building && (
          <div style={{ position:'absolute', bottom:8, left:'50%', transform:'translateX(-50%)',
            background:'rgba(4,7,14,0.82)', border:'1px solid rgba(255,255,255,0.07)',
            borderRadius:100, padding:'4px 14px', backdropFilter:'blur(6px)', whiteSpace:'nowrap' }}>
            <span style={{ fontSize:9, color:'var(--text-d)' }}>
              LMB orbitar · MMB/Ctrl pan · Scroll zoom · Shift+Scroll WW · Alt+Scroll WC
            </span>
          </div>
        )}
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>

      {showSeg && (
        <div style={{ width:214, minWidth:214, background:'var(--bg-surface)',
          borderLeft:'1px solid var(--border-s)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'7px 10px', borderBottom:'1px solid var(--border-s)', flexShrink:0 }}>
            <span style={{ fontSize:9, color:'var(--cyan)', textTransform:'uppercase', letterSpacing:'0.1em' }}>Segmentação</span>
            <button onClick={() => setShowSeg(false)} style={{ color:'var(--text-m)', fontSize:12 }}>✕</button>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:8, display:'flex', flexDirection:'column', gap:6 }}>
            {segLayers.map(layer => (
              <div key={layer.id} style={{ background:'var(--bg-elevated)', borderRadius:'var(--r-md)',
                padding:8, border:'1px solid var(--border-d)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                  <div style={{ width:12, height:12, borderRadius:3, background:layer.color, flexShrink:0 }}/>
                  <span style={{ flex:1, fontSize:11, fontWeight:600,
                    color: layer.visible ? 'var(--text-p)' : 'var(--text-m)' }}>{layer.name}</span>
                  <button onClick={() => updateSegLayer(layer.id,{visible:!layer.visible})}
                    style={{ fontSize:11, color: layer.visible ? 'var(--cyan)' : 'var(--text-d)' }}>
                    {layer.visible ? '●' : '○'}
                  </button>
                  <button onClick={() => removeSegLayer(layer.id)} style={{ fontSize:10, color:'var(--red)' }}>✕</button>
                </div>
                <div style={{ fontSize:9, color:'var(--text-m)', marginBottom:4 }}>HU {layer.huMin}→{layer.huMax}</div>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ fontSize:9, color:'var(--text-m)', minWidth:28 }}>Opac.</span>
                  <input type="range" min={0} max={1} step={0.05} value={layer.opacity}
                    onChange={e => updateSegLayer(layer.id,{opacity:+e.target.value})}
                    style={{ flex:1, height:3, accentColor:layer.color }}/>
                  <span style={{ fontSize:9, color:'var(--text-m)', minWidth:24 }}>{Math.round(layer.opacity*100)}%</span>
                </div>
              </div>
            ))}
            <div style={{ background:'var(--bg-panel)', borderRadius:'var(--r-md)', padding:9, border:'1px solid var(--border-s)' }}>
              <div style={{ fontSize:9, color:'var(--cyan)', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:7 }}>Nova Camada</div>
              <input value={newLayer.name} placeholder="Nome"
                onChange={e => setNewLayer(n => ({...n,name:e.target.value}))}
                style={{ width:'100%', marginBottom:5, padding:'4px 6px', fontSize:11 }}/>
              <div style={{ display:'flex', gap:4, marginBottom:5 }}>
                <input type="number" value={newLayer.huMin} placeholder="HU min"
                  onChange={e => setNewLayer(n => ({...n,huMin:+e.target.value}))}
                  style={{ flex:1, padding:'4px 5px', fontSize:10 }}/>
                <input type="number" value={newLayer.huMax} placeholder="HU max"
                  onChange={e => setNewLayer(n => ({...n,huMax:+e.target.value}))}
                  style={{ flex:1, padding:'4px 5px', fontSize:10 }}/>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:7 }}>
                <input type="color" value={newLayer.color}
                  onChange={e => setNewLayer(n => ({...n,color:e.target.value}))}
                  style={{ width:24, height:22, borderRadius:4, border:'none', padding:1, background:'none', cursor:'pointer' }}/>
                <span style={{ fontSize:9, color:'var(--text-m)' }}>Cor</span>
              </div>
              <button onClick={() => addSegLayer(newLayer.name, newLayer.huMin, newLayer.huMax, newLayer.color)}
                style={{ width:'100%', padding:'5px 8px', borderRadius:'var(--r-sm)', fontSize:11,
                  background:'var(--cyan-d)', border:'1px solid var(--cyan)', color:'var(--cyan)', cursor:'pointer' }}>
                + Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {!showSeg && (
        <button onClick={() => setShowSeg(true)}
          style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
            padding:'8px 4px', borderRadius:'var(--r-sm)', background:'var(--bg-elevated)',
            border:'1px solid var(--border-d)', color:'var(--text-m)', fontSize:9, writingMode:'vertical-rl' }}>
          Seg
        </button>
      )}
    </div>
  )
}
