const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { cases, priorityCount, queueSummary, filteredCases, visibleSelection, statusLabel, escapeHtml, clampSlice, sliceValueText, wheelSlice, syntheticLesions, caseButtonHtml, normalizeRealManifest } = require('../app.js');

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

test('browser assets are cache-busted so a reload cannot mix app versions', () => {
  const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
  assert.match(html, /styles\.css\?v=[a-z0-9-]+/);
  assert.match(html, /app\.js\?v=[a-z0-9-]+/);
});

test('case card exposes an obvious CT opening action', () => {
  const html = caseButtonHtml(cases[0], 0, cases[0].id, 2);
  assert.match(html, /CT 열기/);
  assert.match(html, /aria-label="SYN-014 CT 열기"/);
});

test('slice navigation clamps to the synthetic series bounds', () => {
  assert.equal(clampSlice(-1, 24), 0);
  assert.equal(clampSlice(9, 24), 9);
  assert.equal(clampSlice(99, 24), 23);
});

test('slice accessibility text is one-based and includes total slices', () => {
  assert.equal(sliceValueText(0, 24), '1 / 24');
  assert.equal(sliceValueText(23, 24), '24 / 24');
});

test('wheel navigation ignores horizontal movement and does not move past bounds', () => {
  assert.deepEqual(wheelSlice(4, 0, 24), { slice: 4, changed: false });
  assert.deepEqual(wheelSlice(23, 12, 24), { slice: 23, changed: false });
  assert.deepEqual(wheelSlice(4, -12, 24), { slice: 3, changed: true });
});

test('synthetic lesion locations are deterministic and slice-local', () => {
  const a = syntheticLesions('SYN-014', 11, 24);
  const b = syntheticLesions('SYN-014', 11, 24);
  assert.deepEqual(a, b);
  assert.ok(a.every(x => x.x >= 0 && x.x <= 1 && x.y >= 0 && x.y <= 1 && x.radius > 0));
  assert.notDeepEqual(a, syntheticLesions('SYN-014', 2, 24));
});

function realManifest() {
  return {
    version: 'ai0-lits-local-v1',
    localOnly: true,
    sourceLabel: 'AI0 public sample',
    cases: Array.from({ length: 3 }, (_, caseIndex) => {
      const id = `LL-CT-00${caseIndex + 1}`;
      return {
        id,
        label: '공개 LiTS 학습 샘플',
        sourceCaseId: 'must-not-reach-browser-state',
        sliceCount: 24,
        slices: Array.from({ length: 24 }, (_, sliceIndex) => ({
          index: sliceIndex + 1,
          sourceSlice: 10 + sliceIndex,
          width: 512,
          height: 512,
          ct: `data/real_cases/web/${id}/ct/${String(sliceIndex + 1).padStart(2, '0')}.webp`,
          overlay: `data/real_cases/web/${id}/overlay/${String(sliceIndex + 1).padStart(2, '0')}.png`,
          ctSha256: 'a'.repeat(64),
          overlaySha256: 'b'.repeat(64),
          tumorPixels: 5
        }))
      };
    })
  };
}

test('real manifest accepts exactly three local aliased 24-slice cases and drops source metadata', () => {
  const normalized = normalizeRealManifest(realManifest());
  assert.equal(normalized.length, 3);
  assert.equal(normalized[0].id, 'LL-CT-001');
  assert.equal(normalized[0].slices.length, 24);
  assert.deepEqual(normalized[0].slices[0], {
    index: 1,
    sourceSlice: 10,
    width: 512,
    height: 512,
    ct: 'data/real_cases/web/LL-CT-001/ct/01.webp',
    overlay: 'data/real_cases/web/LL-CT-001/overlay/01.png',
    ctSha256: 'a'.repeat(64),
    overlaySha256: 'b'.repeat(64),
    tumorPixels: 5
  });
  assert.equal(Object.hasOwn(normalized[0], 'sourceCaseId'), false);
});

test('real manifest rejects wrong version, non-local, alias mismatch, and non-sequential slices', () => {
  const wrongVersion = realManifest();
  wrongVersion.version = 'unknown';
  assert.deepEqual(normalizeRealManifest(wrongVersion), []);

  const nonLocal = realManifest();
  nonLocal.localOnly = false;
  assert.deepEqual(normalizeRealManifest(nonLocal), []);

  const mismatch = realManifest();
  mismatch.cases[0].slices[0].ct = 'data/real_cases/web/LL-CT-999/ct/01.webp';
  assert.deepEqual(normalizeRealManifest(mismatch), []);

  const badIndex = realManifest();
  badIndex.cases[1].slices[3].index = Number.NaN;
  assert.deepEqual(normalizeRealManifest(badIndex), []);

  const badHash = realManifest();
  badHash.cases[2].slices[2].ctSha256 = 'not-a-sha256';
  assert.deepEqual(normalizeRealManifest(badHash), []);
});

test('CSP-compatible signal bars use progress elements instead of inline styles', () => {
  const source = fs.readFileSync(new URL('../app.js', `file://${__filename}`), 'utf8');
  assert.match(source, /<progress class="bar/);
  assert.doesNotMatch(source, /style="width:/);
});
