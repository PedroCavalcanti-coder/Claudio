import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useStore, genId } from '../store'
import type { PlaneType, Annotation, AnnotationShape, Point } from '../store'
import { canvasToImg, imgToCanvas, dist } from '../utils/render'
import { renderAnnotations, hitTest } from '../utils/annotations'
import { extractAxial, extractSagital, extractCoronal, renderSlice } from '../utils/mpr'

function cobbDeg(p1:{x:number;y:number},p2:{x:number;y:number},p3:{x:number;y:number},p4:{x:number;y:number}):number{
  const v1x=p2.x-p1.x,v1y=p2.y-p1.y,v2x=p4.x-p3.x,v2y=p4.y-p3.y
  const dot=v1x*v2x+v1y*v2y,mag=Math.hypot(v1x,v1y)*Math.hypot(v2x,v2y)||1
  return(Math.acos(Math.min(1,Math.abs(dot/mag)))*180)/Math.PI
}

// Hit-test whether canvas point (cx,cy) is inside the rotated text box
function insideTextBox(cx:number,cy:number,sh:AnnotationShape,cw:number,ch:number,iw:number,ih:number,px:number,py:number,zoom:number):boolean{
  if(!sh.position) return false
  const tl=imgToCanvas(sh.position.x,sh.position.y,cw,ch,iw,ih,px,py,zoom)
  const bw=(sh.width||160)*zoom, bh=(sh.height||70)*zoom
  const bcx=tl.x+bw/2, bcy=tl.y+bh/2
  const rot=-((sh.textRotation||0)*Math.PI)/180
  const rx=Math.cos(rot)*(cx-bcx)-Math.sin(rot)*(cy-bcy)
  const ry=Math.sin(rot)*(cx-bcx)+Math.cos(rot)*(cy-bcy)
  return Math.abs(rx)<=bw/2+6&&Math.abs(ry)<=bh/2+6
}

// Canvas-space layout for a text box (used by handle overlay)
function textBoxLayout(sh:AnnotationShape,cw:number,ch:number,iw:number,ih:number,px:number,py:number,zoom:number){
  const tl=imgToCanvas(sh.position!.x,sh.position!.y,cw,ch,iw,ih,px,py,zoom)
  const bw=(sh.width||160)*zoom, bh=(sh.height||70)*zoom
  const cx=tl.x+bw/2, cy=tl.y+bh/2
  const rot=((sh.textRotation||0)*Math.PI)/180
  const tp=(lx:number,ly:number)=>({x:cx+Math.cos(rot)*lx-Math.sin(rot)*ly,y:cy+Math.sin(rot)*lx+Math.cos(rot)*ly})
  return{cx,cy,bw,bh,rot,tlx:tl.x,tly:tl.y,
    handles:{
      tl:tp(-bw/2,-bh/2),tc:tp(0,-bh/2),tr:tp(bw/2,-bh/2),
      ml:tp(-bw/2,0),mr:tp(bw/2,0),
      bl:tp(-bw/2,bh/2),bc:tp(0,bh/2),br:tp(bw/2,bh/2),
      rot:tp(0,-bh/2-24),
    }
  }
}

const HANDLE_CURSORS: Record<string,string>={tl:'nwse-resize',tc:'ns-resize',tr:'nesw-resize',ml:'ew-resize',mr:'ew-resize',bl:'nesw-resize',bc:'ns-resize',br:'nwse-resize',rot:'alias'}
const PLANE_COLORS:Record<PlaneType,string>={axial:'#f72585',sagital:'#4cc9f0',coronal:'#7bed9f'}
const DRAG_TYPE='application/x-orthovis-plane'

interface Props{vpId:string;isActive:boolean;onClick:()=>void}

export function SliceViewport({vpId,isActive,onClick}:Props){
  const imgRef=useRef<HTMLCanvasElement>(null)
  const annRef=useRef<HTMLCanvasElement>(null)
  const containerRef=useRef<HTMLDivElement>(null)
  const [isDrop,setIsDrop]=useState(false)
  const [,setIsDrawing]=useState(false)
  const [selectedTextId,setSelectedTextId]=useState<string|null>(null)
  // bump p/ re-render quando um corte full-res termina de decodificar (streaming)
  const [sliceVer,setSliceVer]=useState(0)

  const {volume,updateMpr,viewports,updateViewport,setViewportPlane,
    activeTool,annotationStyle,addAnnotation,removeAnnotation,updateAnnotation,
    cineActive,cineFps}=useStore()

  const vp=viewports[vpId]
  const plane=vp?.plane||'axial'
  const color=PLANE_COLORS[plane]

  // em streaming, o plano axial usa profundidade/espaçamento full-res (não o volume reduzido)
  const streamAxial=!!volume?.stream&&plane==='axial'
  const totalSlices=!volume?1:streamAxial?volume.stream!.fullDepth:plane==='axial'?volume.depth:plane==='sagital'?volume.width:volume.height
  const spX=!volume?1:streamAxial?volume.stream!.fullSpacingX:plane==='axial'||plane==='coronal'?volume.spacingX:volume.spacingY
  const spY=!volume?1:streamAxial?volume.stream!.fullSpacingY:plane==='axial'?volume.spacingY:volume.spacingZ

  const getSlice=useCallback(()=>{
    if(!volume||!vp)return null
    const idx=vp.currentIndex
    // streaming: axial full-res sob demanda; enquanto decodifica, mostra a prévia reduzida
    if(volume.stream&&plane==='axial'){
      const full=volume.stream.getSlice(idx)
      if(full)return{pixels:full,width:volume.stream.fullWidth,height:volume.stream.fullHeight}
      const rz=Math.round(idx*volume.depth/volume.stream.fullDepth)
      return extractAxial(volume,rz)
    }
    return plane==='axial'?extractAxial(volume,idx):plane==='sagital'?extractSagital(volume,idx):extractCoronal(volume,idx)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[volume,vp,plane,sliceVer])

  const renderImg=useCallback(()=>{
    const c=imgRef.current;if(!c||!volume||!vp)return
    const sl=getSlice();if(!sl)return
    const img=renderSlice(sl,vp.windowCenter,vp.windowWidth,vp.invert,'grayscale',vp.brightness,vp.contrast)
    c.width=sl.width;c.height=sl.height
    c.getContext('2d')!.putImageData(img,0,0)
  },[vp,volume,getSlice])

  const renderAnns=useCallback((extra?:Annotation)=>{
    const c=annRef.current;if(!c||!vp)return
    const sl=getSlice()
    const ctx=c.getContext('2d')!
    const sliceAnns=vp.annotations.filter(a=>a.sliceIndex===vp.currentIndex)
    const allAnns=extra?[...sliceAnns,extra]:sliceAnns
    renderAnnotations(ctx,allAnns,c.width,c.height,sl?.width||512,sl?.height||512,vp.panX,vp.panY,vp.zoom,spX,spY)
  },[vp,getSlice,spX,spY])

  useEffect(()=>{if(activeTool!=='text')setSelectedTextId(null)},[activeTool])

  useEffect(()=>{
    if(!cineActive||!isActive||!volume)return
    const ms=Math.round(1000/Math.max(1,cineFps))
    const id=setInterval(()=>{
      const{viewports:vps,updateViewport:upVP,updateMpr:upMpr}=useStore.getState()
      const cur=vps[vpId];if(!cur)return
      const next=(cur.currentIndex+1)%totalSlices
      upVP(vpId,{currentIndex:next})
      if(plane==='axial')upMpr({axialIndex:next})
      else if(plane==='sagital')upMpr({sagittalIndex:next})
      else upMpr({coronalIndex:next})
    },ms)
    return()=>clearInterval(id)
  },[isActive,cineActive,cineFps,vpId,plane,volume,totalSlices])

  useEffect(()=>{renderImg()},[renderImg])
  useEffect(()=>{renderAnns()},[renderAnns])

  // streaming axial: garante o corte full-res do índice atual + prefetch dos vizinhos
  useEffect(()=>{
    if(!volume?.stream||plane!=='axial'||!vp)return
    const z=vp.currentIndex
    volume.stream.prefetch(z)
    if(volume.stream.getSlice(z))return
    let cancelled=false
    volume.stream.ensureSlice(z).then(()=>{if(!cancelled)setSliceVer(v=>v+1)})
    return()=>{cancelled=true}
  },[volume,plane,vp?.currentIndex])

  useEffect(()=>{
    const el=containerRef.current;if(!el)return
    const ro=new ResizeObserver(()=>{
      if(annRef.current){const r=el.getBoundingClientRect();annRef.current.width=r.width;annRef.current.height=r.height}
      renderAnns()
    })
    ro.observe(el);return()=>ro.disconnect()
  },[renderAnns])

  const evToImg=useCallback((e:React.MouseEvent)=>{
    const c=annRef.current!;const r=c.getBoundingClientRect();const sl=getSlice()
    return canvasToImg(e.clientX-r.left,e.clientY-r.top,c.width,c.height,sl?.width||512,sl?.height||512,vp?.panX||0,vp?.panY||0,vp?.zoom||1)
  },[vp,getSlice])

  const evToCanvas=useCallback((e:React.MouseEvent)=>{
    const c=annRef.current!;const r=c.getBoundingClientRect()
    return{x:e.clientX-r.left,y:e.clientY-r.top}
  },[])

  const getHU=useCallback((ip:Point)=>{
    if(!volume||!vp)return 0
    const x=Math.round(ip.x),y=Math.round(ip.y),W=volume.width,H=volume.height,sl=getSlice()
    if(!sl||x<0||y<0||x>=sl.width||y>=sl.height)return 0
    const idx=vp.currentIndex
    // streaming axial: amostra direto o corte exibido (full-res ou prévia)
    if(volume.stream&&plane==='axial')return sl.pixels[x+y*sl.width]
    if(plane==='axial')return volume.voxels[x+y*W+idx*W*H]
    if(plane==='sagital')return volume.voxels[idx+y*W+(sl.height-1-Math.round(y>sl.height-1?sl.height-1:y))*W*H]
    return volume.voxels[x+idx*W+(sl.height-1-y)*W*H]
  },[volume,vp,plane,getSlice])

  const drawRef=useRef({
    active:false,start:{x:0,y:0},cur:{x:0,y:0},
    fh:[] as Point[],
    angStep:0,angP1:null as Point|null,angV:null as Point|null,
    cobbStep:0,cobbP1:null as Point|null,cobbP2:null as Point|null,
    polyPoints:[] as Point[],
  })
  const interRef=useRef({down:false,lx:0,ly:0,swc:0,sww:0,spx:0,spy:0})

  // ── Rich text popup state ─────────────────────────────────────────────────
  const [showTxt,setShowTxt]=useState(false)
  const [txtState,setTxtState]=useState({cx:0,cy:0,ix:0,iy:0,val:'',editId:null as string|null})

  const isAnn=['ruler','bidirectional','arrow','circle','rectangle','roi_ellipse','roi_rect',
    'text','probe','angle','cobb','freehand','polygon','eraser'].includes(activeTool)

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{
      if(e.key!=='Escape')return
      const d=drawRef.current
      d.active=false;d.fh=[];d.angStep=0;d.angP1=null;d.angV=null
      d.cobbStep=0;d.cobbP1=null;d.cobbP2=null;d.polyPoints=[]
      setIsDrawing(false);renderAnns()
      if(activeTool==='text'){setSelectedTextId(null);setShowTxt(false)}
    }
    window.addEventListener('keydown',h)
    return()=>window.removeEventListener('keydown',h)
  },[renderAnns,activeTool])

  // Delete selected text box with Backspace/Delete
  useEffect(()=>{
    if(!selectedTextId)return
    const h=(e:KeyboardEvent)=>{
      if(e.key==='Delete'||e.key==='Backspace'){
        if((e.target as HTMLElement).tagName==='INPUT'||(e.target as HTMLElement).tagName==='TEXTAREA')return
        removeAnnotation(vpId,selectedTextId);setSelectedTextId(null)
      }
    }
    window.addEventListener('keydown',h)
    return()=>window.removeEventListener('keydown',h)
  },[selectedTextId,vpId,removeAnnotation])

  const computeROIEllipse=useCallback((center:Point,radius:number)=>{
    const step=Math.max(1,Math.floor(radius/30)),values:number[]=[]
    for(let dy=-radius;dy<=radius;dy+=step)
      for(let dx=-radius;dx<=radius;dx+=step)
        if(dx*dx+dy*dy<=radius*radius)values.push(getHU({x:center.x+dx,y:center.y+dy}))
    if(!values.length)return{}
    const mean=values.reduce((a,b)=>a+b,0)/values.length
    return{huMean:mean,huStd:Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length),huMin:Math.min(...values),huMax:Math.max(...values)}
  },[getHU])

  const computeROIRect=useCallback((p1:Point,p2:Point)=>{
    const x0=Math.min(p1.x,p2.x),x1=Math.max(p1.x,p2.x)
    const y0=Math.min(p1.y,p2.y),y1=Math.max(p1.y,p2.y)
    const step=Math.max(1,Math.floor(Math.min(x1-x0,y1-y0)/40)),values:number[]=[]
    for(let y=y0;y<=y1;y+=step)for(let x=x0;x<=x1;x+=step)values.push(getHU({x,y}))
    if(!values.length)return{}
    const mean=values.reduce((a,b)=>a+b,0)/values.length
    return{huMean:mean,huStd:Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length),huMin:Math.min(...values),huMax:Math.max(...values)}
  },[getHU])

  const commit=useCallback((shape:any)=>{
    addAnnotation(vpId,{id:genId(),shape,color:annotationStyle.color,lineWidth:annotationStyle.lineWidth,fontSize:annotationStyle.fontSize,createdAt:Date.now(),sliceIndex:vp?.currentIndex??0})
  },[vpId,annotationStyle,addAnnotation,vp])

  // ── Text-box handle drag ──────────────────────────────────────────────────
  const textDragRef=useRef<{
    mode:'move'|'resize'|'rotate'
    handle?:string
    startCX:number;startCY:number
    startShape:AnnotationShape
  }|null>(null)

  const startTextDrag=useCallback((mode:'move'|'resize'|'rotate',e:React.MouseEvent,handle?:string)=>{
    e.preventDefault();e.stopPropagation()
    if(!selectedTextId||!vp)return
    const ann=vp.annotations.find(a=>a.id===selectedTextId)
    if(!ann)return
    textDragRef.current={mode,handle,startCX:e.clientX,startCY:e.clientY,startShape:{...ann.shape}}

    const onMove=(ev:MouseEvent)=>{
      const drag=textDragRef.current;if(!drag)return
      const sh=drag.startShape
      const c=annRef.current!
      const zoom=vp?.zoom||1
      const dx_c=ev.clientX-drag.startCX,dy_c=ev.clientY-drag.startCY
      const dx_i=dx_c/zoom,dy_i=dy_c/zoom

      if(drag.mode==='move'&&sh.position){
        updateAnnotation(vpId,selectedTextId!,{shape:{...sh,position:{x:sh.position.x+dx_i,y:sh.position.y+dy_i}}})
      } else if(drag.mode==='resize'&&sh.position){
        let newX=sh.position.x,newY=sh.position.y
        let newW=sh.width||160,newH=sh.height||70
        const h2=drag.handle||'br'
        if(h2.includes('r'))newW=Math.max(40,newW+dx_i)
        if(h2.includes('l')){newW=Math.max(40,newW-dx_i);newX+=dx_i}
        if(h2.includes('b')&&!h2.includes('t'))newH=Math.max(24,newH+dy_i)
        if(h2==='tc'||h2==='tl'||h2==='tr'){newH=Math.max(24,newH-dy_i);newY+=dy_i}
        updateAnnotation(vpId,selectedTextId!,{shape:{...sh,position:{x:newX,y:newY},width:newW,height:newH}})
      } else if(drag.mode==='rotate'&&sh.position){
        const tl=imgToCanvas(sh.position.x,sh.position.y,c.width,c.height,getSlice()?.width||512,getSlice()?.height||512,vp?.panX||0,vp?.panY||0,zoom)
        const bw=(sh.width||160)*zoom,bh=(sh.height||70)*zoom
        const bcx=tl.x+bw/2,bcy=tl.y+bh/2
        const rect=c.getBoundingClientRect()
        const angle=Math.atan2(ev.clientY-rect.top-bcy,ev.clientX-rect.left-bcx)*180/Math.PI+90
        updateAnnotation(vpId,selectedTextId!,{shape:{...sh,textRotation:angle}})
      }
    }
    const onUp=()=>{
      textDragRef.current=null
      window.removeEventListener('mousemove',onMove)
      window.removeEventListener('mouseup',onUp)
    }
    window.addEventListener('mousemove',onMove)
    window.addEventListener('mouseup',onUp)
  },[selectedTextId,vp,vpId,updateAnnotation,getSlice])

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const handleMouseDown=useCallback((e:React.MouseEvent)=>{
    onClick()
    if(e.button!==0||!volume)return
    const ip=evToImg(e),cp=evToCanvas(e),d=drawRef.current

    if(activeTool==='text'){
      // Click on existing text box → select
      const c=annRef.current!,sl=getSlice()
      const textAnns=(vp?.annotations||[]).filter(a=>a.sliceIndex===vp?.currentIndex&&a.shape.type==='text')
      for(const ann of textAnns){
        if(insideTextBox(cp.x,cp.y,ann.shape,c.width,c.height,sl?.width||512,sl?.height||512,vp?.panX||0,vp?.panY||0,vp?.zoom||1)){
          setSelectedTextId(ann.id);setShowTxt(false);return
        }
      }
      // Click on empty space → deselect + open creation dialog
      setSelectedTextId(null)
      setTxtState({cx:cp.x,cy:cp.y,ix:ip.x,iy:ip.y,val:'',editId:null})
      setShowTxt(true);return
    }

    if(activeTool==='eraser'){
      const c=annRef.current!,sl=getSlice()
      const sliceAnns=vp?.annotations.filter(a=>a.sliceIndex===vp.currentIndex)||[]
      const hit=sliceAnns.find(a=>hitTest(cp.x,cp.y,a,c.width,c.height,sl?.width||512,sl?.height||512,vp.panX,vp.panY,vp.zoom))
      if(hit)removeAnnotation(vpId,hit.id);return
    }
    if(activeTool==='probe'){commit({type:'probe',position:ip,hu:getHU(ip)});return}

    if(activeTool==='angle'){
      if(d.angStep===0){d.angP1=ip;d.angStep=1;d.active=true;setIsDrawing(true)}
      else if(d.angStep===1){d.angV=ip;d.angStep=2}
      else{
        const p1=d.angP1!,v=d.angV!,v1={x:p1.x-v.x,y:p1.y-v.y},v2={x:ip.x-v.x,y:ip.y-v.y}
        const cos=Math.max(-1,Math.min(1,(v1.x*v2.x+v1.y*v2.y)/(Math.hypot(v1.x,v1.y)*Math.hypot(v2.x,v2.y))))
        commit({type:'angle',p1,vertex:v,p2:ip,degrees:(Math.acos(cos)*180)/Math.PI})
        d.angStep=0;d.angP1=null;d.angV=null;d.active=false;setIsDrawing(false)
      };return
    }
    if(activeTool==='cobb'){d.active=true;d.start=ip;d.cur=ip;setIsDrawing(true);return}
    if(activeTool==='polygon'){
      const pts=d.polyPoints
      if(pts.length===0){pts.push(ip);setIsDrawing(true);return}
      const c2=annRef.current!,sl=getSlice()
      const first=imgToCanvas(pts[0].x,pts[0].y,c2.width,c2.height,sl?.width||512,sl?.height||512,vp?.panX||0,vp?.panY||0,vp?.zoom||1)
      if(dist(cp,first)<14&&pts.length>2){commit({type:'polygon',points:[...pts]});d.polyPoints=[];setIsDrawing(false)}
      else pts.push(ip);return
    }
    if(activeTool==='freehand'){d.active=true;d.fh=[ip];setIsDrawing(true);return}
    if(isAnn){d.active=true;d.start=ip;d.cur=ip;setIsDrawing(true);return}

    interRef.current={down:true,lx:e.clientX,ly:e.clientY,swc:vp?.windowCenter||400,sww:vp?.windowWidth||1500,spx:vp?.panX||0,spy:vp?.panY||0}
    e.preventDefault()
  },[onClick,volume,activeTool,evToImg,evToCanvas,vp,vpId,commit,getHU,removeAnnotation,getSlice,isAnn])

  const handleMouseMove=useCallback((e:React.MouseEvent)=>{
    const d=drawRef.current,ip=evToImg(e)
    const prev={id:'__p__',color:annotationStyle.color,lineWidth:annotationStyle.lineWidth,fontSize:annotationStyle.fontSize,createdAt:0,sliceIndex:vp?.currentIndex??0}
    if(activeTool==='freehand'&&d.active){d.fh.push(ip);renderAnns({...prev,shape:{type:'freehand',points:[...d.fh]}});return}
    if(activeTool==='polygon'&&d.polyPoints.length>0){renderAnns({...prev,shape:{type:'polygon',points:[...d.polyPoints,ip]}});return}
    if(isAnn&&d.active&&!['probe','eraser','text','freehand','angle','polygon'].includes(activeTool)){
      d.cur=ip;let sh:any=null
      if(activeTool==='ruler')sh={type:'ruler',p1:d.start,p2:ip}
      else if(activeTool==='bidirectional'){
        const dx=ip.x-d.start.x,dy=ip.y-d.start.y,len=Math.hypot(dx,dy)||1
        const mid={x:(d.start.x+ip.x)/2,y:(d.start.y+ip.y)/2}
        const perp=len*0.5,nx=-dy/len,ny=dx/len
        sh={type:'bidirectional',p1:d.start,p2:ip,p3:{x:mid.x+nx*perp/2,y:mid.y+ny*perp/2},p4:{x:mid.x-nx*perp/2,y:mid.y-ny*perp/2}}
      }
      else if(activeTool==='cobb'){
        if(d.cobbStep===0)sh={type:'ruler',p1:d.start,p2:ip}
        else{const deg=cobbDeg(d.cobbP1!,d.cobbP2!,d.start,ip);sh={type:'cobb',p1:d.cobbP1!,p2:d.cobbP2!,p3:d.start,p4:ip,degrees:deg}}
      }
      else if(activeTool==='arrow')sh={type:'arrow',p1:d.start,p2:ip}
      else if(activeTool==='circle')sh={type:'circle',center:d.start,radius:dist(d.start,ip)}
      else if(activeTool==='roi_ellipse')sh={type:'roi_ellipse',center:d.start,radius:dist(d.start,ip)}
      else if(activeTool==='rectangle')sh={type:'rectangle',p1:d.start,p2:ip}
      else if(activeTool==='roi_rect')sh={type:'roi_rect',p1:d.start,p2:ip}
      if(sh)renderAnns({...prev,shape:sh});return
    }
    const st=interRef.current;if(!st.down)return
    if(activeTool==='windowing')updateViewport(vpId,{windowWidth:Math.max(1,st.sww+(e.clientX-st.lx)*10),windowCenter:st.swc-(e.clientY-st.ly)*5})
    else if(activeTool==='pan')updateViewport(vpId,{panX:st.spx+(e.clientX-st.lx),panY:st.spy+(e.clientY-st.ly)})
    else if(activeTool==='zoom')updateViewport(vpId,{zoom:Math.max(0.1,Math.min(20,(vp?.zoom||1)-(e.clientY-st.ly)*0.01))})
  },[activeTool,evToImg,vp,vpId,updateViewport,annotationStyle,renderAnns,isAnn])

  const handleMouseUp=useCallback((e:React.MouseEvent)=>{
    interRef.current.down=false
    const d=drawRef.current;if(!d.active)return
    const ip=evToImg(e)
    if(activeTool==='freehand'){if(d.fh.length>1)commit({type:'freehand',points:[...d.fh]});d.active=false;d.fh=[];setIsDrawing(false);return}
    if(activeTool==='angle'||activeTool==='polygon')return
    if(activeTool==='cobb'){
      if(d.cobbStep===0){d.cobbP1=d.start;d.cobbP2=ip;d.cobbStep=1;d.active=false;return}
      else{const deg=cobbDeg(d.cobbP1!,d.cobbP2!,d.start,ip);commit({type:'cobb',p1:d.cobbP1!,p2:d.cobbP2!,p3:d.start,p4:ip,degrees:deg});d.cobbStep=0;d.cobbP1=null;d.cobbP2=null;d.active=false;setIsDrawing(false);return}
    }
    let sh:any=null
    if(activeTool==='ruler')sh={type:'ruler',p1:d.start,p2:ip}
    else if(activeTool==='bidirectional'){
      const dx=ip.x-d.start.x,dy=ip.y-d.start.y,len=Math.hypot(dx,dy)||1
      const mid={x:(d.start.x+ip.x)/2,y:(d.start.y+ip.y)/2}
      const perp=len*0.5,nx=-dy/len,ny=dx/len
      sh={type:'bidirectional',p1:d.start,p2:ip,p3:{x:mid.x+nx*perp/2,y:mid.y+ny*perp/2},p4:{x:mid.x-nx*perp/2,y:mid.y-ny*perp/2}}
    }
    else if(activeTool==='arrow')sh={type:'arrow',p1:d.start,p2:ip}
    else if(activeTool==='circle'){const r=dist(d.start,ip);if(r>2)sh={type:'circle',center:d.start,radius:r}}
    else if(activeTool==='roi_ellipse'){const r=dist(d.start,ip);if(r>5)sh={type:'roi_ellipse',center:d.start,radius:r,...computeROIEllipse(d.start,r)}}
    else if(activeTool==='rectangle'){if(Math.abs(ip.x-d.start.x)>4&&Math.abs(ip.y-d.start.y)>4)sh={type:'rectangle',p1:d.start,p2:ip}}
    else if(activeTool==='roi_rect'){if(Math.abs(ip.x-d.start.x)>4&&Math.abs(ip.y-d.start.y)>4)sh={type:'roi_rect',p1:d.start,p2:ip,...computeROIRect(d.start,ip)}}
    if(sh)commit(sh)
    d.active=false;setIsDrawing(false)
  },[activeTool,evToImg,commit,computeROIEllipse,computeROIRect])

  const handleDoubleClick=useCallback(()=>{
    const d=drawRef.current
    if(activeTool==='polygon'&&d.polyPoints.length>2){commit({type:'polygon',points:[...d.polyPoints]});d.polyPoints=[];setIsDrawing(false)}
  },[activeTool,commit])

  const handleWheel=useCallback((e:React.WheelEvent)=>{
    e.preventDefault();if(!volume||!vp)return
    const d=e.deltaY>0?1:-1
    if(e.ctrlKey||e.metaKey)updateViewport(vpId,{zoom:Math.max(0.1,Math.min(20,(vp.zoom||1)-d*0.1))})
    else if(e.shiftKey)updateViewport(vpId,{windowWidth:Math.max(1,(vp.windowWidth||1500)+d*50)})
    else{
      const newIdx=Math.max(0,Math.min(totalSlices-1,(vp.currentIndex||0)+d))
      updateViewport(vpId,{currentIndex:newIdx})
      if(plane==='axial')updateMpr({axialIndex:newIdx})
      else if(plane==='sagital')updateMpr({sagittalIndex:newIdx})
      else updateMpr({coronalIndex:newIdx})
    }
  },[volume,vp,vpId,updateViewport,updateMpr,plane,totalSlices])

  const handleDragOver=(e:React.DragEvent)=>{if(e.dataTransfer.types.includes(DRAG_TYPE)){e.preventDefault();setIsDrop(true)}}
  const handleDragLeave=(e:React.DragEvent)=>{if(!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node))setIsDrop(false)}
  const handleDrop=(e:React.DragEvent)=>{e.preventDefault();setIsDrop(false);const p=e.dataTransfer.getData(DRAG_TYPE) as PlaneType;if(p){setViewportPlane(vpId,p);onClick()}}

  const getCursor=()=>{
    if(activeTool==='pan')return'grab';if(activeTool==='zoom')return'ns-resize'
    if(activeTool==='eraser')return'cell';if(activeTool==='text')return'text'
    return'crosshair'
  }

  const transform=vp?`translate(${vp.panX}px,${vp.panY}px) scale(${vp.zoom}) rotate(${vp.rotation}deg) scaleX(${vp.flipH?-1:1}) scaleY(${vp.flipV?-1:1})`:''

  // Commit text (from rich dialog)
  const commitText=(val:string,style:{bold:boolean;italic:boolean;align:'left'|'center'|'right';bgColor:string;fontSize:number;lineWidth:number;color:string})=>{
    if(!val.trim())return
    if(txtState.editId){
      // Edit existing
      const ann=vp?.annotations.find(a=>a.id===txtState.editId)
      if(ann){
        updateAnnotation(vpId,txtState.editId,{
          color:style.color,lineWidth:style.lineWidth,fontSize:style.fontSize,
          shape:{...ann.shape,text:val.trim(),bold:style.bold,italic:style.italic,align:style.align,bgColor:style.bgColor}
        })
      }
    } else {
      addAnnotation(vpId,{
        id:genId(),
        shape:{type:'text',position:{x:txtState.ix,y:txtState.iy},text:val.trim(),
          width:180,height:80,textRotation:0,bold:style.bold,italic:style.italic,align:style.align,bgColor:style.bgColor},
        color:style.color,lineWidth:style.lineWidth,fontSize:style.fontSize,
        createdAt:Date.now(),sliceIndex:vp?.currentIndex??0
      })
    }
    setShowTxt(false)
  }

  // Get selected text annotation (for overlay)
  const selectedTextAnn=selectedTextId?vp?.annotations.find(a=>a.id===selectedTextId&&a.shape.type==='text'):null
  const canvasSize={cw:annRef.current?.width||512,ch:annRef.current?.height||512}
  const sl=getSlice()
  const layout=selectedTextAnn?.shape.position&&annRef.current
    ?textBoxLayout(selectedTextAnn.shape,canvasSize.cw,canvasSize.ch,sl?.width||512,sl?.height||512,vp?.panX||0,vp?.panY||0,vp?.zoom||1)
    :null

  return (
    <div ref={containerRef} data-vpid={vpId}
      style={{position:'relative',width:'100%',height:'100%',background:'#000',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',
        border:isDrop?'2px dashed var(--cyan)':'1px solid #111',outline:isActive?`2px solid ${color}`:'none',outlineOffset:'-2px',cursor:getCursor()}}
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
    >
      {!volume&&(
        <div style={{position:'absolute',top:8,left:10,fontFamily:'var(--font-d)',fontSize:11,fontWeight:700,letterSpacing:'0.1em',color,textShadow:'0 1px 4px rgba(0,0,0,0.9)',pointerEvents:'none',zIndex:8,textTransform:'uppercase'}}>
          {plane}
        </div>
      )}
      {!volume&&(
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,color:'var(--text-d)',fontSize:11}}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.7" opacity={0.4}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>
          <span style={{fontSize:10}}>{isDrop?'Soltar aqui':`Arraste ${plane} aqui`}</span>
        </div>
      )}

      {volume&&<canvas ref={imgRef} style={{position:'absolute',transform,transformOrigin:'center center',imageRendering:'auto',maxWidth:'100%',maxHeight:'100%',display:'block',pointerEvents:'none'}}/>}

      <canvas ref={annRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',background:'transparent',zIndex:5}}
        onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp} onWheel={handleWheel} onClick={onClick} onDoubleClick={handleDoubleClick}/>

      {/* ── Text box handle overlay ───────────────────────────────────── */}
      {selectedTextAnn&&layout&&(
        <div style={{position:'absolute',inset:0,zIndex:15,pointerEvents:'none',overflow:'visible'}}>
          {/* SVG: dashed selection border + rotation line */}
          <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',overflow:'visible',pointerEvents:'none'}}>
            <rect
              transform={`rotate(${selectedTextAnn.shape.textRotation||0} ${layout.cx} ${layout.cy})`}
              x={layout.cx-layout.bw/2-3} y={layout.cy-layout.bh/2-3}
              width={layout.bw+6} height={layout.bh+6}
              fill="none" stroke="#00b8d9" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.9"/>
            <line x1={layout.handles.tc.x} y1={layout.handles.tc.y} x2={layout.handles.rot.x} y2={layout.handles.rot.y} stroke="#00b8d9" strokeWidth="1" opacity="0.7"/>
          </svg>

          {/* Invisible body (for move + dblclick-to-edit) */}
          <div style={{
            position:'absolute',left:layout.tlx,top:layout.tly,width:layout.bw,height:layout.bh,
            transform:`rotate(${selectedTextAnn.shape.textRotation||0}deg)`,transformOrigin:'50% 50%',
            cursor:'move',pointerEvents:'auto',
          }}
          onMouseDown={e=>startTextDrag('move',e)}
          onDoubleClick={()=>{
            const ann=selectedTextAnn
            setTxtState({cx:layout.tlx,cy:layout.tly,ix:ann.shape.position!.x,iy:ann.shape.position!.y,val:ann.shape.text||'',editId:ann.id})
            setShowTxt(true)
          }}
          />

          {/* Resize handles (squares) */}
          {(Object.entries(layout.handles) as [string,{x:number;y:number}][]).filter(([k])=>k!=='rot').map(([k,p])=>(
            <div key={k} style={{
              position:'absolute',left:p.x-5,top:p.y-5,width:10,height:10,
              background:'#fff',border:'1.5px solid #00b8d9',borderRadius:2,
              cursor:HANDLE_CURSORS[k]||'pointer',pointerEvents:'auto',
            }}
            onMouseDown={e=>startTextDrag('resize',e,k)}
            />
          ))}

          {/* Rotation handle (circle) */}
          <div style={{
            position:'absolute',left:layout.handles.rot.x-7,top:layout.handles.rot.y-7,
            width:14,height:14,borderRadius:'50%',background:'#00b8d9',border:'2px solid #fff',
            cursor:'alias',pointerEvents:'auto',boxShadow:'0 2px 6px rgba(0,0,0,0.5)',
          }}
          onMouseDown={e=>startTextDrag('rotate',e)}
          />

          {/* Delete button on top-right */}
          <div style={{
            position:'absolute',left:layout.handles.tr.x+4,top:layout.handles.tr.y-12,
            background:'var(--red)',borderRadius:4,padding:'1px 5px',fontSize:10,color:'#fff',
            cursor:'pointer',pointerEvents:'auto',lineHeight:1.5,fontFamily:'var(--font-m)',
          }}
          onClick={()=>{removeAnnotation(vpId,selectedTextId!);setSelectedTextId(null)}}
          >✕</div>
        </div>
      )}

      {/* ── DICOM overlays ────────────────────────────────────────────── */}
      {volume&&vp&&(
        <>
          <div style={{position:'absolute',top:8,left:10,fontSize:10,fontFamily:'var(--font-m)',color:'rgba(255,255,255,0.55)',lineHeight:1.6,pointerEvents:'none',zIndex:8}}>
            <div style={{fontFamily:'var(--font-d)',fontSize:11,fontWeight:700,letterSpacing:'0.1em',color,textTransform:'uppercase',marginBottom:2}}>{plane}</div>
            {volume.patientName&&<div style={{fontWeight:700,color:'rgba(255,255,255,0.8)'}}>{volume.patientName}</div>}
            {volume.studyDate&&<div>{volume.studyDate}</div>}
            {volume.modality&&<div style={{color:'rgba(255,255,255,0.35)',letterSpacing:'0.06em'}}>{volume.modality}</div>}
          </div>
          <div style={{position:'absolute',top:8,right:10,fontSize:10,fontFamily:'var(--font-m)',color:'rgba(255,255,255,0.55)',lineHeight:1.6,pointerEvents:'none',zIndex:8,textAlign:'right'}}>
            <div>{vp.currentIndex+1} / {totalSlices}</div>
            {volume.stream&&(
              <div style={{marginTop:2,fontSize:9,fontWeight:700,letterSpacing:'0.04em',color:streamAxial?'#34d399':'#fbbf24'}}>
                {streamAxial?'FULL-RES · streaming':'PRÉVIA reduzida'}
              </div>
            )}
            <div>WC {Math.round(vp.windowCenter)}</div>
            <div>WW {Math.round(vp.windowWidth)}</div>
          </div>
          <div style={{position:'absolute',bottom:8,left:10,fontSize:9,fontFamily:'var(--font-m)',color:'rgba(255,255,255,0.4)',lineHeight:1.6,pointerEvents:'none',zIndex:8}}>
            {volume.seriesDescription&&<div>{volume.seriesDescription}</div>}
            <div>{spX.toFixed(2)}×{spY.toFixed(2)} mm</div>
          </div>
          <div style={{position:'absolute',bottom:8,right:10,fontSize:9,fontFamily:'var(--font-m)',color:'rgba(255,255,255,0.4)',lineHeight:1.6,pointerEvents:'none',zIndex:8,textAlign:'right'}}>
            {vp.annotations.filter(a=>a.sliceIndex===vp.currentIndex).length>0&&<div style={{color}}>{vp.annotations.filter(a=>a.sliceIndex===vp.currentIndex).length} ann</div>}
            {vp.zoom!==1&&<div>{(vp.zoom*100).toFixed(0)}%</div>}
            {cineActive&&isActive&&<div style={{color:'#f72585',fontWeight:700}}>▶ CINE</div>}
          </div>
          {totalSlices>1&&(
            <div style={{position:'absolute',right:4,top:'6%',bottom:'6%',width:3,background:'rgba(255,255,255,0.07)',borderRadius:2,zIndex:8}}>
              <div style={{position:'absolute',left:0,width:3,height:14,background:color,borderRadius:2,top:`${(vp.currentIndex/Math.max(1,totalSlices-1))*100}%`,transform:'translateY(-50%)'}}/>
            </div>
          )}
        </>
      )}

      {/* ── Rich text creation / edit popup ──────────────────────────── */}
      {showTxt&&<TextPopup
        initial={txtState.val}
        cx={txtState.cx}
        cy={txtState.cy}
        annotationStyle={annotationStyle}
        onCommit={commitText}
        onCancel={()=>setShowTxt(false)}
        containerWidth={annRef.current?.width||400}
        containerHeight={annRef.current?.height||400}
      />}

      {isDrop&&(
        <div style={{position:'absolute',inset:0,zIndex:20,background:'rgba(0,0,0,0.65)',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:8,color:'var(--cyan)',fontSize:12,pointerEvents:'none'}}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29"/></svg>
          <span>Soltar plano aqui</span>
        </div>
      )}
    </div>
  )
}

// ── Rich text creation popup ──────────────────────────────────────────────────
interface TextPopupProps{
  initial:string; cx:number; cy:number; containerWidth:number; containerHeight:number
  annotationStyle:{color:string;lineWidth:number;fontSize:number;bold:boolean;italic:boolean;align:'left'|'center'|'right';bgColor:string}
  onCommit:(val:string,style:{bold:boolean;italic:boolean;align:'left'|'center'|'right';bgColor:string;fontSize:number;lineWidth:number;color:string})=>void
  onCancel:()=>void
}

function TextPopup({initial,cx,cy,containerWidth,containerHeight,annotationStyle,onCommit,onCancel}:TextPopupProps){
  const [val,setVal]=useState(initial)
  const [bold,setBold]=useState(annotationStyle.bold)
  const [italic,setItalic]=useState(annotationStyle.italic)
  const [align,setAlign]=useState<'left'|'center'|'right'>(annotationStyle.align)
  const [bgColor,setBgColor]=useState(annotationStyle.bgColor==='transparent'?'rgba(0,0,0,0)':annotationStyle.bgColor)
  const [fontSize,setFontSize]=useState(annotationStyle.fontSize)
  const [color,setColor]=useState(annotationStyle.color)
  const [lineWidth,setLineWidth]=useState(annotationStyle.lineWidth)

  const popW=280,popH=290
  const left=Math.min(cx,containerWidth-popW-8)
  const top=Math.min(cy+14,containerHeight-popH-8)

  const handleCommit=()=>onCommit(val,{bold,italic,align,bgColor:bgColor||'transparent',fontSize,lineWidth,color})

  return(
    <div style={{
      position:'absolute',left:Math.max(4,left),top:Math.max(4,top),zIndex:40,width:popW,
      background:'var(--bg-elevated)',border:'1px solid var(--border-b)',borderRadius:'var(--r-lg)',
      boxShadow:'var(--shadow-f)',overflow:'hidden',
    }}
    onMouseDown={e=>e.stopPropagation()}
    >
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderBottom:'1px solid var(--border-s)',background:'var(--bg-panel)'}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2"><text x="3" y="18" style={{font:'bold 18px serif',fill:'currentColor',stroke:'none'}}>T</text></svg>
        <span style={{fontFamily:'var(--font-d)',fontSize:11,fontWeight:700,color:'var(--text-s)',flex:1}}>Caixa de Texto</span>
        <button onClick={onCancel} style={{color:'var(--text-m)',fontSize:14,lineHeight:1}}>✕</button>
      </div>

      <div style={{padding:'10px 12px',display:'flex',flexDirection:'column',gap:9}}>
        {/* Formatting toolbar */}
        <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap'}}>
          {/* Bold */}
          <button onClick={()=>setBold(b=>!b)} title="Negrito"
            style={{width:26,height:26,borderRadius:'var(--r-sm)',background:bold?'var(--cyan-d)':'var(--bg-overlay)',border:`1px solid ${bold?'var(--cyan)':'var(--border-d)'}`,color:bold?'var(--cyan)':'var(--text-m)',fontWeight:700,fontSize:13}}>B</button>
          {/* Italic */}
          <button onClick={()=>setItalic(i=>!i)} title="Itálico"
            style={{width:26,height:26,borderRadius:'var(--r-sm)',background:italic?'var(--cyan-d)':'var(--bg-overlay)',border:`1px solid ${italic?'var(--cyan)':'var(--border-d)'}`,color:italic?'var(--cyan)':'var(--text-m)',fontStyle:'italic',fontSize:13}}>I</button>

          {/* Divider */}
          <div style={{width:1,height:20,background:'var(--border-s)',margin:'0 2px'}}/>

          {/* Align */}
          {(['left','center','right'] as const).map(a=>(
            <button key={a} onClick={()=>setAlign(a)} title={a}
              style={{width:26,height:26,borderRadius:'var(--r-sm)',background:align===a?'var(--cyan-d)':'var(--bg-overlay)',border:`1px solid ${align===a?'var(--cyan)':'var(--border-d)'}`,color:align===a?'var(--cyan)':'var(--text-m)',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {a==='left'&&<><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></>}
                {a==='center'&&<><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></>}
                {a==='right'&&<><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></>}
              </svg>
            </button>
          ))}

          {/* Divider */}
          <div style={{width:1,height:20,background:'var(--border-s)',margin:'0 2px'}}/>

          {/* Text color */}
          <label title="Cor do texto" style={{width:26,height:26,borderRadius:'50%',border:'2px solid var(--border-d)',overflow:'hidden',cursor:'pointer',flexShrink:0,position:'relative'}}>
            <span style={{position:'absolute',inset:1,background:color,borderRadius:'50%'}}/>
            <input type="color" value={color} onChange={e=>setColor(e.target.value)} style={{position:'absolute',opacity:0,width:0,height:0}}/>
          </label>
        </div>

        {/* Font size + Line width */}
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <div style={{flex:1}}>
            <div style={{fontSize:8,color:'var(--text-m)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>Tamanho</div>
            <div style={{display:'flex',gap:3}}>
              {[10,12,14,18,24].map(s=>(
                <button key={s} onClick={()=>setFontSize(s)}
                  style={{flex:1,padding:'3px 2px',borderRadius:'var(--r-sm)',fontSize:9,background:fontSize===s?'var(--cyan-d)':'var(--bg-overlay)',border:`1px solid ${fontSize===s?'var(--cyan)':'var(--border-d)'}`,color:fontSize===s?'var(--cyan)':'var(--text-s)'}}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{fontSize:8,color:'var(--text-m)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:3}}>Borda</div>
            <select value={lineWidth} onChange={e=>setLineWidth(+e.target.value)}
              style={{width:46,height:22,fontSize:9,background:'var(--bg-overlay)',border:'1px solid var(--border-d)',color:'var(--text-s)',borderRadius:'var(--r-sm)',textAlign:'center'}}>
              {[0,1,2,3].map(w=><option key={w} value={w}>{w===0?'Nenhuma':`${w}px`}</option>)}
            </select>
          </div>
        </div>

        {/* Background color */}
        <div>
          <div style={{fontSize:8,color:'var(--text-m)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:4}}>Fundo</div>
          <div style={{display:'flex',gap:4,alignItems:'center'}}>
            {['transparent','rgba(0,0,0,0.6)','rgba(0,0,0,0.9)','rgba(255,255,255,0.15)','rgba(255,255,255,0.85)'].map(c=>(
              <button key={c} onClick={()=>setBgColor(c)} title={c}
                style={{width:22,height:22,borderRadius:'var(--r-sm)',background:c==='transparent'?'linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%),linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%)':c,backgroundSize:'8px 8px',backgroundPosition:'0 0,4px 4px',border:`1px solid ${bgColor===c?'var(--cyan)':'var(--border-d)'}`,cursor:'pointer',flexShrink:0}}>
              </button>
            ))}
          </div>
        </div>

        {/* Text input */}
        <textarea autoFocus value={val} onChange={e=>setVal(e.target.value)}
          placeholder="Digite o texto aqui..."
          rows={3}
          onKeyDown={e=>{if(e.key==='Enter'&&e.ctrlKey)handleCommit();if(e.key==='Escape')onCancel()}}
          style={{
            width:'100%',resize:'vertical',padding:'7px 9px',fontSize:fontSize,lineHeight:1.55,
            fontFamily:'var(--font-m)',fontWeight:bold?700:400,fontStyle:italic?'italic':'normal',
            textAlign:align,color,
            background:'var(--bg-overlay)',border:'1px solid var(--border-d)',borderRadius:'var(--r-md)',
            outline:'none',boxSizing:'border-box',
          }}
        />

        {/* Actions */}
        <div style={{display:'flex',justifyContent:'flex-end',gap:6}}>
          <button onClick={onCancel} style={{padding:'5px 12px',borderRadius:'var(--r-sm)',fontSize:11,background:'var(--bg-overlay)',border:'1px solid var(--border-d)',color:'var(--text-s)'}}>Cancelar</button>
          <button onClick={handleCommit} disabled={!val.trim()}
            style={{padding:'5px 14px',borderRadius:'var(--r-sm)',fontSize:11,fontWeight:600,background:val.trim()?'var(--cyan)':'var(--bg-overlay)',border:`1px solid ${val.trim()?'var(--cyan)':'var(--border-d)'}`,color:val.trim()?'#000':'var(--text-d)',cursor:val.trim()?'pointer':'not-allowed'}}>
            {initial?'Salvar':'Inserir'}
          </button>
        </div>
        <div style={{fontSize:9,color:'var(--text-d)',textAlign:'right',marginTop:-4}}>Ctrl+Enter para confirmar</div>
      </div>
    </div>
  )
}
