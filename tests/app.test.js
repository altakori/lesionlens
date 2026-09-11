const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { cases, priorityCount, queueSummary, filteredCases, sortedCases, visibleSelection, statusLabel, escapeHtml, clampSlice, sliceValueText, wheelSlice, caseButtonHtml, normalizeRealManifest } = require('../app.js');

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

test('clinical-style review categories filter synthetic cases without claiming outcomes', () => {
  assert.deepEqual(filteredCases(cases, 'large').map(c => c.id), ['SYN-014','SYN-017']);
  assert.deepEqual(filteredCases(cases, 'early').map(c => c.id), ['SYN-014','SYN-021','SYN-008','SYN-011']);
  assert.deepEqual(filteredCases(cases, 'multifocal').map(c => c.id), ['SYN-014','SYN-021']);
  assert.deepEqual(filteredCases(cases, 'boundary').map(c => c.id), ['SYN-003','SYN-021','SYN-008','SYN-005']);
  assert.deepEqual(filteredCases(cases, 'image-quality').map(c => c.id), ['SYN-003','SYN-017','SYN-026']);
  assert.deepEqual(filteredCases(cases, 'disagreement').map(c => c.id), ['SYN-014','SYN-003','SYN-021','SYN-008','SYN-017','SYN-011','SYN-005']);
  assert.ok(cases.every(item => Array.isArray(item.categories)));
  assert.ok(cases.filter(item => item.signals.includes('작은 병변 후보')).every(item => item.categories.includes('early')));
  assert.deepEqual(cases.filter(item => item.categories.length === 0).map(item => item.id), ['SYN-019','SYN-002']);
  const source = fs.readFileSync(new URL('../app.js', `file://${__filename}`), 'utf8');
  assert.match(source, /class="category-empty">별도 관찰 카테고리 없음/);
  assert.doesNotMatch(source, /class="category-tag">별도 관찰 카테고리 없음/);
  assert.match(source, /완치 가능성을 예측하지 않음/);
  assert.match(source, /전이 위험을 예측하지 않음/);
});

test('queue sort keeps every case and supports review, quality, and id order', () => {
  const review = sortedCases(cases, 'review');
  const quality = sortedCases(cases, 'quality');
  const byId = sortedCases(cases, 'id');
  assert.equal(review.length, cases.length);
  assert.equal(quality.length, cases.length);
  assert.equal(byId.length, cases.length);
  assert.deepEqual(review.map(c => c.id), ['SYN-008','SYN-014','SYN-021','SYN-003','SYN-026','SYN-011','SYN-017','SYN-005','SYN-002','SYN-019']);
  assert.equal(quality[0].id, 'SYN-003');
  assert.equal(byId[0].id, 'SYN-002');
  for (const result of [review, quality, byId]) {
    assert.deepEqual(result.map(c => c.id).sort(), cases.map(c => c.id).sort());
    assert.notEqual(result, cases);
  }
  assert.deepEqual(sortedCases([...cases].reverse()), review);
  assert.deepEqual(sortedCases(cases, 'unknown'), review);
  assert.deepEqual(sortedCases([], 'id'), []);
  assert.deepEqual(quality.slice(0, 2).map(c => c.status), ['quality', 'quality']);
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

test('case card opens review rationale without claiming a synthetic CT', () => {
  const html = caseButtonHtml(cases[0], 0, cases[0].id, 2);
  assert.match(html, /검토 근거 보기/);
  assert.doesNotMatch(html, /CT 열기/);
  assert.doesNotMatch(html, /aria-label="SYN-014 CT 열기"/);
  assert.match(html, /SYN-014/);
  assert.match(html, /큰 병변 후보와 다발성 분포를 함께 확인/);
  assert.match(html, /작은 후보가 여러 개 관찰됨/);
  assert.match(html, /근거 3개/);
  assert.match(html, /큰 병변 후보/);
  assert.match(html, /다발성·분포 확인/);
  assert.doesNotMatch(html, /<span class="score">/);
  assert.match(html, /aria-pressed="true"/);
  for (const item of cases) {
    const card = caseButtonHtml(item, 0, cases[0].id);
    assert.ok(card.includes(escapeHtml(item.reasons[0])));
    assert.ok(card.includes(escapeHtml(item.reasons[1])));
    assert.ok(card.includes(statusLabel(item)[1]));
  }
});

test('raw mentoring feedback is represented by explicit product context and evidence boundaries', () => {
  const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
  for (const id of ['project-context', 'workflow-purpose', 'case-map', 'evidence-boundary']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /영상의학과 의료진/);
  assert.match(html, /QA 담당자/);
  assert.match(html, /모든 사례를 유지/);
  assert.match(html, /원래 판독·QA 흐름/);
  assert.match(html, /한 모델만 표시한 작은 후보/);
  assert.match(html, /간 경계 인접 후보/);
  assert.match(html, /현재 범위 밖/);
  assert.match(html, /기관별 재학습/);
  assert.match(html, /심사 기준/);
  assert.match(html, /styles\.css\?v=category-tags-1/);
  assert.match(html, /app\.js\?v=category-tags-1/);
  assert.ok(html.indexOf('id="queue"') < html.indexOf('id="project-context"'));
});

test('slice navigation clamps to the reference CT series bounds', () => {
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

test('UI removes generated synthetic CT graphics and keeps real CT as a contextual dialog', () => {
  const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
  const source = fs.readFileSync(new URL('../app.js', `file://${__filename}`), 'utf8');
  assert.match(html, /id="realCtDialog"/);
  assert.match(html, /id="openRealCt"/);
  assert.match(html, /id="closeRealCt"/);
  assert.doesNotMatch(html, /id="ctCanvas"/);
  assert.doesNotMatch(source, /drawSyntheticCt|syntheticLesions|Synthetic CT/);
  assert.match(html, /현재 선택한 합성 사례의 영상이 아닙니다/);
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

test('unvalidated synthetic signal numbers are not rendered', () => {
  const source = fs.readFileSync(new URL('../app.js', `file://${__filename}`), 'utf8');
  assert.doesNotMatch(source, /<progress class="bar/);
  assert.doesNotMatch(source, /style="width:/);
  assert.match(source, /상대 신호가 관찰됨/);
  assert.doesNotMatch(source, /추가 확인 가치 · \$\{Number\(item\.score\)\}/);
});

test('evaluation section is a pending plan rather than a completed frozen result', () => {
  const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
  assert.match(html, /평가 계획 · 아직 성능 결과 없음/);
  assert.doesNotMatch(html, /Frozen MVP contract/);
  assert.match(html, /대표 라벨은 다음 행동/);
});

test('provisional users and observed signals are represented without stale score wording', () => {
  const html = fs.readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
  const source = fs.readFileSync(new URL('../app.js', `file://${__filename}`), 'utf8');
  assert.match(html, /현재 사용자 가정/);
  assert.match(html, /의료진 검토 필요/);
  assert.match(source, /item\.signals/);
  assert.match(source, /현재 별도 트리거 없음/);
  assert.doesNotMatch(source, /점수는 정상 판정이 아님/);
  assert.doesNotMatch(source, /낮은 점수로 배제/);
  assert.doesNotMatch(source, /score:/);
  assert.match(source, /선택이 \$\{selected\.id\}로 변경됨/);
});

test('rendered queue, rationale detail, and CT reference dialog work at mobile and desktop widths', { skip: !process.env.LESIONLENS_CHROME, timeout: 60000 }, async t => {
  const { spawn } = require('node:child_process');
  const { once } = require('node:events');
  const os = require('node:os');
  const path = require('node:path');
  const http = require('node:http');
  const root = path.resolve(__dirname, '..');
  const actualManifest = path.join(root, 'data', 'real_cases', 'manifest.json');
  const useValidatedLocalAssets = fs.existsSync(actualManifest);
  let baseUrl;
  if (useValidatedLocalAssets) {
    const reservation = http.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const secureServer = spawn('python', ['scripts/serve_local.py', '--port', String(port)], { cwd:root, stdio:['ignore','pipe','pipe'] });
    t.after(() => secureServer.kill());
    await new Promise((resolve, reject) => {
      let output = '';
      secureServer.on('error', reject);
      secureServer.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('LesionLens serving on')) resolve();
      });
      secureServer.on('exit', code => reject(new Error(`secure local server exited: ${code}`)));
    });
    baseUrl = `http://127.0.0.1:${port}`;
    t.diagnostic('Browser test uses validated local CT assets through scripts/serve_local.py');
  } else {
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const fixtureManifest = realManifest();
    const webServer = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      if (pathname === '/' || pathname === '/index.html') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        return response.end(fs.readFileSync(path.join(root, 'index.html')));
      }
      if (pathname === '/app.js' || pathname === '/styles.css') {
        response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
        return response.end(fs.readFileSync(path.join(root, pathname.slice(1))));
      }
      if (pathname === '/data/real_cases/manifest.json') {
        response.setHeader('Content-Type', 'application/json');
        return response.end(JSON.stringify(fixtureManifest));
      }
      if (/^\/data\/real_cases\/web\/LL-CT-00[1-3]\/(ct|overlay)\/(0[1-9]|1[0-9]|2[0-4])\.(webp|png)$/.test(pathname)) {
        response.setHeader('Content-Type', 'image/png');
        return response.end(pixel);
      }
      response.statusCode = 404;
      response.end('not found');
    });
    await new Promise(resolve => webServer.listen(0, '127.0.0.1', resolve));
    t.after(() => webServer.close());
    baseUrl = `http://127.0.0.1:${webServer.address().port}`;
  }
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
  await cdp('Page.navigate', { url: `${baseUrl}/?v=test` });
  await evaluate(`new Promise(resolve => {
    if (document.readyState === 'complete') resolve(true);
    else addEventListener('load', () => resolve(true), { once: true });
  })`);
  const ids = () => evaluate(`Array.from(document.querySelectorAll('.case'), x => x.dataset.id)`);
  assert.deepEqual(await ids(), sortedCases(cases, 'review').map(c => c.id));
  assert.equal(await evaluate('document.querySelector("#sortSelect").value'), 'review');
  assert.equal(await evaluate(`document.querySelector('.case[aria-pressed="true"]').dataset.id`), sortedCases(cases, 'review')[0].id);
  assert.equal(await evaluate(`document.querySelector('.detail-hero h2').textContent`), sortedCases(cases, 'review')[0].id);
  for (const sort of ['quality', 'id', 'review']) {
    await evaluate(`document.querySelector('#sortSelect').value = '${sort}'; document.querySelector('#sortSelect').dispatchEvent(new Event('change'))`);
    assert.deepEqual(await ids(), sortedCases(cases, sort).map(c => c.id));
  }
  for (const filter of ['large', 'early', 'multifocal', 'boundary', 'disagreement', 'image-quality', 'all']) {
    await evaluate(`document.querySelector('[data-filter="${filter}"]').click()`);
    assert.deepEqual(await ids(), filteredCases(sortedCases(cases, 'review'), filter).map(c => c.id));
    assert.equal(await evaluate(`document.querySelector('.case[aria-pressed="true"]').dataset.id === document.querySelector('.detail-hero h2').textContent`), true);
    assert.equal(await evaluate(`document.querySelector('#visibleCount').textContent`), '10');
  }
  for (const item of cases) {
    await evaluate(`document.querySelector('[data-id="${item.id}"]').click()`);
    assert.equal(await evaluate(`document.querySelector('.detail-hero h2').textContent`), item.id);
    assert.equal(await evaluate(`document.activeElement.id`), 'selectedCaseTitle');
    const detail = await evaluate(`document.querySelector('#detailPanel').textContent`);
    for (const reason of item.reasons) assert.ok(detail.includes(reason));
    assert.match(detail, /확인할 항목/);
    assert.match(detail, /합성 신호/);
    assert.match(detail, /확률 아님/);
    assert.match(detail, /공통 실패/);
  }
  assert.equal(await evaluate(`document.querySelectorAll('.real-case').length`), 0, 'reference assets load only after the dialog opens');
  await evaluate(`document.querySelector('#openRealCt').focus(); document.querySelector('#openRealCt').click()`);
  assert.equal(await evaluate(`document.querySelector('#realCtDialog').open`), true);
  assert.match(await evaluate(`document.querySelector('#realCtDialog').textContent`), /현재 선택한 합성 사례의 영상이 아닙니다/);
  assert.equal(await evaluate(`document.querySelector('#ctCanvas') === null`), true);
  await evaluate(`new Promise((resolve, reject) => {
    const done = () => document.querySelector('#realCtSection').classList.contains('loaded') && document.querySelector('#realCtImage').naturalWidth > 0;
    if (done()) return resolve(true);
    const started = performance.now();
    const timer = setInterval(() => {
      if (done()) { clearInterval(timer); resolve(true); }
      else if (performance.now() - started > 5000) { clearInterval(timer); reject(new Error('CT fixture did not load')); }
    }, 20);
  })`);
  assert.equal(await evaluate(`document.querySelectorAll('.real-case').length`), 3);
  assert.equal(await evaluate(`document.querySelector('#realCtImage').naturalWidth`), useValidatedLocalAssets ? 512 : 1);
  await evaluate(`document.querySelector('#realSliceSlider').value = '0'; document.querySelector('#realSliceSlider').dispatchEvent(new Event('input'))`);
  assert.equal(await evaluate(`document.querySelector('#realPreviousSlice').disabled`), true);
  await evaluate(`document.querySelector('#realNextSlice').click()`);
  assert.equal(await evaluate(`document.querySelector('#realSliceSlider').value`), '1');
  await evaluate(`document.querySelector('#realCtImage').dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true, cancelable:true }))`);
  assert.equal(await evaluate(`document.querySelector('#realSliceSlider').value`), '2');
  await evaluate(`document.querySelector('#realImageFrame').dispatchEvent(new WheelEvent('wheel', { deltaY:100, bubbles:true, cancelable:true }))`);
  assert.equal(await evaluate(`document.querySelector('#realSliceSlider').value`), '3');
  await evaluate(`document.querySelector('#realOverlayToggle').click()`);
  assert.equal(await evaluate(`document.querySelector('#realOverlayToggle').getAttribute('aria-pressed')`), 'false');
  await evaluate(`document.querySelector('#realSliceSlider').value = '23'; document.querySelector('#realSliceSlider').dispatchEvent(new Event('input'))`);
  assert.equal(await evaluate(`document.querySelector('#realNextSlice').disabled`), true);
  await evaluate(`document.querySelector('#closeRealCt').click()`);
  assert.equal(await evaluate(`document.querySelector('#realCtDialog').open`), false);
  assert.equal(await evaluate(`document.activeElement.id`), 'openRealCt');
  for (const width of [390, 800, 1280, 1440]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`scrollTo(0, 0); new Promise(resolve => requestAnimationFrame(resolve))`);
    if (process.env.LESIONLENS_SCREENSHOTS) {
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      const file = path.join(os.tmpdir(), `lesionlens-${width}.png`);
      fs.writeFileSync(file, Buffer.from(screenshot.data, 'base64'));
      t.diagnostic(`Screenshot: ${file}`);
    }
    const overflow = await evaluate(`Array.from(document.querySelectorAll('main, .workspace, .queue-panel, .case, .detail-panel, .section-head')).filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className || el.tagName)`);
    assert.deepEqual(overflow, [], `Overflow at ${width}px`);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `Page overflow at ${width}px`);
    assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.reason-tag')).whiteSpace`), 'nowrap', `Reasons must wrap at ${width}px`);
    await evaluate(`document.querySelector('.case').scrollIntoView({ block: 'center' })`);
    const cardPoint = await evaluate(`(() => { const r = document.querySelector('.case').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...cardPoint, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...cardPoint, button: 'left', clickCount: 1 });
    assert.equal(await evaluate(`(() => { const r = document.querySelector('#selectedCaseTitle').getBoundingClientRect(); return r.top >= 76 && r.top <= innerHeight; })()`), true, `Rationale detail comes into view at ${width}px`);
  }
  assert.deepEqual(errors, []);

});
