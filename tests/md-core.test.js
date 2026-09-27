'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),M=require('../md-core.js');
function memory(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),data};}
const draft=()=>({id:'idempotent-1',notes:'synthetic note',selected:[],none:true});
test('send acknowledged durable state, immutable snapshot, scoped receiver, receipt and reopen',()=>{
 const storage=memory(),s=M.store(storage,'a'),d=draft();s.draft(M.demo.id,d);
 const r=s.send(M.demo,d,null,'DEMO');d.notes='changed';assert.equal(r.notes,'synthetic note');
 const reload=M.store(storage,'a');assert.equal(reload.read().reviews[M.demo.id],true);assert.equal(reload.read().sends[r.id].notes,'synthetic note');assert.deepEqual(reload.read().drafts,{});
 assert.deepEqual(M.store(storage,'b').read().sends,{});reload.receipt(r.id);assert.ok(reload.read().receipts[r.id]);reload.review(M.demo.id,false);assert.equal(reload.read().reviews[M.demo.id],false);assert.ok(reload.read().sends[r.id]);
});
test('write failure retains persisted draft, retry same ID is idempotent; no success on silent dropped write',()=>{
 const storage=memory(),s=M.store(storage,'a'),d=draft();s.draft(M.demo.id,d);const write=storage.setItem;storage.setItem=()=>{throw Error('quota');};
 assert.throws(()=>s.send(M.demo,d,null,'DEMO'));assert.deepEqual(s.read().drafts[M.demo.id],d);assert.deepEqual(s.read().reviews,{});assert.deepEqual(s.read().sends,{});
 storage.setItem=()=>{};assert.throws(()=>s.send(M.demo,d,null,'DEMO'),/acknowledgement/);assert.deepEqual(s.read().sends,{});
 storage.setItem=write;const r=s.send(M.demo,d,null,'DEMO');assert.deepEqual(s.send(M.demo,d,null,'DEMO'),r);assert.equal(Object.keys(s.read().sends).length,1);
});
test('XOR multi-model selection, missing model and clinical mapping guard',()=>{
 const c={...M.demo,models:{cappyv2:{},cp050:{}},slices:[{overlays:{cappyv2:{path:'a'},cp050:{path:'b'}}}]};
 assert.ok(M.selection(c,['cappyv2','cp050'],false));assert.ok(M.selection(c,[],true));
 for(const [sel,none] of [[[],false],[['cappyv2'],true],[['baseline'],false],[['gt'],false],[['cappyv2','cappyv2'],false]])assert.equal(M.selection(c,sel,none),false);
 const s=M.store(memory(),'a');for(const bad of [{...M.demo,synthetic:false},{...M.demo,id:'case_000'},{...M.demo,mapping:{...M.demo.mapping,department:'pathology'}},{...M.demo,mapping:null}])assert.throws(()=>s.send(bad,draft(),null,'DEMO'));
 assert.throws(()=>s.send(M.demo,draft(),null,'REAL'));
});
test('pending-first filtering, evidence-only order, stable ID ties, missing retained, reopen',()=>{
 const cases=[{id:'b',gt:{componentCount:100}},{id:'a'},{id:'c'},{id:'missing'}],e={c:{reasons:[{}]},a:{reasons:[{}]}};
 const state={reviews:{a:true},sends:{x:{case:{id:'a'}}}};
 assert.deepEqual(M.queue(cases,e,state).map(c=>c.id),['c','b','missing']);assert.deepEqual(M.queue(cases,e,state,'sent').map(c=>c.id),['a']);
 state.reviews.a=false;assert.deepEqual(M.queue(cases,e,state).map(c=>c.id),['a','c','b','missing']);
 assert.match(M.reason(null),/미산출/);assert.match(M.reason({reasons:[],missingModels:['baseline']}),/일부 없음/);
});
test('cancel/discard changes drafts only; receipt persistence failure not acknowledged',()=>{
 const storage=memory(),s=M.store(storage,'a');s.draft(M.demo.id,draft());s.discard(M.demo.id);assert.deepEqual(s.read(),{reviews:{},drafts:{},sends:{},receipts:{}});
 s.send(M.demo,draft(),null,'DEMO');storage.setItem=()=>{throw Error('quota');};assert.throws(()=>s.receipt('idempotent-1'));assert.deepEqual(s.read().receipts,{});
});

test('reference normalization cannot persist empty/non-none or unavailable/duplicate choices',()=>{
 const c={...M.demo,models:{cappyv2:{},cp050:{}},slices:[{overlays:{cappyv2:{path:'a'},cp050:{path:'b'}}}]};
 for(const [selected,none,expected] of [
  [[],false,{selected:[],none:true}],
  [['cappyv2','cp050'],false,{selected:['cappyv2','cp050'],none:false}],
  [['cappyv2','cappyv2','baseline','gt'],false,{selected:['cappyv2'],none:false}],
  [['cappyv2'],true,{selected:[],none:true}],
  [['baseline'],false,{selected:[],none:true}],
  [null,false,{selected:[],none:true}],
  ['cappyv2',false,{selected:[],none:true}],
 ]){
  const result=M.normalizeReferences(c,selected,none);
  assert.deepEqual(result,expected);assert.ok(M.selection(c,result.selected,result.none));
  assert.deepEqual(M.normalizeReferences(c,result.selected,result.none),result);
 }
 const normalized=M.normalizeReferences(M.demo,['cappyv2'],false);
 assert.deepEqual(normalized,{selected:[],none:true});
});
test('restored malformed drafts normalize before display while preserving notes and idempotency ID',()=>{
 const storage=memory(),s=M.store(storage,'malformed');
 const broken={id:'retry-stable',notes:'preserve notes',selected:[],none:false};
 s.draft(M.demo.id,broken);
 const fixed=M.normalizeDraft(M.demo,s.read().drafts[M.demo.id],()=>{throw Error('must preserve ID');});
 assert.deepEqual(fixed,{...broken,none:true});
 s.draft(M.demo.id,fixed);
 assert.ok(M.selection(M.demo,s.read().drafts[M.demo.id].selected,s.read().drafts[M.demo.id].none));
 assert.equal(s.send(M.demo,fixed,null,'DEMO').id,'retry-stable');
 for(const value of [null,[],17,'bad',{id:7,notes:{},selected:'bad',none:false}]){
  assert.deepEqual(M.normalizeDraft(M.demo,value,()=> 'new-id'),{id:'new-id',notes:'',selected:[],none:true});
 }
 assert.throws(()=>M.store(memory(),'raw').send(M.demo,broken,null,'DEMO'),/Invalid selection/,'core send still rejects invalid raw drafts');
});

test('synthetic study series pairs three burden-ordered cases and never drops the synthetic label',()=>{
 assert.equal(M.syntheticSeriesGroups.length,3);
 const used=new Set();
 for(const g of M.syntheticSeriesGroups){
  for(const alias of [g.prior,g.current]){
   assert.ok(!used.has(alias),alias+' appears in only one synthetic pair');used.add(alias);
   const r=M.studyReceipts.find(x=>x.alias===alias);assert.ok(r&&r.manifestPath==='data/model_compare/manifest.json',alias+' must stay viewable');
  }
  assert.match(g.gtBasis,/cm³ → [0-9.]+cm³$/);assert.doesNotMatch(g.gtBasis,/[0-9]L/);
  const prior=M.seriesFor({id:g.prior}),current=M.seriesFor({id:g.current});
  assert.equal(prior.syntheticSeries,true);assert.equal(current.syntheticSeries,true);
  assert.equal(prior.patientId,g.patientId);assert.equal(current.patientId,g.patientId);
  assert.deepEqual(prior.studies.map(s=>s.relation),['current','next']);
  assert.deepEqual(current.studies.map(s=>s.relation),['prior','current']);
  assert.equal(current.currentIndex,1);assert.ok(current.studies[0].viewable&&prior.studies[1].viewable);
  assert.match(current.studies[0].assumedDate,/개월 전$/);assert.match(prior.studies[1].assumedDate,/개월 후$/);
  assert.match(prior.basis,/합성/);assert.match(current.basis,/GT 병변/);
  assert.match(M.seriesSummary({id:g.current}),/^합성 시리즈 2건 · 이전 CT 1건 · 실제 환자의 경과 아님$/);
  assert.match(M.seriesSummary({id:g.prior}),/^합성 시리즈 2건 · 다음 CT 1건 · 실제 환자의 경과 아님$/);
  assert.doesNotMatch(M.seriesSummary({id:g.prior}),/cm³/);assert.match(current.basis,/cm³/);
 }
 for(const id of ['case_000','case_045','case_001','case_009']){
  const s=M.seriesFor({id});assert.equal(s.syntheticSeries,false);assert.equal(s.patientId,null);
  assert.equal(s.studies.length,1);assert.match(M.seriesSummary({id}),/^이 검사 1건/);
 }
 assert.equal(M.seriesFor(M.demo),null);
});
