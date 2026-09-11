(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.LesionLens = api;
    document.addEventListener('DOMContentLoaded', () => api.mount(document));
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const cases = [
    { id:'SYN-014', status:'priority', fn:2, categories:['large','early','multifocal','disagreement'], signals:['모델 불일치','작은 병변 후보'], reasons:['큰 병변 후보와 다발성 분포를 함께 확인','작은 후보가 여러 개 관찰됨','한 모델만 표시한 합성 후보 존재'] },
    { id:'SYN-003', status:'quality', fn:1, categories:['image-quality','boundary','disagreement'], signals:['영상 품질','모델 불일치'], reasons:['절편 간격 품질 플래그','경계부 마스크 변동','영상 품질 확인 후 모델 결과 해석 필요'] },
    { id:'SYN-021', status:'priority', fn:2, categories:['early','multifocal','boundary','disagreement'], signals:['모델 불일치','작은 병변 후보'], reasons:['여러 연결요소의 분포 확인 필요','작은 병변 후보 관찰','간 경계 인접 후보로 추가 확인 필요'] },
    { id:'SYN-008', status:'priority', fn:1, categories:['early','boundary','disagreement'], signals:['작은 병변 후보','모델 불일치'], reasons:['작은 후보를 조기에 다시 확인','모델별 예측 부피 차이','경계 인접 위치와 공통 실패 가능성 확인'] },
    { id:'SYN-017', status:'routine', fn:0, categories:['large','image-quality','disagreement'], signals:['모델 불일치','영상 품질'], reasons:['큰 병변 후보의 범위 확인','중간 수준 모델 불일치','품질 신호와 함께 일반 검토'] },
    { id:'SYN-011', status:'routine', fn:0, categories:['early','disagreement'], signals:['모델 불일치','작은 병변 후보'], reasons:['작은 후보를 조기에 다시 확인','낮은 불일치','일반 검토 대기열 유지'] },
    { id:'SYN-026', status:'quality', fn:0, categories:['image-quality'], signals:['영상 품질'], reasons:['영상 품질 플래그 우세','모델 예측은 비교적 일치','품질 확인 후 일반 검토'] },
    { id:'SYN-005', status:'routine', fn:0, categories:['boundary','disagreement'], signals:['모델 불일치'], reasons:['경계 인접 후보 위치 확인','모델 간 차이 작음','일반 검토 대기열 유지'] },
    { id:'SYN-019', status:'routine', fn:0, categories:[], signals:[], reasons:['현재 별도 관찰 신호 없음','품질 플래그 없음','모델 공통 실패는 낮은 신호로 배제 불가'] },
    { id:'SYN-002', status:'routine', fn:0, categories:[], signals:[], reasons:['현재 별도 관찰 신호 없음','일반 검토 유지','낮은 신호는 정상 판정이 아님'] }
  ];

  const categoryLabels = {
    large: '큰 병변 후보',
    early: '작은 후보·조기 확인',
    multifocal: '다발성·분포 확인',
    boundary: '경계 인접',
    disagreement: '모델 불일치',
    'image-quality': '영상 품질'
  };

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
    const workflowOrder = { priority: 0, quality: 1, routine: 2 };
    return [...items].sort((a, b) => {
      const byId = a.id.localeCompare(b.id);
      if (sort === 'id') return byId;
      if (sort === 'quality') {
        const aQuality = a.status === 'quality' ? 0 : a.signals.includes('영상 품질') ? 1 : 2;
        const bQuality = b.status === 'quality' ? 0 : b.signals.includes('영상 품질') ? 1 : 2;
        return aQuality - bQuality || byId;
      }
      return workflowOrder[a.status] - workflowOrder[b.status] || b.signals.length - a.signals.length || byId;
    });
  }

  function filteredCases(items, filter) {
    if (filter === 'priority' || filter === 'quality') return items.filter(item => item.status === filter);
    if (Object.hasOwn(categoryLabels, filter)) return items.filter(item => item.categories.includes(filter));
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

  function categoryLabel(category) {
    return categoryLabels[category] || category;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function caseButtonHtml(item, rank, selectedId) {
    const [kind, label] = statusLabel(item);
    const categoryTags = item.categories.length ? `<span class="category-tags" aria-label="검토 카테고리">${item.categories.map(category => `<small class="category-tag">${escapeHtml(categoryLabel(category))}</small>`).join('')}</span>` : '';
    const reasonTags = item.reasons.slice(0, 2).map(reason => `<small class="reason-tag">${escapeHtml(reason)}</small>`).join('');
    return `<button class="case ${item.id === selectedId ? 'selected' : ''}" data-id="${escapeHtml(item.id)}" aria-pressed="${item.id === selectedId}"><span class="rank">${String(rank + 1).padStart(2, '0')}</span><span class="case-main"><strong>${escapeHtml(item.id)}</strong><span class="badge ${escapeHtml(kind)}">${escapeHtml(label)}</span>${categoryTags}<span class="reason-tags">${reasonTags}</span><span class="viewer-cta">검토 근거 보기 <b aria-hidden="true">→</b></span></span><span class="evidence-count"><strong>근거 ${item.reasons.length}개</strong><small>선택 후 전체 확인</small></span></button>`;
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
      normalized.push({ id, label: String(item.label || '로컬 LiTS CT 샘플'), slices });
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
      const previousButton = doc.getElementById('realPreviousSlice');
      const nextButton = doc.getElementById('realNextSlice');
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
        previousButton.disabled = slice === 0;
        nextButton.disabled = slice === item.slices.length - 1;
        const valueText = sliceValueText(slice, item.slices.length);
        slider.setAttribute('aria-valuetext', valueText);
        label.textContent = valueText;
        image.alt = `${item.id} 로컬 LiTS CT 축상 절편 ${valueText}`;
        overlay.alt = `${item.id} LiTS 종양 정답 주석 ${valueText}`;
        description.textContent = `${item.id}, 로컬 LiTS CT 절편 ${valueText}. LiTS 종양 정답 주석 ${showOverlay ? '표시 중' : '숨김'}. AI 예측이나 진단 결과가 아닙니다.`;
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
      previousButton.addEventListener('click', () => renderSlice(slice - 1));
      nextButton.addEventListener('click', () => renderSlice(slice + 1));
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

  function mount(doc) {
    const list = doc.getElementById('caseList');
    const detail = doc.getElementById('detailPanel');
    const sortSelect = doc.getElementById('sortSelect');
    const realCtDialog = doc.getElementById('realCtDialog');
    let filter = 'all';
    let selectedId = sortedCases(cases, 'review')[0].id;
    let focusDetailAfterRender = false;
    let realCtLoaded = false;
    let realCtOpener = null;

    function openRealCt() {
      if (typeof realCtDialog.showModal !== 'function') {
        const status = doc.getElementById('realDataStatus');
        status.textContent = '이 브라우저는 CT 참고 대화상자를 지원하지 않습니다';
        status.classList.add('error');
        return;
      }
      realCtOpener = doc.activeElement;
      realCtDialog.showModal();
      if (!realCtLoaded) {
        realCtLoaded = true;
        mountRealCases(doc);
      }
    }

    function closeRealCt() {
      if (realCtDialog.open) realCtDialog.close();
      if (realCtOpener && typeof realCtOpener.focus === 'function') realCtOpener.focus();
    }

    function renderDetail(item) {
      const [, label] = statusLabel(item);
      const categoryTags = item.categories.length ? item.categories.map(category => `<span class="category-tag">${escapeHtml(categoryLabel(category))}</span>`).join('') : '<span class="category-empty">별도 관찰 카테고리 없음</span>';
      const signalItems = item.signals.length
        ? item.signals.map(signal => `<li><strong>${escapeHtml(signal)}</strong><span>합성 상대 신호가 관찰됨</span></li>`).join('')
        : '<li><strong>현재 별도 트리거 없음</strong><span>정상 판정이 아니며 일반 순서로 유지</span></li>';
      detail.innerHTML = `
        <div class="detail-hero"><small>${escapeHtml(label)}</small><h2 id="selectedCaseTitle" tabindex="-1">${escapeHtml(item.id)}</h2><p>검토 근거 ${item.reasons.length}개</p><p class="signal-note">합성 사례 · 임상 우선순위나 진단 확률 아님</p></div>
        <div class="detail-body">
          <div class="detail-purpose"><strong>이 화면에서 할 일</strong><p>선정 이유와 확인 항목을 읽고 기존 판독·QA 흐름에서 무엇을 먼저 다시 볼지 결정합니다.</p></div>
          <h3>검토 카테고리</h3>
          <div class="detail-category-tags">${categoryTags}</div>
          <p class="category-boundary">카테고리는 합성 영상 특징을 묶은 탐색 기준입니다. <strong>작은 후보·조기 확인은 완치 가능성을 예측하지 않음</strong>, <strong>다발성·분포 확인은 전이 위험을 예측하지 않음</strong>을 뜻합니다.</p>
          <h3>사례별 검토 근거</h3>
          <ul class="reason-list">${item.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
          <h3>확인할 항목</h3>
          <p class="inspect-note">${item.status === 'quality' ? '실제 적용 단계에서는 해당 사례의 원본 영상에서 절편 간격과 영상 품질 플래그를 먼저 확인한 뒤 모델 결과를 해석합니다.' : item.status === 'priority' ? '실제 적용 단계에서는 해당 사례의 원본 영상에서 모델 표시 차이와 작은 후보·경계 인접 위치를 비교합니다. 현재 합성 사례에는 원본 영상이 연결되어 있지 않습니다.' : '실제 적용 단계에서는 해당 사례의 전체 원본 절편과 모델 표시를 일반 순서로 검토합니다. 현재 합성 사례에는 원본 영상이 연결되어 있지 않으며 낮은 신호만으로 검토를 생략하지 않습니다.'}</p>
          <h3>사용한 합성 신호</h3>
          <p class="signal-note">상대 신호가 관찰됨을 표시할 뿐, 산식과 임상적 기준이 검증되기 전에는 숫자를 노출하지 않습니다.</p>
          <ul class="signal-list">${signalItems}</ul>
          <div class="limitation"><strong>해석 한계</strong><br>합성 사례·신호로 실제 성능을 입증하지 않습니다. 후보는 오탐일 수 있고 품질 신호는 질환 위험과 별개입니다. 두 모델의 공통 실패는 낮은 신호로 배제할 수 없으며 일반 순서는 정상 판정이 아닙니다. 최종 판단은 의료진이 수행합니다.</div>
          <div class="reference-callout"><div><strong>실제 CT 조작을 확인해야 하나요?</strong><p>현재 합성 사례와 연결되지 않은 로컬 LiTS CT 참고 영상을 대화상자에서 볼 수 있습니다.</p></div><button class="open-real-ct-inline" type="button">실제 CT 샘플 보기</button></div>
        </div>`;
      detail.querySelector('.open-real-ct-inline').addEventListener('click', openRealCt);
      if (focusDetailAfterRender) {
        focusDetailAfterRender = false;
        const title = doc.getElementById('selectedCaseTitle');
        title.focus({ preventScroll: true });
        detail.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    }

    function render() {
      const ranked = sortedCases(cases, sortSelect.value);
      const visible = filteredCases(ranked, filter);
      doc.getElementById('visibleCount').textContent = cases.length;
      doc.getElementById('priorityCount').textContent = filteredCases(cases, 'priority').length;
      doc.getElementById('qualityCount').textContent = filteredCases(cases, 'quality').length;
      const viewCount = doc.getElementById('viewCount');
      const previousSelectedId = selectedId;
      const selected = visibleSelection(visible, selectedId);
      if (selected) selectedId = selected.id;
      viewCount.textContent = `${visible.length} / ${cases.length} 사례 표시${selected && previousSelectedId !== selected.id ? ` · 선택이 ${selected.id}로 변경됨` : ''}`;
      list.innerHTML = visible.map(item => {
        const rank = ranked.findIndex(c => c.id === item.id);
        return caseButtonHtml(item, rank, selectedId);
      }).join('');
      if (selected) renderDetail(selected);
      list.querySelectorAll('.case').forEach(button => button.addEventListener('click', () => {
        selectedId = button.dataset.id;
        focusDetailAfterRender = true;
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
    doc.getElementById('openRealCt').addEventListener('click', openRealCt);
    doc.getElementById('closeRealCt').addEventListener('click', closeRealCt);
    realCtDialog.addEventListener('click', event => {
      if (event.target === realCtDialog) closeRealCt();
    });
    render();
  }

  return { cases, categoryLabel, priorityCount, queueSummary, filteredCases, sortedCases, visibleSelection, statusLabel, escapeHtml, caseButtonHtml, clampSlice, sliceValueText, wheelSlice, normalizeRealManifest, mountRealCases, mount };
});
