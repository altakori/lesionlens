const test = require('node:test');
const assert = require('node:assert/strict');
const { cases, priorityCount, queueSummary, filteredCases, visibleSelection, statusLabel, escapeHtml } = require('../app.js');

test('priority count rounds workload up and keeps at least one case', () => {
  assert.equal(priorityCount(10, 20), 2);
  assert.equal(priorityCount(3, 10), 1);
  assert.equal(priorityCount(0, 20), 0);
});

test('queue summary uses the ranked top slice', () => {
  const summary = queueSummary(cases, 20);
  assert.deepEqual(summary, { total:10, selected:2, capturedFn:3, totalFn:6, captureRate:50, qualityCount:2 });
});

test('filters return selected workload and quality cases', () => {
  assert.deepEqual(filteredCases(cases, 'priority', 30).map(c => c.id), ['SYN-014','SYN-003','SYN-021']);
  assert.deepEqual(filteredCases(cases, 'quality', 20).map(c => c.id), ['SYN-003','SYN-026']);
});

test('selection resets to a visible case when a filter hides it', () => {
  const quality = filteredCases(cases, 'quality', 20);
  assert.equal(visibleSelection(quality, 'SYN-014').id, 'SYN-003');
  assert.equal(visibleSelection(quality, 'SYN-026').id, 'SYN-026');
});

test('workload selection overrides stored status label', () => {
  assert.deepEqual(statusLabel(cases[1], 1, 2), ['priority','우선 재검토']);
  assert.deepEqual(statusLabel(cases[6], 6, 2), ['quality','품질 확인']);
});

test('HTML output escapes future external strings', () => {
  assert.equal(escapeHtml('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
});
