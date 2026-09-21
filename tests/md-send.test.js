'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const M=require('../md-core.js'), app=require('../app.js');
if(!globalThis.crypto)globalThis.crypto=require('node:crypto').webcrypto;
// Code-only full-schema fixture. No source scans or image bytes are read.
function fixture(){
 return {version:app.MANIFEST_VERSION,localOnly:true,caseCount:5,windowHu:[-150,250],cases:app.CASE_SPECS.map(([id,depth,voxels])=>{
  const counts={gt:voxels,...Object.fromEntries(app.MODELS.slice(0,id==='case_045'?0:3).map((k,j)=>[k,app.MODEL_VOXELS[id][j]]))};
  const stats=Object.fromEntries(Object.entries(counts).map(([k,n])=>[k,{voxels:n,volumeMl:n*.002,componentCount:1,componentVolumesMl:[n*.002],positiveSliceCount:1,sliceSpan:[3,3]}]));
  return {id,sourceCaseId:id,sliceCount:depth,dimensions:[512,512,depth],spacing:[1,1,2],tumorVolumeMl:voxels*.002,defaultSlice:2,gt:stats.gt,models:Object.fromEntries(Object.entries(stats).filter(([k])=>k!=='gt')),
   disagreement:id==='case_045'?null:{intersectionVoxels:0,unionVoxels:app.MODEL_VOXELS[id].reduce((a,b)=>a+b,0),score:1},
   slices:Array.from({length:depth},(_,z)=>({index:z+1,canonicalSlice:z,width:512,height:512,gtPixels:z===2?voxels:0,ct:`data/model_compare/web/${id}/ct/${String(z+1).padStart(3,'0')}.webp`,ctSha256:'a'.repeat(64),overlays:Object.fromEntries(Object.keys(counts).map(k=>[k,{path:`data/model_compare/web/${id}/${k}/${String(z+1).padStart(3,'0')}.png`,sha256:'b'.repeat(64)}])),pixels:Object.fromEntries(Object.entries(counts).map(([k,n])=>[k,z===2?n:0]))}))};
 })};
}
function memory(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};}
async function setup(){const raw=fixture(),text=JSON.stringify(raw),scope=await M.digest(text),cases=app.normalizeManifest(raw);assert.equal(cases.length,5);return {text,scope,c:cases[0],cases,context:{manifestSha256:scope,manifestVersion:raw.version,cases}};}
const draft=(id='research-send')=>({id,notes:'SYNTHETIC TEST memo',selected:['cappyv2','cp050'],none:false});

test('research send requires explicit separate envelope; no real mode or mutation of patient mapping',async()=>{
 const {c,context,scope}=await setup(),before=JSON.stringify(c),s=M.store(memory(),scope);
 assert.equal(M.eligible(c),false);
 assert.throws(()=>M.localDemoEnvelope(c,context,false));
 assert.throws(()=>s.send(c,draft(),null,'DEMO'));
 assert.throws(()=>s.send(c,draft(),null,'REAL'));
 assert.throws(()=>s.send(c,draft(),null,'LOCAL_DEMO'));
 const envelope=M.localDemoEnvelope(c,context,true);
 const r=s.send(c,draft(),null,'LOCAL_DEMO',envelope);
 assert.equal(JSON.stringify(c),before);assert.equal(c.mapping,undefined);
 assert.equal(r.mode,'LOCAL_DEMO');assert.equal(r.dataKind,'research-ct');assert.equal(r.case.synthetic,undefined);
 assert.equal(r.recipient.patientMapping,null);assert.equal(r.recipient.patientId,undefined);
 assert.equal(r.binding.manifestSha256,scope);assert.equal(r.binding.sourceCaseId,c.id);
 assert.equal(r.sender,'LOCAL DEMO MD');assert.ok(r.time);assert.ok(M.isLocalRecord(r));
 assert.throws(()=>M.store(memory(),'wrong-scope').send(c,draft(),null,'LOCAL_DEMO',envelope));
 assert.throws(()=>M.localDemoEnvelope({...c,sourceCaseId:'case_001'},context,true));
});

test('acknowledged immutable snapshot, evidence, exact scoped links, reload, receipts and retry idempotency',async()=>{
 const {c,context,scope,text}=await setup(),storage=memory(),s=M.store(storage,scope),d=draft();
 const evidence={models:{},pairs:[],missingModels:[],reasons:[]}, envelope=M.localDemoEnvelope(c,context,true);
 s.draft(c.id,d);const r=s.send(c,d,evidence,'LOCAL_DEMO',envelope);
 d.notes='changed';evidence.reasons.push({kind:'forged'});envelope.case.id='changed';
 const reloaded=M.store(storage,scope),saved=reloaded.read().sends[r.id];
 assert.equal(saved.notes,'SYNTHETIC TEST memo');assert.deepEqual(saved.evidence.reasons,[]);assert.equal(saved.case.id,c.id);
 assert.equal(reloaded.read().reviews[c.id],true);assert.deepEqual(reloaded.read().drafts,{});
 const same=reloaded.send(c,{...draft(),notes:'attempted edit'},null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true));
 assert.deepEqual(same,saved);assert.equal(Object.keys(reloaded.read().sends).length,1);
 const query=new URLSearchParams(M.recordLink(scope,r.id).split('#')[1]);
 assert.equal(query.get('scope'),scope);assert.equal(query.get('record'),r.id);assert.equal(query.get('mode'),'sent');
 assert.equal(new URLSearchParams(M.recordLink(scope,r.id,'inbox').split('#')[1]).get('mode'),'inbox');
 assert.deepEqual(await M.snapshotCase(saved,text,app.normalizeManifest,scope),c);
 reloaded.receipt(r.id);assert.ok(reloaded.read().receipts[r.id]);
 reloaded.review(c.id,false);assert.ok(reloaded.read().sends[r.id]);assert.equal(reloaded.read().reviews[c.id],false);
});

test('failed or dropped write preserves draft and status; cancellation/discard never sends',async()=>{
 const {c,context,scope}=await setup(),storage=memory(),s=M.store(storage,scope),d=draft();s.draft(c.id,d);
 const envelope=M.localDemoEnvelope(c,context,true),write=storage.setItem;
 storage.setItem=()=>{throw Error('quota');};assert.throws(()=>s.send(c,d,null,'LOCAL_DEMO',envelope));
 assert.deepEqual(s.read().drafts[c.id],d);assert.deepEqual(s.read().sends,{});assert.deepEqual(s.read().reviews,{});
 storage.setItem=()=>{};assert.throws(()=>s.send(c,d,null,'LOCAL_DEMO',envelope),/acknowledgement/);
 assert.deepEqual(s.read().sends,{});storage.setItem=write;s.discard(c.id);
 assert.deepEqual(s.read(),{reviews:{},drafts:{},sends:{},receipts:{}});
});

test('reference-none and missing model stay honest; synthetic legacy still has no images',async()=>{
 const {cases,context,scope,text}=await setup(),c=cases.find(c=>c.id==='case_045'),s=M.store(memory(),scope),envelope=M.localDemoEnvelope(c,context,true);
 assert.throws(()=>s.send(c,draft(),null,'LOCAL_DEMO',envelope),/Invalid selection/);
 const r=s.send(c,{...draft(),selected:[],none:true},null,'LOCAL_DEMO',envelope);
 assert.deepEqual(r.selected,[]);assert.equal(r.evidence,null);assert.deepEqual(r.case.models,{});
 assert.deepEqual((await M.snapshotCase(r,text,app.normalizeManifest,scope)).models,{});
 const legacy=M.store(memory(),'demo-only-v1').send(M.demo,{...draft(),selected:[],none:true},null,'DEMO');
 assert.ok(M.isLocalRecord(legacy));assert.deepEqual(legacy.case.slices,[]);
 assert.equal(M.eligible({...M.demo,slices:cases[0].slices}),false);
});

test('live digest, case metadata, local paths, selected models and scope must match before images',async()=>{
 const {c,context,scope,text}=await setup(),s=M.store(memory(),scope);
 const r=s.send(c,draft(),null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true));
 await assert.rejects(()=>M.snapshotCase(r,text+' ',app.normalizeManifest,scope));
 await assert.rejects(()=>M.snapshotCase(r,text,app.normalizeManifest,'other-scope'));
 for(const mutate of [x=>x.case.id='case_001',x=>x.case.slices[0].ct='https://external.invalid/raw',x=>x.case.slices[0].ctSha256='c'.repeat(64),x=>x.case.spacing[0]=2,x=>x.binding.sourceCaseId='case_001',x=>x.selected=['gt'],x=>x.none=true,x=>x.mode='REAL']){
  const altered=JSON.parse(JSON.stringify(r));mutate(altered);
  await assert.rejects(()=>M.snapshotCase(altered,text,app.normalizeManifest,scope));
  assert.equal(altered.notes,'SYNTHETIC TEST memo','historical notes not erased by failed validation');
 }
 const malformed=JSON.parse(text);malformed.cases[0].slices[0].ct='../raw';
 const forged=JSON.parse(JSON.stringify(r));forged.binding.manifestSha256=forged.scope=await M.digest(JSON.stringify(malformed));
 await assert.rejects(()=>M.snapshotCase(forged,JSON.stringify(malformed),app.normalizeManifest,forged.scope));
});


test('versioned bound viewpoints: basic/legacy, finite bounds, malformed and foreign identity fail closed',async()=>{
 const {c,context,scope,text}=await setup(),envelope=M.localDemoEnvelope(c,context,true),s=M.store(memory(),scope);
 const v=M.attachViewpoint({slice:2,zoom:2,panX:20,panY:-30,contrast:1.4},c,envelope.binding);
 assert.equal(v.version,'md-viewpoint-v1');assert.equal(v.manifestSha256,scope);
 assert.throws(()=>M.attachViewpoint(null,c,envelope.binding));
 const basic=s.send(c,draft('basic'),null,'LOCAL_DEMO',envelope);assert.equal(basic.viewpoint,null);
 delete basic.viewpoint;assert.deepEqual(await M.snapshotCase(basic,text,app.normalizeManifest,scope),c);
 for(const change of [{version:'v2'},{caseId:'other'},{manifestSha256:'b'.repeat(64)},{slice:-1},{slice:c.slices.length},{slice:1.5},{zoom:NaN},{zoom:Infinity},{zoom:0},{zoom:6},{panX:2049},{panY:-2049},{panX:'0'},{contrast:.1},{contrast:4},{overlayMode:'invalid'},{overlayMode:null},{overlayVisible:0},{overlayVisible:null}]){
  const bad={...v,...change};
  const reopened=M.normalizeDraft(c,{...draft('invalid'),viewpoint:bad});
  assert.throws(()=>s.send(c,reopened,null,'LOCAL_DEMO',envelope),'malformed reopened draft must not silently become basic');
  assert.throws(()=>s.send(c,{...draft('invalid'),viewpoint:bad},null,'LOCAL_DEMO',envelope));
  await assert.rejects(()=>M.snapshotCase({...basic,viewpoint:bad},text,app.normalizeManifest,scope));
 }
 assert.equal(Object.keys(s.read().sends).length,1);
 assert.throws(()=>M.store(memory(),'demo-only-v1').send(M.demo,{...draft(),selected:[],none:true,viewpoint:v},null,'DEMO'));
});

test('attached viewpoint persists unchanged through failed send, draft reopen, retry, reload and none selection',async()=>{
 const {c,context,scope,text}=await setup(),storage=memory(),s=M.store(storage,scope),envelope=M.localDemoEnvelope(c,context,true);
 const v=M.attachViewpoint({slice:3,zoom:5,panX:2048,panY:-2048,contrast:.2,overlayMode:'outline',overlayVisible:false},c,envelope.binding);
 const d={...draft(),selected:[],none:true,viewpoint:v};s.draft(c.id,d);
 const original=JSON.stringify(v),write=storage.setItem;storage.setItem=()=>{throw Error('quota');};
 assert.throws(()=>s.send(c,d,null,'LOCAL_DEMO',envelope));assert.deepEqual(s.read().drafts[c.id].viewpoint,v);
 const reopened=M.normalizeDraft(c,s.read().drafts[c.id]);assert.deepEqual(reopened.viewpoint,v);
 storage.setItem=write;const r=s.send(c,reopened,null,'LOCAL_DEMO',envelope);reopened.viewpoint.zoom=1;
 assert.equal(JSON.stringify(M.store(storage,scope).read().sends[r.id].viewpoint),original);
 assert.deepEqual(await M.snapshotCase(r,text,app.normalizeManifest,scope),c);
 assert.deepEqual(s.send(c,{...d,viewpoint:{...v,zoom:1}},null,'LOCAL_DEMO',envelope),r);
 assert.deepEqual(r.selected,[]);assert.equal(r.none,true);
});

test('explicit basic choice survives draft normalization',()=>{
 const d=M.normalizeDraft(M.demo,{...draft(),viewpointChoice:'basic'});
 assert.equal(d.viewpointChoice,'basic');assert.equal(d.viewpoint,undefined);
});

test('automatic drafts awaiting a frame stay automatic on reopen; legacy drafts stay unspecified',()=>{
 const d=M.normalizeDraft(M.demo,{...draft(),viewpointChoice:'auto'});
 assert.equal(d.viewpointChoice,'auto');assert.equal(d.viewpoint,undefined);
 assert.equal(M.normalizeDraft(M.demo,draft()).viewpointChoice,undefined);
});
