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

test('follow-up opinion is never preselected; unknown or empty saved values stay absent',()=>{
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,draft()),'followup'),false);
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,{}),'followup'),false);
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,{followup:''}),'followup'),false);
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,{followup:'selected_by_ai'}) ,'followup'),false);
 assert.equal(M.normalizeDraft(M.demo,{followup:'short_term_followup'}).followup,'short_term_followup');
 assert.equal(M.normalizeDraft(M.demo,{followup:'none'}).followup,'none');
 assert.deepEqual(M.followupOptions,['short_term_followup','immediate_us_biopsy','other','none']);
});

test('MD follow-up opinion is stored once in the immutable snapshot and re-read unchanged',async()=>{
 const {c,context,scope}=await setup(),storage=memory(),s=M.store(storage,scope);
 const d={...draft('followup-send'),followup:'short_term_followup',notes:'SYNTHETIC followup memo'};
 const r=s.send(c,d,null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true));
 assert.equal(r.followup,'short_term_followup');assert.equal(M.followupLabel(r.followup),'단기 추적검사');
 d.followup='immediate_us_biopsy';d.notes='MUTATED AFTER SEND';
 const reloaded=M.store(storage,scope).read().sends[r.id];
 assert.equal(reloaded.followup,'short_term_followup');assert.equal(reloaded.notes,'SYNTHETIC followup memo');
 assert.equal(JSON.stringify(reloaded),JSON.stringify(r));
 const r2=s.send(c,{...draft('followup-none'),followup:'none'},null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true));
 assert.equal(r2.followup,'none');assert.equal(M.followupLabel(r2.followup),'의견 없음');
 assert.equal(M.followupLabel(undefined),'이 전송에는 의견 기록이 없습니다.');
 assert.equal(M.followupLabel('ct_is_normal'),'읽을 수 없는 의견 유형');
});

test('pre-opinion is never preselected; unknown or empty saved values stay absent',()=>{
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,draft()),'precheck'),false);
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,{}),'precheck'),false);
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,{precheck:''}),'precheck'),false);
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,{precheck:'selected_by_ai'}),'precheck'),false);
 assert.equal(M.normalizeDraft(M.demo,{precheck:'recheck_needed'}).precheck,'recheck_needed');
 assert.equal(M.normalizeDraft(M.demo,{precheck:'deferred'}).precheck,'deferred');
 assert.deepEqual(M.precheckOptions,['recheck_needed','not_needed','deferred']);
});

test('MD pre-opinion is stored once in the immutable snapshot and re-read unchanged',async()=>{
 const {c,context,scope}=await setup(),storage=memory(),s=M.store(storage,scope);
 const d={...draft('precheck-send'),precheck:'recheck_needed'};
 const r=s.send(c,d,null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true));
 assert.equal(r.precheck,'recheck_needed');assert.equal(M.precheckLabel(r.precheck),'재확인 필요');
 assert.equal(Object.hasOwn(r,'followup'),false);
 d.precheck='not_needed';
 const reloaded=M.store(storage,scope).read().sends[r.id];
 assert.equal(reloaded.precheck,'recheck_needed');
 assert.equal(JSON.stringify(reloaded),JSON.stringify(r));
 const r2=s.send(c,{...draft('precheck-deferred'),precheck:'deferred'},null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true));
 assert.equal(M.precheckLabel(r2.precheck),'판단 유보');
 // Omitting the field stays unrecorded; nothing infers a value for legacy sends.
 const r3=s.send(c,draft('precheck-absent'),null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true));
 assert.equal(Object.hasOwn(r3,'precheck'),false);
 assert.equal(M.precheckLabel(r3.precheck),'이 전송에는 사전 의견이 기록되지 않았습니다.');
 assert.equal(M.precheckLabel('ct_is_normal'),'읽을 수 없는 사전 의견');
});

test('an unrecognised pre-opinion value is refused and leaves no send record',async()=>{
 const {c,context,scope}=await setup(),s=M.store(memory(),scope);
 assert.throws(()=>s.send(c,{...draft('bad-precheck'),precheck:'ct_is_normal'},null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true)),/Invalid pre-opinion record/);
 assert.equal(s.read().sends['bad-precheck'],undefined);
 assert.equal(Object.keys(s.read().sends).length,0);
});

test('an unrecognised follow-up value is refused and leaves no send record',async()=>{
 const {c,context,scope}=await setup(),s=M.store(memory(),scope);
 assert.throws(()=>s.send(c,{...draft('bad-followup'),followup:'ct_is_normal'},null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true)),/Invalid followup opinion/);
 assert.equal(s.read().sends['bad-followup'],undefined);
 assert.equal(Object.keys(s.read().sends).length,0);
});

// Model pairs are the evidence rows, not the review list: one candidate repeats across
// disagreeing pairs, which is what made the candidate list unreadable on case_035.
const evidenceOf=(...rows)=>({models:{},pairs:[],missingModels:[],reasons:rows});
const pair=(candidateId,model,otherModel,slice,extra={})=>({kind:'model_disagreement',candidateId,model,otherModel,voxel:[10,20,slice],slice,smallAdditional:false,...extra});

test('review candidates collapse model-pair rows into one row per candidate and keep counterparts',()=>{
 const e=evidenceOf(
  pair('cp050:3','cappyv2','cp050',174),
  pair('cp050:3','cappyv2','cp050',174),
  pair('cp050:3','cappyv2','lesionfinder',174),
  pair('cp012:1','cp050','cappyv2',9,{smallAdditional:true}),
  {kind:'forged'},null,{candidateId:''});
 const k=M.reviewCandidates(e);
 assert.equal(e.reasons.filter(r=>r&&r.candidateId).length,4);
 assert.deepEqual(k.map(x=>x.candidateId),['cp012:1','cp050:3']);
 assert.deepEqual(k[1].pairs,['cp050','lesionfinder']);
 assert.equal(k[1].voxel.join(','),'10,20,174');
 assert.equal(k[0].small,true);assert.equal(k[1].small,false);
 assert.deepEqual(M.reviewCandidates(null),[]);assert.deepEqual(M.reviewCandidates({reasons:[]}),[]);
 assert.equal(M.candidateLabel(k[1]),'cp050:3 · 절편 175');
 assert.equal(M.candidateLabel(k[0]),'cp012:1 · 절편 10 · 작은 추가 후보');
 assert.equal(M.candidateLabel({candidateId:'cp9',slice:null,small:false}),'cp9 · 절편 알 수 없음');
});

test('a biopsy target is validated against this case\'s candidates and stored immutably',async()=>{
 const {c,context,scope}=await setup(),storage=memory(),s=M.store(storage,scope);
 const e=evidenceOf(pair('cp050:3','cappyv2','cp050',174),pair('cp050:3','cappyv2','lesionfinder',174));
 const d={...draft('biopsy-send'),followup:'immediate_us_biopsy',biopsyProtocol:'ct',biopsy:'cp050:3'};
 const r=s.send(c,d,e,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true));
 assert.equal(r.biopsyProtocol,'ct');assert.equal(M.biopsyProtocolLabel(r.biopsyProtocol),'CT 유도');
 assert.deepEqual(r.biopsyCandidate,{candidateId:'cp050:3',model:'cappyv2',voxel:[10,20,174],slice:174,small:false});
 assert.equal(M.biopsyCandidateLabel(r.biopsyCandidate),'cp050:3 · 절편 175');
 d.biopsy='cp999';d.followup='other';
 assert.equal(JSON.stringify(M.store(storage,scope).read().sends[r.id]),JSON.stringify(r));
 // A biopsy opinion is not actionable without the route that performs it, and a
 // protocol attached to a non-biopsy opinion is rejected rather than silently dropped.
 assert.throws(()=>s.send(c,{...draft('biopsy-no-protocol'),followup:'immediate_us_biopsy',biopsy:'cp050:3'},e,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true)),/Biopsy opinion requires a guidance protocol/);
 assert.throws(()=>s.send(c,{...draft('biopsy-bad-protocol'),followup:'immediate_us_biopsy',biopsyProtocol:'xray',biopsy:'cp050:3'},e,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true)),/Biopsy opinion requires a guidance protocol/);
 assert.throws(()=>s.send(c,{...draft('protocol-without-biopsy'),followup:'short_term_followup',biopsyProtocol:'us'},e,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true)),/Invalid biopsy protocol/);
 assert.equal(s.read().sends['biopsy-no-protocol'],undefined);assert.equal(s.read().sends['protocol-without-biopsy'],undefined);
 assert.throws(()=>s.send(c,{...draft('biopsy-unknown'),biopsy:'cp999'},e,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true)),/Invalid biopsy candidate/);
 assert.throws(()=>s.send(c,{...draft('biopsy-no-evidence'),biopsy:'cp050:3'},null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true)),/Invalid biopsy candidate/);
 assert.equal(s.read().sends['biopsy-unknown'],undefined);assert.equal(s.read().sends['biopsy-no-evidence'],undefined);
 assert.equal(M.store(storage,scope).read().sends[r.id].biopsyCandidate.voxel.join(','),'10,20,174');
 assert.equal(M.biopsyCandidateLabel(undefined),'이 전송에는 조직검사 후보가 기록되지 않았습니다.');
 assert.equal(M.biopsyCandidateLabel({candidateId:42}),'읽을 수 없는 조직검사 후보');
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,{...draft(),biopsy:''}),'biopsy'),false);
 assert.equal(M.normalizeDraft(M.demo,{...draft(),biopsy:'cp050:3'}).biopsy,'cp050:3');
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,{...draft(),visitRequest:false}),'visitRequest'),false);
 assert.equal(M.normalizeDraft(M.demo,{...draft(),visitRequest:true}).visitRequest,true);
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,{...draft(),biopsyProtocol:''}),'biopsyProtocol'),false);
 assert.equal(Object.hasOwn(M.normalizeDraft(M.demo,{...draft(),biopsyProtocol:'pet'}),'biopsyProtocol'),false);
 assert.equal(M.normalizeDraft(M.demo,{...draft(),biopsyProtocol:'mri'}).biopsyProtocol,'mri');
});

test('biopsy protocol checklist is demo wording that routes to institutional confirmation',()=>{
 assert.deepEqual(M.biopsyProtocolOptions,['us','ct','mri','surgical']);
 assert.equal(M.biopsyProtocolLabel('us'),'초음파(US) 유도');
 assert.equal(M.biopsyProtocolLabel(undefined),'이 전송에는 조직검사 프로토콜이 기록되지 않았습니다.');
 assert.equal(M.biopsyProtocolLabel('robotic'),'읽을 수 없는 프로토콜');
 for(const key of M.biopsyProtocolOptions){
  const g=M.protocolGuide(key);
  assert.equal(g.kind,'demo-protocol-guide-v1');assert.equal(g.key,key);
  assert.ok(g.title&&g.fit&&g.steps.length>=4&&g.confirm);
  assert.match(g.authority,/이 병원의 실제 프로토콜 문서 아님/);
  const text=JSON.stringify(g);
  // No fabricated clinical numbers, and the wording never claims an institution's rule.
  assert.equal(/\d+\s?(?:Gy|mGy|mmHg|mL|h|시간|일|%)/.test(text),false,text.slice(0,80));
  assert.match(g.confirm,/기관 확인 필요|해당 기관에서 확인 필요/);
 }
 assert.equal(M.protocolGuide('xray'),null);
 assert.equal(M.protocolGuide(undefined),null);
 // The guidance list must never be handed to the MD as a pre-filled default.
 assert.equal(M.normalizeDraft(M.demo,draft()).biopsyProtocol,undefined);
});

test('patient series is a geometry-based demo grouping with assumed dates, never verified identity',async()=>{
 const {c,cases,context,scope}=await setup(),s=M.store(memory(),scope);
 const s0=M.seriesFor(c);
 assert.equal(s0.patientId,'DEMO-P-01');
 assert.deepEqual(s0.studies.map(k=>k.relation),['prior','current','next']);
 assert.deepEqual(s0.studies.map(k=>k.alias),['LL-CT-001','case_000','case_001']);
 assert.deepEqual(s0.studies.map(k=>k.viewable),[false,true,true]);
 assert.deepEqual(s0.studies.map(k=>k.dateIsAssumed),[true,true,true]);
 assert.match(s0.basis,/같은 획득 프로토콜로 추정/);
 assert.equal(M.seriesSummary(c),'DEMO-P-01 · 이전 1건 · 이 검사 · 다음 1건');
 // The pairing must not move when the same case is read again.
 assert.deepEqual(M.seriesFor({id:c.id}),s0);
 const last=cases.find(x=>x.id==='case_001');
 assert.deepEqual(M.seriesFor(last).studies.map(k=>k.relation),['prior','prior','current']);
 const pair2=cases.find(x=>x.id==='case_045');
 assert.deepEqual(M.seriesFor(pair2).studies.map(k=>k.label),['이 검사','다음 CT']);
 assert.deepEqual(M.seriesFor(cases.find(x=>x.id==='case_048')).studies.map(k=>k.relation),['current']);
 assert.equal(M.seriesFor(M.demo),null);
 const record=s.send(c,draft('series-send'),null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true));
 assert.deepEqual(record.series,s0);
 // The synthetic workflow case has no CT, so no series is attached to its record.
 const synthetic=M.store(memory(),'demo-only-v1').send(M.demo,{...draft('series-synthetic'),selected:[],none:true},null,'DEMO');
 assert.equal(synthetic.dataKind,'synthetic-no-ct');assert.equal(synthetic.series,null);
});

test('outpatient request is accepted only for a not-visited demo case and stored as a request, not a send',async()=>{
 const {c,cases,context,scope}=await setup(),s=M.store(memory(),scope);
 assert.equal(M.visitStatus(c),'scheduled_not_visited');
 const visited=cases.find(x=>M.visitStatus(x)!=='scheduled_not_visited');assert.ok(visited);
 const r=s.send(c,{...draft('visit-send'),visitRequest:true},null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true));
 assert.deepEqual(r.visit,{status:'scheduled_not_visited',requested:true});
 assert.equal(M.visitLabel(r.visit.status),'금일 외래 미내원');
 const plain=s.send(c,draft('visit-plain'),null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true));
 assert.deepEqual(plain.visit,{status:'scheduled_not_visited',requested:false});
 assert.throws(()=>s.send(visited,{...draft('visit-wrong'),visitRequest:true},null,'LOCAL_DEMO',M.localDemoEnvelope(visited,context,true)),/Outpatient request requires a not-visited case/);
 assert.equal(s.read().sends['visit-wrong'],undefined);
 assert.throws(()=>s.send(c,{...draft('visit-bad-value'),visitRequest:'yes'},null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true)),/Invalid outpatient request/);
 assert.equal(M.visitStatus({id:c.id}),M.visitStatus(c));
 assert.equal(M.visitLabel(undefined),'이 전송에는 내원 정보 기록이 없습니다.');
 assert.equal(M.visitLabel('admitted_yesterday'),'읽을 수 없는 내원 정보');
});

test('prior study pairing is a labelled demo crop of the same source volume, never a patient history',async()=>{
 const {c,cases,context,scope}=await setup(),s=M.store(memory(),scope);
 const p=M.priorStudyFor(c);
 assert.equal(p.caseId,'case_000');assert.equal(p.alias,'LL-CT-001');assert.equal(p.dateIsAssumed,true);
 assert.equal(p.manifestPath,'data/real_cases/manifest.json');assert.match(p.basis,/환자 검사가 아님/);
 assert.deepEqual(s.send(c,draft('prior-send'),null,'LOCAL_DEMO',M.localDemoEnvelope(c,context,true)).priorStudy,p);
 const other=cases.find(x=>x.id!=='case_000');
 assert.equal(M.priorStudyFor(other),null);
 assert.equal(s.send(other,draft('prior-other'),null,'LOCAL_DEMO',M.localDemoEnvelope(other,context,true)).priorStudy,null);
});
