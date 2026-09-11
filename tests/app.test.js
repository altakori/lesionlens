const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { cases, priorityCount, queueSummary, filteredCases, sortedCases, visibleSelection, statusLabel, escapeHtml, clampSlice, sliceValueText, wheelSlice, syntheticLesions, caseButtonHtml, normalizeRealManifest } = require('../app.js');

test('priority count rounds workload up and keeps at least one case', () => {
  assert.equal(priorityCount(10, 20), 2);
  assert.equal(priorityCount(3, 10), 1);
  assert.equal(priorityCount(0, 20), 0);
});

test('queue summary uses the ranked top slice', () => {
  const summary = queueSummary(cases, 20);
  assert.deepEqual(summary, { total:10, selected:2, capturedFn:3, totalFn:6, captureRate:50, qualityCount:2 });
});

test('view filters use workflow status rather than a workload cutoff', () => {
  assert.deepEqual(filteredCases(cases, 'priority').map(c => c.id), ['SYN-014','SYN-021','SYN-008']);
  assert.deepEqual(filteredCases(cases, 'quality', 20).map(c => c.id), ['SYN-003','SYN-026']);
  assert.deepEqual(filteredCases(cases, 'all'), cases);
});

test('queue sort keeps every case and supports review, quality, and id order', () => {
  const review = sortedCases(cases, 'review');
  const quality = sortedCases(cases, 'quality');
  const byId = sortedCases(cases, 'id');
  assert.equal(review.length, cases.length);
  assert.equal(quality.length, cases.length);
  assert.equal(byId.length, cases.length);
  assert.deepEqual(review.map(c => c.id), cases.map(c => c.id));
  assert.equal(quality[0].id, 'SYN-003');
  assert.equal(byId[0].id, 'SYN-002');
  for (const result of [review, quality, byId]) {
    assert.deepEqual(result.map(c => c.id).sort(), cases.map(c => c.id).sort());
    assert.notEqual(result, cases);
  }
  assert.deepEqual(sortedCases([...cases].reverse()), review);
  assert.deepEqual(sortedCases(cases, 'unknown'), review);
  assert.deepEqual(sortedCases([], 'id'), []);
  assert.ok(quality.every((item, i) => !i || quality[i - 1].quality >= item.quality));
  assert.deepEqual(byId.map(c => c.id), cases.map(c => c.id).sort());
});

test('selection resets to a visible case when a filter hides it', () => {
  const quality = filteredCases(cases, 'quality', 20);
  assert.equal(visibleSelection(quality, 'SYN-014').id, 'SYN-003');
  assert.equal(visibleSelection(quality, 'SYN-026').id, 'SYN-026');
});

test('workflow labels do not change with queue position', () => {
  assert.deepEqual(statusLabel(cases[0], 9, 0), ['priority','먼저 확인']);
  assert.deepEqual(statusLabel(cases[1], 1, 2), ['quality','품질 확인']);
  assert.deepEqual(statusLabel(cases[6], 6, 2), ['quality','품질 확인']);
  assert.deepEqual(statusLabel(cases[9], 0, 2), ['routine','일반 순서']);
});

test('HTML output escapes future external strings', () => {
  assert.equal(escapeHtml('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
});

test('browser assets are cache-busted so a reload cannot mix app versions', () => {
  const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
  assert.match(html, /styles\.css\?v=[a-z0-9-]+/);
  assert.match(html, /app\.js\?v=[a-z0-9-]+/);
});

test('primary queue control sorts rather than truncates the visible queue', () => {
  const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
  assert.match(html, /id="sortSelect"/);
  assert.doesNotMatch(html, /id="workloadSelect"/);
  assert.match(html, /모든 사례/);
  assert.match(html, /안전/);
});

test('case card exposes an obvious CT opening action', () => {
  const html = caseButtonHtml(cases[0], 0, cases[0].id, 2);
  assert.match(html, /CT 열기/);
  assert.doesNotMatch(html, /aria-label="SYN-014 CT 열기"/);
  assert.match(html, /SYN-014/);
  assert.match(html, /모델 간 종양 마스크 차이 34%/);
  assert.match(html, /aria-pressed="true"/);
  for (const item of cases) {
    const card = caseButtonHtml(item, 0, cases[0].id);
    assert.ok(card.includes(escapeHtml(item.reasons[0])));
    assert.match(card, /합성 신호/);
    assert.match(card, /확률 아님/);
    assert.ok(card.includes(statusLabel(item)[1]));
  }
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

test('rendered queue and CT controls work at mobile and desktop widths', { skip: !process.env.LESIONLENS_CHROME, timeout: 60000 }, async t => {
  const { spawn } = require('node:child_process');
  const { once } = require('node:events');
  const os = require('node:os');
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lesionlens-browser-'));
  const browser = spawn(process.env.LESIONLENS_CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => browser.kill());
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    browser.on('error', reject);
    browser.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    browser.on('exit', code => reject(new Error(`Chrome exited: ${code}`)));
  });
  const socket = new WebSocket(endpoint);
  await once(socket, 'open');
  t.after(() => socket.close());
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params);
    if (!message.id) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: pathToFileURL(path.resolve(__dirname, '../index.html')).href });
  await evaluate(`new Promise(resolve => {
    if (document.readyState === 'complete') resolve(true);
    else addEventListener('load', () => resolve(true), { once: true });
  })`);
  const ids = () => evaluate(`Array.from(document.querySelectorAll('.case'), x => x.dataset.id)`);
  assert.deepEqual(await ids(), cases.map(c => c.id));
  assert.equal(await evaluate('document.querySelector("#sortSelect").value'), 'review');
  for (const sort of ['quality', 'id', 'review']) {
    await evaluate(`document.querySelector('#sortSelect').value = '${sort}'; document.querySelector('#sortSelect').dispatchEvent(new Event('change'))`);
    assert.deepEqual(await ids(), sortedCases(cases, sort).map(c => c.id));
  }
  for (const filter of ['quality', 'priority', 'all']) {
    await evaluate(`document.querySelector('[data-filter="${filter}"]').click()`);
    assert.deepEqual(await ids(), filteredCases(cases, filter).map(c => c.id));
    assert.equal(await evaluate(`document.querySelector('.case[aria-pressed="true"]').dataset.id === document.querySelector('.detail-hero h2').textContent`), true);
    assert.equal(await evaluate(`document.querySelector('#visibleCount').textContent`), '10');
  }
  for (const item of cases) {
    await evaluate(`document.querySelector('[data-id="${item.id}"]').click()`);
    assert.equal(await evaluate(`document.querySelector('.detail-hero h2').textContent`), item.id);
    assert.equal(await evaluate(`document.activeElement.id`), 'ctCanvas');
    const detail = await evaluate(`document.querySelector('#detailPanel').textContent`);
    for (const reason of item.reasons) assert.ok(detail.includes(reason));
    assert.match(detail, /확인할 항목/);
    assert.match(detail, /합성 신호/);
    assert.match(detail, /확률 아님/);
    assert.match(detail, /공통 실패/);
  }
  await evaluate(`document.querySelector('#sliceSlider').value = 7; document.querySelector('#sliceSlider').dispatchEvent(new Event('input'))`);
  assert.equal(await evaluate(`document.querySelector('#sliceLabel').textContent`), '8 / 24');
  await evaluate(`document.querySelector('#ctCanvas').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
  assert.equal(await evaluate(`document.querySelector('#sliceSlider').value`), '8');
  await evaluate(`document.querySelector('#ctCanvas').scrollIntoView({ block: 'center' })`);
  const point = await evaluate(`(() => { const r = document.querySelector('#ctCanvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaY: 100, deltaX: 0 });
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.equal(await evaluate(`document.querySelector('#sliceSlider').value`), '9');
  await evaluate(`document.querySelector('#previousSlice').click(); document.querySelector('#nextSlice').click(); document.querySelector('#overlayToggle').click()`);
  assert.equal(await evaluate(`document.querySelector('#sliceSlider').value`), '9');
  assert.equal(await evaluate(`document.querySelector('#overlayToggle').getAttribute('aria-pressed')`), 'false');
  for (const width of [390, 800, 1280, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`scrollTo(0, 0); new Promise(resolve => requestAnimationFrame(resolve))`);
    if (process.env.LESIONLENS_SCREENSHOTS) {
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const file = path.join(os.tmpdir(), `lesionlens-${width}.png`);
      fs.writeFileSync(file, Buffer.from(screenshot.data, 'base64'));
      t.diagnostic(`Screenshot: ${file}`);
    }
    const overflow = await evaluate(`Array.from(document.querySelectorAll('main, .workspace, .queue-panel, .case, .detail-panel, .ct-viewer, .section-head')).filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className || el.tagName)`);
    assert.deepEqual(overflow, [], `Overflow at ${width}px`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `Page overflow at ${width}px`);
    assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.reason-tag')).whiteSpace`), 'nowrap', `Reasons must wrap at ${width}px`);
    await evaluate(`document.querySelector('.case').scrollIntoView({ block: 'center' })`);
    const cardPoint = await evaluate(`(() => { const r = document.querySelector('.case').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...cardPoint, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...cardPoint, button: 'left', clickCount: 1 });
    assert.equal(await evaluate(`(() => { const r = document.querySelector('#ctCanvas').getBoundingClientRect(); return r.top >= 76 && r.bottom <= innerHeight; })()`), true, `CT open brings viewer into view at ${width}px`);
  }
  assert.deepEqual(errors, []);

});
