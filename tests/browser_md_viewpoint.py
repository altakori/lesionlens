"""LOCAL DEMO send/view E2E using intercepted synthetic fixtures only.
Run with Playwright + localhost:4173; no source CT reads/downloads.
"""
import hashlib
import json
import os
import struct
import zlib
from urllib.parse import urlsplit, parse_qs, urlencode
from playwright.sync_api import expect, sync_playwright


def png(rgba):
    def chunk(kind, body):
        return struct.pack('!I', len(body)) + kind + body + struct.pack('!I', zlib.crc32(kind + body) & 0xffffffff)
    row = b'\0' + bytes(rgba) * 2
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 2,2,8,6,0,0,0)) + chunk(b'IDAT', zlib.compress(row * 2)) + chunk(b'IEND', b'')


CT = png((90,90,90,255))
MASK = png((0,255,230,120))


def manifest_fixture():
    # Fixed production schema, entirely synthetic metadata/pixels for UI tests.
    specs = [('case_000',75,2591),('case_001',123,7194),('case_035',124,20318),('case_045',74,4539),('case_048',244,35478)]
    models = ['baseline','cappyv2','cp050']
    counts_by_case = {'case_000':[2359,2483,2517],'case_001':[9499,9968,10472],'case_035':[31587,8885,72907],'case_048':[29641,30044,30495]}
    cases = []
    for cid,depth,gt in specs:
        counts = {'gt':gt, **dict(zip(models, counts_by_case.get(cid, [])))}
        stats = {k:{'voxels':n,'volumeMl':n*.002,'componentCount':1,'componentVolumesMl':[n*.002],'positiveSliceCount':1,'sliceSpan':[3,3]} for k,n in counts.items()}
        rows = []
        for z in range(depth):
            base = f'data/model_compare/web/{cid}'
            rows.append({'index':z+1,'canonicalSlice':z,'width':512,'height':512,'gtPixels':gt if z==2 else 0,
                         'ct':f'{base}/ct/{z+1:03d}.webp','ctSha256':hashlib.sha256(CT).hexdigest(),
                         'overlays':{k:{'path':f'{base}/{k}/{z+1:03d}.png','sha256':hashlib.sha256(MASK).hexdigest()} for k in counts},
                         'pixels':{k:n if z==2 else 0 for k,n in counts.items()}})
        cases.append({'id':cid,'sourceCaseId':cid,'sliceCount':depth,'dimensions':[512,512,depth],'spacing':[1,1,2],
                      'tumorVolumeMl':gt*.002,'defaultSlice':2,'gt':stats['gt'],'models':{k:v for k,v in stats.items() if k!='gt'},
                      'disagreement':None if cid=='case_045' else {'intersectionVoxels':0,'unionVoxels':sum(counts_by_case[cid]),'score':1},'slices':rows})
    return {'version':'lits-model-compare-v1','localOnly':True,'caseCount':5,'windowHu':[-150,250],'cases':cases}


BASE = 'http://127.0.0.1:4173'
with sync_playwright() as p:
    options = {'headless': True}
    if os.environ.get('CHROME_EXECUTABLE'):
        options['executable_path'] = os.environ['CHROME_EXECUTABLE']
    browser = p.chromium.launch(**options)
    page = browser.new_page()
    page.set_default_timeout(10000)
    page.set_default_navigation_timeout(15000)
    errors, external, held = [], [], []
    delay = False
    hold_initial = False
    text = json.dumps(manifest_fixture(), separators=(',', ':'))
    page.on('pageerror', lambda e: errors.append(str(e)))
    def guard(route):
        if urlsplit(route.request.url).hostname in ('localhost', '127.0.0.1'):
            route.continue_()
        else:
            external.append(route.request.url)
            route.abort()
    def fulfill(route):
        route.fulfill(status=200, content_type='image/png', body=CT if '/ct/' in route.request.url else MASK)
    def data(route):
        path = urlsplit(route.request.url).path
        if path.endswith('/manifest.json'):
            route.fulfill(status=200, content_type='application/json', body=text)
        elif '/web/' in path:
            if hold_initial and '/case_035/' in path and (path.endswith('/001.webp') or path.endswith('/001.png')):
                held.append(route)
            elif delay and (path.endswith('/006.webp') or path.endswith('/006.png') or path.endswith('/007.webp') or path.endswith('/007.png')):
                held.append(route)
            else:
                fulfill(route)
        else:
            route.fulfill(status=404, body='Synthetic unavailable')
    page.route('**/*', guard)
    page.route('**/data/**', data)
    def queue():
        page.goto(BASE)
        page.locator('[data-case-id="DEMO-WORKFLOW-001"]').wait_for()
        page.locator('#mdFilter').select_option('all')
    def modal(cid):
        page.locator(f'.md-case-card[data-case-id="{cid}"]').get_by_role('button', name='주치의에게 전송하기', exact=True).click()
        d=page.locator('#mdSendDialog')
        expect(d.locator('.md-send-submit')).to_be_disabled()
        return d
    def saved():
        return page.evaluate("() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('lesionlens:md:v1:'))))")
    def ready(host, z):
        expect(host).to_have_attribute('data-load-state','ready')
        expect(host).to_have_attribute('data-slice',str(z))
    queue()
    # Absent viewer cannot attach; basic + none preserves original default behavior.
    d=modal('case_001')
    expect(d.locator('[value="basic"]')).to_be_checked()
    expect(d.locator('[value="attached"]')).to_be_disabled()
    d.locator('.md-demo-opt-in input').check()
    d.locator('.md-send-submit').click()
    page.get_by_role('link',name='보낸 사례 상세 보기',exact=True).click()
    page.locator('.md-record-ct-button').click()
    host=page.locator('.md-received-viewer');ready(host,0)
    expect(host.locator('.md-image-panel')).to_have_count(1)
    expect(host.locator('.md-image-panel')).to_have_attribute('data-source','ct')
    assert next(iter(saved()['sends'].values()))['viewpoint'] is None

    queue()
    card=page.locator('.md-case-card[data-case-id="case_000"]')
    card.get_by_role('button',name='CT 확대',exact=True).click()
    host=card.locator('.md-inline-viewer');ready(host,0)
    sliders=host.locator('input[type=range]')
    sliders.nth(0).fill('2');ready(host,2)
    sliders.nth(1).fill('2');sliders.nth(2).fill('1.5')
    host.locator('canvas').first.press('Shift+ArrowRight')
    host.locator('[data-overlay-mode=outline]').click()
    host.locator('.md-overlay-eye').click()
    delay=True
    sliders.nth(0).fill('5');sliders.nth(0).fill('6')
    expect(host).to_have_attribute('data-pending-slice','6')
    expect(host).to_have_attribute('data-slice','2')
    d=modal('case_000')
    expect(d.locator('.md-viewpoint-status')).to_contain_text('현재 표시 3 / 75')
    expect(d.locator('.md-viewpoint-status')).to_contain_text('요청 7 불러오는 중')
    expect(d.locator('[value="attached"]')).to_be_checked()
    d.get_by_label('CAPPY2 current',exact=True).check()
    d.get_by_label('CAPPY2 050',exact=True).check()
    d.locator('textarea').fill('SYNTHETIC viewpoint memo')
    v=saved()['drafts']['case_000']['viewpoint']
    assert (v['slice'],v['zoom'],v['panX'],v['contrast'],v['overlayMode'],v['overlayVisible']) == (2,2,10,1.5,'outline',False)
    d.get_by_role('button',name='취소',exact=True).click()
    d.get_by_role('button',name='초안 보관하고 닫기',exact=True).click()
    delay=False
    for route in held:
        try:
            fulfill(route)
        except Exception:
            pass  # Superseded requests may already be canceled by the viewer.
    held.clear()
    ready(host,6)
    d=modal('case_000')
    expect(d.locator('[value="attached"]')).to_be_checked()
    expect(d.locator('.md-viewpoint-status')).to_contain_text('첨부 절편 3')
    d.locator('.md-demo-opt-in input').check()
    page.evaluate("() => { window.originalSet=Storage.prototype.setItem; Storage.prototype.setItem=function(){throw Error('synthetic quota');}; }")
    d.locator('.md-send-submit').click()
    expect(d.get_by_role('alert')).to_contain_text('전송 저장 실패')
    assert saved()['drafts']['case_000']['viewpoint']==v
    page.evaluate("() => { Storage.prototype.setItem=window.originalSet; }")
    d.locator('.md-send-submit').click()
    page.get_by_role('link',name='보낸 사례 상세 보기',exact=True).click()
    expect(page.locator('.md-record-detail')).to_be_visible()
    record=next(r for r in saved()['sends'].values() if r['case']['id']=='case_000')
    assert record['viewpoint']==v
    for reload in (False,True):
        if reload:
            page.reload()
        host=page.locator('.md-received-viewer');ready(host,2)
        expect(host).to_have_attribute('data-zoom','2')
        expect(host).to_have_attribute('data-pan-x','10')
        expect(host).to_have_attribute('data-contrast','1.5')
        expect(host).to_have_attribute('data-overlay-mode','outline')
        expect(host).to_have_attribute('data-overlay-visible','false')
        assert host.locator('.md-image-panel').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.source)')==['cappyv2','cp050']
        for mode in ('seg','outline','box'):
            host.locator(f'[data-overlay-mode="{mode}"]').click()
            host.locator('.md-overlay-eye').click();host.locator('.md-overlay-eye').click()
            expect(host).to_have_attribute('data-overlay-mode',mode)
        host.get_by_role('button',name='위치 초기화',exact=True).click()
        expect(host).to_have_attribute('data-zoom','1')
        host.locator('input[type=range]').first.fill('4');ready(host,4)
        assert saved()['sends'][record['id']]['viewpoint']==v
    page.locator('.md-record-receiver-link').click()
    expect(page.locator('#recipientTitle')).to_have_text('수신함 · LOCAL DEMO')
    ready(page.locator('.md-received-viewer'),2)
    # Invalid persisted view fails closed despite valid canonical manifest; memo remains.
    page.evaluate("""id => {const k=Object.keys(localStorage).find(k=>k.startsWith('lesionlens:md:v1:')); const s=JSON.parse(localStorage.getItem(k));s.sends[id].viewpoint.slice=99999;localStorage.setItem(k,JSON.stringify(s));} """,record['id'])
    page.reload()
    expect(page.locator('.md-record-detail')).to_have_attribute('data-binding-state','mismatch')
    expect(page.locator('.md-received-viewer canvas')).to_have_count(0)
    expect(page.locator('.md-record-memo')).to_contain_text('SYNTHETIC viewpoint memo')
    # An attached viewpoint with explicit none still has one CT-only panel.
    queue()
    card=page.locator('.md-case-card[data-case-id="case_001"]')
    card.get_by_role('button',name='CT 확대',exact=True).click()
    host=card.locator('.md-inline-viewer');ready(host,0)
    host.locator('input[type=range]').first.fill('3');ready(host,3)
    d=modal('case_001');expect(d.locator('[value="attached"]')).to_be_checked()
    expect(d.get_by_label('모델 참고 없음',exact=True)).to_be_checked()
    d.locator('.md-demo-opt-in input').check();d.locator('.md-send-submit').click()
    page.get_by_role('link',name='보낸 사례 상세 보기',exact=True).click()
    host=page.locator('.md-received-viewer');ready(host,3)
    expect(host.locator('.md-image-panel')).to_have_count(1)
    expect(host.locator('.md-image-panel')).to_have_attribute('data-source','ct')
    # An initially unloaded viewer has no invented frame. The first complete
    # frame attaches automatically; explicit basic survives unrelated edits/reopen.
    queue()
    hold_initial=True
    card=page.locator('.md-case-card[data-case-id="case_035"]')
    card.get_by_role('button',name='CT 확대',exact=True).click()
    host=card.locator('.md-inline-viewer')
    expect(host).to_have_attribute('data-load-state','loading')
    expect(host).to_have_attribute('data-slice','')
    d=modal('case_035')
    expect(d.locator('[value="attached"]')).to_be_disabled()
    d.locator('textarea').fill('SYNTHETIC initial loading')
    assert saved()['drafts']['case_035'].get('viewpoint') is None
    hold_initial=False
    for route in held:
        fulfill(route)
    held.clear()
    ready(host,0)
    expect(d.locator('[value="attached"]')).to_be_checked()
    assert saved()['drafts']['case_035']['viewpoint']['slice']==0
    d.locator('[value="basic"]').check()
    d.get_by_label('CAPPY2 current',exact=True).check()
    d.locator('.md-demo-opt-in input').check()
    d.get_by_role('button',name='취소',exact=True).click()
    d.get_by_role('button',name='초안 보관하고 닫기',exact=True).click()
    host.locator('input[type=range]').first.fill('3');ready(host,3)
    d=modal('case_035')
    expect(d.locator('[value="basic"]')).to_be_checked()
    d.locator('textarea').fill('SYNTHETIC explicit basic')
    d.locator('.md-demo-opt-in input').check()
    d.locator('.md-send-submit').click()
    page.get_by_role('link',name='보낸 사례 상세 보기',exact=True).click()
    basic_record=next(r for r in saved()['sends'].values() if r['case']['id']=='case_035')
    assert basic_record['viewpoint'] is None
    expect(page.locator('.md-received-viewer canvas')).to_have_count(0)
    page.locator('.md-record-ct-button').click()
    ready(page.locator('.md-received-viewer'),0)
    assert not errors, errors
    assert not external, external
    browser.close()
    print('PASS synthetic sender viewpoint capture/persistence/restore/fail-closed')
