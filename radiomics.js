(function (global) {
  'use strict';
  const metricKeys = ['reviewGroup', 'reviewGroupBin50', 'largestComponentMl', 'componentCount', 'maxDiameterMm', 'sphericity', 'entropy', 'contrastHu'];
  const nullable = metricKeys.filter(k => !['largestComponentMl', 'componentCount'].includes(k));
  function check(ok) { if (!ok) throw new Error('Invalid radiomics manifest'); }
  function keys(x, expected) { check(x !== null && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).sort().join('|') === expected.slice().sort().join('|')); }
  const num = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const int = x => Number.isSafeInteger(x) && x >= 0;
  function groups(cases, morphology = false) {
    let pending = cases.filter(c => c.metrics.componentCount > 0), rank = 1;
    const result = Object.create(null);
    const axes = c => { const m = c.metrics; return morphology ? [m.largestComponentMl, m.componentCount] : [m.largestComponentMl, m.componentCount, m.entropy, -m.contrastHu]; };
    while (pending.length) {
      const front = pending.filter(c => !pending.some(d => { const a = axes(c), b = axes(d); return b.every((v, i) => v >= a[i]) && b.some((v, i) => v > a[i]); }));
      front.forEach(c => { result[c.id] = rank; });
      pending = pending.filter(c => result[c.id] === undefined); rank++;
    }
    return result;
  }
  function validate(m) {
    keys(m, ['version', 'localOnly', 'caseCount', 'windowHu', 'cases']);
    check(m.version === 1 && m.localOnly === true && Array.isArray(m.windowHu) && m.windowHu.length === 2 && m.windowHu[0] === -150 && m.windowHu[1] === 250);
    check(Array.isArray(m.cases) && int(m.caseCount) && m.caseCount >= 1 && m.caseCount <= 100 && m.cases.length === m.caseCount);
    const seen = new Set();
    m.cases.forEach(c => {
      keys(c, ['id', 'sliceCount', 'defaultSlice', 'dimensions', 'spacing', 'gtVoxelCount', 'metrics', 'slices']);
      check(typeof c.id === 'string' && /^case_[0-9]{3}$/.test(c.id) && !seen.has(c.id)); seen.add(c.id);
      check(int(c.sliceCount) && c.sliceCount > 0 && c.sliceCount <= 10000 && int(c.defaultSlice) && c.defaultSlice < c.sliceCount);
      check(Array.isArray(c.dimensions) && c.dimensions.length === 3 && c.dimensions.every(v => int(v) && v > 0) && c.dimensions[2] === c.sliceCount);
      check(Array.isArray(c.spacing) && c.spacing.length === 3 && c.spacing.every(v => num(v) && v > 0));
      check(int(c.gtVoxelCount)); keys(c.metrics, metricKeys);
      const q = c.metrics;
      check(int(q.componentCount) && num(q.largestComponentMl));
      if (q.componentCount === 0) check(q.largestComponentMl === 0 && nullable.every(k => q[k] === null));
      else check(q.largestComponentMl > 0 && nullable.every(k => num(q[k])) && int(q.reviewGroup) && q.reviewGroup > 0 && int(q.reviewGroupBin50) && q.reviewGroupBin50 > 0 && q.sphericity <= 1);
      check(Array.isArray(c.slices) && c.slices.length === c.sliceCount);
      let total = 0, maximum = -1, defaultIndex = 0;
      c.slices.forEach((s, i) => {
        keys(s, ['index', 'ct', 'gt', 'ctSha256', 'gtSha256', 'gtPixels', 'width', 'height']);
        check(s.index === i && int(s.width) && int(s.height) && s.width === c.dimensions[0] && s.height === c.dimensions[1]);
        check(int(s.gtPixels) && s.gtPixels <= s.width * s.height);
        for (const [kind, ext] of [['ct', 'webp'], ['gt', 'png']]) {
          check(s[kind] === `data/radiomics_web/web/${c.id}/${kind}/${String(i).padStart(4, '0')}.${ext}`);
          check(typeof s[kind + 'Sha256'] === 'string' && /^[0-9a-f]{64}$/.test(s[kind + 'Sha256']));
        }
        total += s.gtPixels;
        if (s.gtPixels > maximum) { maximum = s.gtPixels; defaultIndex = i; }
      });
      check(total === c.gtVoxelCount && (total > 0) === (q.componentCount > 0) && q.componentCount <= total);
      check(c.defaultSlice === (total ? defaultIndex : Math.floor(c.sliceCount / 2)));
    });
    const ranks = groups(m.cases);
    check(m.cases.every(c => c.metrics.reviewGroup === (ranks[c.id] ?? null)));
    return m;
  }
  function sorted(cases, mode, ranks, morphology) {
    return cases.slice().sort((a, b) => {
      // Empty annotation is a separate tail, never a fabricated low-risk score.
      const empty = Number(a.metrics.componentCount === 0) - Number(b.metrics.componentCount === 0);
      if (empty) return empty;
      let delta = 0;
      if (mode === 'volume') delta = b.metrics.largestComponentMl - a.metrics.largestComponentMl;
      else if (mode !== 'id') { const r = mode === 'morphology' ? morphology : ranks; delta = (r[a.id] ?? Infinity) - (r[b.id] ?? Infinity); }
      return delta || a.id.localeCompare(b.id);
    });
  }
  function createEpoch() {
    let serial = 0, active = false;
    return { next() { active = true; return ++serial; }, close() { active = false; serial++; }, current(token) { return active && token === serial; } };
  }
  const reviewKey = (dataset, id) => `lesionlens:radiomics:v1:${dataset}:${id}`;
  function mount(doc, env = global) {
    const ids = ['radiomicsPanel', 'radiomicsStatus', 'radiomicsSearch', 'radiomicsSort', 'radiomicsSummary', 'radiomicsList', 'radiomicsDialog', 'radiomicsCaseTitle', 'radiomicsClose', 'radiomicsCt', 'radiomicsGt', 'radiomicsSlice', 'radiomicsSliceLabel', 'radiomicsOverlayToggle', 'radiomicsViewerFacts'];
    const el = Object.fromEntries(ids.map(id => [id, doc.getElementById(id)]));
    if (ids.some(id => !el[id])) return;
    const epoch = createEpoch();
    let manifest, ranks, morphology, dataset, currentCase = null, focusBack = null, overlay = true, storageFailed = false;
    const status = text => { el.radiomicsStatus.textContent = text; };
    const storageError = () => { storageFailed = true; status('검토 상태 저장소를 사용할 수 없습니다. 변경 내용은 저장되지 않습니다.'); };
    function reviewed(id) { try { return env.localStorage.getItem(reviewKey(dataset, id)) === '1'; } catch (_) { storageError(); return false; } }
    function close() {
      epoch.close(); currentCase = null;
      el.radiomicsCt.removeAttribute('src'); el.radiomicsGt.removeAttribute('src');
      el.radiomicsCt.hidden = true; el.radiomicsGt.hidden = true;
      el.radiomicsDialog.hidden = true;
      if (focusBack && focusBack.isConnected) focusBack.focus(); focusBack = null;
    }
    el.radiomicsClose.addEventListener('click', close);
    function displaySlice(index) {
      if (!currentCase) return;
      index = Math.max(0, Math.min(currentCase.sliceCount - 1, index));
      const s = currentCase.slices[index], token = epoch.next();
      el.radiomicsSlice.value = String(index); el.radiomicsSliceLabel.textContent = `${index + 1} / ${currentCase.sliceCount}`;
      el.radiomicsCt.hidden = true; el.radiomicsGt.hidden = true;
      el.radiomicsCt.removeAttribute('src'); el.radiomicsGt.removeAttribute('src');
      el.radiomicsViewerFacts.textContent = 'CT / GT 불러오는 중…';
      const ct = new env.Image(), gt = new env.Image(); let loaded = 0, failed = false;
      const error = () => { if (!epoch.current(token)) return; failed = true; el.radiomicsCt.hidden = true; el.radiomicsGt.hidden = true; el.radiomicsViewerFacts.textContent = '영상을 불러올 수 없습니다.'; };
      const ready = () => {
        if (!epoch.current(token) || failed || ++loaded !== 2) return;
        el.radiomicsCt.src = ct.src; el.radiomicsGt.src = gt.src;
        el.radiomicsCt.hidden = false; el.radiomicsGt.hidden = !overlay;
        el.radiomicsViewerFacts.textContent = `GT label 2 · 이 슬라이스 ${s.gtPixels} voxels · HU −150–250 · 임상적 긴급도 미상`;
      };
      ct.onload = ready; gt.onload = ready; ct.onerror = error; gt.onerror = error;
      ct.src = '/' + s.ct; gt.src = '/' + s.gt;
    }
    function open(c, button) {
      close(); focusBack = button; currentCase = c; overlay = true;
      el.radiomicsCaseTitle.textContent = c.id;
      el.radiomicsCt.alt = `${c.id} CT`; el.radiomicsGt.alt = `${c.id} GT label 2`;
      el.radiomicsSlice.min = '0'; el.radiomicsSlice.max = String(c.sliceCount - 1); el.radiomicsSlice.step = '1';
      el.radiomicsOverlayToggle.setAttribute('aria-pressed', 'true');
      el.radiomicsOverlayToggle.textContent = 'GT 숨기기';
      button.closest('article').append(el.radiomicsDialog); el.radiomicsDialog.hidden = false; displaySlice(c.defaultSlice); el.radiomicsClose.focus();
    }
    el.radiomicsSlice.addEventListener('input', () => displaySlice(Number(el.radiomicsSlice.value)));
    el.radiomicsDialog.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (!currentCase || !['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const i = Number(el.radiomicsSlice.value);
      displaySlice(e.key === 'Home' ? 0 : e.key === 'End' ? currentCase.sliceCount - 1 : i + (['ArrowRight', 'ArrowUp'].includes(e.key) ? 1 : -1));
    });
    el.radiomicsOverlayToggle.addEventListener('click', () => {
      overlay = !overlay; el.radiomicsGt.hidden = !overlay || el.radiomicsCt.hidden;
      el.radiomicsOverlayToggle.setAttribute('aria-pressed', String(overlay));
      el.radiomicsOverlayToggle.textContent = overlay ? 'GT 숨기기' : 'GT 보기';
    });
    const text = (tag, value, cls) => { const node = doc.createElement(tag); node.textContent = value; if (cls) node.className = cls; return node; };
    const value = x => x === null ? '자료 없음' : new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 2}).format(x);
    function render() {
      if (!manifest) return;
      if (currentCase) close();
      el.radiomicsList.replaceChildren();
      const filtered = sorted(manifest.cases, el.radiomicsSort.value, ranks, morphology).filter(c => c.id.includes(el.radiomicsSearch.value.trim().toLowerCase()));
      el.radiomicsSummary.textContent = `${filtered.length} / ${manifest.caseCount} cases · GT 기반 탐색적 그룹 · AI 예측 아님 · 임상적 긴급도 미상`;
      filtered.forEach(c => {
        const m = c.metrics, card = text('article', '', 'rad-card'); card.append(text('h3', c.id));
        card.append(text('p', m.componentCount ? `GT 탐색적 그룹 (4축): ${ranks[c.id]} · 형태 그룹 (2축): ${morphology[c.id]}` : '종양 주석 없음 (GT label 2 없음)'));
        card.append(text('p', `GT 최대 성분 ${value(m.largestComponentMl)} mL · 연결 성분 ${value(m.componentCount)}개 · 질감 복잡도 ${value(m.entropy)} · 간 대비도 ${value(m.contrastHu)} HU`, 'rad-meta'));
        const actions = text('div', '', 'rad-actions'), view = text('button', 'CT 보기'), review = text('button', reviewed(c.id) ? '확인 완료됨' : '확인 완료');
        view.type = review.type = 'button';
        view.addEventListener('click', () => open(c, view));
        review.addEventListener('click', () => {
          try { const key = reviewKey(dataset, c.id); env.localStorage.setItem(key, '1'); if (env.localStorage.getItem(key) !== '1') throw new Error('Storage unavailable'); review.textContent = '확인 완료됨'; }
          catch (_) { storageError(); }
        });
        actions.append(view, review); card.append(actions); el.radiomicsList.append(card);
      });
    }
    el.radiomicsSearch.addEventListener('input', render); el.radiomicsSort.addEventListener('change', render);
    status('GT 코호트 불러오는 중…');
    env.fetch('/data/radiomics_web/manifest.json', { cache: 'no-store' }).then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); }).then(async data => {
      const validated = validate(data);
      // Isolate persistence by the complete dataset, including all derived asset hashes.
      const hash = await env.crypto.subtle.digest('SHA-256', new env.TextEncoder().encode(JSON.stringify(validated)));
      dataset = Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join('');
      manifest = validated; ranks = groups(manifest.cases); morphology = groups(manifest.cases, true);
      render(); if (!storageFailed) status('GT 기반 탐색적 검토입니다. 임상적 긴급도는 알 수 없습니다.');
    }).catch(() => { manifest = null; el.radiomicsList.replaceChildren(); status('새 코호트를 사용할 수 없습니다. 기존 앱은 계속 사용할 수 있습니다.'); });
  }
  const api = { validate, groups, sorted, createEpoch, reviewKey, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { global.Radiomics = api; if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', () => mount(global.document)); else mount(global.document); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
