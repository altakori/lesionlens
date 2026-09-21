'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../radiomics.js');
function fixture() {
  return {version: 1, localOnly: true, caseCount: 1, windowHu: [-150, 250], cases: [{id: 'case_900', sliceCount: 1, defaultSlice: 0, dimensions: [2,3,1], spacing: [1,2,3], gtVoxelCount: 1,
    metrics: {reviewGroup: 1, reviewGroupBin50: 1, largestComponentMl: .006, componentCount: 1, maxDiameterMm: 3, sphericity: .5, entropy: 0, contrastHu: 0},
    slices: [{index: 0, ct: 'data/radiomics_web/web/case_900/ct/0000.webp', gt: 'data/radiomics_web/web/case_900/gt/0000.png', ctSha256: 'a'.repeat(64), gtSha256: 'b'.repeat(64), gtPixels: 1, width: 2, height: 3}]}]};
}
test('strict manifest with zero vs missing', () => {
  assert.equal(api.validate(fixture()).cases[0].metrics.entropy, 0);
  for (const mutate of [m => m.private = 'x', m => m.caseCount = true, m => m.cases[0].metrics.entropy = NaN, m => m.cases[0].metrics.entropy = null, m => m.cases[0].metrics.reviewGroup = 2, m => m.cases[0].slices[0].ct = '../raw.nii', m => m.cases[0].gtVoxelCount = 2, m => m.cases[0].spacing[0] = 0, m => m.cases[0].slices[0].gtSha256 = 'no', m => m.cases[0].defaultSlice = 2]) {
    const m = fixture(); mutate(m); assert.throws(() => api.validate(m));
  }
  const m = fixture(), c = m.cases[0]; c.gtVoxelCount = 0; c.slices[0].gtPixels = 0;
  Object.keys(c.metrics).forEach(k => { c.metrics[k] = ['componentCount','largestComponentMl'].includes(k) ? 0 : null; });
  api.validate(m); c.metrics.entropy = 0; assert.throws(() => api.validate(m));
});
test('hand-calculated Pareto, ties, contrast direction, fixed cohort', () => {
  const cases = [[8,2,4,2], [4,1,2,4], [2,3,1,6], [1,1,1,8], [8,2,4,2]].map((a,i) => ({id: `case_${900+i}`, metrics: Object.fromEntries(['largestComponentMl','componentCount','entropy','contrastHu'].map((k,j) => [k,a[j]]))}));
  const ranks = api.groups(cases), morph = api.groups(cases, true);
  assert.deepEqual({...ranks}, {case_900:1, case_902:1, case_904:1, case_901:2, case_903:3});
  assert.equal(api.sorted([cases[3],cases[1]], 'radiomics', ranks, morph)[0].id, 'case_901');
  const trade = [{id:'case_910',metrics:{largestComponentMl:2,componentCount:1,entropy:0,contrastHu:0}}, {id:'case_911',metrics:{largestComponentMl:1,componentCount:1,entropy:2,contrastHu:0}}];
  assert.deepEqual({...api.groups(trade)}, {case_910:1,case_911:1});
  assert.deepEqual({...api.groups(trade,true)}, {case_910:1,case_911:2});
});
test('stale events remain invalid after next slice, close and reopen', () => {
  const state = api.createEpoch(), old = state.next(), next = state.next();
  assert.equal(state.current(old), false); assert.equal(state.current(next), true);
  state.close(); assert.equal(state.current(next), false);
  const reopened = state.next(); assert.equal(state.current(next), false); assert.equal(state.current(reopened), true);
  assert.notEqual(api.reviewKey('datasetA','case_900'), api.reviewKey('datasetB','case_900'));
});

// Minimal semantic DOM harness: exercises actual event handlers without image/network access.
class Element {
  constructor() { this.listeners = {}; this.children = []; this.hidden = false; this.value = ''; this.open = false; this.isConnected = true; this.attrs = {}; }
  addEventListener(k, fn) { (this.listeners[k] ||= []).push(fn); }
  fire(k, extra = {}) { for (const fn of this.listeners[k] || []) fn({preventDefault(){}, ...extra}); }
  setAttribute(k,v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this[k]; }
  append(...children) { for (const c of children) c.parent = this; this.children.push(...children); }
  closest() { return this.parent.parent; }
  replaceChildren(...children) { this.children = children; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
}
async function harness(legacy = false, brokenStorage = false, data = fixture()) {
  const els = {}, images = [], storage = new Map();
  const doc = {getElementById: id => els[id] ||= new Element(), createElement: () => new Element()};
  const env = {location:{href:`http://127.0.0.1:4173/?foo=bar${legacy ? '&cohort=legacy' : ''}#anchor`}, history:{replaceState(a,b,url){env.location.href=String(url);}},
    Image: class {constructor(){images.push(this);}}, TextEncoder, crypto:require('node:crypto').webcrypto,
    localStorage:{getItem(k){if(brokenStorage) throw Error(); return storage.get(k);},setItem(k,v){if(brokenStorage) throw Error(); storage.set(k,v);}},
    fetch: async () => ({ok:true,json: async () => data})};
  api.mount(doc, env);
  for(let i=0; i<100 && !els.radiomicsList.children.length; i++) await new Promise(r=>setTimeout(r, 5));
  assert.equal(els.radiomicsList.children.length,1);
  return {els, images, env, storage};
}
test('same-screen auxiliary mount, inline containment, lazy images, stale callbacks, storage, focus', async () => {
  const {els, images, env, storage} = await harness(true);
  assert.equal(images.length,0);
  assert.equal(els.showLegacy,undefined); assert.equal(els.showRadiomics,undefined);
  const url = new URL(env.location.href); assert.equal(url.searchParams.get('foo'),'bar'); assert.equal(url.hash,'#anchor'); assert.equal(url.searchParams.get('cohort'),'legacy', 'auxiliary area no longer rewrites navigation');
  const actions = els.radiomicsList.children[0].children[3], view = actions.children[0], review = actions.children[1];
  review.fire('click'); assert.equal(storage.size,1); assert.equal(review.textContent,'확인 완료됨');
  view.fire('click'); assert.equal(images.length,2);
  assert.equal(els.radiomicsDialog.parent,els.radiomicsList.children[0]);
  assert.equal(els.radiomicsDialog.hidden,false); assert.equal(els.radiomicsDialog.open,false, 'CT review must not open a modal');
  els.radiomicsSlice.fire('input'); assert.equal(images.length,4);
  images[0].onload(); images[1].onerror(); assert.equal(els.radiomicsViewerFacts.textContent,'CT / GT 불러오는 중…');
  images[2].onload(); images[3].onload(); assert.equal(els.radiomicsCt.hidden,false);
  els.radiomicsOverlayToggle.fire('click'); assert.equal(els.radiomicsGt.hidden,true);
  els.radiomicsClose.fire('click'); assert.equal(view.focused,true); images[3].onerror(); assert.equal(els.radiomicsCt.hidden,true);
  view.fire('click'); assert.equal(els.radiomicsDialog.hidden,false); images[2].onerror(); assert.equal(els.radiomicsViewerFacts.textContent,'CT / GT 불러오는 중…');
  els.radiomicsClose.fire('click'); assert.equal(els.radiomicsDialog.hidden,true); assert.equal(view.focused,true);
});
test('unavailable storage explicitly reports failure without fake persistence', async () => {
  const {els} = await harness(false,true);
  const review = els.radiomicsList.children[0].children[3].children[1]; review.fire('click');
  assert.equal(review.textContent,'확인 완료'); assert.match(els.radiomicsStatus.textContent,/저장되지/);
});

test('full-series keyboard navigation and current failure handling', async () => {
  const data = fixture(), c = data.cases[0], original = c.slices[0];
  c.sliceCount = c.dimensions[2] = 3;
  c.slices = [0,1,2].map(i => ({...original, index:i, gtPixels:i === 0 ? 1 : 0,
    ct:`data/radiomics_web/web/case_900/ct/${String(i).padStart(4,'0')}.webp`,
    gt:`data/radiomics_web/web/case_900/gt/${String(i).padStart(4,'0')}.png`}));
  const {els,images} = await harness(false,false,data);
  els.radiomicsList.children[0].children[3].children[0].fire('click');
  els.radiomicsDialog.fire('keydown',{key:'End'}); assert.equal(els.radiomicsSlice.value,'2');
  els.radiomicsDialog.fire('keydown',{key:'ArrowLeft'}); assert.equal(els.radiomicsSlice.value,'1');
  assert.match(images.at(-2).src,/0001.webp$/); assert.match(images.at(-1).src,/0001.png$/);
  images.at(-2).onerror(); images.at(-1).onload(); assert.equal(els.radiomicsCt.hidden,true);
  assert.equal(els.radiomicsViewerFacts.textContent,'영상을 불러올 수 없습니다.');
  els.radiomicsDialog.fire('keydown',{key:'Home'}); assert.equal(els.radiomicsSlice.value,'0');
  els.radiomicsDialog.fire('keydown',{key:'ArrowLeft'}); assert.equal(els.radiomicsSlice.value,'0');
  els.radiomicsDialog.fire('keydown',{key:'Escape'}); assert.equal(els.radiomicsDialog.hidden,true);
});
test('malformed auxiliary manifest fails closed without touching main workflow', async () => {
  const els = {}, doc = {getElementById:id => els[id] ||= new Element(), createElement:() => new Element()};
  let imageRequests = 0;
  const env = {location:{href:'http://127.0.0.1:4173/'}, history:{replaceState(){}},
    fetch:async () => ({ok:true,json:async () => ({version:1,privatePath:'forbidden'})}),
    Image:class {constructor(){imageRequests++;}}};
  api.mount(doc,env);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(els.radiomicsList.children.length,0); assert.equal(imageRequests,0);
  assert.match(els.radiomicsStatus.textContent,/사용할 수 없습니다/);
  assert.equal(els.legacyPanel,undefined); assert.equal(els.showLegacy,undefined);
});
