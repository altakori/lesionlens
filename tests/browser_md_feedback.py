"""Run against local integrated server, no downloads: python3 tests/browser_md_feedback.py."""
import os
import re
from playwright.sync_api import expect, sync_playwright

# Comparison runs launch the same suite against a second port.
BASE = os.environ.get('LESIONLENS_BASE_URL', 'http://127.0.0.1:4173')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path':os.environ['CHROME_EXECUTABLE']} if os.environ.get('CHROME_EXECUTABLE') else {}))
    page = browser.new_page()
    page.goto(f'{BASE}/')
    page.locator('[data-case-id="DEMO-WORKFLOW-001"]').wait_for()
    page.evaluate('localStorage.clear()')
    page.reload()
    card = page.locator('[data-case-id="DEMO-WORKFLOW-001"]')
    card.wait_for()
    real = page.locator('[data-case-id="case_000"]')
    if real.count():
        real.get_by_role('button', name='주치의에게 전송하기').click()
        blocked = page.locator('#mdSendDialog')
        assert blocked.get_by_role('button', name='보내기 불가 · 수신 담당자 미연결').is_disabled()
        blocked.get_by_label('CAPPY2 current', exact=True).check()
        blocked.get_by_label('CAPPY2 050', exact=True).check()
        assert not blocked.get_by_label('모델 참고 없음', exact=True).is_checked()
        blocked.get_by_label('기타(직접 입력)', exact=True).check()
        blocked.locator('textarea').fill('SYNTHETIC local draft only')
        page.keyboard.press('Escape')
        blocked.get_by_role('button', name='초안 보관하고 닫기').click()
        real.get_by_role('button', name='주치의에게 전송하기').click()
        assert blocked.locator('textarea').input_value() == 'SYNTHETIC local draft only'
        assert blocked.get_by_label('CAPPY2 current', exact=True).is_checked()
        blocked.get_by_label('모델 참고 없음', exact=True).check()
        assert not blocked.get_by_label('CAPPY2 current', exact=True).is_checked()
        # None cannot be unchecked when no reference model is selected.
        blocked.get_by_label('모델 참고 없음', exact=True).click()
        assert blocked.get_by_label('모델 참고 없음', exact=True).is_checked()
        assert blocked.get_by_role('button', name='보내기 불가 · 수신 담당자 미연결').is_disabled()
        page.keyboard.press('Escape')
        blocked.get_by_role('button', name='폐기하고 닫기').click()
    card.get_by_role('button', name='CT 확대', exact=True).click()
    assert card.locator('canvas').count() == 4
    assert page.locator('dialog[open]').count() == 0
    card.get_by_role('button', name='주치의에게 전송하기').click()
    dialog = page.locator('#mdSendDialog')
    assert dialog.locator('input[type=checkbox]:disabled').count() == 3
    # The MD opinion must start untouched: no radio preselects, no AI guess.
    assert dialog.locator('fieldset.md-followup input[type=radio]:checked').count() == 0
    assert dialog.get_by_text('메모에 원하는 후속조치를 직접 적어주세요.').is_hidden()
    # The pre-opinion group also starts blank, and its caveat states the limit.
    assert dialog.locator('fieldset.md-precheck input[type=radio]:checked').count() == 0
    assert dialog.locator('.md-precheck-clear').is_disabled()
    assert dialog.get_by_text('이 창은 재검토 목록의 모델 불일치 신호를 이미 표시합니다').is_visible()
    dialog.get_by_label('기타(직접 입력)', exact=True).check()
    assert dialog.get_by_text('메모에 원하는 후속조치를 직접 적어주세요.').is_visible()
    dialog.get_by_label('단기 추적검사', exact=True).check()
    assert not dialog.get_by_label('기타(직접 입력)', exact=True).is_checked()
    assert dialog.get_by_text('메모에 원하는 후속조치를 직접 적어주세요.').is_hidden()
    dialog.get_by_label('재확인 필요', exact=True).check()
    assert not dialog.locator('.md-precheck-clear').is_disabled()
    dialog.get_by_role('button', name='미작성으로 되돌리기').click()
    assert dialog.locator('fieldset.md-precheck input[type=radio]:checked').count() == 0
    assert dialog.locator('.md-precheck-clear').is_disabled()
    dialog.get_by_label('판단 유보', exact=True).check()
    dialog.get_by_label('재확인 필요', exact=True).check()
    assert dialog.locator('.md-viewpoint-options [value=attached]').is_disabled()
    # Free text is only shown for '기타'; switch back so the stored opinion stays short-term.
    dialog.get_by_label('기타(직접 입력)', exact=True).check()
    dialog.locator('textarea').fill('SYNTHETIC browser note')
    dialog.get_by_label('단기 추적검사', exact=True).check()
    page.keyboard.press('Escape')
    dialog.get_by_role('button', name='초안 보관하고 닫기').click()
    # Reopen a pre-fix malformed draft after reload. Notes/token must survive;
    # invalid empty/non-none must be normalized before display and resaved.
    draft_id = page.evaluate('''() => {
      const key=Object.keys(localStorage).find(k=>k.startsWith('lesionlens:md:v1:'));
      const state=JSON.parse(localStorage.getItem(key));
      const draft=state.drafts['DEMO-WORKFLOW-001'];
      draft.selected=[]; draft.none=false;
      localStorage.setItem(key,JSON.stringify(state));
      return draft.id;
    }''')
    page.reload()
    card.wait_for()
    card.get_by_role('button', name='주치의에게 전송하기').click()
    assert dialog.locator('textarea').input_value() == 'SYNTHETIC browser note'
    none = dialog.get_by_label('모델 참고 없음', exact=True)
    assert none.is_checked()
    none.click()  # Native checkbox would uncheck; the invariant restores it.
    assert none.is_checked()
    assert dialog.get_by_role('button', name='DEMO 보내기', exact=True).is_enabled()
    restored = page.evaluate('''() => {
      const key=Object.keys(localStorage).find(k=>k.startsWith('lesionlens:md:v1:'));
      return JSON.parse(localStorage.getItem(key)).drafts['DEMO-WORKFLOW-001'];
    }''')
    # Automatic intent survives normalization; this synthetic case has no viewpoint.
    assert restored == {'id':draft_id,'notes':'SYNTHETIC browser note','selected':[],'none':True,'viewpointChoice':'auto','followup':'short_term_followup','precheck':'recheck_needed'}
    page.keyboard.press('Escape')
    dialog.get_by_role('button', name='계속 작성').click()
    # Throw before persistence: failed send must leave draft and case pending.
    page.evaluate("() => { window.originalSet = Storage.prototype.setItem; Storage.prototype.setItem = function(){throw Error('test quota')}; }")
    dialog.get_by_role('button', name='DEMO 보내기', exact=True).click()
    assert dialog.is_visible()
    assert dialog.locator('textarea').input_value() == 'SYNTHETIC browser note'
    assert page.evaluate("Object.keys(JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('lesionlens:md:v1:')))).sends).length") == 0
    page.evaluate('() => { Storage.prototype.setItem = window.originalSet; }')
    dialog.get_by_role('button', name='DEMO 보내기', exact=True).click()
    assert not dialog.is_visible()
    assert page.locator('[data-case-id="DEMO-WORKFLOW-001"]').count() == 0
    page.reload()
    page.locator('#mdFilter').select_option('sent')
    page.locator('[data-case-id="DEMO-WORKFLOW-001"]').wait_for()
    page.goto(f'{BASE}/recipient.html')
    page.get_by_role('link', name='상세 보기', exact=True).first.click()
    page.locator('.md-record-memo').get_by_text('SYNTHETIC browser note', exact=True).wait_for()
    # Pre-opinion and opinion type are the first things the receiving clinician reads.
    assert page.locator('.md-record-precheck').inner_text() == '사전 의견(참고) · 재확인 필요'
    assert page.locator('.md-record-followup').inner_text() == '의견 유형 · 단기 추적검사'
    page.get_by_role('button', name='수신 확인 (진료 판단 아님)').click()
    page.reload()
    assert page.get_by_role('button', name='수신 확인됨', exact=False).is_disabled()
    page.goto(f'{BASE}/')
    page.locator('#mdFilter').select_option('sent')
    page.get_by_role('button', name='다시 검토', exact=True).click()
    page.locator('#mdFilter').select_option('pending')
    page.locator('[data-case-id="DEMO-WORKFLOW-001"]').wait_for()
    real = page.locator('[data-case-id="case_000"]')
    if real.count():
        real.get_by_role('button',name='CT 확대',exact=True).click()
        viewer=real.locator('.md-inline-viewer')
        assert viewer.locator('canvas').count()==4
        assert page.locator('dialog[open]').count()==0
        modes=viewer.get_by_role('group',name='동시 오버레이 방식')
        assert modes.get_by_role('button').count()==3
        assert viewer.locator('select').count()==0
        eye=viewer.get_by_role('button',name='모든 패널 오버레이 표시',exact=True)
        assert eye.inner_text()==''
        assert eye.locator('svg[aria-hidden="true"]').count()==1
        for mode,label in [('outline','테두리'),('box','박스'),('seg','seg 마스크')]:
            button=modes.get_by_role('button',name=label,exact=True)
            button.focus()
            button.press('Enter')
            assert button.get_attribute('aria-pressed')=='true'
            assert modes.locator('button[aria-pressed="true"]').count()==1
            eye.focus()
            eye.press('Space')
            assert eye.get_attribute('aria-pressed')=='false'
            assert viewer.get_attribute('data-overlay-visible')=='false'
            eye.press('Enter')
            assert eye.get_attribute('aria-pressed')=='true'
            assert viewer.get_attribute('data-overlay-visible')=='true'
            assert viewer.get_attribute('data-overlay-mode')==mode
            assert button.get_attribute('aria-pressed')=='true'
        viewer.get_by_label('공통 절편',exact=True).fill('1')
        # The requested slice becomes displayed only after atomic frame commit.
        expect(viewer).to_have_attribute('data-load-state', 'ready')
        expect(viewer).to_have_attribute('data-slice', '1')
        assert viewer.get_attribute('data-slice')=='1'
        assert viewer.locator('canvas[data-slice="1"]').count()==4
        viewer.locator('canvas').first.press('Shift+ArrowRight')
        assert viewer.get_attribute('data-pan-x')=='10'
        viewer.get_by_label('공통 확대',exact=True).fill('2')
        assert viewer.get_attribute('data-zoom')=='2'
        real.get_by_role('button',name='CT 접기',exact=True).click()
        assert viewer.locator('canvas').count()==0
    # Review shortcuts on a real research case: candidate rows collapse, a biopsy opinion
    # names its target, free text only opens for '기타', and the visit state is a demo value.
    if real.count():
        real.get_by_role('button', name='CT 확대', exact=True).click()
        inline = real.locator('.md-inline-viewer')
        assert inline.locator('canvas').count() == 4
        # A per-case study strip sits beside the reading controls. Identity comes from the
        # image sha256 receipt, so it names one study, invents no patient and no date, and
        # shows an alias of the same acquisition as text instead of a second viewer.
        strip = real.locator('.md-series')
        strip_text = strip.inner_text()
        assert strip.is_visible()
        assert '이 검사 1건' in strip_text and 'image sha256' in strip_text
        assert 'LL-CT-001' in strip_text
        assert 'DEMO-P-01' not in strip_text and '가정' not in strip_text
        assert real.locator('.md-series-current').inner_text().startswith('이 검사 · case_000')
        assert real.locator('.md-series-chip').count() == 0
        assert real.locator('.md-series-viewer canvas').count() == 0
        # A case without any CT gets no series box, so no empty framed placeholder shows.
        assert page.evaluate("()=>[...document.querySelectorAll('.md-series')].every(n=>n.textContent.trim().length>0)")
        toggle = inline.get_by_role('button', name='재검토 후보', exact=True)
        real.get_by_role('button', name='주치의에게 전송하기').click()
        dialog.get_by_label('LOCAL DEMO로 연구 CT를 로컬 전달하기 (실제 환자/주치의 연결·병원 전송 아님)', exact=True).check()
        rows = dialog.locator('.md-candidate-row')
        assert rows.count() >= 1
        dialog.get_by_label('CAPPY2 current', exact=True).check()
        dialog.get_by_label('CAPPY2 050', exact=True).check()
        assert ' · 절편 ' in rows.first.inner_text()
        rows.first.click()
        assert rows.first.get_attribute('aria-pressed') == 'true'
        preview_src = dialog.locator('.md-candidate-frame img').get_attribute('src') or ''
        assert '/ct/' in preview_src and 'case_000' in preview_src, preview_src
        mark_style = dialog.locator('.md-candidate-mark').get_attribute('style') or ''
        assert 'left:' in mark_style and 'top:' in mark_style, mark_style
        assert inline.get_by_role('button', name='재검토 후보', exact=True).get_attribute('aria-pressed') == 'true'
        rows.first.click()
        assert rows.first.get_attribute('aria-pressed') == 'false'
        # A biopsy opinion has to name its target and the route that performs it, so
        # both pickers appear with that opinion and neither one is pre-filled.
        assert dialog.locator('.md-biopsy').is_hidden()
        dialog.get_by_label('즉시 조직검사 · 프로토콜 선택', exact=True).check()
        assert dialog.locator('.md-biopsy').is_visible()
        assert dialog.locator('.md-biopsy select').count() == 2
        assert dialog.locator('.md-biopsy select').nth(0).input_value() == ''
        assert dialog.locator('.md-biopsy select').nth(1).locator('option').count() == rows.count() + 1
        dialog.locator('.md-biopsy select').nth(1).select_option(index=1)
        assert dialog.locator('.md-biopsy select').nth(1).input_value() != ''
        # US is not a default: the checklist only exists once the MD names a protocol.
        assert dialog.locator('.md-biopsy-guide').is_hidden()
        dialog.locator('.md-biopsy select').nth(0).select_option(label='CT 유도')
        assert dialog.locator('.md-biopsy-guide').is_visible()
        assert 'CT 유도 조직검사' in dialog.locator('.md-biopsy-guide').inner_text()
        assert '이 병원의 실제 프로토콜 문서 아님' in dialog.locator('.md-biopsy-guide').inner_text()
        # Free text stays behind '기타'; anything already typed is never hidden again.
        assert dialog.locator('.md-notes-wrap').is_hidden()
        dialog.get_by_label('기타(직접 입력)', exact=True).check()
        assert dialog.locator('.md-notes-wrap').is_visible()
        dialog.locator('textarea').fill('SYNTHETIC review shortcut memo')
        dialog.get_by_label('즉시 조직검사 · 프로토콜 선택', exact=True).check()
        assert dialog.locator('.md-notes-wrap').is_visible()
        assert dialog.locator('textarea').input_value() == 'SYNTHETIC review shortcut memo'
        # Leaving the biopsy opinion clears target and protocol, so both are re-picked.
        assert dialog.locator('.md-biopsy select').nth(1).input_value() == ''
        assert dialog.locator('.md-biopsy select').nth(0).input_value() == ''
        assert dialog.locator('.md-biopsy-guide').is_hidden()
        dialog.locator('.md-biopsy select').nth(0).select_option(label='CT 유도')
        dialog.locator('.md-biopsy select').nth(1).select_option(index=1)
        assert dialog.locator('.md-biopsy-guide').is_visible()
        assert dialog.locator('fieldset.md-visit').is_visible()
        assert '시연용 가정값' in dialog.locator('fieldset.md-visit legend').inner_text()
        dialog.get_by_role('button', name='LOCAL DEMO 보내기', exact=True).click()
        assert not dialog.is_visible()
        sent_link = page.locator('#mdSendResult a').get_attribute('href')
        assert sent_link
        page.goto(BASE + '/' + sent_link.lstrip('/'))
        assert '금일 외래 미내원' in page.locator('.md-record-visit').inner_text()
        biopsy_text = page.locator('.md-record-biopsy').inner_text()
        assert '조직검사 후보 ·' in biopsy_text and ' · 절편 ' in biopsy_text, biopsy_text
        biopsy_button = page.get_by_role('button', name='조직검사 후보 표시', exact=True)
        assert biopsy_button.is_enabled() and biopsy_button.get_attribute('aria-pressed') == 'false'
        biopsy_button.click()
        expect(page.locator('.md-received-viewer')).to_have_attribute('data-load-state', 'ready')
        assert biopsy_button.get_attribute('aria-pressed') == 'true'
        assert page.locator('.md-received-viewer .md-candidate-toggle[aria-pressed="true"]').count() == 1
        biopsy_button.click()
        assert biopsy_button.get_attribute('aria-pressed') == 'false'
        # The receiver sees which route the MD chose and can open its checklist.
        assert 'CT 유도' in page.locator('.md-record-biopsy-protocol').inner_text()
        protocol_button = page.get_by_role('button', name='조직검사 프로토콜 보기', exact=True)
        assert protocol_button.get_attribute('aria-expanded') == 'false'
        assert page.locator('.md-record-protocol-body').is_hidden()
        protocol_button.click()
        protocol_body = page.locator('.md-record-protocol-body')
        assert protocol_body.is_visible()
        # The control renames itself while open, so later steps hold it by class.
        assert page.locator('.md-record-protocol-button').get_attribute('aria-expanded') == 'true'
        assert page.get_by_role('button', name='조직검사 프로토콜 접기', exact=True).count() == 1
        assert 'CT 유도 조직검사' in protocol_body.inner_text()
        assert protocol_body.locator('li').count() >= 4
        assert '기관 확인 필요' in protocol_body.inner_text()
        assert '이 병원의 실제 프로토콜 문서 아님' in protocol_body.inner_text()
        page.locator('.md-record-protocol-button').click()
        assert page.locator('.md-record-protocol-body').is_hidden()
        assert page.locator('.md-record-protocol-button').get_attribute('aria-expanded') == 'false'
        # The record carries the same receipt-based strip: one study, the duplicate alias
        # named once as text, and no second CT viewer mounted from an assumed pairing.
        series = page.locator('.md-record-series')
        series_text = series.inner_text()
        assert series.is_visible()
        assert 'image sha256' in series_text and 'LL-CT-001' in series_text
        assert 'DEMO-P-01' not in series_text and '신원 미검증' not in series_text and '가정' not in series_text
        assert page.locator('.md-record-series-current').inner_text().startswith('이 검사 · case_000')
        assert '복제 표시' in page.locator('.md-record-series-dup').inner_text()
        assert page.locator('.md-record-series-chip').count() == 0
        assert page.locator('.md-record-series-viewer canvas').count() == 0
        page.goto(f'{BASE}/')
        card.wait_for()
        page.locator('#mdFilter').select_option('pending')
    # Functional structure at target widths; visual overflow is Astra's CSS QA.
    for width in (1440,768,390,320):
        page.set_viewport_size({'width':width,'height':900})
        assert page.locator('#mdFilter').is_visible()
    # 320px: the new opinion group must not hide the primary send action.
    page.set_viewport_size({'width':320,'height':740})
    card.get_by_role('button', name='주치의에게 전송하기').click()
    dialog.get_by_label('단기 추적검사', exact=True).check()
    geo = page.evaluate('''() => {
      const dl=document.getElementById('mdSendDialog');
      const send=[...dl.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='DEMO 보내기'||b.textContent.trim()==='✈');
      const r=dl.getBoundingClientRect(), s=send?.getBoundingClientRect();
      return {dialogH:Math.round(r.height), scrollH:dl.scrollHeight,
        labelHeights:[...dl.querySelectorAll('fieldset.md-followup > label')].map(l=>Math.round(l.getBoundingClientRect().height)),
        docOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
    }''')
    assert geo['docOverflow'] <= 1, geo
    assert len(geo['labelHeights']) == 4 and min(geo['labelHeights']) >= 44, geo
    dialog.get_by_role('button', name='DEMO 보내기', exact=True).click()
    assert not dialog.is_visible()
    browser.close()
print('MD workflow browser behavioral checks passed')
