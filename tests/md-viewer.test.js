'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const MD = require('../md-core.js');

// Exercise the actual renderer and controls without image assets or a browser.
function mount(caseData=MD.demo, reuse=null, sources=undefined, viewpoint=null) {
  const images = [];
  const doc = reuse?.doc || {
    createElement: tag => new Element(tag),
    createElementNS: (namespace, tag) => new Element(tag),
  };
  class Element {
    constructor(tag) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.attrs = {}; this.dataset = {}; this.textContent = ''; this.listeners={};this.operations=[];this.frame=[]; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    addEventListener(type, fn) {this.listeners[type]=fn;}
    getContext() {
      if(this.context)return this.context;
      const canvas=this;
      return this.context={
        clearRect(){canvas.operations.push('clear');canvas.frame=[];},
        drawImage(img){canvas.operations.push('draw');canvas.frame.push(img.src||'outline');},
        save(){},restore(){},translate(){},scale(){},strokeRect(){},putImageData(){},
        getImageData(){return {data:new Uint8ClampedArray(16).fill(255)};},
        createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
      };
    }
  }
  class DeferredImage {
    constructor(){this.naturalWidth=this.naturalHeight=2;images.push(this);}
    set src(value){this.url=value;this.success=this.onload;this.failure=this.onerror;}
    get src(){return this.url;}
    removeAttribute(){this.cancelled=true;}
    // Captured handlers deliberately still fire after cancellation to prove
    // that late browser events cannot redraw a closed/superseded viewer.
    succeed(){this.success();}
    fail(){this.failure(new Error('deferred failure'));}
  }
  const context = {MD,Image:DeferredImage};
  vm.runInNewContext(fs.readFileSync(require.resolve('../md-viewer.js'), 'utf8'), context);
  const host = reuse?.host || new Element('div');
  const viewer = context.MDViewer.mount(host, caseData, sources, viewpoint);
  return {host, viewer, images, doc};
}
function descendants(node) { return node.children.flatMap(c => [c, ...descendants(c)]); }

test('actual default renderer mounts exactly four source-bound canvases with no CT modal or overlay select', () => {
  const {host, viewer} = mount(), all = descendants(host);
  const panels = all.filter(n => n.className === 'md-image-panel');
  assert.deepEqual(panels.map(n => n.dataset.source), ['gt','cappyv2','cp050','baseline']);
  assert.deepEqual(panels.map(n => n.children[0].textContent), ['GT · 참조 정답','CAPPY2 current · 예측','CAPPY2 050 · 예측','Baseline · 예측']);
  assert.equal(all.filter(n => n.tag === 'canvas').length, 4);
  assert.equal(all.filter(n => ['dialog','select'].includes(n.tag)).length, 0);
  viewer.close();
  assert.equal(host.children.length, 0);
});

test('overlay button group has exclusive pressed state; icon-only eye preserves every mode across off/on', () => {
  const {host} = mount(), all = descendants(host);
  const group = all.find(n => n.attrs.role === 'group');
  assert.equal(group.attrs['aria-label'], '동시 오버레이 방식');
  assert.deepEqual(group.children.map(n => n.dataset.overlayMode), ['seg','outline','box']);
  assert.deepEqual(group.children.map(n => n.attrs['aria-pressed']), ['true','false','false']);
  const eye = all.find(n => n.className === 'md-overlay-eye');
  assert.equal(eye.tag, 'button');
  assert.equal(eye.type, 'button'); // Native Enter/Space activation; browser test checks both.
  assert.equal(eye.attrs['aria-label'], '모든 패널 오버레이 표시');
  assert.equal(eye.textContent, '');
  assert.equal(eye.children[0].tag, 'svg');
  assert.equal(eye.children[0].attrs['aria-hidden'], 'true');
  assert.equal(eye.children[0].attrs.focusable, 'false');
  for (const button of group.children) {
    assert.equal(button.tag, 'button'); assert.equal(button.type, 'button');
    button.onclick();
    assert.equal(button.attrs['aria-pressed'], 'true');
    assert.equal(group.children.filter(n => n.attrs['aria-pressed'] === 'true').length, 1);
    eye.onclick();
    assert.equal(eye.attrs['aria-pressed'], 'false');
    assert.equal(eye.title, '모든 패널 오버레이 복원');
    assert.equal(host.dataset.overlayVisible, 'false');
    eye.onclick();
    assert.equal(eye.attrs['aria-pressed'], 'true');
    assert.equal(eye.title, '모든 패널 오버레이 숨기기');
    assert.equal(host.dataset.overlayVisible, 'true');
    assert.equal(host.dataset.overlayMode, button.dataset.overlayMode);
    assert.equal(button.attrs['aria-pressed'], 'true');
  }
});


function caseFixture(missing=false) {
  return {id:'SYNTHETIC-FRAME-TEST',slices:[0,1,2,3].map(z=>({ct:`ct/${z}.webp`,
    overlays:Object.fromEntries(Object.keys(MD.labels).filter(k=>!missing||k!=='baseline').map(k=>[k,{path:`${k}/${z}.png`}]))}))};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const canvases=h=>descendants(h.host).filter(n=>n.tag==='canvas');
const output=h=>descendants(h.host).find(n=>n.tag==='output');
const requests=(h,z)=>h.images.filter(img=>img.url.endsWith(`/${z}.webp`)||img.url.endsWith(`/${z}.png`));
function complete(h,z){requests(h,z).forEach(img=>img.succeed());}
async function initial(){const h=mount(caseFixture());complete(h,0);await flush();return h;}
function assertFrame(h,z){
  assert.equal(h.host.dataset.slice,String(z));
  for(const [i,canvas] of canvases(h).entries()){
    assert.equal(canvas.dataset.slice,String(z));
    assert.equal(canvas.hidden,false);
    assert.deepEqual(canvas.frame,[`/ct/${z}.webp`,`/${Object.keys(MD.labels)[i]}/${z}.png`]);
  }
}

test('wheel leaves committed pixels untouched while CT and all overlays load, then commits together',async()=>{
  const h=await initial();assertFrame(h,0);
  const before=canvases(h).map(c=>c.operations.length);
  canvases(h)[0].listeners.wheel({deltaY:100,deltaX:0,preventDefault(){}});
  assert.equal(h.host.dataset.pendingSlice,'1');assert.equal(h.host.dataset.requestedSlice,'1');
  assert.equal(h.host.dataset.loadState,'loading');assert.equal(h.host.attrs['aria-busy'],'true');
  assert.match(output(h).textContent,/표시 1 \/ 4.*요청 2 \/ 4/);
  assertFrame(h,0);assert.deepEqual(canvases(h).map(c=>c.operations.length),before);
  const batch=requests(h,1);assert.equal(batch.length,5,'one shared CT plus four overlays');
  for(const img of batch.slice(0,-1)){img.succeed();await flush();assertFrame(h,0);assert.deepEqual(canvases(h).map(c=>c.operations.length),before);}
  batch.at(-1).succeed();await flush();assertFrame(h,1);
  assert.equal(h.host.dataset.pendingSlice,'');assert.equal(h.host.dataset.loadState,'ready');
  assert.equal(output(h).textContent,'표시 2 / 4');
});

test('out-of-order obsolete images never commit; newest complete frame wins with bounded active loads',async()=>{
  const h=await initial();h.viewer.setSlice(1);const older=requests(h,1);
  older[0].succeed();await flush();
  h.viewer.setSlice(2);assert.ok(older.slice(1).every(img=>img.cancelled));
  assert.equal(h.images.filter(img=>!img.cancelled && img.onload).length,5);
  older.forEach(img=>img.succeed());await flush();assertFrame(h,0);
  assert.equal(h.host.dataset.pendingSlice,'2');assert.equal(h.host.dataset.loadState,'loading');
  complete(h,2);await flush();assertFrame(h,2);
  older.forEach(img=>img.succeed());await flush();assertFrame(h,2);
  assert.equal(h.host.dataset.loadState,'ready');
  h.viewer.setSlice(3);requests(h,3)[0].fail();await flush();assertFrame(h,2);
  assert.match(output(h).textContent,/표시 3 \/ 4.*요청 4 실패.*이전 영상 유지/);
});

test('overlay failure retains the entire prior frame; explicit retry commits a complete frame',async()=>{
  const h=await initial();const before=canvases(h).map(c=>c.operations.length);
  h.viewer.setSlice(1);const batch=requests(h,1);
  batch.slice(0,-1).forEach(img=>img.succeed());await flush();
  batch.at(-1).fail();await flush();assertFrame(h,0);
  assert.deepEqual(canvases(h).map(c=>c.operations.length),before);
  assert.equal(h.host.dataset.loadState,'error');assert.equal(h.host.dataset.pendingSlice,'');
  assert.match(output(h).textContent,/요청 2 실패.*이전 영상 유지/);
  assert.ok(descendants(h.host).filter(n=>n.attrs.role==='status').every(n=>/Baseline 이미지 오류/.test(n.textContent)));
  const retryButton=descendants(h.host).find(n=>n.textContent==='절편 다시 불러오기');assert.equal(retryButton.hidden,false);retryButton.onclick();
  const retry=requests(h,1).slice(5);assert.equal(retry.length,5);assert.equal(retryButton.hidden,true);
  retry.forEach(img=>img.succeed());await flush();assertFrame(h,1);
});

test('initial failure never exposes partial panels, and known missing models commit honestly',async()=>{
  const h=mount(caseFixture());const batch=requests(h,0);
  batch.slice(1).forEach(img=>img.succeed());await flush();
  assert.ok(canvases(h).every(c=>c.hidden&&c.operations.length===0));
  batch[0].fail();await flush();assert.equal(h.host.dataset.slice,'');
  assert.ok(canvases(h).every(c=>c.hidden&&c.operations.length===0));
  assert.match(output(h).textContent,/표시 없음.*실패.*표시할 영상 없음/);
  const missing=mount(caseFixture(true));assert.equal(requests(missing,0).length,4);
  complete(missing,0);await flush();
  assert.equal(missing.host.dataset.slice,'0');
  assert.deepEqual(canvases(missing).at(-1).frame,['/ct/0.webp']);
  assert.match(descendants(missing.host).filter(n=>n.attrs.role==='status').at(-1).textContent,/Baseline 자료 없음 · CT만 표시/);
});

test('return to displayed slice cancels pending without redraw; late failure cannot change labels',async()=>{
  const h=await initial();const before=canvases(h).map(c=>c.operations.length);
  h.viewer.setSlice(1);const batch=requests(h,1);h.viewer.setSlice(0);
  assert.ok(batch.every(img=>img.cancelled));assert.equal(h.host.dataset.loadState,'ready');
  batch.forEach(img=>img.fail());await flush();assertFrame(h,0);
  assert.deepEqual(canvases(h).map(c=>c.operations.length),before);
  assert.equal(output(h).textContent,'표시 1 / 4');
});

test('close/reopen on same host isolates late events and repeated old close calls',async()=>{
  const h=await initial();h.viewer.setSlice(1);const old=requests(h,1),oldCanvases=canvases(h);
  h.viewer.close();assert.ok(old.every(img=>img.cancelled));
  const counts=oldCanvases.map(c=>c.operations.length);
  const reopened=mount({...caseFixture(),id:'SYNTHETIC-OTHER-CASE'},h);
  h.viewer.close();h.viewer.setSlice(3);old.forEach(img=>img.succeed());await flush();
  assert.equal(reopened.host.dataset.slice,'');assert.equal(reopened.host.dataset.loadState,'loading');
  assert.deepEqual(oldCanvases.map(c=>c.operations.length),counts);
  complete(reopened,0);await flush();assertFrame(reopened,0);
  assert.ok(canvases(reopened).every(c=>c.dataset.caseId==='SYNTHETIC-OTHER-CASE'));
});

test('view controls during pending redraw only committed sources and persist into next commit',async()=>{
  const h=await initial();h.viewer.setSlice(1);
  const eye=descendants(h.host).find(n=>n.className==='md-overlay-eye');eye.onclick();
  assert.equal(h.host.dataset.slice,'0');assert.equal(h.host.dataset.overlayVisible,'false');
  assert.ok(canvases(h).every(c=>JSON.stringify(c.frame)===JSON.stringify(['/ct/0.webp'])));
  complete(h,1);await flush();assert.equal(h.host.dataset.slice,'1');
  assert.ok(canvases(h).every(c=>JSON.stringify(c.frame)===JSON.stringify(['/ct/1.webp'])));
  eye.onclick();assertFrame(h,1);
});


test('viewpoint capture uses committed frame through rapid pending scroll, failure and close',async()=>{
 const h=mount(caseFixture());assert.equal(h.viewer.capture(),null);
 complete(h,0);await flush();
 const controls=descendants(h.host).filter(n=>n.type==='range');
 controls[1].value=2;controls[1].listeners.input();
 controls[2].value=1.5;controls[2].listeners.input();
 canvases(h)[0].onkeydown({key:'ArrowRight',shiftKey:true,preventDefault(){}});
 descendants(h.host).find(n=>n.dataset.overlayMode==='box').onclick();
 descendants(h.host).find(n=>n.className==='md-overlay-eye').onclick();
 assert.equal(h.viewer.capture().overlayMode,'box');assert.equal(h.viewer.capture().overlayVisible,false);
 const before=JSON.stringify(h.viewer.capture());
 h.viewer.setSlice(1);h.viewer.setSlice(3);
 assert.equal(JSON.stringify(h.viewer.capture()),before);assert.equal(h.viewer.state().pendingSlice,3);
 requests(h,1).forEach(i=>i.succeed());await flush();assert.equal(JSON.stringify(h.viewer.capture()),before);
 requests(h,3)[0].fail();await flush();assert.equal(JSON.stringify(h.viewer.capture()),before);
 const frame=h.viewer.capture();assert.equal(frame.slice,0);assert.equal(frame.zoom,2);assert.equal(frame.panX,10);assert.equal(frame.contrast,1.5);
 frame.slice=999;assert.equal(h.viewer.capture().slice,0);
 h.viewer.close();assert.equal(h.viewer.capture(),null);
});

test('attached frame restores atomically for selected simultaneous panels or CT-only; controls do not mutate saved view',async()=>{
 const c=caseFixture(),saved={version:'md-viewpoint-v1',caseId:c.id,manifestSha256:'a'.repeat(64),slice:2,zoom:2,panX:10,panY:-20,contrast:1.5,overlayMode:'outline',overlayVisible:false};
 const original=JSON.stringify(saved);
 for(const sources of [['cappyv2','cp050'],['ct']]){
  const h=mount(c,null,sources,saved);assert.equal(h.viewer.capture(),null);
  assert.equal(requests(h,0).length,0);assert.equal(requests(h,2).length,sources.length===1?1:3);
  complete(h,2);await flush();
  assert.deepEqual(descendants(h.host).filter(n=>n.className==='md-image-panel').map(n=>n.dataset.source),sources);
  assert.equal(h.host.dataset.overlayMode,'outline');assert.equal(h.host.dataset.overlayVisible,'false');
  assert.equal(h.viewer.capture().overlayMode,'outline');assert.equal(h.viewer.capture().overlayVisible,false);
  assert.equal(descendants(h.host).find(n=>n.className==='md-overlay-eye').attrs['aria-pressed'],'false');
  assert.equal(h.host.dataset.slice,'2');assert.equal(h.host.dataset.zoom,'2');assert.equal(h.host.dataset.panY,'-20');
  const box=descendants(h.host).find(n=>n.dataset.overlayMode==='box');box.onclick();
  const eye=descendants(h.host).find(n=>n.className==='md-overlay-eye');eye.onclick();eye.onclick();assert.equal(h.host.dataset.overlayMode,'box');
  descendants(h.host).find(n=>n.textContent==='위치 초기화').onclick();
  assert.equal(h.host.dataset.zoom,'1');assert.equal(h.host.dataset.panX,'0');assert.equal(h.host.dataset.contrast,'1');
  h.viewer.setSlice(3);complete(h,3);await flush();assert.equal(h.host.dataset.slice,'3');
  assert.equal(JSON.stringify(saved),original);h.viewer.close();
 }
 assert.throws(()=>mount(c,null,['ct'],{...saved,slice:100}));
});

test('legacy viewpoints keep historical seg/visible defaults',async()=>{
 const c=caseFixture(),saved={version:'md-viewpoint-v1',caseId:c.id,manifestSha256:'a'.repeat(64),slice:1,zoom:1,panX:0,panY:0,contrast:1};
 const h=mount(c,null,['cappyv2'],saved);complete(h,1);await flush();
 assert.equal(h.host.dataset.overlayMode,'seg');assert.equal(h.host.dataset.overlayVisible,'true');
 assert.equal(h.viewer.capture().overlayMode,'seg');assert.equal(h.viewer.capture().overlayVisible,true);
 h.viewer.close();
});
