(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.LesionLens = api;
    document.addEventListener('DOMContentLoaded', () => api.mount(document));
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const cases = [
    { id:'SYN-014', score:92, status:'priority', disagreement:88, smallCandidate:91, quality:22, fn:2, reasons:['모델 간 종양 마스크 차이 34%','10 mm 미만 후보 2개','recall 지향 모델만 표시한 후보 존재'] },
    { id:'SYN-003', score:86, status:'quality', disagreement:54, smallCandidate:61, quality:89, fn:1, reasons:['절편 간격 품질 플래그','경계부 마스크 변동','영상 품질 확인 후 모델 결과 해석 필요'] },
    { id:'SYN-021', score:81, status:'priority', disagreement:83, smallCandidate:78, quality:31, fn:2, reasons:['두 모델의 연결요소 수 불일치','작은 병변 후보 1개','간 경계 인접 후보로 추가 확인 필요'] },
    { id:'SYN-008', score:74, status:'routine', disagreement:68, smallCandidate:72, quality:18, fn:1, reasons:['작은 연결요소 후보','모델별 예측 부피 차이','공통 실패 가능성은 별도 확인 필요'] },
    { id:'SYN-017', score:67, status:'routine', disagreement:61, smallCandidate:57, quality:40, fn:0, reasons:['중간 수준 모델 불일치','품질 신호 경미','현재 operating point에서는 일반 검토'] },
    { id:'SYN-011', score:58, status:'routine', disagreement:46, smallCandidate:52, quality:35, fn:0, reasons:['낮은 불일치','작은 후보 신호 약함','일반 검토 대기열 유지'] },
    { id:'SYN-026', score:51, status:'quality', disagreement:29, smallCandidate:35, quality:84, fn:0, reasons:['영상 품질 플래그 우세','모델 예측은 비교적 일치','품질 확인 후 일반 검토'] },
    { id:'SYN-005', score:43, status:'routine', disagreement:38, smallCandidate:41, quality:19, fn:0, reasons:['낮은 위험 신호','모델 간 차이 작음','일반 검토 대기열 유지'] },
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

  function filteredCases(items, filter, percent) {
    const top = priorityCount(items.length, percent);
    if (filter === 'priority') return items.slice(0, top);
    if (filter === 'quality') return items.filter(item => item.status === 'quality');
    return items;
  }

  function visibleSelection(items, selectedId) {
    return items.find(item => item.id === selectedId) || items[0] || null;
  }

  function statusLabel(item, rank, selectedCount) {
    if (rank < selectedCount) return ['priority', '우선 재검토'];
    if (item.status === 'quality') return ['quality', '품질 확인'];
    return ['routine', '일반'];
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function mount(doc) {
    const list = doc.getElementById('caseList');
    const detail = doc.getElementById('detailPanel');
    const workload = doc.getElementById('workloadSelect');
    let filter = 'all';
    let selectedId = cases[0].id;

    function renderDetail(item, selectedCount) {
      const rank = cases.findIndex(c => c.id === item.id);
      const [, label] = statusLabel(item, rank, selectedCount);
      detail.innerHTML = `
        <div class="detail-hero"><small>${escapeHtml(label)}</small><h2>${escapeHtml(item.id)}</h2><p>Review value score · ${Number(item.score)}</p></div>
        <div class="detail-body">
          <h3>순위가 올라간 이유</h3>
          <ul class="reason-list">${item.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
          <h3>신호 구성</h3>
          <div class="model-bars">
            ${[['모델 불일치',item.disagreement,''],['작은 병변 후보',item.smallCandidate,'pink'],['영상 품질',item.quality,'']].map(([name,value,cls]) => `<div><div class="bar-label"><span>${escapeHtml(name)}</span><strong>${Number(value)}</strong></div><div class="bar ${escapeHtml(cls)}"><i style="width:${Math.max(0, Math.min(100, Number(value)))}%"></i></div></div>`).join('')}
          </div>
          <div class="limitation"><strong>해석 한계</strong><br>두 모델이 같은 병변을 함께 놓친 경우에는 불일치 점수가 낮을 수 있습니다. 최종 판단은 의료진이 수행합니다.</div>
        </div>`;
    }

    function render() {
      const percent = Number(workload.value);
      const summary = queueSummary(cases, percent);
      doc.getElementById('visibleCount').textContent = summary.total;
      doc.getElementById('priorityCount').textContent = summary.selected;
      doc.getElementById('captureRate').textContent = `${summary.captureRate}%`;
      doc.getElementById('qualityCount').textContent = summary.qualityCount;
      const visible = filteredCases(cases, filter, percent);
      // HTML templates only receive source-controlled demo data; every interpolated string is escaped.
      list.innerHTML = visible.map(item => {
        const rank = cases.findIndex(c => c.id === item.id);
        const [kind,label] = statusLabel(item, rank, summary.selected);
        return `<button class="case ${item.id === selectedId ? 'selected' : ''}" data-id="${escapeHtml(item.id)}"><span class="rank">${String(rank+1).padStart(2,'0')}</span><span class="case-main"><strong>${escapeHtml(item.id)}</strong><small>${escapeHtml(item.reasons[0])}</small><span class="badge ${escapeHtml(kind)}">${escapeHtml(label)}</span></span><span class="score"><strong>${Number(item.score)}</strong><small>review score</small></span></button>`;
      }).join('');
      const selected = visibleSelection(visible, selectedId);
      if (selected) selectedId = selected.id;
      if (selected) renderDetail(selected, summary.selected);
      list.querySelectorAll('.case').forEach(button => button.addEventListener('click', () => { selectedId = button.dataset.id; render(); }));
    }

    workload.addEventListener('change', render);
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
  }

  return { cases, priorityCount, queueSummary, filteredCases, visibleSelection, statusLabel, escapeHtml, mount };
});
