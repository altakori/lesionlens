"""LOCAL DEMO send/view E2E using intercepted synthetic fixtures only.
Run with existing Windows Playwright + localhost:4173; no source CT reads/downloads.
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
    options = {'headless':True}
    if os.environ.get('CHROME_EXECUTABLE'):
        options['executable_path'] = os.environ['CHROME_EXECUTABLE']
    browser = p.chromium.launch(**options)
    context = browser.new_context()
    page = context.new_page()
    manifest_text = json.dumps(manifest_fixture(), separators=(',', ':'))
    original_manifest = manifest_text
    images, external, errors = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def requests(request):
        if urlsplit(request.url).hostname not in ('127.0.0.1', 'localhost'):
            external.append(request.url)
    page.on('request', requests)

    def data(route):
        path = urlsplit(route.request.url).path
        if path == '/data/model_compare/manifest.json':
            route.fulfill(status=200, content_type='application/json', body=manifest_text)
        elif path.startswith('/data/model_compare/web/'):
            images.append(path)
            # These are clearly synthetic test pixels, not copied source assets.
            route.fulfill(status=200, content_type='image/png', body=CT if '/ct/' in path else MASK)
        else:
            route.fulfill(status=404, body='Synthetic fixture: unavailable')
    page.route('**/*', lambda route: route.continue_() if urlsplit(route.request.url).hostname in ('127.0.0.1','localhost') else route.abort('blockedbyclient'))
    page.route('**/data/**', data)

    def queue():
        page.goto(BASE)
        page.locator('[data-case-id="DEMO-WORKFLOW-001"]').wait_for()
        page.locator('#mdFilter').select_option('all')

    def modal(cid):
        card=page.locator(f'[data-case-id="{cid}"]')
        card.get_by_role('button', name='주치의에게 전송하기', exact=True).click()
        dialog=page.locator('#mdSendDialog')
        expect(dialog.get_by_role('button', name='보내기 불가 · 수신 담당자 미연결')).to_be_disabled()
        return dialog

    def records():
        return page.evaluate('''() => {
          const key=Object.keys(localStorage).find(k=>k.startsWith('lesionlens:md:v1:'));
          return key ? JSON.parse(localStorage.getItem(key)) : {sends:{},reviews:{},drafts:{}};
        }''')

    queue()
    page.get_by_role('link', name='보낸 사례', exact=True).click()
    expect(page.locator('.md-inbox-empty')).to_contain_text('보낸 로컬 사례가 없습니다')
    page.get_by_role('link', name='검토 목록으로', exact=True).click()
    page.locator('[data-case-id="case_000"]').wait_for()
    dialog=modal('case_000')
    dialog.locator('.md-demo-opt-in input').check()
    dialog.locator('textarea').fill('SYNTHETIC cancellation')
    dialog.get_by_role('button', name='전송 취소 및 닫기', exact=True).click()
    dialog.get_by_role('button', name='폐기하고 닫기', exact=True).click()
    assert records()['sends']=={} and records()['reviews']=={}

    # Consent is fresh per opening; choosing models alone never authorizes send.
    dialog=modal('case_000')
    dialog.get_by_label('CAPPY2 current', exact=True).check()
    dialog.get_by_label('CAPPY2 050', exact=True).check()
    expect(dialog.get_by_role('button', name='보내기 불가 · 수신 담당자 미연결')).to_be_disabled()
    dialog.locator('textarea').fill('SYNTHETIC selected-model memo')
    dialog.locator('.md-demo-opt-in input').check()
    submit=dialog.get_by_role('button', name='LOCAL DEMO 보내기', exact=True)
    expect(submit).to_be_enabled()
    page.evaluate("() => { window.originalSet=Storage.prototype.setItem; Storage.prototype.setItem=function(){throw Error('test quota')}; }")
    submit.click()
    expect(dialog).to_be_visible()
    expect(dialog.locator('textarea')).to_have_value('SYNTHETIC selected-model memo')
    assert records()['sends']=={} and records()['reviews']=={}
    assert records()['drafts']['case_000']['selected']==['cappyv2','cp050']
    page.evaluate('() => { Storage.prototype.setItem=window.originalSet; }')
    submit.click()
    expect(dialog).not_to_be_visible()
    snapshot=records()
    assert len(snapshot['sends'])==1 and snapshot['reviews']['case_000'] is True
    record=next(iter(snapshot['sends'].values()))
    assert record['mode']=='LOCAL_DEMO' and record['dataKind']=='research-ct'
    assert 'mapping' not in record['case'] and 'synthetic' not in record['case']
    assert record['recipient']['patientMapping'] is None and 'patientId' not in record['recipient']
    assert record['evidence'] is None
    assert record['binding']['manifestSha256']==hashlib.sha256(original_manifest.encode()).hexdigest()
    page.get_by_role('link', name='보낸 사례 상세 보기', exact=True).click()
    expect(page.locator('#recipientTitle')).to_have_text('보낸 사례 · LOCAL DEMO')
    expect(page.locator('.md-record-detail')).to_have_attribute('data-record-id', record['id'])
    expect(page.locator('.md-record-detail')).to_have_attribute('data-scope', record['scope'])
    sent_url=page.url
    query=parse_qs(urlsplit(sent_url).fragment)
    assert query['record']==[record['id']] and query['mode']==['sent']
    assert query['scope']==[record['scope']]
    expect(page.locator('.md-record-memo')).to_contain_text('SYNTHETIC selected-model memo')
    assert images==[]  # Both sent/inbox details mount CT only on explicit view.
    page.get_by_role('button', name='전달 CT 보기', exact=True).click()
    detail=page.locator('.md-record-detail')
    expect(detail).to_have_attribute('data-binding-state','verified')
    expect(page.locator('.md-received-viewer')).to_have_attribute('data-load-state','ready')
    assert page.locator('.md-image-panel').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.source)')==['cappyv2','cp050']
    assert all('/ct/' in path or '/cappyv2/' in path or '/cp050/' in path for path in images)
    images.clear()
    page.reload()
    expect(page.locator('.md-record-memo')).to_contain_text('SYNTHETIC selected-model memo')
    assert images==[] and page.locator('canvas').count()==0
    page.get_by_role('link', name='수신 화면에서 이 기록 보기', exact=True).click()
    # Hash URL changes precede hashchange rendering; wait for the inbox view,
    # not the previous sender detail (which has the same record identity).
    inbox_query={'mode':'inbox','scope':record['scope'],'record':record['id']}
    expect(page).to_have_url(BASE+'/recipient.html#'+urlencode(inbox_query))
    expect(page.locator('#recipientTitle')).to_have_text('수신함 · LOCAL DEMO')
    expect(page.locator('.md-record-detail')).to_have_attribute('data-record-id',record['id'])
    expect(page.locator('.md-record-detail')).to_have_attribute('data-scope',record['scope'])
    assert parse_qs(urlsplit(page.url).fragment)=={key:[value] for key,value in inbox_query.items()}
    expect(page.locator('textarea')).to_have_count(0)
    page.get_by_role('button', name='수신 확인 (진료 판단 아님)', exact=True).click()
    page.reload()
    expect(page.get_by_role('button', name='수신 확인됨', exact=False)).to_be_disabled()
    page.get_by_role('link', name='보낸 사례', exact=True).click()
    expect(page).to_have_url(BASE+'/recipient.html#mode=sent')
    expect(page.locator('#recipientTitle')).to_have_text('보낸 사례 · LOCAL DEMO')
    expect(page.locator('.md-inbox-list')).to_be_visible()
    expect(page.locator('.md-record-detail')).to_have_count(0)
    items=page.locator('.md-inbox-item')
    expect(items).to_have_count(1)
    expect(items).to_have_attribute('data-record-id',record['id'])
    expect(items).to_have_attribute('data-scope',record['scope'])
    expected_href='recipient.html#'+urlencode({'mode':'sent','scope':record['scope'],'record':record['id']})
    expect(items.locator('.md-record-link')).to_have_attribute('href',expected_href)

    # A research case may also send no model references; no GT is substituted.
    queue()
    dialog=modal('case_001')
    expect(dialog.get_by_label('모델 참고 없음', exact=True)).to_be_checked()
    dialog.locator('.md-demo-opt-in input').check()
    dialog.locator('textarea').fill('SYNTHETIC CT only memo')
    dialog.get_by_role('button', name='LOCAL DEMO 보내기', exact=True).click()
    page.get_by_role('link', name='보낸 사례 상세 보기', exact=True).click()
    images.clear()
    page.get_by_role('button', name='전달 CT 보기', exact=True).click()
    expect(page.locator('.md-received-viewer')).to_have_attribute('data-load-state','ready')
    assert page.locator('.md-image-panel').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.source)')==['ct']
    assert images and all('/ct/' in path for path in images)

    queue()
    dialog=modal('case_045')
    for name in ('CAPPY2 current','CAPPY2 050','Baseline'):
        expect(dialog.get_by_label(name,exact=True)).to_be_disabled()
    dialog.get_by_role('button', name='취소', exact=True).click()

    # Changed live canonical digest blocks all image requests; historical memo remains.
    manifest_text=original_manifest+' '
    page.goto(sent_url)
    images.clear()
    page.get_by_role('button', name='전달 CT 보기', exact=True).click()
    expect(page.locator('.md-record-detail')).to_have_attribute('data-binding-state','mismatch')
    assert images==[] and page.locator('canvas').count()==0
    expect(page.locator('.md-record-memo')).to_contain_text('SYNTHETIC selected-model memo')
    manifest_text=original_manifest
    page.evaluate('''({scope,id})=>{
      const key='lesionlens:md:v1:'+scope,state=JSON.parse(localStorage.getItem(key));
      state.sends[id].case.slices[0].ct='https://external.invalid/forged';
      localStorage.setItem(key,JSON.stringify(state));
    }''', {'scope':record['scope'],'id':record['id']})
    page.reload()
    page.get_by_role('button', name='전달 CT 보기', exact=True).click()
    expect(page.locator('.md-record-detail')).to_have_attribute('data-binding-state','mismatch')
    assert images==[] and page.locator('canvas').count()==0
    expect(page.locator('.md-record-memo')).to_contain_text('SYNTHETIC selected-model memo')
    assert external==[] and errors==[], (external,errors)
    context.close()
    browser.close()
print('Research LOCAL DEMO send/exact sent-detail/inbox/binding synthetic E2E passed')
