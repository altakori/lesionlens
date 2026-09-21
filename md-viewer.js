(function(g) {
  'use strict';
  // Canvas drawing avoids style mutations and applies identical transforms to all panels.
  function mount(host, c, sources=Object.keys(g.MD.labels), viewpoint=null) {
    const doc=host.ownerDocument;
    const node=(tag,text) => {const n=doc.createElement(tag); if(text) n.textContent=text; return n;};
    let epoch=0, closed=false, slice=0, displayedSlice=null, pendingSlice=null, phase='idle', failure='', zoom=1, x=0, y=0, contrast=1, visible=true, mode='seg', loaded=[];
    const inFlight=new Set(), listeners=new Set();
    const boundedPan=v=>Math.max(-2048,Math.min(2048,v));
    // The caller verifies manifest identity; validate numeric bounds here too.
    if(viewpoint){
      g.MD.validateViewpoint(viewpoint,c,{manifestSha256:viewpoint.manifestSha256,sourceCaseId:c.id});
      slice=viewpoint.slice;zoom=viewpoint.zoom;x=viewpoint.panX;y=viewpoint.panY;contrast=viewpoint.contrast;
      mode=viewpoint.overlayMode ?? 'seg';visible=viewpoint.overlayVisible ?? true;
    }
    const frame=()=>closed||displayedSlice===null?null:{slice:displayedSlice,zoom,panX:x,panY:y,contrast,overlayMode:mode,overlayVisible:visible};
    const notify=()=>listeners.forEach(fn=>fn());
    const controls=node('div'); controls.className='md-viewer-controls';
    function range(label,min,max,step,value,fn) {const wrap=node('label',label), input=node('input');input.type='range';Object.assign(input,{min,max,step,value});input.addEventListener('input',()=>fn(Number(input.value)));wrap.append(input);controls.append(wrap);return input;}
    const slider=range('공통 절편',0,Math.max(0,c.slices.length-1),1,slice,v=>{slice=v;load();});
    const position=node('output');position.setAttribute('aria-live','polite');controls.append(position);
    const zoomControl=range('공통 확대',1,5,.1,zoom,v=>{zoom=v;draw();});
    const contrastControl=range('공통 PNG/WebP 표시 대비 (HU window 변경 아님)',.2,3,.1,contrast,v=>{contrast=v;draw();});
    const modes=node('div');modes.className='md-overlay-modes';modes.setAttribute('role','group');modes.setAttribute('aria-label','동시 오버레이 방식');
    const modeButtons=[];
    for(const [value,label] of [['seg','seg 마스크'],['outline','테두리'],['box','박스']]) {
      const button=node('button',label);button.type='button';button.dataset.overlayMode=value;
      button.setAttribute('aria-pressed',String(mode===value));
      button.onclick=()=>{mode=value;modeButtons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.overlayMode===mode)));draw();};
      modeButtons.push(button);modes.append(button);
    }
    controls.append(modes);
    const eye=node('button');eye.type='button';eye.className='md-overlay-eye';
    eye.setAttribute('aria-label','모든 패널 오버레이 표시');eye.setAttribute('aria-pressed',String(visible));eye.title=visible?'모든 패널 오버레이 숨기기':'모든 패널 오버레이 복원';
    const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'24',height:'24',fill:'none',stroke:'currentColor','stroke-width':'2','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
    const outline=doc.createElementNS('http://www.w3.org/2000/svg','path');outline.setAttribute('d','M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z');
    const pupil=doc.createElementNS('http://www.w3.org/2000/svg','circle');pupil.setAttribute('cx','12');pupil.setAttribute('cy','12');pupil.setAttribute('r','3');
    const slash=doc.createElementNS('http://www.w3.org/2000/svg','path');slash.setAttribute('d','M3 3l18 18');slash.setAttribute('visibility',visible?'hidden':'visible');
    svg.append(outline,pupil,slash);eye.append(svg);
    eye.onclick=()=>{visible=!visible;eye.setAttribute('aria-pressed',String(visible));eye.title=visible?'모든 패널 오버레이 숨기기':'모든 패널 오버레이 복원';slash.setAttribute('visibility',visible?'hidden':'visible');draw();};controls.append(eye);
    const retry=node('button','절편 다시 불러오기');retry.type='button';retry.hidden=true;retry.onclick=()=>load();controls.append(retry);
    const reset=node('button','위치 초기화');reset.onclick=()=>{x=y=0;zoom=contrast=1;zoomControl.value=contrastControl.value=1;draw();};controls.append(reset);
    const grid=node('div');grid.className='md-viewer-grid';host.append(controls,grid);
    const panels=sources.map(key=>{const panel=node('section');panel.className='md-image-panel';panel.dataset.source=key;
      panel.append(node('h4',(g.MD.labels[key]||'CT')+(key==='gt'?' · 참조 정답':key==='ct'?' · 모델 참고 없음':' · 예측')));
      const canvas=node('canvas');canvas.width=canvas.height=512;canvas.hidden=true;canvas.className='md-canvas';canvas.tabIndex=0;canvas.setAttribute('aria-label',`${c.id} ${g.MD.labels[key]} CT · 방향키 절편, Shift+방향키 이동`);
      const status=node('p');status.setAttribute('role','status');panel.append(canvas,status);grid.append(panel);
      let start=null;
      canvas.onpointerdown=e=>{start=[e.clientX,e.clientY,x,y];canvas.setPointerCapture(e.pointerId);};
      canvas.onpointermove=e=>{if(start){const rect=canvas.getBoundingClientRect();x=start[2]+(e.clientX-start[0])*512/rect.width;y=start[3]+(e.clientY-start[1])*512/rect.height;draw();}};
      canvas.onpointerup=canvas.onpointercancel=()=>{start=null;};
      canvas.addEventListener('wheel',e=>{if(!e.deltaY||Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();slice=Math.max(0,Math.min(Math.max(0,c.slices.length-1),slice+(e.deltaY>0?1:-1)));slider.value=slice;load();},{passive:false});
      canvas.onkeydown=e=>{if(!['Home','End','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(e.shiftKey){x+=e.key==='ArrowLeft'?-10:e.key==='ArrowRight'?10:0;y+=e.key==='ArrowUp'?-10:e.key==='ArrowDown'?10:0;draw();}else{slice=e.key==='Home'?0:e.key==='End'?Math.max(0,c.slices.length-1):Math.max(0,Math.min(Math.max(0,c.slices.length-1),slice+(['ArrowRight','ArrowUp'].includes(e.key)?1:-1)));slider.value=slice;load();}};
      return {key,canvas,status};});
    function overlayImage(img) {
      const off=node('canvas');off.width=img.naturalWidth;off.height=img.naturalHeight;const ctx=off.getContext('2d');ctx.drawImage(img,0,0);
      const pixels=ctx.getImageData(0,0,off.width,off.height), w=off.width,h=off.height;
      const mask=Uint8Array.from({length:w*h},(_,i)=>pixels.data[i*4+3]>0?1:0);
      const outline=node('canvas');outline.width=w;outline.height=h;const oc=outline.getContext('2d');
      const edges=oc.createImageData(w,h); const boxes=[];const seen=new Uint8Array(mask.length);
      for(let i=0;i<mask.length;i++)if(mask[i]){
        const px=i%w,py=Math.floor(i/w);
        if(px===0||py===0||px===w-1||py===h-1||!mask[i-1]||!mask[i+1]||!mask[i-w]||!mask[i+w]) edges.data.set([0,255,230,255],i*4);
        if(!seen[i]){let loX=px,hiX=px,loY=py,hiY=py;const todo=[i];seen[i]=1;
          while(todo.length){const j=todo.pop(),a=j%w,b=Math.floor(j/w);loX=Math.min(loX,a);hiX=Math.max(hiX,a);loY=Math.min(loY,b);hiY=Math.max(hiY,b);
            for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=a+dx,yy=b+dy,k=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&mask[k]&&!seen[k]){seen[k]=1;todo.push(k);}}}
          boxes.push([loX,loY,hiX-loX+1,hiY-loY+1]);}}
      oc.putImageData(edges,0,0);return {seg:img,outline,boxes,w,h};
    }
    function draw(){if(closed)return;x=boundedPan(x);y=boundedPan(y);host.dataset.slice=displayedSlice===null?'':String(displayedSlice);host.dataset.zoom=String(zoom);host.dataset.panX=String(x);host.dataset.panY=String(y);host.dataset.contrast=String(contrast);host.dataset.overlayMode=mode;host.dataset.overlayVisible=String(visible);panels.forEach((p,i)=>{const ctx=p.canvas.getContext('2d');p.canvas.dataset.slice=displayedSlice===null?'':String(displayedSlice);p.canvas.dataset.caseId=c.id;const data=loaded[i];if(!data)return;p.canvas.hidden=false;ctx.clearRect(0,0,512,512);
      ctx.save();ctx.translate(256+x,256+y);ctx.scale(zoom,zoom);ctx.translate(-256,-256);ctx.filter=`contrast(${contrast})`;ctx.drawImage(data.ct,0,0,512,512);ctx.filter='none';
      if(visible&&data.overlay){const o=data.overlay;if(mode==='box'){for(const b of o.boxes){const rect=[b[0]*512/o.w,b[1]*512/o.h,b[2]*512/o.w,b[3]*512/o.h];ctx.strokeStyle='#071019';ctx.lineWidth=6/zoom;ctx.strokeRect(...rect);ctx.strokeStyle='#00ffe6';ctx.lineWidth=3/zoom;ctx.strokeRect(...rect);}}else if(mode==='outline'){ctx.shadowColor='#000';ctx.shadowBlur=4;for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[0,0]])ctx.drawImage(o.outline,dx/zoom,dy/zoom,512,512);ctx.shadowBlur=0;ctx.drawImage(o.outline,0,0,512,512);}else ctx.drawImage(o.seg,0,0,512,512);}ctx.restore();});notify();}
    function describeFrame(){
      if(closed)return;
      host.dataset.slice=displayedSlice===null?'':String(displayedSlice);
      host.dataset.requestedSlice=c.slices.length?String(slice):'';
      host.dataset.pendingSlice=pendingSlice===null?'':String(pendingSlice);
      host.dataset.loadState=phase;
      host.setAttribute('aria-busy',String(phase==='loading'));
      retry.hidden=phase!=='error';
      const shown=displayedSlice===null?'표시 없음':`표시 ${displayedSlice+1} / ${c.slices.length}`;
      position.textContent=!c.slices.length?'CT 없음 · 합성 워크플로 시연 (영상 생성 안 함)':
        phase==='loading'?`${shown} · 요청 ${slice+1} / ${c.slices.length} 불러오는 중…`:
        phase==='error'?`${shown} · 요청 ${slice+1} 실패 · ${displayedSlice===null?'표시할 영상 없음':'이전 영상 유지'}`:shown;
      slider.setAttribute('aria-valuetext',position.textContent);notify();
      panels.forEach((p,i)=>{
        const state=loaded[i]?.overlay?'W400/L50 · CT + 동일 절편 표시':p.key==='ct'?'CT만 표시':`${g.MD.labels[p.key]} 자료 없음 · CT만 표시`;
        p.status.textContent=!c.slices.length?'CT / 모델 영상 없음':
          phase==='loading'?`${shown} · 요청 ${slice+1} 불러오는 중…`:
          phase==='error'?`${shown} · ${failure} · 요청 ${slice+1} 실패 (${displayedSlice===null?'영상 없음':'이전 영상 유지'})`:
          `${shown} · ${state}`;
      });
    }
    function cancelLoads(){for(const cancel of [...inFlight])cancel();}
    const image=(path,label)=>new Promise((resolve,reject)=>{
      const img=new Image();let settled=false;
      const finish=(error)=>{if(settled)return;settled=true;inFlight.delete(cancel);img.onload=img.onerror=null;error?reject(error):resolve(img);};
      const cancel=()=>{finish(new Error('취소된 요청'));img.removeAttribute('src');};
      inFlight.add(cancel);img.onload=()=>finish();img.onerror=()=>finish(new Error(`${label} 이미지 오류`));img.src='/'+path;
    });
    async function load(){
      if(closed)return;
      if(phase==='loading'&&pendingSlice===slice)return;
      const token=++epoch, target=slice;
      cancelLoads();
      if(!c.slices.length){phase='empty';pendingSlice=null;draw();describeFrame();return;}
      // Returning to the displayed slice cancels any uncommitted request.
      if(displayedSlice===target){phase='ready';pendingSlice=null;failure='';describeFrame();return;}
      phase='loading';pendingSlice=target;failure='';describeFrame();
      const row=c.slices[target];
      try{
        // One CT decode is shared by all panels. Every declared overlay must
        // succeed before any panel changes, even when the eye is switched off.
        const [ct, overlays]=await Promise.all([
          image(row.ct,'CT'),
          Promise.all(panels.map(async p=>{
            const path=row.overlays?.[p.key]?.path;
            if(!path)return null; // Known missing source, never a substitute.
            const img=await image(path, g.MD.labels[p.key]||p.key);
            if(closed||token!==epoch)return null;
            try{return overlayImage(img);}catch(_){throw new Error(`${g.MD.labels[p.key]} 표시 변환 오류`);}
          }))
        ]);
        if(closed||token!==epoch)return;
        loaded=panels.map((p,i)=>({ct,overlay:overlays[i]}));displayedSlice=target;
        pendingSlice=null;phase='ready';
        // Synchronous redraw in one task: no await or per-image panel commit.
        draw();describeFrame();
      }catch(error){
        if(closed||token!==epoch)return;
        cancelLoads();pendingSlice=null;phase='error';failure=error.message;
        // Keep every committed canvas intact; only status/target labels change.
        describeFrame();
      }
    }
    draw();load();return {
      capture:frame,
      state(){return {displayedSlice,pendingSlice,phase};},
      subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
      close(){if(closed)return;closed=true;epoch++;cancelLoads();loaded=[];displayedSlice=pendingSlice=null;host.replaceChildren();host.dataset.slice='';host.dataset.pendingSlice='';host.dataset.requestedSlice='';host.dataset.loadState='closed';host.setAttribute('aria-busy','false');notify();listeners.clear();},
      setSlice(v){if(closed)return;const value=Number(v);slice=Math.max(0,Math.min(Math.max(0,c.slices.length-1),Number.isFinite(value)?Math.trunc(value):0));slider.value=slice;return load();}
    };
  }
  g.MDViewer={mount};
})(globalThis);
