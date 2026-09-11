(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.LesionLens = api;
    document.addEventListener('DOMContentLoaded', () => api.mount(document));
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const cases = [
    { id:'SYN-014', score:92, status:'priority', disagreement:88, smallCandidate:91, quality:22, fn:2, reasons:['모델 간 종양 마스크 차이 34%','10 mm 미만 후보 2개','한 모델만 표시한 합성 후보 존재'] },
    { id:'SYN-003', score:86, status:'quality', disagreement:54, smallCandidate:61, quality:89, fn:1, reasons:['절편 간격 품질 플래그','경계부 마스크 변동','영상 품질 확인 후 모델 결과 해석 필요'] },
    { id:'SYN-021', score:81, status:'priority', disagreement:83, smallCandidate:78, quality:31, fn:2, reasons:['두 모델의 연결요소 수 불일치','작은 병변 후보 1개','간 경계 인접 후보로 추가 확인 필요'] },
    { id:'SYN-008', score:74, status:'priority', disagreement:68, smallCandidate:72, quality:18, fn:1, reasons:['작은 연결요소 후보','모델별 예측 부피 차이','공통 실패 가능성은 별도 확인 필요'] },
    { id:'SYN-017', score:67, status:'routine', disagreement:61, smallCandidate:57, quality:40, fn:0, reasons:['중간 수준 모델 불일치','품질 신호 경미','현재 분류 기준에서는 일반 검토'] },
    { id:'SYN-011', score:58, status:'routine', disagreement:46, smallCandidate:52, quality:35, fn:0, reasons:['낮은 불일치','작은 후보 신호 약함','일반 검토 대기열 유지'] },
    { id:'SYN-026', score:51, status:'quality', disagreement:29, smallCandidate:35, quality:84, fn:0, reasons:['영상 품질 플래그 우세','모델 예측은 비교적 일치','품질 확인 후 일반 검토'] },
    { id:'SYN-005', score:43, status:'routine', disagreement:38, smallCandidate:41, quality:19, fn:0, reasons:['낮은 추가 확인 신호','모델 간 차이 작음','일반 검토 대기열 유지'] },
    { id:'SYN-019', score:34, status:'routine', disagreement:25, smallCandidate:30, quality:28, fn:0, reasons:['낮은 불일치','품질 플래그 없음','모델 공통 실패는 점수만으로 배제 불가'] },
    { id:'SYN-002', score:23, status:'routine', disagreement:17, smallCandidate:21, quality:14, fn:0, reasons:['현재 특징상 낮은 추가 확인 가치','일반 검토 유지','점수는 정상 판정이 아님'] }
  ];

  function priorityCount(total, percent) {
    if (!Number.isFinite(total) || total <= 0) return 0;
    return Math.max(1, Math.ceil(total * Number(percent) / 100));
  }

  function queueSummary(items, percent) {
    const top = priorityCount(items.length, percent);
    const selected = items.slice(0, top);
    const totalFn = items.reduce((sum, item) => sum + item.fn, 0);
    const capturedFn = selected.reduce((sum, item) => sum + item.fn, 0);
    return {
      total: items.length,
      selected: top,
      capturedFn,
      totalFn,
      captureRate: totalFn ? Math.round(capturedFn / totalFn * 100) : 0,
      qualityCount: items.filter(item => item.status === 'quality').length
    };
  }

  function sortedCases(items, sort = 'review') {
    return [...items].sort((a, b) => {
      const byId = a.id.localeCompare(b.id);
      if (sort === 'id') return byId;
      if (sort === 'quality') return b.quality - a.quality || b.score - a.score || byId;
      return b.score - a.score || byId;
    });
  }

  function filteredCases(items, filter) {
    if (filter === 'priority' || filter === 'quality') return items.filter(item => item.status === filter);
    return items;
  }

  function visibleSelection(items, selectedId) {
    return items.find(item => item.id === selectedId) || items[0] || null;
  }

  function statusLabel(item) {
    if (item.status === 'priority') return ['priority', '먼저 확인'];
    if (item.status === 'quality') return ['quality', '품질 확인'];
    return ['routine', '일반 순서'];
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function caseButtonHtml(item, rank, selectedId) {
    const [kind, label] = statusLabel(item);
    return `<button class="case ${item.id === selectedId ? 'selected' : ''}" data-id="${escapeHtml(item.id)}" aria-pressed="${item.id === selectedId}"><span class="rank">${String(rank + 1).padStart(2, '0')}</span><span class="case-main"><strong>${escapeHtml(item.id)}</strong><span class="badge ${escapeHtml(kind)}">${escapeHtml(label)}</span><small class="reason-tag">${escapeHtml(item.reasons[0])}</small><span class="viewer-cta">CT 열기 <b aria-hidden="true">→</b></span></span><span class="score"><strong>${Number(item.score)}</strong><small>추가 확인 가치<br>합성 신호<br>확률 아님</small></span></button>`;
  }

  function clampSlice(value, totalSlices) {
    const total = Math.max(1, Math.floor(Number(totalSlices) || 1));
    return Math.max(0, Math.min(total - 1, Math.round(Number(value) || 0)));
  }

  function sliceValueText(slice, totalSlices) {
    return `${clampSlice(slice, totalSlices) + 1} / ${Math.max(1, Math.floor(Number(totalSlices) || 1))}`;
  }

  function wheelSlice(currentSlice, deltaY, totalSlices) {
    if (!Number(deltaY)) return { slice: clampSlice(currentSlice, totalSlices), changed: false };
    const current = clampSlice(currentSlice, totalSlices);
    const slice = clampSlice(current + (deltaY > 0 ? 1 : -1), totalSlices);
    return { slice, changed: slice !== current };
  }

  function hashSeed(text) {
    let hash = 2166136261;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function syntheticLesions(caseId, slice, totalSlices) {
    const total = Math.max(1, Number(totalSlices) || 1);
    const seed = hashSeed(caseId);
    const center = Math.floor(total * (0.38 + (seed % 22) / 100));
    const distance = Math.abs(Number(slice) - center);
    if (distance > 3) return [];
    const radius = Math.max(0.018, (0.055 + ((seed >>> 8) % 18) / 1000) * (1 - distance / 5));
    return [{
      x: 0.61 + ((seed >>> 12) % 17) / 100,
      y: 0.48 + ((seed >>> 17) % 16) / 100,
      radius: Number(radius.toFixed(3))
    }];
  }

  function normalizeRealManifest(manifest) {
    const expectedIds = ['LL-CT-001', 'LL-CT-002', 'LL-CT-003'];
    if (!manifest || manifest.version !== 'ai0-lits-local-v1' || manifest.localOnly !== true || !Array.isArray(manifest.cases) || manifest.cases.length !== expectedIds.length) return [];
    const normalized = [];
    for (let caseIndex = 0; caseIndex < expectedIds.length; caseIndex += 1) {
      const item = manifest.cases[caseIndex];
      const id = expectedIds[caseIndex];
      if (!item || item.id !== id || item.sliceCount !== 24 || !Array.isArray(item.slices) || item.slices.length !== 24) return [];
      const slices = [];
      for (let sliceIndex = 0; sliceIndex < 24; sliceIndex += 1) {
        const row = item.slices[sliceIndex];
        const number = sliceIndex + 1;
        const filename = String(number).padStart(2, '0');
        const expectedCt = `data/real_cases/web/${id}/ct/${filename}.webp`;
        const expectedOverlay = `data/real_cases/web/${id}/overlay/${filename}.png`;
        const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
        if (!row || row.index !== number || row.ct !== expectedCt || row.overlay !== expectedOverlay || !Number.isInteger(row.sourceSlice) || row.sourceSlice < 0 || row.width !== 512 || row.height !== 512 || !validHash(row.ctSha256) || !validHash(row.overlaySha256) || !Number.isInteger(row.tumorPixels) || row.tumorPixels < 0) return [];
        slices.push({ index: number, sourceSlice: row.sourceSlice, width: row.width, height: row.height, ct: expectedCt, overlay: expectedOverlay, ctSha256: row.ctSha256, overlaySha256: row.overlaySha256, tumorPixels: row.tumorPixels });
      }
      normalized.push({ id, label: String(item.label || '공개 CT 샘플'), slices });
    }
    return normalized;
  }

  async function mountRealCases(doc) {
    const section = doc.getElementById('realCtSection');
    if (!section) return;
    const status = doc.getElementById('realDataStatus');
    if (typeof fetch !== 'function') {
      status.textContent = '이 브라우저에서는 로컬 CT를 불러올 수 없습니다';
      status.classList.add('error');
      doc.getElementById('realCtUnavailable').hidden = false;
      section.classList.add('unavailable');
      return;
    }
    try {
      const response = await fetch('data/real_cases/manifest.json?v=ai0-lits-local-v1', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const items = normalizeRealManifest(await response.json());
      if (!items.length) throw new Error('유효한 로컬 사례 없음');

      const list = doc.getElementById('realCaseList');
      const image = doc.getElementById('realCtImage');
      const overlay = doc.getElementById('realOverlayImage');
      const slider = doc.getElementById('realSliceSlider');
      const label = doc.getElementById('realSliceLabel');
      const description = doc.getElementById('realCtDescription');
      const overlayToggle = doc.getElementById('realOverlayToggle');
      const imageFrame = doc.getElementById('realImageFrame');
      let selected = 0;
      let slice = 0;
      let showOverlay = true;
      let loadGeneration = 0;

      const renderSlice = nextSlice => {
        const item = items[selected];
        slice = clampSlice(nextSlice, item.slices.length);
        const row = item.slices[slice];
        const generation = ++loadGeneration;
        let pendingAssets = 2;
        let failed = false;
        status.textContent = `${item.id} 절편 불러오는 중`;
        status.classList.remove('ready', 'error');
        const onLoad = () => {
          if (generation !== loadGeneration || failed) return;
          pendingAssets -= 1;
          if (pendingAssets === 0) {
            status.textContent = `로컬 실제 CT ${items.length}건 준비됨`;
            status.classList.add('ready');
          }
        };
        const onError = () => {
          if (generation !== loadGeneration || failed) return;
          failed = true;
          status.textContent = `${item.id} 절편 파일 오류`;
          status.classList.add('error');
          description.textContent = `${item.id} 절편 파일을 불러오지 못했습니다. 이 화면을 정상 CT나 GT 표시로 해석하지 마세요.`;
        };
        image.onload = onLoad;
        overlay.onload = onLoad;
        image.onerror = onError;
        overlay.onerror = onError;
        image.src = row.ct;
        overlay.src = row.overlay;
        overlay.hidden = !showOverlay;
        slider.max = String(item.slices.length - 1);
        slider.value = String(slice);
        const valueText = sliceValueText(slice, item.slices.length);
        slider.setAttribute('aria-valuetext', valueText);
        label.textContent = valueText;
        image.alt = `${item.id} 실제 공개 CT 축상 절편 ${valueText}`;
        overlay.alt = `${item.id} LiTS 종양 정답 주석 ${valueText}`;
        description.textContent = `${item.id}, 실제 공개 CT 절편 ${valueText}. LiTS 종양 정답 주석 ${showOverlay ? '표시 중' : '숨김'}. AI 예측이나 진단 결과가 아닙니다.`;
      };

      const renderCases = () => {
        list.replaceChildren();
        items.forEach((item, index) => {
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = `real-case${index === selected ? ' selected' : ''}`;
          button.setAttribute('aria-pressed', String(index === selected));
          const strong = doc.createElement('strong');
          const span = doc.createElement('span');
          const cta = doc.createElement('b');
          strong.textContent = item.id;
          span.textContent = item.label;
          cta.textContent = '실제 CT 열기 →';
          button.append(strong, span, cta);
          button.addEventListener('click', () => {
            selected = index;
            slice = Math.floor(item.slices.length / 2);
            renderCases();
            renderSlice(slice);
            image.focus({ preventScroll: true });
          });
          list.appendChild(button);
        });
      };

      slider.addEventListener('input', () => renderSlice(slider.value));
      doc.getElementById('realPreviousSlice').addEventListener('click', () => renderSlice(slice - 1));
      doc.getElementById('realNextSlice').addEventListener('click', () => renderSlice(slice + 1));
      overlayToggle.addEventListener('click', () => {
        showOverlay = !showOverlay;
        overlayToggle.setAttribute('aria-pressed', String(showOverlay));
        overlayToggle.textContent = showOverlay ? 'GT 주석 숨기기' : 'GT 주석 보기';
        renderSlice(slice);
      });
      image.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        renderSlice(slice + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1));
      });
      imageFrame.addEventListener('wheel', event => {
        const next = wheelSlice(slice, event.deltaY, items[selected].slices.length);
        if (!next.changed) return;
        event.preventDefault();
        renderSlice(next.slice);
      }, { passive: false });

      renderCases();
      renderSlice(Math.floor(items[0].slices.length / 2));
      section.classList.add('loaded');
    } catch (error) {
      status.textContent = '로컬 실제 CT를 찾지 못했습니다';
      doc.getElementById('realCtUnavailable').hidden = false;
      section.classList.add('unavailable');
    }
  }

  function drawSyntheticCt(canvas, item, slice, totalSlices, showOverlay) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const size = canvas.width;
    const seed = hashSeed(`${item.id}:${slice}`);
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2 + 5;
    const bodyWidth = size * (0.36 + Math.sin((slice / totalSlices) * Math.PI) * 0.05);
    const bodyHeight = size * 0.40;
    const body = ctx.createRadialGradient(cx - 18, cy - 25, 20, cx, cy, bodyWidth);
    body.addColorStop(0, '#b7b9bc');
    body.addColorStop(0.58, '#73777d');
    body.addColorStop(1, '#252a30');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(cx, cy, bodyWidth, bodyHeight, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#161a20';
    ctx.beginPath();
    ctx.ellipse(cx - size * .13, cy - size * .09, size * .105, size * .15, -.08, 0, Math.PI * 2);
    ctx.ellipse(cx + size * .13, cy - size * .09, size * .105, size * .15, .08, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#92959a';
    ctx.beginPath();
    ctx.ellipse(cx + size * .13, cy + size * .07, size * .19, size * .13, -.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e4e5e7';
    ctx.beginPath();
    ctx.arc(cx, cy + size * .24, size * .047, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4d5259';
    ctx.beginPath();
    ctx.arc(cx, cy + size * .24, size * .018, 0, Math.PI * 2);
    ctx.fill();

    let state = seed || 1;
    for (let i = 0; i < 230; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const angle = (state % 6283) / 1000;
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const distance = Math.sqrt((state % 1000) / 1000);
      const x = cx + Math.cos(angle) * bodyWidth * distance;
      const y = cy + Math.sin(angle) * bodyHeight * distance;
      ctx.fillStyle = `rgba(255,255,255,${0.025 + (state % 5) / 100})`;
      ctx.fillRect(x, y, 1.4, 1.4);
    }

    syntheticLesions(item.id, slice, totalSlices).forEach(lesion => {
      const x = lesion.x * size;
      const y = lesion.y * size;
      const r = lesion.radius * size;
      ctx.fillStyle = 'rgba(45,48,52,.8)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (showOverlay) {
        ctx.strokeStyle = '#ff5d9e';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    ctx.fillStyle = 'rgba(0,0,0,.62)';
    ctx.fillRect(12, 12, 128, 42);
    ctx.fillStyle = '#f5f7fa';
    ctx.font = '600 13px system-ui';
    ctx.fillText(`AXIAL  ${String(slice + 1).padStart(2, '0')}/${totalSlices}`, 22, 31);
    ctx.font = '11px system-ui';
    ctx.fillStyle = '#bfc5cf';
    ctx.fillText('Synthetic CT · no PHI', 22, 47);
    return true;
  }

  function mount(doc) {
    const list = doc.getElementById('caseList');
    const detail = doc.getElementById('detailPanel');
    const sortSelect = doc.getElementById('sortSelect');
    let filter = 'all';
    let selectedId = cases[0].id;
    let selectedSlice = 11;
    let showOverlay = true;
    let focusViewerAfterRender = false;
    const totalSlices = 24;

    function renderDetail(item) {
      const [, label] = statusLabel(item);
      detail.innerHTML = `
        <div class="detail-hero"><small>${escapeHtml(label)}</small><h2>${escapeHtml(item.id)}</h2><p>추가 확인 가치 · ${Number(item.score)}</p><p class="signal-note">합성 신호 · 진단 확률 아님</p></div>
        <div class="detail-body">
          <section class="ct-viewer" aria-label="${escapeHtml(item.id)} 합성 CT 뷰어">
            <div class="ct-toolbar">
              <div><strong>Axial CT</strong><span>합성 영상 · 실제 환자자료 아님</span></div>
              <button id="overlayToggle" type="button" aria-pressed="${showOverlay}">${showOverlay ? '후보 표시 숨기기' : '후보 표시'}</button>
            </div>
            <canvas id="ctCanvas" width="420" height="420" tabindex="0" aria-label="마우스 휠 또는 아래 슬라이더로 절편 이동">합성 축상 CT 뷰어입니다. 아래 절편 설명을 확인하세요.</canvas>
            <p id="ctDescription" class="ct-description" aria-live="polite"></p>
            <div class="slice-control">
              <button id="previousSlice" type="button" aria-label="이전 절편">−</button>
              <label>절편 <strong id="sliceLabel">${selectedSlice + 1} / ${totalSlices}</strong>
                <input id="sliceSlider" type="range" min="0" max="${totalSlices - 1}" value="${selectedSlice}" aria-label="CT 절편" aria-valuetext="${sliceValueText(selectedSlice, totalSlices)}">
              </label>
              <button id="nextSlice" type="button" aria-label="다음 절편">＋</button>
            </div>
          </section>
          <h3>사례별 검토 근거</h3>
          <ul class="reason-list">${item.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
          <h3>확인할 항목</h3>
          <p class="inspect-note">${item.status === 'quality' ? '절편 간격과 영상 품질 플래그를 먼저 확인하고 모델 표시를 비교하세요.' : item.status === 'priority' ? '절편을 이동하며 모델 표시 차이와 작은 후보·경계 인접 위치를 비교하세요.' : '전체 절편과 모델 표시를 일반 순서로 검토하세요. 낮은 신호만으로 검토를 생략하지 않습니다.'}</p>
          <h3>신호 구성</h3>
          <p class="signal-note">모든 수치는 합성 데모 신호이며 진단 확률 아님.</p>
          <div class="model-bars">
            ${[['모델 불일치',item.disagreement,''],['작은 병변 후보',item.smallCandidate,'pink'],['영상 품질',item.quality,'']].map(([name,value,cls]) => `<div><div class="bar-label"><span>${escapeHtml(name)}</span><strong>${Number(value)}</strong></div><progress class="bar ${escapeHtml(cls)}" max="100" value="${Math.max(0, Math.min(100, Number(value)))}" aria-label="${escapeHtml(name)} ${Math.max(0, Math.min(100, Number(value)))}"></progress></div>`).join('')}
          </div>
          <div class="limitation"><strong>해석 한계</strong><br>합성 영상·신호로 실제 성능을 입증하지 않습니다. 후보는 오탐일 수 있고 품질 신호는 질환 위험과 별개입니다. 두 모델의 공통 실패는 낮은 점수로 배제할 수 없으며 일반 순서는 정상 판정이 아닙니다. 최종 판단은 의료진이 수행합니다.</div>
        </div>`;

      const canvas = doc.getElementById('ctCanvas');
      const slider = doc.getElementById('sliceSlider');
      const sliceLabel = doc.getElementById('sliceLabel');
      const description = doc.getElementById('ctDescription');
      const refreshSlice = value => {
        selectedSlice = clampSlice(value, totalSlices);
        slider.value = selectedSlice;
        const valueText = sliceValueText(selectedSlice, totalSlices);
        const lesionCount = syntheticLesions(item.id, selectedSlice, totalSlices).length;
        sliceLabel.textContent = valueText;
        slider.setAttribute('aria-valuetext', valueText);
        description.textContent = `${item.id}, 축상 절편 ${valueText}. 병변 후보 ${lesionCount}개. 후보 표시 ${showOverlay ? '켜짐' : '꺼짐'}. 합성 영상이며 실제 환자자료가 아닙니다.`;
        if (!drawSyntheticCt(canvas, item, selectedSlice, totalSlices, showOverlay)) {
          description.textContent += ' 이 브라우저에서는 캔버스 영상을 표시할 수 없습니다.';
        }
      };
      slider.addEventListener('input', () => refreshSlice(slider.value));
      doc.getElementById('previousSlice').addEventListener('click', () => refreshSlice(selectedSlice - 1));
      doc.getElementById('nextSlice').addEventListener('click', () => refreshSlice(selectedSlice + 1));
      doc.getElementById('overlayToggle').addEventListener('click', event => {
        showOverlay = !showOverlay;
        event.currentTarget.setAttribute('aria-pressed', String(showOverlay));
        event.currentTarget.textContent = showOverlay ? '후보 표시 숨기기' : '후보 표시';
        refreshSlice(selectedSlice);
      });
      canvas.addEventListener('wheel', event => {
        const next = wheelSlice(selectedSlice, event.deltaY, totalSlices);
        if (!next.changed) return;
        event.preventDefault();
        refreshSlice(next.slice);
      }, { passive: false });
      canvas.addEventListener('keydown', event => {
        if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') refreshSlice(selectedSlice + 1);
        else refreshSlice(selectedSlice - 1);
      });
      refreshSlice(selectedSlice);
      if (focusViewerAfterRender) {
        focusViewerAfterRender = false;
        canvas.focus({ preventScroll: true });
        canvas.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    }

    function render() {
      const ranked = sortedCases(cases, sortSelect.value);
      const visible = filteredCases(ranked, filter);
      doc.getElementById('visibleCount').textContent = cases.length;
      doc.getElementById('priorityCount').textContent = filteredCases(cases, 'priority').length;
      doc.getElementById('qualityCount').textContent = filteredCases(cases, 'quality').length;
      doc.getElementById('viewCount').textContent = `${visible.length} / ${cases.length} 사례 표시`;
      const selected = visibleSelection(visible, selectedId);
      if (selected) selectedId = selected.id;
      // HTML templates only receive source-controlled demo data; every interpolated string is escaped.
      list.innerHTML = visible.map(item => {
        const rank = ranked.findIndex(c => c.id === item.id);
        return caseButtonHtml(item, rank, selectedId);
      }).join('');
      if (selected) renderDetail(selected);
      list.querySelectorAll('.case').forEach(button => button.addEventListener('click', () => {
        selectedId = button.dataset.id;
        selectedSlice = 11;
        focusViewerAfterRender = true;
        render();
      }));
    }

    sortSelect.addEventListener('change', render);
    doc.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
      doc.querySelectorAll('.filter').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      button.classList.add('active');
      button.setAttribute('aria-pressed', 'true');
      filter = button.dataset.filter;
      render();
    }));
    render();
    mountRealCases(doc);
  }

  return { cases, priorityCount, queueSummary, filteredCases, sortedCases, visibleSelection, statusLabel, escapeHtml, caseButtonHtml, clampSlice, sliceValueText, wheelSlice, syntheticLesions, normalizeRealManifest, mountRealCases, mount };
});
