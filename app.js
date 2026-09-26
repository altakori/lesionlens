'use strict';
const MANIFEST_VERSION = 'lits-model-compare-v4';
const CASE_SPECS = [['case_000',75,2591], ['case_001',123,7194], ['case_035',124,20318], ['case_045',74,4539], ['case_048',244,35478],
  ['case_005',537,540], ['case_049',254,8015], ['case_051',227,124895], ['case_057',366,6604],
  ['case_060',244,11368], ['case_061',193,2916], ['case_079',147,9085], ['case_116',908,611132],
  ['case_009',549,22179],
  ['case_019',547,18528],
  ['case_020',574,1669],
  ['case_026',668,51809],
  ['case_065',513,1670],
  ['case_080',217,88269],
  ['case_083',871,98],
  ['case_088',811,254141],
  ['case_093',696,348088],
  ['case_095',841,2581],
  ['case_102',677,47754],
  ['case_113',836,84270],
  ['case_126',401,5090],
  ['case_129',338,1909785],
  // lv2-test20 cohort (ai0 labv2 Dataset003_Liver fold_0 test set, 2 arms)
  ['lv2-case_041',113,0],
  ['lv2-case_089',766,0],
  ['lv2-case_114',846,0],
  ['lv2-case_115',846,0],
  ['lv2-case_117',836,1034092],
  ['lv2-case_118',427,419119],
  ['lv2-case_119',461,0],
  ['lv2-case_120',424,5231],
  ['lv2-case_121',463,2123],
  ['lv2-case_122',422,79803],
  ['lv2-case_123',432,228251],
  ['lv2-case_125',410,754],
  ['lv2-case_127',987,298],
  ['lv2-case_128',654,326553],
];
const MODELS = ['baseline', 'cappyv2', 'cp050'];
// lv2-* cases were produced by two trainers only; case_045 has no model output.
const caseArms = id => id === 'case_045' ? [] : (id.startsWith('lv2-') ? MODELS.slice(0, 2) : MODELS);
const MODEL_VOXELS = {case_000: [2359,2483,2517], case_001: [9499,9968,10472], case_035: [31587,8885,72907], case_048: [29641,30044,30495],
  case_005: [915,482,564], case_049: [18175,20068,7080], case_051: [131139,134716,136408], case_057: [5978,6728,6793],
  case_060: [8159,8076,8139], case_061: [2230,2487,2403], case_079: [8389,8294,8741], case_116: [0,0,17],
  case_009: [22153,21981,23477],
  case_019: [31898,31510,30673],
  case_020: [8340,9892,14803],
  case_026: [67718,67227,69658],
  case_065: [673,754,841],
  case_080: [71757,74493,73674],
  case_083: [450,370,285],
  case_088: [184392,200340,234853],
  case_093: [383435,390345,396030],
  case_095: [3766,3874,8076],
  case_102: [32672,32427,34127],
  case_113: [106704,104629,106500],
  case_126: [3760,4224,5019],
  case_129: [1799499,1805493,1780747],
  'lv2-case_041': [29750,32791],
  'lv2-case_089': [0,0],
  'lv2-case_114': [2,0],
  'lv2-case_115': [66,29],
  'lv2-case_117': [1066536,1085419],
  'lv2-case_118': [302721,323070],
  'lv2-case_119': [0,0],
  'lv2-case_120': [46966,8807],
  'lv2-case_121': [153,980],
  'lv2-case_122': [59705,69505],
  'lv2-case_123': [235431,244728],
  'lv2-case_125': [950,1042],
  'lv2-case_127': [0,45],
  'lv2-case_128': [409335,483678],
};
const SOURCE_LABELS = {gt: '정답 표시 (GT)', baseline: '기본 AI (nnU-Net)', cappyv2: 'CAPPYv2', cp050: 'CAPPYv2+ 실험 (CP050 epoch1000)', none: 'CT만 보기'};
function normalizeManifest(raw) {
  try {
    const check = value => { if (!value) throw Error('manifest'); };
    const keys = (obj, names) => check(obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).sort().join(' ') === [...names].sort().join(' '));
    const integer = (n, max = 512*512*244) => Number.isInteger(n) && n >= 0 && n <= max;
    const near = (a,b) => Number.isFinite(a) && Math.abs(a-b) <= Math.max(1e-12, Math.abs(b)*1e-6);
    keys(raw, ['version','localOnly','caseCount','windowHu','cases']);
    check(raw.version === MANIFEST_VERSION && raw.localOnly === true && raw.caseCount === CASE_SPECS.length
      && JSON.stringify(raw.windowHu) === '[-150,250]' && Array.isArray(raw.cases) && raw.cases.length === CASE_SPECS.length);
    return raw.cases.map((item,i) => {
      const [id,depth,voxels] = CASE_SPECS[i], models = caseArms(id), kinds = ['gt',...models];
      keys(item, ['id','sourceCaseId','sliceCount','dimensions','spacing','tumorVolumeMl','defaultSlice','gt','models','disagreement','slices']);
      check(item.id === id && item.sourceCaseId === id && item.sliceCount === depth && JSON.stringify(item.dimensions) === JSON.stringify([512,512,depth]));
      check(Array.isArray(item.spacing) && item.spacing.length === 3 && item.spacing.every(v => Number.isFinite(v) && v > 0 && v < 100));
      keys(item.models, models);
      check(Array.isArray(item.slices) && item.slices.length === depth);
      const areas = Object.fromEntries(kinds.map(kind => [kind,[]]));
      for (const [z,row] of item.slices.entries()) {
        keys(row, ['index','canonicalSlice','width','height','gtPixels','ct','ctSha256','overlays','pixels']);
        check(row.index === z+1 && row.canonicalSlice === z && row.width === 512 && row.height === 512);
        keys(row.overlays,kinds); keys(row.pixels,kinds);
        for (const kind of kinds) { check(integer(row.pixels[kind],512*512)); areas[kind].push(row.pixels[kind]); }
        check(row.gtPixels === row.pixels.gt);
        const entries = {ct: {path: row.ct, sha256: row.ctSha256}, ...row.overlays};
        for (const [kind,entry] of Object.entries(entries)) {
          keys(entry,['path','sha256']);
          check(entry.path === `data/model_compare/web/${id}/${kind}/${String(z+1).padStart(3,'0')}.${kind === 'ct' ? 'webp' : 'png'}` && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256));
        }
      }
      const voxelMl = item.spacing.reduce((a,b) => a*b,1)/1000;
      const stats = (value, kind, expected) => {
        keys(value,['voxels','volumeMl','componentVolumesMl','componentCount','positiveSliceCount','sliceSpan']);
        check(value.voxels === expected && areas[kind].reduce((a,b) => a+b,0) === expected && near(value.volumeMl,expected*voxelMl));
        const components = value.componentVolumesMl;
        check(Array.isArray(components) && components.every(v => Number.isFinite(v) && v > 0 && Math.abs(v/voxelMl - Math.round(v/voxelMl)) <= 1e-5));
        check(value.componentCount === components.length && components.length <= expected && (components.length > 0) === (expected > 0) && near(components.reduce((a,b) => a+b,0),value.volumeMl));
        const positive = areas[kind].flatMap((n,z) => n ? [z+1] : []);
        check(value.positiveSliceCount === positive.length && JSON.stringify(value.sliceSpan) === JSON.stringify(positive.length ? [positive[0],positive.at(-1)] : null));
      };
      stats(item.gt,'gt',voxels);
      models.forEach((kind,j) => stats(item.models[kind],kind,MODEL_VOXELS[id][j]));
      check(item.tumorVolumeMl === item.gt.volumeMl && item.defaultSlice === areas.gt.indexOf(Math.max(...areas.gt)));
      if (!models.length) check(item.disagreement === null);
      else {
        keys(item.disagreement,['intersectionVoxels','unionVoxels','score']);
        const {intersectionVoxels: intersection,unionVoxels: union,score} = item.disagreement, counts = MODEL_VOXELS[id];
        check(integer(intersection) && integer(union) && intersection <= Math.min(...counts) && union >= Math.max(...counts) && union <= counts.reduce((a,b) => a+b,0));
        check(Number.isFinite(score) && score >= 0 && score <= 1 && Math.abs(score - (union ? 1-intersection/union : 0)) <= 1e-12);
      }
      return item;
    });
  } catch { return []; }
}
function reviewKey(version, id) { return `lesionlens:${version}:${id}:reviewed`; }
function readReviewed(storage, version, items) {
  return new Set(items.filter(item => { try { return storage.getItem(reviewKey(version, item.id)) === 'true'; } catch { return false; } }).map(item => item.id));
}
function setReviewed(storage, version, id, value) {
  try { storage.setItem(reviewKey(version, id), String(value)); return true; } catch { return false; }
}
function firstKey(version, id) { return `lesionlens:${version}:${id}:first`; }
function readFirst(storage, version, items) {
  return new Set(items.filter(item => { try { return storage.getItem(firstKey(version, item.id)) === 'true'; } catch { return false; } }).map(item => item.id));
}
function setFirst(storage, version, id, value) {
  try { storage.setItem(firstKey(version, id), String(value)); return true; } catch { return false; }
}
// Technical worklist rules only; never infer clinical urgency from masks.
function reviewPriority(item, first = false) {
  const tags = [], gt = item.gt || {};
  const add = (key, icon, label, source, detail) => tags.push({key, icon, label, source, detail});
  const score = Number.isFinite(item.disagreement?.score) ? item.disagreement.score : null;
  const models = MODELS.filter(kind => item.models?.[kind]);
  const missing = MODELS.filter(kind => !item.models?.[kind]);
  if (score !== null && score >= .20) add('disagreement', '↔', 'AI 표시 차이 큼', 'AI', `disagreement.score = ${score} ≥ 0.20 (1 − 공통 표시 / 합친 표시)`);
  const counts = models.map(kind => item.models[kind].componentCount);
  if (counts.length >= 2 && counts.every(Number.isFinite) && new Set(counts).size >= 2)
    add('countdiff', '≠', 'AI 표시 개수 다름', 'AI', `${models.map((kind,i) => `${SOURCE_LABELS[kind]} componentCount = ${counts[i]}`).join(', ')}; 비교 가능 모델 ≥ 2, 개수 서로 다름. 연결 표시 개수이며 병변 개수가 아님.`);
  const volumes = models.map(kind => item.models[kind].volumeMl);
  if (volumes.length >= 2 && volumes.every(v => Number.isFinite(v) && v >= 0)) {
    const min = Math.min(...volumes), max = Math.max(...volumes);
    if ((min > 0 && max / min >= 1.5) || (min === 0 && max > 0))
      add('volumediff', '◧', 'AI 표시 부피 다름', 'AI', `${models.map((kind,i) => `${SOURCE_LABELS[kind]} volumeMl = ${volumes[i]} mL`).join(', ')}; ${min > 0 ? `최대/최소 = ${max/min} ≥ 1.5` : '최소 = 0, 최대 > 0 (비율 정의 안 됨)'}`);
  }
  const small = (gt.componentVolumesMl || []).filter(v => v > 0 && v < 1);
  if (small.length) add('small', '•', '작은 표시 포함', '정답 표시', `gt.componentVolumesMl 중 ${small.join(', ')} mL; 0 < 연결 표시 부피 < 1 mL. 지름이나 치료 가능성을 뜻하지 않음.`);
  if (gt.componentCount >= 2) add('multiple', '⋮', '여러 표시 포함', '정답 표시', `gt.componentCount = ${gt.componentCount} ≥ 2 (26방향 연결 표시)`);
  if (item.tumorVolumeMl >= 20) add('large', '▰', '전체 표시 부피 큼', '정답 표시', `tumorVolumeMl = ${item.tumorVolumeMl} mL ≥ 20 mL; 전체 표시 합계이며 단일 병변 크기가 아님.`);
  if (item.sliceCount > 0 && gt.positiveSliceCount / item.sliceCount >= .25)
    add('extent', '▤', '여러 CT 장에 표시', '정답 표시', `gt.positiveSliceCount / sliceCount = ${gt.positiveSliceCount} / ${item.sliceCount} = ${gt.positiveSliceCount/item.sliceCount} ≥ 0.25; 해부학적 분포를 판정하지 않음.`);
  if (missing.length || score === null) add('missing', '?', models.length ? 'AI 비교 자료 일부 없음' : 'AI 비교 자료 없음', '자료 가용성', `예측 모델 ${models.length}/3; 없는 모델: ${missing.map(kind => SOURCE_LABELS[kind]).join(', ') || '없음'}; disagreement.score = ${score === null ? 'null (비교 점수 없음)' : score}. 자료 없음은 정상 판정이 아님.`);
  const band = tags.some(t => t.key === 'disagreement') ? 0 : tags.length ? 1 : 2;
  if (first) add('manual', '📌', '직접 먼저 보기 지정', '수동 작업', '사용자 먼저 보기 지정 = true; 자동 근거와 무관한 수동 우선 배치.');
  return {tags, band, score, label: ['먼저 비교', '이어서 확인', '차례대로 확인'][band]};
}
function matchesCategory(item, category, first) {
  const priority = reviewPriority(item, first);
  return category === 'all' || category === 'gt' ||
    (category === 'priority' ? first : priority.tags.some(tag => tag.key === category));
}
// Descriptive GT morphology only: no clinical cutoffs or severity classes.
function morphologyPriority(item) {
  const gt = item.gt, volumes = gt?.componentVolumesMl, count = gt?.componentCount;
  const available = Array.isArray(volumes) && Number.isInteger(count) && count >= 0 &&
    count === volumes.length && volumes.every(v => Number.isFinite(v) && v > 0);
  return {status: available ? 'available' : 'unavailable',
    largestVolumeMl: available ? volumes.reduce((max, v) => Math.max(max, v), 0) : null,
    componentCount: available ? count : null};
}
function dominatesMorphology(a, b) {
  return a.largestVolumeMl >= b.largestVolumeMl && a.componentCount >= b.componentCount &&
    (a.largestVolumeMl > b.largestVolumeMl || a.componentCount > b.componentCount);
}
// Always pass the full available cohort; review, pins and filters are not inputs.
function morphologyLayers(items) {
  const layers = new Map(items.map(item => [item.id, null]));
  let remaining = items.map(item => ({id:item.id, ...morphologyPriority(item)}))
    .filter(value => value.status === 'available');
  let layer = 1;
  while (remaining.length) {
    const front = remaining.filter(b => !remaining.some(a => dominatesMorphology(a, b)));
    const ids = new Set(front.map(value => value.id));
    front.forEach(value => layers.set(value.id, layer));
    remaining = remaining.filter(value => !ids.has(value.id));
    layer++;
  }
  return layers;
}
function compareMorphology(a, b, first, layers, reviewed = new Set()) {
  return Number(reviewed.has(a.id)) - Number(reviewed.has(b.id)) ||
    Number(first.has(b.id)) - Number(first.has(a.id)) ||
    (layers.get(a.id) ?? Infinity) - (layers.get(b.id) ?? Infinity) || a.id.localeCompare(b.id);
}
function morphologyPriorityHtml(item, rank = null, first = false, group = null) {
  const value = morphologyPriority(item);
  return `<section class="morphology-priority" data-morphology-status="${value.status}" aria-label="크기·개수 검토 그룹">
    <p><span class="rank-number">${rank === null ? '전체 대기열' : `전체 대기열 ${rank}번째`}</span> · 크기·개수 검토 그룹 · GT${first ? ' · 📌 수동 우선' : ''}</p>
    <h4>${group === null ? '그룹 자료 없음' : `${group}그룹`}</h4><p>같은 그룹은 사례 번호순 · 의학적 우열 아님</p><div class="priority-reason-tags" title="순위 근거">${value.status === 'available' ?
      `<span class="priority-reason-tag" data-reason="largest-volume">최대 연결 표시 부피 ${value.largestVolumeMl.toFixed(2)} mL</span><span class="priority-reason-tag" data-reason="component-count">연결 표시 ${value.componentCount}개</span>` :
      '<span class="priority-reason-tag" data-reason="unavailable">GT 크기·개수 자료 없음</span>'}</div>
    <details class="morphology-rule"><summary>정렬 기준 · 임상 응급도 아님</summary><p>전체 자료 안에서 GT 최대 연결 표시 부피와 개수를 함께 비교한 상대 그룹입니다. 두 값 모두 작지 않고 하나 이상 큰 사례부터 그룹을 나눕니다. 확인 완료·수동 지정·필터로 그룹은 바뀌지 않습니다. 확인 전 먼저, 각 확인 상태에서 수동 지정 먼저 배치합니다. 개수는 분할 표시의 조각화를 반영할 수 있습니다. 연결 표시는 확정 병변이 아니며, 임상 응급도 판정이 아닙니다. 순번은 전체 크기·개수 대기열 기준으로 다른 정렬·필터의 화면 순서와 다를 수 있습니다.</p></details></section>`;
}
function filteredCases(items, {search = '', sort = 'burden', category = 'all', first = new Set(), filter = 'all', reviewed = new Set()} = {}) {
  const layers = morphologyLayers(items);
  return items.filter(c => c.id.toLowerCase().includes(search.trim().toLowerCase()) &&
    (filter === 'all' || (filter === 'reviewed' ? reviewed.has(c.id) : !reviewed.has(c.id))) && matchesCategory(c, category, first.has(c.id)))
    .sort((a, b) => {
      if (sort === 'burden') return compareMorphology(a, b, first, layers, reviewed);
      const ap = reviewPriority(a), bp = reviewPriority(b);
      return ((sort === 'priority' || sort === 'disagreement') ? Number(first.has(b.id)) - Number(first.has(a.id)) : 0) ||
        (sort === 'priority' ? ap.band - bp.band : 0) ||
        (sort === 'priority' || sort === 'disagreement' ? (bp.score ?? -1) - (ap.score ?? -1) :
          sort === 'tumor' ? b.tumorVolumeMl - a.tumorVolumeMl : 0) || a.id.localeCompare(b.id);
    });
}
function visibleSelection(items, id) { return items.find(c => c.id === id) || items[0] || null; }
// Always use the full technical queue, independent of the visible list controls.
function selectNextCase(items, {first = new Set(), reviewed = new Set()} = {}) {
  return filteredCases(items, {first, reviewed, filter: 'pending', sort: 'burden'})[0] || null;
}
function caseRecommendation(item) {
  const keys = new Set(reviewPriority(item).tags.map(tag => tag.key)), actions = [];
  if (['disagreement', 'countdiff', 'volumediff'].some(key => keys.has(key))) actions.push('AI별 표시 경계를 비교');
  if (keys.has('small')) actions.push('정답 표시(GT)의 작은 영역을 확인');
  if (keys.has('missing')) actions.push('누락된 AI 예측·비교 자료를 확보');
  if (!actions.length) actions.push('정답 표시(GT)와 AI 표시를 차례대로 확인');
  return `${actions.join('하고 ')}해 주세요.`;
}
function nextCaseHtml(items, {first = new Set(), reviewed = new Set(), state = 'ready'} = {}) {
  if (state === 'loading') return '<p>다음 확인 사례를 불러오는 중이에요.</p>';
  if (state === 'error') return '<p>CT 목록을 불러오지 못해 다음 사례를 정할 수 없어요. 로컬 데이터를 확인해 주세요.</p>';
  if (!items.length) return '<p>표시할 CT 사례가 없어요.</p>';
  const item = selectNextCase(items, {first, reviewed});
  if (!item) return '<p>모든 사례를 확인했어요.</p>';
  const id = escapeHtml(item.id), morphology = morphologyPriority(item), group = morphologyLayers(items).get(item.id);
  const reason = morphology.status === 'available'
    ? `최대 연결 표시 부피 ${morphology.largestVolumeMl.toFixed(2)} mL · 연결 표시 ${morphology.componentCount}개 · GT`
    : 'GT 크기·개수 자료 없음';
  return `<h3><span class="next-label">다음 확인 사례</span><span class="next-id">${id}</span></h3>
    <details class="next-evidence"><summary>선정 이유 · 응급도 순위 아님</summary><p>전체 기본 크기·개수 대기열 · GT (화면 정렬·필터와 무관) · 자료 내 상대 그룹</p><p class="case-reason">${first.has(item.id) ? '직접 먼저 보기 지정 · ' : ''}${group === null ? '그룹 자료 없음' : `${group}그룹`} · ${escapeHtml(reason)}</p></details>
    <button type="button" data-action="open" data-id="${id}" aria-label="${id} CT 보기">CT 보기 <span aria-hidden="true">↗</span></button>`;
}
function queueSummaryHtml(items, {reviewed = new Set(), first = new Set(), state = 'ready'} = {}) {
  if (state === 'loading') return '<p>대기열 집계 중이에요.</p>';
  if (state === 'error') return '<p>CT 목록을 불러오지 못해 대기열을 집계할 수 없어요.</p>';
  const pending = items.filter(item => !reviewed.has(item.id));
  const layers = morphologyLayers(items);
  const firstGroup = pending.filter(item => layers.get(item.id) === 1).length;
  const unknown = pending.filter(item => layers.get(item.id) === null).length;
  const pins = pending.filter(item => first.has(item.id)).length;
  return `<p class="progress-count">확인 완료 <strong>${items.length - pending.length}</strong>건</p><details class="progress-details"><summary>전체 진행 현황</summary><div class="progress-breakdown"><p>전체 기본 대기열 · 자료 내 상대 그룹</p><p>1그룹 확인 전 <strong>${firstGroup}</strong>건</p><p>다른 그룹 확인 전 <strong>${pending.length - firstGroup - unknown}</strong>건</p><p>GT 자료 없음 · 확인 전 <strong>${unknown}</strong>건</p>${pins ? `<p>별도 안내 · 확인 전 중 수동 지정 <strong>${pins}</strong>건</p>` : ''}<p>응급 소견 미평가 <strong>${items.length}</strong>건</p></div></details>`;
}
function clampSlice(value, count) { return Math.max(0, Math.min(count - 1, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0)); }
function sliceValueText(index, count) { return `${index + 1} / ${count}`; }
function wheelSlice(index, delta, count) { const slice = clampSlice(index + Math.sign(delta), count); return {slice, changed: slice !== index}; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])); }
function caseReason(item) {
  const tag = reviewPriority(item).tags[0];
  return tag ? `${tag.label} · ${tag.source} 기준` : '추가 비교 기준 해당 없음 · 차례대로 확인';
}
function caseButtonHtml(item, selectedId, reviewed, first = false, rank = null, sort = 'burden', legacyRank = null, group = null) {
  const id = escapeHtml(item.id), priority = reviewPriority(item, first);
  const modelCount = MODELS.filter(kind => item.models?.[kind]).length;
  return `<article class="case-card${item.id === selectedId ? ' selected' : ''}" data-id="${id}" data-review-band="${priority.band}" data-reviewed="${!!reviewed}" data-rank-policy="pareto-gt-vol-count" data-review-group="${group ?? 'unknown'}" data-queue-ordinal="${rank ?? 'unknown'}">
    <h3 class="case-id">${id}</h3><small class="case-subtitle">원본 사례 번호 · CT ${item.sliceCount}장${item.id.startsWith('lv2-') ? ' · 다른 실행군(labv2) · AI 2종' : ''}</small>
    ${morphologyPriorityHtml(item, rank, first, group)}
    ${sort === 'priority' ? `<p class="review-rank">기존 비교 기준 ${legacyRank === null ? '' : `${legacyRank}번째 · `}<span class="rank-band">${priority.label}</span></p>` : ''}
    <p class="emergency-status" title="응급 소견 판독·임상 정보가 연결되지 않았어요"><strong>응급 소견 미평가</strong></p>
    <div class="case-tags">${priority.tags.map(tag => `<span class="case-tag" data-tag="${tag.key}"><span aria-hidden="true">${tag.icon}</span> ${tag.label} · ${tag.source}</span>`).join('')}</div>
    <details class="rank-reasons"><summary>이유와 측정값 자세히</summary>
    <p class="case-reason">${escapeHtml(caseReason(item))}</p>
    <p class="next-action-reason">${escapeHtml(caseRecommendation(item))}</p>
    <h4 class="review-action-heading">${['우선 재검토', '추가 확인', '차례대로 확인'][priority.band]}</h4>
    <p class="case-source">CT · 정답 표시 · AI ${modelCount}종 자료 있음</p>
<p class="rank-explanation">기존 비교 기준(priority) 순서: 수동 지정 먼저 → 비교 단계 → 같은 단계에서 AI 차이 점수 내림차순 (없음은 뒤) → 사례 번호. 크기·개수 기준 순위와 별개의 기존 기술 비교 규칙이에요. 현재 단계: ${priority.label}; AI 차이 점수: ${priority.score ?? '없음'}. ${first ? '수동 지정으로 자동 순서보다 앞에 배치해요.' : '해당 비교 기준과 점수로 순서를 정해요.'}</p>
    <ul>${priority.tags.map(tag => `<li>${tag.label} · ${tag.source}: ${escapeHtml(tag.detail)}</li>`).join('') || '<li>추가 비교 기준 해당 없음.</li>'}</ul>
    <p>프로젝트의 잠정 기술 검토 기준이며 임상 검증된 기준이 아니에요. 차이 점수는 AI 사이의 표시 불일치이며 정답 대비 정확도가 아니에요.</p><small>임상 응급도: 판단 자료 부족 · 응급 소견 판독·임상 정보가 연결되지 않았어요</small></details>
    <span class="case-state${reviewed ? ' reviewed' : ''}">${reviewed ? '확인 완료' : '확인 전'}</span>
    <div class="card-actions"><button type="button" data-action="first" data-id="${id}" aria-pressed="${first}" aria-label="${id} 먼저 보기${first ? ' 해제' : ''}"><span aria-hidden="true">📌</span> ${first ? '먼저 보기 해제' : '먼저 보기'}</button>
    <button type="button" data-action="open" data-id="${id}" aria-label="${id} CT 보기"><span aria-hidden="true">🖼️</span> CT 보기</button></div></article>`;
}
function comparisonHtml(item) {
  if (!item) return '';
  const entries = [['gt',item.gt], ...MODELS.map(kind => [kind,item.models[kind]])];
  return entries.map(([kind,stats]) => `<section><h3>${SOURCE_LABELS[kind]}</h3>${stats ?
    `<p>표시 부피 ${stats.volumeMl.toFixed(2)} mL · 표시 덩어리 ${stats.componentCount}개</p><p>표시가 있는 CT ${stats.positiveSliceCount}장 · ${stats.sliceSpan ? stats.sliceSpan.join('–') + '번째 이미지 범위' : '표시 없음'}</p><p>덩어리별 부피: ${stats.componentVolumesMl.map(v => v.toFixed(3)).join(', ') || '없음'} mL</p>` : '<p>이 사례에는 AI 예측 자료가 없어요.</p>'}</section>`).join('') +
    `<p>${item.disagreement ? `세 AI 표시 차이 ${(item.disagreement.score*100).toFixed(1)}% (1 − 공통 표시 / 합친 표시)` : '세 AI 표시 차이: 비교 자료 없음'}</p><p>표시 덩어리는 3차원에서 면·모서리·꼭짓점으로 맞닿은 표시를 묶은 수(26방향 연결)이며, 의료진이 판정한 병변 개수가 아니에요. 부피는 표시 복셀 수 × 복셀 부피로 계산해요.</p><p>작은 표시: 정답 표시 덩어리 중 0 초과 1 mL 미만이 있음. 여러 표시: 정답 표시 덩어리 2개 이상. AI 차이 분류: 차이 점수 0.20 이상. 모두 탐색용 기준으로 임상 검증되지 않았어요. 차이 점수는 정답과의 정확도가 아닌 세 AI 사이의 표시 불일치예요.</p><p>표시 범위는 첫 표시부터 마지막 표시까지의 CT 이미지 번호이며, 그 사이 모든 이미지에 표시가 있다는 뜻은 아니에요. 선별된 예시이므로 모델 성능을 평가하는 집단이 아니에요.</p>`;
}

function startApp() {
  if (document.body?.dataset.mdWorkflow) return;
  const $ = id => document.getElementById(id);
  // The parent supplies this static DOM contract.
  let cases = [], reviewed = new Set(), selected = null, slice = 0, overlay = true, generation = 0, loaded = false;
  let source = 'gt';
  let filter = 'all', category = 'all', first = new Set(), triggerId = null, manifestError = '', storage;
  let manifestState = 'loading', triggerPanel = 'caseList';
  const dialog = $('ctDialog');
  $('sortSelect').value = 'burden';
  try { storage = window.localStorage; } catch { storage = null; }
  const images = [$('realCtImage'), $('realOverlayImage')];
  function clearImages() {
    loaded = false;
    for (const image of images) { image.hidden = true; image.removeAttribute('src'); image.alt = ''; }
  }
  function status(kind, text) {
    $('realDataStatus').className = `real-status ${kind}`;
    $('realDataStatus').textContent = text;
    $('realCtUnavailable').hidden = kind !== 'error';
    $('realCtUnavailable').textContent = kind === 'error' ? text : '';
  }
  function overlayState() {
    $('realOverlayToggle').setAttribute('aria-pressed', String(!!selected && overlay && source !== 'none' && !!selected.slices[slice].overlays[source]));
    $('realOverlayToggle').textContent = overlay ? '표시 숨기기' : '표시 보기';
    $('realOverlayImage').hidden = !loaded || !overlay || !images[1].hasAttribute('src');
  }
  function controls() {
    const count = selected ? selected.sliceCount : 0;
    $('realSliceSlider').min = '0';
    $('realSliceSlider').max = String(Math.max(0, count - 1));
    $('realSliceSlider').value = String(slice);
    $('realSliceSlider').disabled = !selected;
    $('realSliceSlider').setAttribute('aria-valuetext', count ? sliceValueText(slice, count) : '절편 없음');
    $('realSliceLabel').textContent = count ? sliceValueText(slice, count) : '—';
    $('realPreviousSlice').disabled = !selected || slice === 0;
    $('realNextSlice').disabled = !selected || slice === count - 1;
    $('realOverlayToggle').disabled = !selected || source === 'none' || !selected.slices[slice].overlays[source];
    $('overlaySelect').disabled = !selected;
    $('reviewToggle').disabled = !selected;
  }
  function preload(path) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.naturalWidth === 512 && image.naturalHeight === 512 ? resolve(image) : reject(Error('dimensions'));
      image.onerror = reject;
      image.src = path;
    });
  }
  async function renderSlice() {
    const token = ++generation;
    clearImages(); controls(); overlayState();
    if (!selected || !dialog.open) { $('realCtDescription').textContent = ''; return; }
    const item = selected, row = item.slices[slice];
    const entry = source === 'none' ? null : row.overlays[source];
    const label = SOURCE_LABELS[source];
    $('modelCaption').textContent = `${label}${source !== 'none' && !entry ? ' · 이 사례에는 자료가 없어요. CT만 보여요.' : overlay || source === 'none' ? '' : ' · 표시를 숨겼어요.'}`;
    status('loading', 'CT 불러오는 중');
    $('realCtDescription').textContent = `${item.id} · ${sliceValueText(slice, item.sliceCount)}번째 CT · ${label}`;
    try {
      await Promise.all([preload(row.ct), ...(overlay && entry ? [preload(entry.path)] : [])]);
      if (token !== generation) return;
      images[0].src = row.ct; images[0].alt = `${item.id} CT ${row.index}절편`;
      if (overlay && entry) { images[1].src = entry.path; images[1].alt = `${item.id} ${label} ${row.index}번째 CT`; }
      loaded = true; images[0].hidden = false; overlayState();
      status('ready', 'CT 준비됨');
    } catch {
      if (token !== generation) return;
      ++generation; clearImages(); status('error', 'CT 또는 선택한 표시를 불러오지 못했어요. 다른 이미지를 선택해 주세요.');
    }
  }
  // Visible elements also fail closed if a cached/preloaded asset later fails.
  images.forEach(image => image.addEventListener('error', () => {
    if (!image.hasAttribute('src')) return;
    ++generation; clearImages(); status('error', 'CT 또는 선택한 표시를 불러오지 못했어요.');
  }));
  function facts() {
    $('comparisonFacts').innerHTML = comparisonHtml(selected);
    for (const option of $('overlaySelect').options) {
      option.textContent = SOURCE_LABELS[option.value] + (selected && MODELS.includes(option.value) && !selected.models[option.value] ? ' · 자료 없음' : '');
    }
    if (!selected) $('modelCaption').textContent = '정답 표시와 AI 예측은 달라요.';
    $('selectedCaseId').textContent = selected ? selected.id : '선택된 사례 없음';
    $('selectedCaseMeta').textContent = selected ? `LiTS · ${selected.sliceCount}절편` : '';
    $('reviewToggle').setAttribute('aria-pressed', String(!!selected && reviewed.has(selected.id)));
    $('reviewToggle').textContent = selected && reviewed.has(selected.id) ? '확인 완료 취소' : '확인 완료';
    $('caseFacts').innerHTML = selected ? [
      ['원본 사례', selected.sourceCaseId], ['전체 절편', String(selected.sliceCount)],
      ['크기', selected.dimensions.join(' × ')], ['복셀 간격', `${selected.spacing.map(v => v.toFixed(3)).join(' × ')} mm`],
      ['정답 표시 전체 부피 (GT)', `${selected.tumorVolumeMl.toFixed(2)} mL`]
    ].map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHtml(value)}</dd></div>`).join('') : '';
  }
  function renderList() {
    if ($('nextCase')) $('nextCase').innerHTML = nextCaseHtml(cases, {first, reviewed, state: manifestState});
    if ($('queueSummary')) $('queueSummary').innerHTML = queueSummaryHtml(cases, {reviewed, first, state: manifestState});
    const visible = filteredCases(cases, {search: $('caseSearch').value, sort: $('sortSelect').value, category, first, filter, reviewed});
    const legacyRanks = new Map(filteredCases(cases, {first, sort: 'priority'}).map((c, i) => [c.id, i + 1]));
    const layers = morphologyLayers(cases);
    const ranks = new Map(filteredCases(cases, {first, reviewed}).map((c, i) => [c.id, i + 1]));
    $('caseList').innerHTML = visible.map(c => caseButtonHtml(c, selected && selected.id, reviewed.has(c.id), first.has(c.id), ranks.get(c.id), $('sortSelect').value, legacyRanks.get(c.id), layers.get(c.id))).join('');
    $('emptyState').hidden = visible.length > 0;
    $('emptyState').textContent = manifestError || (cases.length ? '조건에 맞는 사례가 없습니다.' : '표시할 CT 사례가 없습니다.');
    $('totalCases').textContent = String(cases.length);
    $('visibleCount').textContent = `전체 ${cases.length}건 중 ${visible.length}건 표시`;
    $('reviewedCount').textContent = String(reviewed.size);
    $('totalSlices').textContent = String(cases.reduce((sum, c) => sum + c.sliceCount, 0));
    document.querySelectorAll('.filter').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
      button.classList.toggle('active', button.dataset.filter === filter);
    });
    $('categoryFilters').querySelectorAll('[data-category]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.category === category));
      button.classList.toggle('active', button.dataset.category === category);
      const count = filteredCases(cases, {search: $('caseSearch').value, category: button.dataset.category, first, filter, reviewed}).length;
      let badge = button.querySelector('.category-count');
      if (!badge) { badge = document.createElement('span'); badge.className = 'category-count'; button.append(badge); }
      badge.textContent = ` (${count})`;
    });
    facts(); controls();
  }
  function closeViewer() {
    if (!selected) return;
    ++generation; clearImages(); selected = null; slice = 0;
    facts(); controls(); overlayState(); $('realCtDescription').textContent = '';
    status('idle', 'CT 보기를 선택해 주세요.');
    // close() hides immediately but queues its close event. Finish cleanup in
    // this user action, then restore focus after the background stops being inert.
    if (dialog.open) dialog.close();
    renderList();
    const trigger = $(triggerPanel)?.querySelector(`[data-action="open"][data-id="${triggerId}"]`) || (triggerPanel === 'nextCase' ? $('nextCase')?.querySelector('[data-action="open"]') : null);
    (trigger || $('caseSearch')).focus();
  }
  // A queued close event must not clear a viewer opened since that close.
  dialog.addEventListener('close', () => { if (!dialog.open) closeViewer(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
  $('closeCtDialog').addEventListener('click', closeViewer);
  function move(value) {
    if (!selected) return;
    const next = clampSlice(value, selected.sliceCount);
    if (next !== slice) { slice = next; renderSlice(); }
  }
  function openCase(item, panel = 'caseList') {
    triggerPanel = panel;
    triggerId = item.id; selected = item; slice = item.defaultSlice;
    source = 'gt'; overlay = true; $('overlaySelect').value = source;
    facts(); dialog.showModal(); renderSlice();
  }
  $('nextCase')?.addEventListener('click', event => {
    const button = event.target.closest('button[data-action="open"]');
    if (!button || !$('nextCase').contains(button)) return;
    const item = selectNextCase(cases, {first, reviewed});
    if (manifestState === 'ready' && item && item.id === button.dataset.id) openCase(item, 'nextCase');
  });
  $('caseList').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || !button.closest('.case-card')) return;
    const item = cases.find(c => c.id === button.dataset.id);
    if (!item) return;
    if (button.dataset.action === 'first') {
      const value = !first.has(item.id);
      if (value) first.add(item.id); else first.delete(item.id);
      const saved = setFirst(storage, MANIFEST_VERSION, item.id, value);
      renderList();
      const replacement = document.querySelector(`[data-action="first"][data-id="${item.id}"]`);
      (replacement || $('caseSearch')).focus();
      if (!saved) {
        $('emptyState').hidden = false;
        $('emptyState').textContent = '먼저 확인 지정은 현재 화면에서만 유지됩니다.';
      }
      return;
    }
    if (button.dataset.action === 'open') openCase(item);
  });
  $('categoryFilters').addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (button) { category = button.dataset.category; renderList(); }
  });
  $('caseSearch').addEventListener('input', () => renderList());
  $('sortSelect').addEventListener('change', () => renderList());
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; renderList(); }));
  $('reviewToggle').addEventListener('click', () => {
    if (!selected) return;
    const value = !reviewed.has(selected.id);
    if (value) reviewed.add(selected.id); else reviewed.delete(selected.id);
    const saved = setReviewed(storage, MANIFEST_VERSION, selected.id, value);
    renderList();
    if (!saved) status('notice', '검토 상태는 현재 화면에서만 유지됩니다.');
  });
  $('realOverlayToggle').addEventListener('click', () => { overlay = !overlay; renderSlice(); });
  $('overlaySelect').addEventListener('change', event => {
    source = event.target.value; overlay = source !== 'none'; renderSlice();
  });
  $('realPreviousSlice').addEventListener('click', () => move(slice - 1));
  $('realNextSlice').addEventListener('click', () => move(slice + 1));
  $('realSliceSlider').addEventListener('input', event => move(event.target.value));
  $('realImageFrame').addEventListener('wheel', event => {
    if (!selected || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault(); move(wheelSlice(slice, event.deltaY, selected.sliceCount).slice);
  }, {passive: false});
  $('realImageFrame').addEventListener('keydown', event => {
    const changes = {ArrowRight: slice + 1, ArrowUp: slice + 1, ArrowLeft: slice - 1, ArrowDown: slice - 1, Home: 0, End: selected ? selected.sliceCount - 1 : 0};
    if (Object.hasOwn(changes, event.key)) { event.preventDefault(); move(changes[event.key]); }
  });
  renderList(); status('loading', 'CT 목록 불러오는 중');
  fetch('data/model_compare/manifest.json', {cache: 'no-store'}).then(response => {
    if (!response.ok) throw Error('manifest'); return response.json();
  }).then(raw => {
    cases = normalizeManifest(raw);
    if (!cases.length) throw Error('manifest');
    reviewed = readReviewed(storage, MANIFEST_VERSION, cases);
    first = readFirst(storage, MANIFEST_VERSION, cases); manifestState = 'ready'; renderList();
    status('idle', 'CT 보기를 선택해 주세요.');
  }).catch(() => {
    manifestState = 'error';
    cases = []; reviewed.clear();
    manifestError = 'CT 목록을 불러오지 못했습니다. 로컬 데이터를 확인해 주세요.';
    renderList(); status('error', manifestError);
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = {morphologyLayers, dominatesMorphology, morphologyPriority, compareMorphology, morphologyPriorityHtml, MANIFEST_VERSION, CASE_SPECS, caseArms, normalizeManifest, reviewKey, readReviewed, setReviewed, filteredCases, visibleSelection, clampSlice, sliceValueText, wheelSlice, escapeHtml, caseButtonHtml, firstKey, readFirst, setFirst, MODELS, MODEL_VOXELS, SOURCE_LABELS, caseReason, comparisonHtml, reviewPriority, matchesCategory, selectNextCase, caseRecommendation, nextCaseHtml, queueSummaryHtml};
if (typeof document !== 'undefined') {
  const url = new URL(window.location.href);
  if (url.searchParams.has('v')) {
    // Keep unrelated query values (and their encoding) intact for bookmarked links.
    const query = url.search.slice(1).split('&').filter(part => !new URLSearchParams(part).has('v')).join('&');
    window.history.replaceState(window.history.state, '', url.pathname + (query ? `?${query}` : '') + url.hash);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startApp); else startApp();
}
