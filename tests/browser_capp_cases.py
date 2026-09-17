"""Windows Chrome acceptance against parent's prepared, loopback-only service."""
import os
from pathlib import Path
import unittest
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:4173').rstrip('/')
CHROME = os.environ.get('CHROME_EXECUTABLE', 'C:/Program Files/Google/Chrome/Application/chrome.exe')
OUTPUT = Path(os.environ.get('QA_OUTPUT', 'qa/capp-cases'))


class CappBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if urlsplit(BASE_URL).hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise ValueError('BASE_URL must be loopback')
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=CHROME, headless=True)
        OUTPUT.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1100})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        response = self.context.request.get(BASE_URL + '/data/model_compare/manifest.json')
        self.assertTrue(response.ok, 'Parent must prepare all approved assets before browser QA')
        self.cases = response.json()['cases']

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def ready(self):
        expect(self.page.locator('#realDataStatus')).to_have_class('real-status ready')
        self.page.wait_for_function("""() => ['realCtImage','realOverlayImage'].every(id => {
            const image = document.getElementById(id); return image.complete && image.naturalWidth === 512;
        })""")

    def open(self):
        self.page.goto(BASE_URL)
        expect(self.page.locator('.case-card')).to_have_count(5)
        expect(self.page.locator('#ctDialog')).not_to_be_visible()
        self.cleared()

    def select(self, case):
        if self.page.locator('#ctDialog').is_visible():
            self.page.locator('#closeCtDialog').click()
        self.page.locator(f'#caseList [data-action="open"][data-id="{case["id"]}"]').click(); self.ready()
        self.assert_slice(case, case['defaultSlice'])

    def assert_slice(self, case, z):
        self.ready()
        expect(self.page.locator('#selectedCaseId')).to_have_text(case['id'])
        expect(self.page.locator('#realCtImage')).to_have_attribute('src', case['slices'][z]['ct'])
        expect(self.page.locator('#realOverlayImage')).to_have_attribute('src', case['slices'][z]['overlays']['gt']['path'])
        expect(self.page.locator('#realSliceSlider')).to_have_value(str(z))
        expect(self.page.locator('#realSliceLabel')).to_have_text(f'{z + 1} / {case["sliceCount"]}')

    def slider(self, z):
        self.page.locator('#realSliceSlider').evaluate("(el,z) => {el.value=z; el.dispatchEvent(new Event('input',{bubbles:true}));}", str(z))

    def cleared(self):
        for selector in ('#realCtImage', '#realOverlayImage'):
            expect(self.page.locator(selector)).to_be_hidden()
            self.assertIsNone(self.page.locator(selector).get_attribute('src'))

    def test_matching_full_series_controls_and_gt(self):
        self.open()
        self.assertEqual([c['id'] for c in self.cases], ['case_000', 'case_001', 'case_035', 'case_045', 'case_048'])
        expect(self.page.locator('#totalCases')).to_have_text('5')
        expect(self.page.locator('#totalSlices')).to_have_text('640')
        for case in self.cases:
            self.select(case)
            facts = self.page.locator('#caseFacts')
            expect(facts).to_contain_text(case['id'])
            expect(facts).to_contain_text(f'{case["tumorVolumeMl"]:.2f} mL')
            expect(facts).to_contain_text(' × '.join(str(v) for v in case['dimensions']))
            expect(facts).to_contain_text(' × '.join(f'{v:.3f}' for v in case['spacing']) + ' mm')
            for z in (0, case['sliceCount'] - 1):
                self.slider(z); self.assert_slice(case, z)
            expect(self.page.locator('#realNextSlice')).to_be_disabled()
            self.slider(0); self.assert_slice(case, 0)
            expect(self.page.locator('#realPreviousSlice')).to_be_disabled()
            self.page.locator('#realNextSlice').click(); self.assert_slice(case, 1)
            self.page.locator('#realPreviousSlice').click(); self.assert_slice(case, 0)
            frame = self.page.locator('#realImageFrame')
            for key, z in [('ArrowRight', 1), ('ArrowUp', 2), ('ArrowLeft', 1), ('ArrowDown', 0), ('End', case['sliceCount'] - 1), ('Home', 0)]:
                frame.press(key); self.assert_slice(case, z)
            frame.hover(); self.page.mouse.wheel(0, 100); self.assert_slice(case, 1)
            frame.hover(); self.page.mouse.wheel(0, -100); self.assert_slice(case, 0)
            self.page.locator('#realOverlayToggle').click()
            expect(self.page.locator('#realOverlayImage')).to_be_hidden()
            expect(self.page.locator('#realOverlayToggle')).to_have_attribute('aria-pressed', 'false')
            self.page.locator('#realOverlayToggle').click()
            self.ready()
            expect(self.page.locator('#realOverlayImage')).to_be_visible()
            self.select(case)  # Reselecting resets maximum-GT slice.

    def test_review_search_sort_and_reload(self):
        self.open(); self.select(self.cases[1])
        self.page.locator('#reviewToggle').click()
        expect(self.page.locator('#reviewedCount')).to_have_text('1')
        self.page.reload()
        expect(self.page.locator('.case-card')).to_have_count(5)
        self.cleared()
        self.page.locator('.filter[data-filter="reviewed"]').click()
        expect(self.page.locator('.case-card')).to_have_count(1)
        self.select(self.cases[1])
        expect(self.page.locator('#reviewToggle')).to_have_attribute('aria-pressed', 'true')
        self.page.locator('#closeCtDialog').click()
        self.page.locator('.filter[data-filter="pending"]').click()
        expect(self.page.locator('.case-card')).to_have_count(4)
        self.page.locator('.filter[data-filter="all"]').click()
        self.page.locator('#sortSelect').select_option('tumor')
        self.assertEqual(self.card_ids(), [c['id'] for c in sorted(self.cases, key=lambda c: (-c['tumorVolumeMl'], c['id']))])
        self.page.locator('#caseSearch').fill('CASE_045')
        expect(self.page.locator('.case-card')).to_have_count(1)
        expect(self.page.locator('#visibleCount')).to_have_text('전체 5건 중 1건 표시')
        expect(self.page.locator('#totalCases')).to_have_text('5')
        self.page.locator('#caseSearch').fill('none')
        expect(self.page.locator('#emptyState')).to_be_visible(); self.cleared()
        expect(self.page.locator('#caseFacts')).to_be_empty()
        self.page.locator('#caseSearch').fill('')
        expect(self.page.locator('.case-card')).to_have_count(5)

    def card_ids(self):
        return self.page.locator('.case-card').evaluate_all('(els)=>els.map(el=>el.dataset.id)')

    @staticmethod
    def technical_tags(case):
        tags = set()
        score = case['disagreement']['score'] if case['disagreement'] else None
        models = [case['models'][k] for k in ('baseline', 'cappyv2', 'cp050') if k in case['models']]
        gt = case['gt']
        if score is not None and score >= .20:
            tags.add('disagreement')
        if len(models) >= 2:
            if len({m['componentCount'] for m in models}) > 1:
                tags.add('countdiff')
            low, high = min(m['volumeMl'] for m in models), max(m['volumeMl'] for m in models)
            if (low > 0 and high / low >= 1.5) or (low == 0 and high > 0):
                tags.add('volumediff')
        if any(0 < v < 1 for v in gt['componentVolumesMl']):
            tags.add('small')
        if gt['componentCount'] >= 2:
            tags.add('multiple')
        if case['tumorVolumeMl'] >= 20:
            tags.add('large')
        if gt['positiveSliceCount'] / case['sliceCount'] >= .25:
            tags.add('extent')
        if len(models) < 3 or score is None:
            tags.add('missing')
        return tags

    def review_groups(self):
        # Independent full-cohort dominance-depth oracle; never use review/pin state.
        values = {c['id']: (max(c['gt']['componentVolumesMl'], default=0), c['gt']['componentCount'])
                  for c in self.cases if c.get('gt') is not None}
        groups = {}
        def group(case_id):
            if case_id not in groups:
                volume, count = values[case_id]
                parents = [other for other, (v, n) in values.items()
                           if v >= volume and n >= count and (v > volume or n > count)]
                groups[case_id] = 1 + max((group(other) for other in parents), default=0)
            return groups[case_id]
        return {c['id']: group(c['id']) if c['id'] in values else None for c in self.cases}

    def ranked_ids(self, pins=(), sort='burden', reviewed=()):
        groups = self.review_groups()
        def key(case):
            if sort == 'burden':
                return (case['id'] in reviewed, case['id'] not in pins,
                        groups[case['id']] or float('inf'), case['id'])
            tags = self.technical_tags(case)
            band = 0 if 'disagreement' in tags else 1 if tags else 2
            score = case['disagreement']['score'] if case['disagreement'] else -1
            return (case['id'] not in pins, band, -score, case['id'])
        return [c['id'] for c in sorted(self.cases, key=key)]

    def test_categories_manual_persistence_and_no_implicit_ct_requests(self):
        requests = []
        self.page.on('request', lambda request: requests.append(request.url) if '/web/' in request.url else None)
        self.open()
        expect(self.page.locator('#sortSelect')).to_have_value('burden')
        automatic = self.ranked_ids()
        self.assertEqual(self.card_ids(), automatic)
        self.assertEqual(automatic, ['case_001', 'case_048', 'case_000', 'case_035', 'case_045'])
        self.assertEqual(self.review_groups(), {'case_000': 2, 'case_001': 1, 'case_035': 2, 'case_045': 3, 'case_048': 1})
        self.assertNotEqual(automatic, sorted(automatic), 'Real differing metrics must produce a non-ID queue')
        self.assertTrue(any(len(self.technical_tags(c)) >= 2 for c in self.cases))
        for rank, case_id in enumerate(automatic, 1):
            case = next(c for c in self.cases if c['id'] == case_id)
            card = self.page.locator(f'.case-card[data-id="{case_id}"]')
            expect(card.locator('.rank-number')).to_have_text(f'전체 대기열 {rank}번째')
            morphology = card.locator('.morphology-priority')
            expect(morphology).to_be_visible()
            expect(card.locator('.emergency-status')).to_be_visible()
            expect(card.locator('.emergency-status')).to_have_text('응급 소견 미평가')
            expect(card.locator('.morphology-rule')).not_to_have_attribute('open', '')
            expect(card.locator('.rank-reasons')).not_to_have_attribute('open', '')
            expect(morphology).to_contain_text('크기·개수 검토 그룹 · GT')
            expect(morphology.locator('h4')).to_have_text(f'{self.review_groups()[case_id]}그룹')
            expect(card).to_have_attribute('data-review-group', str(self.review_groups()[case_id]))
            expect(card).to_have_attribute('data-queue-ordinal', str(rank))
            expect(card).to_have_attribute('data-rank-policy', 'pareto-gt-vol-count')
            volume_text = morphology.locator('[data-reason=largest-volume]').inner_text()
            self.assertTrue(volume_text.startswith('최대 연결 표시 부피 ') and volume_text.endswith(' mL'))
            expected_volume = self.page.evaluate('(value) => value.toFixed(2)', max(case['gt']['componentVolumesMl'], default=0))
            self.assertEqual(volume_text, f'최대 연결 표시 부피 {expected_volume} mL')
            expect(morphology.locator('[data-reason=component-count]')).to_have_text(f"연결 표시 {case['gt']['componentCount']}개")
            expect(card.locator('.case-tags .priority-reason-tag')).to_have_count(0)
            expect(morphology.locator('.case-tag')).to_have_count(0)
            self.assertEqual(set(card.locator('.case-tag').evaluate_all('(els)=>els.map(e=>e.dataset.tag)')), self.technical_tags(case))
            for tag in card.locator('.case-tag').all():
                expect(tag).to_be_visible()
            expect(card.locator('.case-reason')).not_to_be_visible()
            expect(card.locator('.next-action-reason')).not_to_be_visible()
            card.locator('.rank-reasons summary').focus()
            card.locator('.rank-reasons summary').press('Enter')
            expect(card.locator('.case-reason')).to_be_visible()
            expect(card.locator('.next-action-reason')).to_be_visible()
            expect(card.locator('.rank-explanation')).to_contain_text('AI 차이 점수')
            expect(card).to_contain_text('임상 응급도: 판단 자료 부족')
            card.locator('.rank-reasons summary').click()
        self.page.locator('#sortSelect').select_option('priority')
        self.assertEqual(self.card_ids(), self.ranked_ids(sort='priority'))
        expect(self.page.locator('#nextCase')).to_contain_text('기본 크기·개수 대기열')
        expect(self.page.locator('#nextCase [data-action=open]')).to_have_attribute('data-id', automatic[0])
        next_case = next(c for c in self.cases if c['id'] == automatic[0])
        next_volume = self.page.evaluate('(value) => value.toFixed(2)', max(next_case['gt']['componentVolumesMl'], default=0))
        expect(self.page.locator('#nextCase .case-reason')).to_have_text(f"1그룹 · 최대 연결 표시 부피 {next_volume} mL · 연결 표시 {next_case['gt']['componentCount']}개 · GT")
        self.page.locator('#sortSelect').select_option('burden')
        self.page.locator('[data-action="first"][data-id="case_045"]').click()
        self.assertEqual(self.card_ids(), self.ranked_ids({'case_045'}))
        expect(self.page.locator('.case-card[data-id=case_045]')).to_have_attribute('data-review-group', '3')
        expect(self.page.locator('.case-card').first).to_contain_text('직접 먼저 보기 지정')
        self.page.reload()
        expect(self.page.locator('.case-card')).to_have_count(5)
        self.assertEqual(self.card_ids(), self.ranked_ids({'case_045'}))
        for category in ('disagreement', 'multiple', 'small', 'countdiff', 'volumediff', 'large', 'extent', 'missing', 'priority', 'all'):
            eligible = {c['id'] for c in self.cases if category == 'all' or
                        (category == 'priority' and c['id'] == 'case_045') or
                        category in self.technical_tags(c)}
            button = self.page.locator(f'[data-category="{category}"]')
            button.click()
            expect(button).to_have_attribute('aria-pressed', 'true')
            self.assertEqual(self.card_ids(), [i for i in self.ranked_ids({'case_045'}) if i in eligible])
            expect(self.page.locator('#visibleCount')).to_have_text(f'전체 5건 중 {len(eligible)}건 표시')
            expect(button.locator('.category-count')).to_have_text(f' ({len(eligible)})')
        self.page.locator('[data-category="priority"]').click()
        self.page.locator('[data-action="first"][data-id="case_045"]').click()
        self.assertEqual(self.card_ids(), [])
        self.page.locator('[data-category="all"]').click()
        self.assertEqual(self.card_ids(), automatic)
        self.cleared()
        self.assertEqual(requests, [])
        self.select(self.cases[3])
        self.page.locator('#reviewToggle').click()
        self.page.locator('#closeCtDialog').click()
        self.page.locator('[data-category="missing"]').click()
        self.page.locator('#caseSearch').fill('045')
        self.page.locator('.filter[data-filter="reviewed"]').click()
        self.assertEqual(self.card_ids(), ['case_045'])
        expect(self.page.locator('.rank-number')).to_have_text(f'전체 대기열 {automatic.index("case_045") + 1}번째')
        self.page.locator('.filter[data-filter="pending"]').click()
        expect(self.page.locator('.case-card')).to_have_count(0)
        self.page.locator('.filter[data-filter="all"]').click()
        self.assertEqual(self.card_ids(), ['case_045'])

    def test_fixed_groups_reviewed_last_and_hospital_unchanged(self):
        self.open()
        hospital = self.page.locator('#hospitalModel')
        expect(hospital).to_have_count(1)
        initial_hospital = hospital.inner_html()
        initial_groups = self.review_groups()
        case_id = self.ranked_ids()[0]
        case = next(c for c in self.cases if c['id'] == case_id)
        self.page.locator(f'[data-action=first][data-id={case_id}]').click()
        self.select(case)
        self.page.locator('#reviewToggle').click()
        self.page.keyboard.press('Escape')
        self.assertEqual(self.card_ids(), self.ranked_ids({case_id}, reviewed={case_id}))
        self.assertEqual(self.card_ids()[-1], case_id)
        for card in self.page.locator('.case-card').all():
            expect(card).to_have_attribute('data-review-group', str(initial_groups[card.get_attribute('data-id')]))
        expect(self.page.locator('#nextCase [data-action=open]')).to_have_attribute('data-id', 'case_048')
        self.page.locator('#caseSearch').fill(case_id)
        self.page.locator('#sortSelect').select_option('id')
        expect(self.page.locator('.case-card')).to_have_attribute('data-review-group', '1')
        expect(self.page.locator('#nextCase [data-action=open]')).to_have_attribute('data-id', 'case_048')
        expect(self.page.locator('#queueSummary')).to_contain_text('1그룹 확인 전 1건')
        expect(self.page.locator('#queueSummary')).to_contain_text('확인 완료 1건')
        self.assertEqual(hospital.inner_html(), initial_hospital)

    def test_next_case_keyboard_review_advance_and_search_independence(self):
        requests = []
        self.page.on('request', lambda request: requests.append(request.url) if '/web/' in request.url else None)
        self.open()
        button = self.page.locator('#nextCase [data-action="open"]')
        expect(button).to_have_attribute('data-id', self.ranked_ids()[0])
        self.page.locator('[data-action="first"][data-id="case_045"]').click()
        order = self.ranked_ids({'case_045'})
        expect(button).to_have_attribute('data-id', order[0])
        expect(self.page.locator('#nextCase')).to_contain_text('직접 먼저 보기 지정')
        self.page.locator('#caseSearch').fill('no-matching-case')
        self.page.locator('#sortSelect').select_option('tumor')
        self.page.locator('[data-category="small"]').click()
        self.page.locator('.filter[data-filter="reviewed"]').click()
        expect(self.page.locator('.case-card')).to_have_count(0)
        expect(button).to_have_attribute('data-id', order[0])
        expect(self.page.locator('#queueSummary')).to_contain_text('1그룹 확인 전 2건')
        expect(self.page.locator('#queueSummary')).to_contain_text('다른 그룹 확인 전 3건')
        expect(self.page.locator('#queueSummary')).to_contain_text('GT 자료 없음 · 확인 전 0건')
        self.assertEqual(requests, [])
        for index, case_id in enumerate(order):
            case = next(c for c in self.cases if c['id'] == case_id)
            expect(button).to_have_attribute('data-id', case_id)
            expect(button).to_have_accessible_name(f'{case_id} CT 보기')
            button.focus(); button.press('Enter' if index % 2 == 0 else 'Space')
            self.assert_slice(case, case['defaultSlice'])
            requests_before_review = list(requests)
            self.page.locator('#reviewToggle').click()
            expect(self.page.locator('#selectedCaseId')).to_have_text(case_id)
            expect(self.page.locator('#reviewedCount')).to_have_text(str(index + 1))
            if index + 1 < len(order):
                expect(button).to_have_attribute('data-id', order[index + 1])
            self.page.keyboard.press('Escape')
            expect(self.page.locator('#ctDialog')).not_to_be_visible()
            self.cleared()
            self.assertEqual(requests, requests_before_review, 'Reviewing and closing must not request the next CT')
            if index + 1 < len(order):
                expect(button).to_be_focused()
        expect(button).to_have_count(0)
        expect(self.page.locator('#nextCase')).to_contain_text('모든 사례를 확인했어요')
        expect(self.page.locator('#queueSummary')).to_contain_text('확인 완료 5건')
        expect(self.page.locator('#queueSummary')).to_contain_text('응급 소견 미평가 5건')
        # Undoing a review returns that case to the queue without opening it.
        self.page.locator('#caseSearch').fill('')
        self.page.locator('[data-category="all"]').click()
        self.select(self.cases[0])
        self.page.locator('#reviewToggle').click()
        self.page.keyboard.press('Escape')
        expect(button).to_have_attribute('data-id', self.cases[0]['id'])
        self.cleared()

    def test_next_case_loading_and_manifest_error_are_not_all_done(self):
        pending = []
        self.page.route('**/data/model_compare/manifest.json', lambda route: pending.append(route))
        with self.page.expect_request('**/data/model_compare/manifest.json'):
            self.page.goto(BASE_URL, wait_until='domcontentloaded')
        expect(self.page.locator('#nextCase')).to_contain_text('불러오는 중')
        expect(self.page.locator('#nextCase')).not_to_contain_text('모든 사례를 확인')
        expect(self.page.locator('#nextCase button')).to_have_count(0)
        self.cleared()
        self.assertEqual(len(pending), 1)
        pending[0].fulfill(status=404, body='missing')
        expect(self.page.locator('#nextCase')).to_contain_text('정할 수 없어요')
        expect(self.page.locator('#nextCase')).not_to_contain_text('모든 사례를 확인')
        expect(self.page.locator('#nextCase button')).to_have_count(0)
        expect(self.page.locator('#queueSummary')).to_contain_text('집계할 수 없어요')
        self.cleared()

    def test_dialog_close_escape_and_focus(self):
        self.open()
        for case, escape in [(self.cases[1], False), (self.cases[2], True)]:
            self.select(case)
            expect(self.page.locator('#ctDialog')).to_be_visible()
            if escape:
                self.page.keyboard.press('Escape')
            else:
                self.page.locator('#closeCtDialog').click()
            expect(self.page.locator('#ctDialog')).not_to_be_visible()
            self.cleared()
            expect(self.page.locator(f'#caseList [data-action="open"][data-id="{case["id"]}"]')).to_be_focused()

    def test_keyboard_open_and_modal_focus(self):
        self.open()
        button = self.page.locator('#caseList [data-action="open"][data-id="case_000"]')
        button.focus(); button.press('Enter'); self.ready()
        expect(self.page.locator('#closeCtDialog')).to_be_focused()
        self.page.keyboard.press('Shift+Tab')
        self.assertTrue(self.page.evaluate("document.getElementById('ctDialog').contains(document.activeElement)"))
        self.page.keyboard.press('Escape'); self.cleared()
        expect(button).to_be_focused()

    def test_synchronous_cleanup_and_immediate_reopen(self):
        self.open()
        for cancel in (False, True):
            self.select(self.cases[1])
            # Capture the contract in the same task as the action, before a
            # queued native close event can run. Reopen before that event too.
            snapshot = self.page.evaluate("""cancel => {
                const dialog = document.getElementById('ctDialog');
                if (cancel) dialog.dispatchEvent(new Event('cancel', {cancelable: true}));
                else document.getElementById('closeCtDialog').click();
                const result = {
                    open: dialog.open,
                    images: ['realCtImage', 'realOverlayImage'].map(id => {
                        const image = document.getElementById(id);
                        return {src: image.getAttribute('src'), hidden: image.hidden};
                    }),
                    status: document.getElementById('realDataStatus').className,
                    facts: document.getElementById('caseFacts').textContent,
                    disabled: document.getElementById('realSliceSlider').disabled,
                    focus: [document.activeElement.dataset.action, document.activeElement.dataset.id]
                };
                document.querySelector('#caseList [data-action="open"][data-id="case_045"]').click();
                return result;
            }""", cancel)
            self.assertEqual(snapshot, {
                'open': False, 'images': [{'src': None, 'hidden': True}] * 2,
                'status': 'real-status idle', 'facts': '', 'disabled': True,
                'focus': ['open', 'case_001'],
            })
            self.page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
            self.assert_slice(self.cases[3], self.cases[3]['defaultSlice'])
            expect(self.page.locator('#ctDialog')).to_be_visible()

    def test_missing_manifest_and_asset_failures(self):
        for body, status in [('{}', 404), ('{"version":"capp-lits-v1","cases":[]}', 200)]:
            self.page.route('**/data/model_compare/manifest.json', lambda r, *, b=body, s=status: r.fulfill(status=s, content_type='application/json', body=b))
            self.page.goto(BASE_URL)
            expect(self.page.locator('#realDataStatus')).to_have_class('real-status error')
            self.cleared(); expect(self.page.locator('.case-card')).to_have_count(0)
            expect(self.page.locator('#emptyState')).to_be_visible()
            expect(self.page.locator('#emptyState')).to_contain_text('CT 목록을 불러오지 못했습니다')
            self.page.locator('#caseSearch').fill('case')
            expect(self.page.locator('#emptyState')).to_contain_text('CT 목록을 불러오지 못했습니다')
            self.page.unroute('**/data/model_compare/manifest.json')
        for key in ('ct', 'overlay'):
            self.open(); case = self.cases[1]
            row = case['slices'][case['defaultSlice']]
            pattern = '**/' + (row['ct'] if key == 'ct' else row['overlays']['gt']['path'])
            self.page.route(pattern, lambda r: r.fulfill(status=404, body='missing'))
            self.page.locator(f'#caseList [data-action="open"][data-id="{case["id"]}"]').click()
            expect(self.page.locator('#realDataStatus')).to_have_class('real-status error')
            expect(self.page.locator('#selectedCaseId')).to_have_text(case['id']); self.cleared()
            self.page.unroute(pattern)
            self.select(case)

    def test_stale_success_and_failure_cannot_replace_new_case(self):
        for failed in (False, True):
            self.open(); old = self.cases[0]; self.select(old); pending = []
            z = 0 if old['defaultSlice'] != 0 else 1
            pattern = '**/' + old['slices'][z]['ct']
            self.page.route(pattern, lambda r: pending.append(r))
            with self.page.expect_request(pattern):
                self.slider(z)
            expect(self.page.locator('#realDataStatus')).to_have_class('real-status loading')
            self.cleared()
            self.select(self.cases[2])
            self.assertEqual(len(pending), 1)
            if failed: pending[0].fulfill(status=404, body='late error')
            else: pending[0].fulfill(response=pending[0].fetch())
            self.page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
            self.assert_slice(self.cases[2], self.cases[2]['defaultSlice'])
            self.page.unroute(pattern)

    def test_close_while_loading_ignores_late_image(self):
        self.open(); pending = []
        case = self.cases[0]
        pattern = '**/' + case['slices'][case['defaultSlice']]['ct']
        self.page.route(pattern, lambda route: pending.append(route))
        with self.page.expect_request(pattern):
            self.page.locator('#caseList [data-action="open"][data-id="case_000"]').click()
        expect(self.page.locator('#realDataStatus')).to_have_class('real-status loading')
        self.page.keyboard.press('Escape')
        self.cleared()
        expect(self.page.locator('#caseList [data-action="open"][data-id="case_000"]')).to_be_focused()
        self.assertEqual(len(pending), 1)
        pending[0].fulfill(response=pending[0].fetch())
        self.page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        self.cleared()
        expect(self.page.locator('#ctDialog')).not_to_be_visible()
        expect(self.page.locator('#realDataStatus')).to_have_class('real-status idle')

    def test_model_switch_same_slice_ct_only_and_unavailable_case(self):
        self.open(); case = self.cases[0]; self.select(case)
        z = min(case['defaultSlice'] + 1, case['sliceCount'] - 1)
        self.slider(z); self.assert_slice(case, z)
        for model in ('baseline', 'cappyv2', 'cp050', 'gt'):
            self.page.locator('#overlaySelect').select_option(model); self.ready()
            expect(self.page.locator('#realSliceSlider')).to_have_value(str(z))
            expect(self.page.locator('#realCtImage')).to_have_attribute('src', case['slices'][z]['ct'])
            expect(self.page.locator('#realOverlayImage')).to_have_attribute('src', case['slices'][z]['overlays'][model]['path'])
            expect(self.page.locator('#realOverlayImage')).to_be_visible()
        self.page.locator('#overlaySelect').select_option('none')
        expect(self.page.locator('#realDataStatus')).to_have_class('real-status ready')
        expect(self.page.locator('#realOverlayImage')).to_be_hidden()
        self.assertIsNone(self.page.locator('#realOverlayImage').get_attribute('src'))
        expect(self.page.locator('#realCtImage')).to_be_visible()
        missing = next(c for c in self.cases if c['id'] == 'case_045')
        self.select(missing)
        requests = []
        self.page.on('request', lambda r: requests.append(r.url))
        for model in ('baseline', 'cappyv2', 'cp050'):
            self.page.locator('#overlaySelect').select_option(model)
            expect(self.page.locator('#realDataStatus')).to_have_class('real-status ready')
            expect(self.page.locator('#modelCaption')).to_contain_text('자료가 없어요')
            expect(self.page.locator('#realOverlayImage')).to_be_hidden()
            self.assertIsNone(self.page.locator('#realOverlayImage').get_attribute('src'))
            expect(self.page.locator('#realCtImage')).to_be_visible()
        self.assertFalse(any('/case_045/' + model + '/' in url for model in ('baseline','cappyv2','cp050') for url in requests))

    def test_stale_model_success_failure_and_close_failure(self):
        for failed in (False, True):
            self.open(); case = self.cases[0]; self.select(case); pending = []
            z = case['defaultSlice']
            pattern = '**/' + case['slices'][z]['overlays']['baseline']['path']
            self.page.route(pattern, lambda r: pending.append(r))
            with self.page.expect_request(pattern):
                self.page.locator('#overlaySelect').select_option('baseline')
            self.cleared()
            self.page.locator('#overlaySelect').select_option('cp050'); self.ready()
            self.assertEqual(len(pending), 1)
            if failed: pending[0].fulfill(status=404, body='late failure')
            else: pending[0].fulfill(response=pending[0].fetch())
            self.page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
            expect(self.page.locator('#realOverlayImage')).to_have_attribute('src', case['slices'][z]['overlays']['cp050']['path'])
            expect(self.page.locator('#realSliceSlider')).to_have_value(str(z))
            self.page.unroute(pattern)
        self.open(); pending = []; case = self.cases[0]
        pattern = '**/' + case['slices'][case['defaultSlice']]['ct']
        self.page.route(pattern, lambda r: pending.append(r))
        with self.page.expect_request(pattern):
            self.page.locator('#caseList [data-action="open"][data-id="case_000"]').click()
        self.page.keyboard.press('Escape')
        self.assertEqual(len(pending), 1); pending[0].fulfill(status=404, body='late failure')
        self.page.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        self.cleared(); expect(self.page.locator('#realDataStatus')).to_have_class('real-status idle')

    def test_layout_screenshots(self):
        for width, height in [(1440, 1100), (390, 844), (320, 740)]:
            self.page.set_viewport_size({'width': width, 'height': height}); self.open()
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
            self.page.screenshot(path=str(OUTPUT / f'capp-{width}.png'), full_page=True)
            self.select(self.cases[0])
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
            self.assertTrue(self.page.locator('#ctDialog').evaluate('(el) => el.scrollWidth <= el.clientWidth'))
            self.page.locator('#detailPanel').screenshot(path=str(OUTPUT / f'capp-detail-{width}.png'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
