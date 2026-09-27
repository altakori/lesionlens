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
  const prior=M.seriesFor({id:g.prior}),current=M.seriesFor({id:g.current});
  assert.equal(prior.syntheticSeries,true);assert.equal(current.syntheticSeries,true);
  assert.equal(prior.patientId,g.patientId);assert.equal(current.patientId,g.patientId);
  assert.deepEqual(prior.studies.map(s=>s.relation),['current','next']);
  assert.deepEqual(current.studies.map(s=>s.relation),['prior','current']);
  assert.equal(current.currentIndex,1);assert.ok(current.studies[0].viewable&&prior.studies[1].viewable);
  assert.match(current.gtBasis,new RegExp(g.priorGt+'cm\u00b3 \u2192 '+g.currentGt+'cm\u00b3$'));assert.doesNotMatch(current.gtBasis,/[0-9]L/);
  assert.equal(current.studies[0].gtVolume,'GT 병변 '+g.priorGt+'cm\u00b3');assert.equal(current.studies[1].gtVolume,'GT 병변 '+g.currentGt+'cm\u00b3');
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

test('queue keeps synthetic pairs adjacent, one card per study, the demo card last, and offers a series filter',()=>{
 const ids=['case_000','case_129','case_065','lv2-case_125','lv2-case_117','case_083','lv2-case_118','case_045','case_102'];
 const cases=[...ids.map(id=>({id})),{id:'DEMO-WORKFLOW-001',synthetic:true}];
 const state={reviews:{'case_000':true},drafts:{},sends:{'case_045':{case:{id:'case_045'}}},receipts:{}};
 const all=M.queue(cases,{},state,'all','').map(c=>c.id);
 assert.equal(all.length,10);assert.equal(all[all.length-1],'DEMO-WORKFLOW-001');
 for(const g of M.syntheticSeriesGroups){
  const i=M.queue(cases,{},state,'all','').findIndex(c=>c.id===g.prior);
  assert.ok(i>=0,g.prior+' is listed');assert.equal(all[i+1],g.current,g.prior+' is followed by its pair');
 }
 assert.deepEqual(M.queue(cases,{},state,'series','').map(c=>c.id).sort(),
  ['case_065','case_083','case_129','lv2-case_117','lv2-case_118','lv2-case_125']);
 assert.equal(M.queue(cases,{},state,'series','').some(c=>c.synthetic),false);
 assert.deepEqual(M.queue(cases,{},state,'series','case_06').map(c=>c.id),['case_065'],'\uac80\uc0c9\uc5d0\uc11c \uc808\ub0b4\uc9c4 \uc9dd\uc740 \ubd99\uc774\uc9c0 \uc54a\ub294\ub2e4');
 assert.deepEqual(M.queue(cases,{},state,'pending','').map(c=>c.id).filter(id=>id==='case_065'),['case_065']);
 assert.ok(!M.queue(cases,{},state,'reviewed','').map(c=>c.id).includes('case_065'));
 assert.ok(M.queue(cases,{},state,'reviewed','').map(c=>c.id).includes('case_000'));
 assert.ok(!M.queue(cases,{},state,'sent','').map(c=>c.id).includes('case_065'));
 // 시연 순서 = 합성 시리즈 6건 + 흐름 시연 카드. 카드 순서는 이전 → 현재, 시연 카드는 마지막.
 const demo=M.queue(cases,{},state,'demo','').map(c=>c.id);
 assert.equal(demo[demo.length-1],'DEMO-WORKFLOW-001');
 assert.deepEqual([...demo].sort(),[...M.syntheticSeriesGroups.flatMap(g=>[g.prior,g.current]),'DEMO-WORKFLOW-001'].sort(),'\uc2dc\uc5f0 \uc21c\uc11c\ub294 \uc2dc\ub9ac\uc988 6\uac74 + \uc2dc\uc5f0 \uce74\ub4dc \ud558\ub098');
 for(const g of M.syntheticSeriesGroups){const i=demo.indexOf(g.prior);assert.ok(i>=0);assert.equal(demo[i+1],g.current,g.prior+' \uc55e\uc5d0 \uc774\uc804 \uac80\uc0ac\uac00 \ubb36\uc5ec \uc788\ub2e4');}
 assert.deepEqual(demo.slice(0,2),['case_065','lv2-case_117'],'\uadf8\ub8f1 \uc21c\uc11d\uc740 CT ID \uc624\ub984\ucc28\uc21c\uc73c\ub85d \uace0\uc815\ub41c\ub2e4');
 // 필터 개수는 목록이 실제로 보여주는 개수와 같아야 한다(중복 제거 후 기준).
 const counts=M.filterCounts(cases,{},state,'');
 assert.deepEqual(Object.keys(counts),M.queueFilters);
 assert.equal(counts.all,10);assert.equal(counts.series,6);assert.equal(counts.demo,7);
 assert.equal(counts.reviewed,1);assert.equal(counts.sent,1);assert.equal(counts.pending,9);
 assert.deepEqual(M.filterCounts(cases,{},state,'case_06'),M.queueFilters.reduce((o,f)=>(o[f]=f==='pending'||f==='all'||f==='series'||f==='demo'?1:0,o),{}));
});
