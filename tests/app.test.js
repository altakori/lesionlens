const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app.js');
function manifest() {
  return {version: app.MANIFEST_VERSION, localOnly: true, caseCount: 5, windowHu: [-150,250],
    cases: app.CASE_SPECS.map(([id,depth,voxels]) => {
      const counts = {gt: voxels, ...Object.fromEntries(app.MODELS.slice(0,id === 'case_045' ? 0 : 3).map((k,j) => [k,app.MODEL_VOXELS[id][j]]))};
      const stats = Object.fromEntries(Object.entries(counts).map(([kind,n]) => [kind, {voxels:n,volumeMl:n*.002,componentCount:1,componentVolumesMl:[n*.002],positiveSliceCount:1,sliceSpan:[3,3]}]));
      return {id,sourceCaseId:id,sliceCount:depth,dimensions:[512,512,depth],spacing:[1,1,2],tumorVolumeMl:voxels*.002,defaultSlice:2,
        gt:stats.gt,models:Object.fromEntries(Object.entries(stats).filter(([k]) => k !== 'gt')),
        disagreement:id === 'case_045' ? null : {intersectionVoxels:0,unionVoxels:app.MODEL_VOXELS[id].reduce((a,b) => a+b,0),score:1},
        slices:Array.from({length:depth},(_,z) => {
          const base = `data/model_compare/web/${id}`, name = String(z+1).padStart(3,'0');
          return {index:z+1,canonicalSlice:z,width:512,height:512,gtPixels:z === 2 ? voxels : 0,
            ct:`${base}/ct/${name}.webp`,ctSha256:'a'.repeat(64),
            overlays:Object.fromEntries(Object.keys(counts).map(k => [k,{path:`${base}/${k}/${name}.png`,sha256:'b'.repeat(64)}])),
            pixels:Object.fromEntries(Object.entries(counts).map(([k,n]) => [k,z === 2 ? n : 0]))};
        })};
    })};
}
test('exact matched cases retain full series, GT metadata and safe source ID only', () => {
  const raw = manifest();
  const cases = app.normalizeManifest(raw);
  assert.deepEqual(cases.map(c => c.sliceCount), [75, 123, 124, 74, 244]);
  assert.equal(cases[0].sourceCaseId, 'case_000');
  assert.equal(cases[0].privatePath, undefined);
  assert.equal(cases[1].slices.at(-1).ct, 'data/model_compare/web/case_001/ct/123.webp');
});
test('reject path attacks, swapped identity, geometry, incomplete slices and invented measurements', () => {
  const changes = [r => r.version = 'old', r => r.cases.reverse(), r => r.localOnly = false,
    r => r.cases[0].sourceCaseId = 'case_001', r => r.cases[0].slices.pop(),
    r => r.cases[0].slices[0].ct = '../source/image.nii.gz',
    r => r.cases[0].slices[0].ct = 'https://example.com/a.webp',
    r => r.cases[0].slices[0].overlays.gt.path = 'data/model_compare/web/case_001/gt/001.png',
    r => r.cases[0].slices[0].ctSha256 = 'z'.repeat(64), r => r.cases[0].slices[0].gtPixels = -1,
    r => r.cases[0].defaultSlice = 0, r => r.cases[0].tumorVolumeMl = 123,
    r => r.cases[0].spacing[0] = NaN, r => r.cases[0].dimensions[0] = 511];
  for (const change of changes) { const raw = manifest(); change(raw); assert.deepEqual(app.normalizeManifest(raw), []); }
  for (const raw of [null, {}, [], {cases: null}]) assert.deepEqual(app.normalizeManifest(raw), []);
});
test('search, measured volume sort, review filters and selection match case IDs', () => {
  const cases = app.normalizeManifest(manifest()), reviewed = new Set(['case_001']);
  assert.deepEqual(app.filteredCases(cases, {sort: 'tumor'}).map(c => c.id), ['case_048','case_035','case_001','case_045','case_000']);
  assert.equal(app.filteredCases(cases, {search: ' CASE_045 '})[0].id, 'case_045');
  assert.equal(app.filteredCases(cases, {search: 'missing'}).length, 0);
  assert.deepEqual(app.filteredCases(cases, {filter: 'reviewed', reviewed}).map(c => c.id), ['case_001']);
  const pending = app.filteredCases(cases, {filter: 'pending', reviewed});
  assert.equal(app.visibleSelection(pending, 'case_001').id, 'case_048');
  assert.equal(app.visibleSelection([], 'case_001'), null);
});
test('review persistence is keyed by version and ID and tolerates blocked storage', () => {
  const data = new Map(), storage = {getItem: k => data.get(k), setItem: (k,v) => data.set(k,v)};
  const cases = app.normalizeManifest(manifest());
  app.setReviewed(storage, app.MANIFEST_VERSION, 'case_001', true);
  assert.deepEqual([...app.readReviewed(storage, app.MANIFEST_VERSION, cases)], ['case_001']);
  assert.equal(app.readReviewed(storage, 'another-version', cases).size, 0);
  app.setReviewed(storage, app.MANIFEST_VERSION, 'case_001', false);
  assert.equal(app.readReviewed(storage, app.MANIFEST_VERSION, cases).size, 0);
  assert.equal(app.setReviewed(null, app.MANIFEST_VERSION, 'case_001', true), false);
  assert.equal(app.readReviewed(null, app.MANIFEST_VERSION, cases).size, 0);
});
test('full-series bounds, wheel and accessible card markup', () => {
  assert.equal(app.clampSlice(999, 123), 122);
  assert.equal(app.clampSlice(-1, 75), 0);
  assert.deepEqual(app.wheelSlice(73, 100, 74), {slice: 73, changed: false});
  assert.equal(app.sliceValueText(122, 123), '123 / 123');
  const html = app.caseButtonHtml(app.normalizeManifest(manifest())[0], 'case_000', true);
  assert.match(html, /class="case-card selected"/); assert.match(html, /case-state reviewed/);
  assert.match(html, /data-id="case_000"/); assert.match(html, /data-action="open"/);
});

test('escaping, zero/horizontal wheel deltas, and finite slice bounds remain safe', () => {
  assert.equal(app.escapeHtml('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
  assert.deepEqual(app.wheelSlice(4, 0, 123), {slice: 4, changed: false});
  assert.deepEqual(app.wheelSlice(4, -12, 123), {slice: 3, changed: true});
  assert.equal(app.clampSlice(NaN, 75), 0);
  assert.equal(app.visibleSelection(app.normalizeManifest(manifest()), 'case_045').id, 'case_045');
});

test('static parent DOM has one matched viewer and versionless local assets', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  for (const id of ['overlaySelect', 'modelCaption', 'comparisonFacts', 'ctDialog', 'closeCtDialog', 'categoryFilters', 'visibleCount', 'caseList', 'caseSearch', 'sortSelect', 'totalCases', 'reviewedCount', 'totalSlices',
    'selectedCaseId', 'selectedCaseMeta', 'reviewToggle', 'realDataStatus', 'realCtUnavailable',
    'realImageFrame', 'realCtImage', 'realOverlayImage', 'realCtDescription', 'realOverlayToggle',
    'realPreviousSlice', 'realNextSlice', 'realSliceSlider', 'realSliceLabel', 'caseFacts', 'emptyState']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
  assert.match(html, /href="styles\.css"/);
  assert.match(html, /src="app\.js"/);
  assert.match(html, /정답 주석/);
  assert.match(html, /기존 연구 모델의 예측/);
  assert.doesNotMatch(source, /SYN-|priorityCount|drawSyntheticCt|style="width:/);
  assert.doesNotMatch(source, /detailPanel.*innerHTML/);
  assert.match(source, /if \(\$\('queueSummary'\)\)/);
  assert.match(source, /if \(\$\('nextCase'\)\)/);
});

test('source-derived small/multiple and technical disagreement boundaries compose with manual/review filters', () => {
  const cases = app.normalizeManifest(manifest());
  cases[0].gt.componentVolumesMl = [1];
  cases[1].gt.componentVolumesMl = [.999,5]; cases[1].gt.componentCount = 2;
  cases[0].disagreement.score = .20; cases[1].disagreement.score = .199;
  const ids = options => app.filteredCases(cases, {sort:'priority', ...options}).map(c => c.id);
  assert.deepEqual(ids({category:'small'}), ['case_001']);
  assert.deepEqual(ids({category:'multiple'}), ['case_001']);
  assert.deepEqual(ids({category:'disagreement'}), ['case_035','case_048','case_000']);
  const first = new Set(['case_045','case_001']);
  assert.deepEqual(ids({first}), ['case_001','case_045','case_035','case_048','case_000']);
  assert.deepEqual(ids({sort:'disagreement',first}), ['case_001','case_045','case_035','case_048','case_000']);
  assert.deepEqual(ids({category:'priority',first,reviewed:new Set(['case_001']),filter:'pending',search:'045'}), ['case_045']);
  assert.deepEqual(cases.map(c => c.id), app.CASE_SPECS.map(c => c[0]));
});
test('manual workflow flags persist separately from review, with version and storage isolation', () => {
  const data = new Map(), storage = {getItem: k => data.get(k), setItem: (k,v) => data.set(k,v)};
  const cases = app.normalizeManifest(manifest());
  assert.equal(app.setFirst(storage, app.MANIFEST_VERSION, 'case_045', true), true);
  assert.deepEqual([...app.readFirst(storage, app.MANIFEST_VERSION, cases)], ['case_045']);
  assert.equal(app.readReviewed(storage, app.MANIFEST_VERSION, cases).size, 0);
  assert.equal(app.readFirst(storage, 'other', cases).size, 0);
  app.setFirst(storage, app.MANIFEST_VERSION, 'case_045', false);
  assert.equal(app.readFirst(storage, app.MANIFEST_VERSION, cases).size, 0);
  assert.equal(app.setFirst(null, app.MANIFEST_VERSION, 'case_045', true), false);
  assert.equal(app.readFirst(null, app.MANIFEST_VERSION, cases).size, 0);
});
test('cards expose measured facts and distinct action buttons without clinical inference', () => {
  const item = app.normalizeManifest(manifest())[0];
  const html = app.caseButtonHtml(item, null, false, true);
  assert.match(html, /<article class="case-card"/);
  assert.equal((html.match(/<button /g) || []).length, 2);
  assert.doesNotMatch(html, /\d+(?:\.\d+)?%/);
  assert.match(app.comparisonHtml(item), /100\.0%/);
  assert.match(html, /CT · 정답 표시 · AI 3종 자료 있음/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /먼저 보기 해제/);
  assert.match(app.caseButtonHtml(item,null,false), /먼저 보기/);
  assert.doesNotMatch(html, /위험|생존|완치|전이|병변 수|MD/);
});
test('missing case045 predictions stay absent and model statistics reject corruption', () => {
  const cases = app.normalizeManifest(manifest());
  const missing = cases.find(c => c.id === 'case_045');
  assert.deepEqual(missing.models,{}); assert.equal(missing.disagreement,null);
  assert.equal(missing.slices[0].overlays.baseline,undefined);
  assert.match(app.caseButtonHtml(missing,null,false), /AI 비교 자료 없음/);
  assert.match(app.comparisonHtml(missing), /AI 예측 자료가 없어요/);
  for (const change of [r => r.privatePath = '/private', r => r.cases[0].models.baseline.volumeMl = 123,
    r => r.cases[3].models.baseline = r.cases[0].models.baseline,
    r => r.cases[0].gt.componentCount = 5,
    r => r.cases[0].gt.componentVolumesMl = [-1],
    r => r.cases[0].gt.sliceSpan = [1,3],
    r => r.cases[0].disagreement.score = .5,
    r => r.cases[0].slices[0].overlays.baseline.path = 'https://example.com/a.png']) {
    const raw = manifest(); change(raw); assert.deepEqual(app.normalizeManifest(raw),[]);
  }
});

test('small and multiple reasons identify GT source without a card percentage', () => {
  const item = app.normalizeManifest(manifest())[0];
  item.disagreement.score = .1;
  item.gt.componentVolumesMl = [.5, 2]; item.gt.componentCount = 2;
  assert.match(app.caseReason(item), /정답 표시 기준/);
  assert.match(app.caseReason(item), /작은/);
  assert.doesNotMatch(app.caseButtonHtml(item,null,false), /\d+(?:\.\d+)?%/);
  item.gt.componentVolumesMl = [1,2];
  assert.match(app.caseReason(item), /정답 표시 기준/);
  assert.match(app.caseReason(item), /여러/);
  assert.doesNotMatch(app.caseButtonHtml(item,null,false), /\d+(?:\.\d+)?%/);
});

// Independent synthetic metrics; these fixtures are not medical case data.
function metrics(overrides = {}) {
  return {id: 'fixture', sliceCount: 100, tumorVolumeMl: 2,
    gt: {componentVolumesMl: [2], componentCount: 1, positiveSliceCount: 1},
    models: Object.fromEntries(app.MODELS.map(k => [k, {componentCount: 1, volumeMl: 2}])),
    disagreement: {score: .1}, ...overrides};
}
const tagKeys = item => app.reviewPriority(item).tags.map(t => t.key);
test('independent exact boundaries for all technical tags', () => {
  const c = metrics();
  for (const [score, expected] of [[.199999, false], [.20, true]]) {
    c.disagreement.score = score; assert.equal(tagKeys(c).includes('disagreement'), expected);
  }
  for (const [volume, expected] of [[0,false], [1,false], [.999999,true]]) {
    c.gt.componentVolumesMl = [volume]; assert.equal(tagKeys(c).includes('small'), expected);
  }
  for (const [volume, expected] of [[19.999,false], [20,true]]) {
    c.tumorVolumeMl = volume; assert.equal(tagKeys(c).includes('large'), expected);
  }
  for (const [slices, expected] of [[24,false], [25,true]]) {
    c.gt.positiveSliceCount = slices; assert.equal(tagKeys(c).includes('extent'), expected);
  }
  for (const [volume, expected] of [[2.99999,false], [3,true], [0,true]]) {
    c.models.baseline.volumeMl = volume; assert.equal(tagKeys(c).includes('volumediff'), expected);
  }
  c.models.baseline.componentCount = 2;
  assert.ok(tagKeys(c).includes('countdiff'));
  c.gt.componentCount = 2; c.gt.componentVolumesMl = [.5, 19.5];
  assert.deepEqual(tagKeys(c), ['disagreement','countdiff','volumediff','small','multiple','large','extent']);
  for (const category of tagKeys(c)) assert.equal(app.filteredCases([c], {category}).length, 1);
});
test('zero predictions remain measurable and null/absent comparisons never imply normal', () => {
  const c = metrics({models: {}, disagreement: null});
  assert.equal(app.reviewPriority(c).band, 1);
  assert.deepEqual(tagKeys(c), ['missing']);
  c.models.baseline = {volumeMl: 0, componentCount: 0};
  assert.match(app.caseButtonHtml(c,null,false), /AI 비교 자료 일부 없음/);
  for (const kind of app.MODELS) c.models[kind] = {volumeMl: 0, componentCount: 0};
  assert.deepEqual(tagKeys(c), ['missing']);
  c.disagreement = {score: 0};
  assert.deepEqual(tagKeys(c), []);
  assert.match(app.caseButtonHtml(c,null,false), /임상 응급도: 판단 자료 부족/);
});
test('automatic bands, descending scores, null-last, stable ties and explicit manual override', () => {
  const cases = [metrics({id:'z', disagreement:{score:.2}}), metrics({id:'b', disagreement:{score:.4}}),
    metrics({id:'a', disagreement:{score:.4}}), metrics({id:'null', models:{}, disagreement:null}),
    metrics({id:'known', tumorVolumeMl:20, disagreement:{score:0}}), metrics({id:'plain'})];
  const ids = options => app.filteredCases(cases,{sort:'priority', ...options}).map(c=>c.id);
  assert.deepEqual(ids(), ['a','b','z','known','null','plain']);
  assert.deepEqual(ids({category:'priority'}), []);
  const first = new Set(['plain']);
  assert.deepEqual(ids({first}), ['plain','a','b','z','known','null']);
  assert.deepEqual(ids({first,sort:'id'}), ['a','b','known','null','plain','z']);
  assert.deepEqual(ids({category:'priority',first}), ['plain']);
  assert.deepEqual(ids({category:'disagreement',search:'b',filter:'reviewed',reviewed:new Set(['b'])}), ['b']);
  assert.deepEqual(ids({category:'disagreement',search:'b',filter:'pending',reviewed:new Set(['b'])}), []);
  const html = app.caseButtonHtml(cases[5],null,false,true,1);
  for (const text of ['전체 대기열 1번째','수동 우선','직접 먼저 보기 지정','rank-reasons','rank-explanation']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /출혈|침범|괴사|악성|성장|긴급|생존|완치/);
  const hostile = metrics({id:'<img onerror="attack">'});
  assert.doesNotMatch(app.caseButtonHtml(hostile,null,false), /<img/);
});

test('next action uses full ranked unreviewed queue, including pins and stable ties', () => {
  const items = [metrics({id:'b', disagreement:{score:.4}}), metrics({id:'a', disagreement:{score:.4}}), metrics({id:'plain'})];
  const reviewed = new Set(), first = new Set();
  const options = {reviewed, first, search:'no match', category:'missing', sort:'tumor', filter:'reviewed'};
  assert.equal(app.selectNextCase(items, options).id, 'a');
  first.add('plain');
  assert.equal(app.selectNextCase(items, options).id, 'plain');
  reviewed.add('plain');
  assert.equal(app.selectNextCase(items, options).id, 'a');
  reviewed.add('a');
  assert.equal(app.selectNextCase(items, options).id, 'b');
  reviewed.add('b');
  assert.equal(app.selectNextCase(items, options), null);
  reviewed.delete('plain');
  assert.equal(app.selectNextCase(items, options).id, 'plain');
  first.clear();
  assert.deepEqual(items.map(item => item.id), ['b','a','plain']);
  assert.equal(app.selectNextCase([]), null);
});

test('next panel distinguishes loading, failure, empty and completed queues without CT requests', () => {
  const items = [metrics()];
  for (const state of ['loading', 'error']) {
    const html = app.nextCaseHtml(items, {state, reviewed:new Set(['fixture'])});
    assert.doesNotMatch(html, /모든 사례를 확인|<button|<img|src=/);
    assert.match(html, state === 'loading' ? /불러오는 중/ : /정할 수 없어요/);
    assert.doesNotMatch(app.queueSummaryHtml(items, {state}), /<strong>|확인 완료/);
  }
  assert.match(app.nextCaseHtml([]), /표시할 CT 사례가 없어요/);
  assert.doesNotMatch(app.nextCaseHtml([]), /모든 사례를 확인/);
  assert.match(app.nextCaseHtml(items, {reviewed:new Set(['fixture'])}), /모든 사례를 확인/);
  assert.doesNotMatch(app.nextCaseHtml(items, {reviewed:new Set(['fixture'])}), /<button/);
  const html = app.nextCaseHtml(items, {first:new Set(['fixture'])});
  assert.match(html, /직접 먼저 보기 지정/);
  assert.match(html, /최대 연결 표시 부피 2\.00 mL · 연결 표시 1개 · GT/);
  assert.match(html, /<button type="button" data-action="open" data-id="fixture" aria-label="fixture CT 보기"/);
  assert.doesNotMatch(html, /<img|src=/);
  assert.doesNotMatch(app.nextCaseHtml([metrics({id:'<img onerror="attack">'})]), /<img/);
});

test('card action headings preserve existing labels and expose honest emergency status in every band', () => {
  const items = [metrics({disagreement:{score:.2}}), metrics({models:{}, disagreement:null}), metrics()];
  items.forEach((item, band) => {
    const html = app.caseButtonHtml(item, null, band === 1, false, null, 'priority');
    assert.match(html, new RegExp(`data-review-band="${band}" data-reviewed="${band === 1}"`));
    assert.ok(html.includes(`<h4 class="review-action-heading">${['우선 재검토','추가 확인','차례대로 확인'][band]}</h4>`));
    assert.ok(html.includes(`<span class="rank-band">${['먼저 비교','이어서 확인','차례대로 확인'][band]}</span>`));
    assert.match(html, /<details class="rank-reasons">/);
    const visible = html.split('<details class="rank-reasons">')[0];
    assert.match(visible, /응급 소견 미평가/);
    assert.match(visible, /응급 소견 판독·임상 정보가 연결되지 않았어요/);
    assert.doesNotMatch(visible, /class="(?:case-reason|next-action-reason)"/);
    const details = html.match(/<details class="rank-reasons">[\s\S]*?<\/details>/)[0];
    assert.match(details, /class="case-reason"/);
    assert.match(details, /class="next-action-reason"/);
    assert.doesNotMatch(html + app.nextCaseHtml([item]), /비응급|응급 아님|정상입니다|진단됨|악성|전이|출혈|치료 권고|긴급 처치/);
  });
});

test('recommendations follow actual tags, including absent predictions and missing comparison score', () => {
  const item = metrics();
  assert.equal(app.caseRecommendation(item), '정답 표시(GT)와 AI 표시를 차례대로 확인해 주세요.');
  item.disagreement.score = .2;
  assert.equal(app.caseRecommendation(item), 'AI별 표시 경계를 비교해 주세요.');
  item.gt.componentVolumesMl = [.5];
  assert.match(app.caseRecommendation(item), /비교하고 정답 표시\(GT\)의 작은 영역을 확인해 주세요\./);
  item.disagreement = null; item.models = {};
  const recommendation = app.caseRecommendation(item);
  assert.match(recommendation, /작은 영역을 확인하고 누락된 AI 예측·비교 자료를 확보해 주세요\./);
  assert.doesNotMatch(recommendation, /경계를 비교|병변|진단/);
  const html = app.nextCaseHtml([item]);
  assert.match(html, /최대 연결 표시 부피 0\.50 mL · 연결 표시 1개 · GT/);
  assert.doesNotMatch(html, /작은 표시 포함|AI 표시 차이 큼|자료 가용성 기준/);
  item.gt.componentVolumesMl = [2];
  assert.match(app.nextCaseHtml([item]), /최대 연결 표시 부피 2\.00 mL · 연결 표시 1개 · GT/);
  assert.match(app.caseReason(item), /AI 비교 자료 없음 · 자료 가용성 기준/);
  item.models = metrics().models;
  assert.match(app.caseRecommendation(item), /예측·비교 자료를 확보/);
});

test('summary counts all cases, excludes reviewed from pending bands and never counts urgent cases', () => {
  const items = [metrics({id:'a', disagreement:{score:.4}}), metrics({id:'b', disagreement:{score:.2}}), metrics({id:'c', models:{}, disagreement:null}), metrics({id:'d'})];
  const reviewed = new Set(['a', 'unknown']);
  const html = app.queueSummaryHtml(items, {reviewed});
  for (const text of ['1그룹 확인 전 <strong>3</strong>건', '다른 그룹 확인 전 <strong>0</strong>건', 'GT 자료 없음 · 확인 전 <strong>0</strong>건', '확인 완료 <strong>1</strong>건', '응급 소견 미평가 <strong>4</strong>건']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /응급 0|비응급/);
  assert.match(app.queueSummaryHtml(items, {reviewed:new Set(items.map(item => item.id))}), /응급 소견 미평가 <strong>4<\/strong>건/);
});

test('GT morphology validates measurements without clinical size/count cutoffs', () => {
  const item = volumes => metrics({gt:{componentVolumesMl:volumes, componentCount:volumes.length}});
  for (const volume of [Number.MIN_VALUE, .999, 1, 3, 5, 20, 20.001, Number.MAX_VALUE]) {
    assert.deepEqual(app.morphologyPriority(item([volume])), {status:'available', largestVolumeMl:volume, componentCount:1});
  }
  assert.deepEqual(app.morphologyPriority(item([])), {status:'available', largestVolumeMl:0, componentCount:0});
  for (const gt of [null, undefined, {}, {componentCount:0}, {componentVolumesMl:[],componentCount:null},
    {componentVolumesMl:[1],componentCount:2}, {componentVolumesMl:[1],componentCount:1.5},
    ...[0,-1,NaN,Infinity,'2',null].map(v => ({componentVolumesMl:[v],componentCount:1}))]) {
    const c = metrics({gt});
    assert.deepEqual(app.morphologyPriority(c), {status:'unavailable',largestVolumeMl:null,componentCount:null});
    assert.match(app.morphologyPriorityHtml(c,3), /data-morphology-status="unavailable"/);
    assert.match(app.morphologyPriorityHtml(c,3), /GT 크기·개수 자료 없음/);
    assert.doesNotMatch(app.morphologyPriorityHtml(c,3), /부피 0 mL|연결 표시 0개/);
  }
  assert.doesNotThrow(() => app.caseButtonHtml(metrics({gt:null}), null, false));
});

test('burden peels full-cohort Pareto groups, with pins and unknown last within review state', () => {
  const item = (id, volumes) => metrics({id, gt:volumes === null ? null : {componentVolumesMl:volumes, componentCount:volumes.length}});
  const cases = [item('missing',null), item('many',[4,4,4,4]), item('b',[5,1]), item('a',[5,2]),
    item('single',[5]), item('largest',[5.00001]), item('zero',[])];
  const original = cases.slice();
  const ids = options => app.filteredCases(cases,options).map(c => c.id);
  assert.deepEqual(ids(), ['a','b','largest','many','single','zero','missing']);
  assert.deepEqual(ids({sort:'burden'}), ids());
  const first = new Set(['missing','many']);
  assert.deepEqual(ids({first}), ['many','missing','a','b','largest','single','zero']);
  const reviewed = new Set(['many']);
  assert.equal(app.selectNextCase(cases,{first,reviewed}).id, 'missing');
  for (const options of [{}, {first}, {first,reviewed}]) {
    assert.equal(app.selectNextCase(cases,options)?.id, app.filteredCases(cases,{...options,filter:'pending'})[0]?.id);
  }
  assert.deepEqual(ids({search:'single',filter:'pending'}), ['single']);
  assert.deepEqual(ids({sort:'id',first}), ['a','b','largest','many','missing','single','zero']);
  assert.deepEqual(cases, original);
  assert.match(app.nextCaseHtml(cases), /전체 기본 크기·개수 대기열 · GT \(화면 정렬·필터와 무관\)/);
});

test('morphology reasons are separate from unchanged ordinary technical tags and ordinal only', () => {
  const item = metrics({gt:{componentVolumesMl:[.00001, 5.1234567],componentCount:2}});
  const html = app.caseButtonHtml(item,null,false,true,2,'burden',null,2);
  const section = html.match(/<section class="morphology-priority"[\s\S]*?<\/section>/)[0];
  for (const text of ['전체 대기열 2번째','크기·개수 검토 그룹 · GT','2그룹','5.12 mL','연결 표시 2개','수동 우선','같은 그룹은 사례 번호순 · 의학적 우열 아님','다른 정렬·필터의 화면 순서와 다를']) assert.ok(section.includes(text));
  assert.match(section, /class="priority-reason-tags" title="순위 근거"/);
  assert.doesNotMatch(section, /class="case-tag"|rank-band|cm/);
  const reasons = section.match(/<div class="priority-reason-tags"[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(reasons, /병변/);
  assert.match(section, /연결 표시는 확정 병변이 아니며/);
  assert.match(section, /<details class="morphology-rule"><summary>/);
  assert.match(html, /data-tag="small"/);
  assert.match(html, /data-tag="multiple"/);
  assert.doesNotMatch(html, /class="review-rank"/);
  const legacy = app.caseButtonHtml(item,null,false,false,2,'priority',4);
  assert.match(legacy, /기존 비교 기준 4번째/);
  assert.match(legacy, /전체 대기열 2번째/);
});


test('rounded morphology display never rounds ranking math or substitutes AI reasons', () => {
  const make = (id, volume) => metrics({id, gt:{componentVolumesMl:[volume],componentCount:1}});
  const smaller = make('a',5.123451), larger = make('z',5.123459);
  assert.equal(app.morphologyPriority(larger).largestVolumeMl, 5.123459);
  assert.deepEqual(app.filteredCases([smaller,larger]).map(c => c.id), ['z','a']);
  for (const c of [smaller,larger]) {
    assert.match(app.morphologyPriorityHtml(c), /최대 연결 표시 부피 5\.12 mL/);
    assert.match(app.nextCaseHtml([c]), /최대 연결 표시 부피 5\.12 mL · 연결 표시 1개 · GT/);
  }
  larger.disagreement = {score:1};
  assert.match(app.caseReason(larger), /AI 표시 차이 큼/);
  assert.doesNotMatch(app.nextCaseHtml([larger]), /AI 표시 차이 큼/);
  const missing = metrics({gt:null});
  assert.match(app.nextCaseHtml([missing]), /GT 크기·개수 자료 없음/);
  assert.doesNotMatch(app.nextCaseHtml([missing]), /부피 0|연결 표시 0개/);
  const empty = metrics({gt:{componentVolumesMl:[],componentCount:0}});
  assert.match(app.nextCaseHtml([empty]), /최대 연결 표시 부피 0\.00 mL · 연결 표시 0개 · GT/);
});


test('Pareto tradeoffs, ID ties, dominance monotonicity and cohort dependence', () => {
  const make = (id, volume, count) => metrics({id, gt:{componentVolumesMl:Array(count).fill(volume), componentCount:count}});
  const cases = [make('z',1,100), make('a',100,1), make('b',100,1), make('low',1,1), make('zero',0,0), metrics({id:'unknown',gt:null})];
  const original = JSON.stringify(cases);
  const layers = app.morphologyLayers(cases);
  assert.deepEqual([...layers.values()], [1,1,1,2,3,null]);
  assert.deepEqual(app.filteredCases(cases).map(c => c.id), ['a','b','z','low','zero','unknown']);
  assert.equal(app.morphologyLayers(cases.slice(3)).get('low'), 1, 'groups are cohort-relative');
  for (let volume = 1; volume <= 5; volume++) for (let count = 1; count <= 5; count++) {
    const baseline = make('target',volume,count);
    const before = app.morphologyLayers([...cases,baseline]).get('target');
    for (const improved of [make('target',volume+1,count),make('target',volume,count+1)]) {
      assert.ok(app.morphologyLayers([...cases,improved]).get('target') <= before);
    }
  }
  const reviewed = new Set(['a','b','z']), first = new Set(['a','unknown']);
  const options = {reviewed,first};
  assert.deepEqual(app.filteredCases(cases,options).map(c => c.id), ['unknown','low','zero','a','b','z']);
  assert.equal(app.selectNextCase(cases,options).id, 'unknown');
  reviewed.add('unknown');
  assert.equal(app.selectNextCase(cases,options).id, 'low');
  const filtered = app.filteredCases(cases,{...options,search:'low',category:'all',filter:'pending'});
  assert.equal(filtered.length,1);
  const card = app.caseButtonHtml(filtered[0],null,false,false,1,'burden',null,layers.get('low'));
  assert.match(card, /data-review-group="2" data-queue-ordinal="1"/);
  assert.match(card, /data-rank-policy="pareto-gt-vol-count"/);
  assert.match(app.nextCaseHtml(cases,options), /2그룹/);
  assert.deepEqual(app.morphologyLayers(cases),layers);
  assert.equal(JSON.stringify(cases),original);
});

test('summary partitions fixed cohort and counts manual pins only as supplementary', () => {
  const cases = [metrics({id:'top',gt:{componentVolumesMl:[5,1],componentCount:2}}), metrics({id:'next'}), metrics({id:'missing',gt:null})];
  const html = app.queueSummaryHtml(cases,{reviewed:new Set(['top']),first:new Set(['missing','top','absent'])});
  for (const text of ['1그룹 확인 전 <strong>0</strong>건','다른 그룹 확인 전 <strong>1</strong>건','GT 자료 없음 · 확인 전 <strong>1</strong>건','확인 완료 <strong>1</strong>건','별도 안내 · 확인 전 중 수동 지정 <strong>1</strong>건']) assert.ok(html.includes(text));
  assert.doesNotMatch(html,/AI 차이 우선검토/);
  const unknown = app.caseButtonHtml(cases[2],null,false,false,3);
  assert.match(unknown,/data-review-group="unknown"/);
  assert.match(unknown,/GT 크기·개수 자료 없음/);
});

test('browser startup removes legacy v without navigation or changing unrelated URL state', () => {
  const vm = require('node:vm');
  const source = require('node:fs').readFileSync(require.resolve('../app.js'), 'utf8');
  for (const [input, expected] of [
    ['/?v=review-groups-10', '/'],
    ['/?case=case_001&v=review-groups-10&label=a%20b&tag=one&tag=two#viewer', '/?case=case_001&label=a%20b&tag=one&tag=two#viewer'],
    ['/?v=review-groups-10&v=old#viewer', '/#viewer'],
    ['/', null],
    ['/?case=case_001&label=a%20b#viewer', null],
  ]) {
    const calls = [], state = {selectedCase: 'case_001'};
    const location = Object.freeze({href: `http://localhost:8000${input}`});
    const window = Object.freeze({location, history: {
      state,
      replaceState(...args) { calls.push(args); },
    }});
    let readyHandler;
    vm.runInNewContext(source, {
      window, URL, URLSearchParams,
      document: {readyState: 'loading', addEventListener(event, handler) {
        assert.equal(event, 'DOMContentLoaded'); readyHandler = handler;
      }},
    });
    assert.equal(typeof readyHandler, 'function');
    assert.deepEqual(calls, expected === null ? [] : [[state, '', expected]], input);
    assert.equal(location.href, `http://localhost:8000${input}`);
  }
});
