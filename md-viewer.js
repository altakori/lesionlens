(function(g) {
  'use strict';
  function mount(host, c, sources=Object.keys(g.MD.labels), viewpoint=null) {
    const doc=host.ownerDocument;
    const node=(tag,text) => {const n=doc.createElement(tag); if(text) n.textContent=text; return n;};
    let epoch=0, closed=false, slice=0, displayedSlice=null, pendingSlice=null, phase='idle', failure='', zoom=1, x=0, y=0, contrast=1, visible=true, mode='seg', loaded=[];
    let markers=[], markerActive=null, markersVisible=true;
    const inFlight=new Set(), listeners=new Set();
    const boundedPan=v=>Math.max(-2048,Math.min(2048,v));
    if(viewpoint){
      g.MD.validateViewpoint(viewpoint,c,{manifestSha256:viewpoint.manifestSha256,sourceCaseId:c.id});
      slice=viewpoint.slice;zoom=viewpoint.zoom;x=viewpoint.panX;y=viewpoint.panY;contrast=viewpoint.contrast;
      mode=viewpoint.overlayMode ?? 'seg';visible=viewpoint.overlayVisible ?? true;
    }
    const frame=()=>closed||displayedSlice===null?null:{slice:displayedSlice,zoom,panX:x,panY:y,contrast,overlayMode:mode,overlayVisible:visible};
    const notify=()=>listeners.forEach(fn=>fn());
    const controls=node('div');controls.className='md-viewer-controls';
    const adjust=node('fieldset');adjust.className='md-adjust-tools';adjust.append(node('legend','보기 조정'));
    const display=node('fieldset');display.className='md-display-tools';display.append(node('legend','표시 방식'));controls.append(adjust,display);
    const outputs={};
    function range(label,min,max,step,value,fn,aria,format) {
      const wrap=node('label'),name=node('span',label),input=node('input'),out=node('output');wrap.className='md-range-row';input.type='range';Object.assign(input,{min,max,step,value});
      input.setAttribute('aria-label',aria);out.textContent=format(value);outputs[aria]={out,format};
      input.addEventListener('input',()=>{out.textContent=format(Number(input.value));fn(Number(input.value));});wrap.append(name,input,out);adjust.append(wrap);return input;
    }
    const slider=range('절편',0,Math.max(0,c.slices.length-1),1,slice,v=>{slice=v;load();},'공통 절편',v=>String(v+1));
    const position=node('output');position.className='md-slice-status';position.setAttribute('aria-live','polite');
    const zoomControl=range('확대',1,5,.1,zoom,v=>{zoom=v;draw();},'공통 확대',v=>Math.round(v*100)+'%');
    const contrastControl=range('표시 대비',.2,3,.1,contrast,v=>{contrast=v;draw();},'공통 PNG/WebP 표시 대비 (HU window 변경 아님)',v=>Number(v).toFixed(1));
    const modes=node('div');modes.className='md-overlay-modes';modes.setAttribute('role','group');modes.setAttribute('aria-label','동시 오버레이 방식');
    const subtypes=node('div');subtypes.className='md-outline-options';subtypes.setAttribute('role','group');subtypes.setAttribute('aria-label','테두리 유형');
    const modeButtons=[];
    for(const [value,label,parent] of [['seg','채움',modes],['outline','테두리',modes],['outline','윤곽선',subtypes],['box','박스',subtypes]]) {
      const button=node('button',label);button.type='button';button.dataset.overlayMode=value;
      button.onclick=()=>{mode=value;syncControls();draw();};modeButtons.push(button);parent.append(button);
    }
    display.append(modes,subtypes);
    const eye=node('button');eye.type='button';eye.className='md-overlay-eye';eye.setAttribute('aria-label','모든 패널 오버레이 표시');
    eye.onclick=()=>{visible=!visible;syncControls();draw();};display.append(eye);
    const retry=node('button','절편 다시 불러오기');retry.type='button';retry.hidden=true;retry.onclick=()=>load();display.append(retry);
    const reset=node('button','↺ 초기화');reset.type='button';reset.onclick=()=>{x=y=0;zoom=contrast=1;syncControls();draw();};display.append(reset);
    function syncControls(){
      slider.value=slice;zoomControl.value=zoom;contrastControl.value=contrast;
      outputs['공통 절편'].out.textContent=String(slice+1);outputs['공통 확대'].out.textContent=Math.round(zoom*100)+'%';outputs['공통 PNG/WebP 표시 대비 (HU window 변경 아님)'].out.textContent=Number(contrast).toFixed(1);
      modeButtons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===1?mode!=='seg':b.dataset.overlayMode===mode)));
      subtypes.hidden=mode==='seg';eye.setAttribute('aria-pressed',String(visible));eye.textContent=visible?'표시 숨기기':'표시 켜기';eye.title=visible?'모든 패널 오버레이 숨기기':'직전 표시 방식 복원';
    }
    syncControls();
    const grid=node('div');grid.className='md-viewer-grid';host.append(controls,position,grid);
    const panels=sources.map(key=>{const panel=node('section');panel.className='md-image-panel';panel.dataset.source=key;
      panel.append(node('h4',(g.MD.labels[key]||'CT')+(key==='gt'?' · 참조 정답':key==='ct'?' · 모델 참고 없음':' · 예측')));
      const canvas=node('canvas');canvas.width=canvas.height=512;canvas.hidden=true;canvas.className='md-canvas';canvas.tabIndex=0;canvas.setAttribute('aria-label',`${c.id} ${g.MD.labels[key]} CT · 방향키 절편, Shift+방향키 이동`);
      const status=node('p');status.setAttribute('role','status');panel.append(canvas,status);grid.append(panel);
      let start=null;
      canvas.onpointerdown=e=>{start=[e.clientX,e.clientY,x,y];canvas.setPointerCapture(e.pointerId);};
      canvas.onpointermove=e=>{if(start){const rect=canvas.getBoundingClientRect(),size=Math.min(rect.width,rect.height);x=start[2]+(e.clientX-start[0])*512/size;y=start[3]+(e.clientY-start[1])*512/size;draw();}};
      canvas.onpointerup=canvas.onpointercancel=()=>{start=null;};
      canvas.addEventListener('wheel',e=>{if(!e.deltaY||Math.abs(e.deltaX)>Math.abs(e.deltaY))return;e.preventDefault();if(e.ctrlKey){zoom=Math.max(1,Math.min(5,zoom+(e.deltaY>0?-.1:.1)));syncControls();draw();return;}slice=Math.max(0,Math.min(Math.max(0,c.slices.length-1),slice+(e.deltaY>0?1:-1)));slider.value=slice;load();},{passive:false});
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
    function draw(){if(closed)return;syncControls();x=boundedPan(x);y=boundedPan(y);host.dataset.slice=displayedSlice===null?'':String(displayedSlice);host.dataset.zoom=String(zoom);host.dataset.panX=String(x);host.dataset.panY=String(y);host.dataset.contrast=String(contrast);host.dataset.overlayMode=mode;host.dataset.overlayVisible=String(visible);panels.forEach((p,i)=>{const ctx=p.canvas.getContext('2d');p.canvas.dataset.slice=displayedSlice===null?'':String(displayedSlice);p.canvas.dataset.caseId=c.id;const data=loaded[i];if(!data)return;p.canvas.hidden=false;ctx.clearRect(0,0,512,512);
      ctx.save();ctx.translate(256+x,256+y);ctx.scale(zoom,zoom);ctx.translate(-256,-256);ctx.filter=`contrast(${contrast})`;ctx.drawImage(data.ct,0,0,512,512);ctx.filter='none';
      if(visible&&data.overlay){const o=data.overlay;if(mode==='box'){for(const b of o.boxes){const rect=[b[0]*512/o.w,b[1]*512/o.h,b[2]*512/o.w,b[3]*512/o.h];ctx.strokeStyle='#071019';ctx.lineWidth=6/zoom;ctx.strokeRect(...rect);ctx.strokeStyle='#00ffe6';ctx.lineWidth=3/zoom;ctx.strokeRect(...rect);}}else if(mode==='outline'){ctx.shadowColor='#000';ctx.shadowBlur=4;for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[0,0]])ctx.drawImage(o.outline,dx/zoom,dy/zoom,512,512);ctx.shadowBlur=0;ctx.drawImage(o.outline,0,0,512,512);}else ctx.drawImage(o.seg,0,0,512,512);}
      if(markersVisible&&markers.length){for(const m of markers){
        if(!m||m.slice!==displayedSlice)continue;const v=Array.isArray(m.voxel)?m.voxel:[];
        if(!Number.isFinite(v[0])||!Number.isFinite(v[1]))continue;
        const on=m.candidateId===markerActive,arm=9/zoom;
        ctx.save();ctx.strokeStyle=on?'#ffd166':'#8a93a8';ctx.lineWidth=(on?3:2)/zoom;
        ctx.beginPath();ctx.moveTo(v[0]-arm,v[1]);ctx.lineTo(v[0]+arm,v[1]);ctx.moveTo(v[0],v[1]-arm);ctx.lineTo(v[0],v[1]+arm);ctx.stroke();
        if(on){ctx.beginPath();ctx.arc(v[0],v[1],15/zoom,0,Math.PI*2);ctx.stroke();}
        ctx.restore();}}
      ctx.restore();});notify();}
    function describeFrame(){
      if(closed)return;syncControls();
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
      inFlight.add(cancel);img.onload=()=>finish();img.onerror=()=>finish(new Error(`${label} 이미지 오류`));img.src=path;
    });
    async function load(){
      if(closed)return;
      if(phase==='loading'&&pendingSlice===slice)return;
      const token=++epoch, target=slice;
      cancelLoads();
      if(!c.slices.length){phase='empty';pendingSlice=null;draw();describeFrame();return;}
      if(displayedSlice===target){phase='ready';pendingSlice=null;failure='';describeFrame();return;}
      phase='loading';pendingSlice=target;failure='';describeFrame();
      const row=c.slices[target];
      try{
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
        draw();describeFrame();
      }catch(error){
        if(closed||token!==epoch)return;
        cancelLoads();pendingSlice=null;phase='error';failure=error.message;
        describeFrame();
      }
    }
    draw();load();return {
      capture:frame,
      state(){return {displayedSlice,pendingSlice,phase};},
      setCandidates(items,activeId){
        markers=Array.isArray(items)?items:[];
        markerActive=typeof activeId==='string'?activeId:null;
        if(markerActive)markersVisible=true;
        const hit=markers.find(k=>k&&k.candidateId===markerActive);
        if(hit&&Number.isInteger(hit.slice)&&hit.slice>=0&&hit.slice<c.slices.length&&hit.slice!==slice){slice=hit.slice;slider.value=slice;return load().then(()=>draw());}
        draw();
      },
      subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},
      close(){if(closed)return;closed=true;epoch++;cancelLoads();loaded=[];displayedSlice=pendingSlice=null;host.replaceChildren();host.dataset.slice='';host.dataset.pendingSlice='';host.dataset.requestedSlice='';host.dataset.loadState='closed';host.setAttribute('aria-busy','false');notify();listeners.clear();},
      setSlice(v){if(closed)return;const value=Number(v);slice=Math.max(0,Math.min(Math.max(0,c.slices.length-1),Number.isFinite(value)?Math.trunc(value):0));slider.value=slice;return load();}
    };
  }
  g.MDViewer={mount};
})(globalThis);
