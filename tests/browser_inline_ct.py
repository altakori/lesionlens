"""Local browser acceptance: requires prepared assets, a running server, and Playwright.

BASE_URL defaults to http://127.0.0.1:4173; CHROME_EXECUTABLE overrides Windows
Chrome; QA_OUTPUT selects the screenshot directory. No downloads or server startup.
Run directly (excluded from the dependency-light unittest discovery pattern).
"""
import os
from pathlib import Path
import unittest

from playwright.sync_api import expect, sync_playwright

BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:4173").rstrip("/")
CHROME = os.environ.get(
    "CHROME_EXECUTABLE", "C:/Program Files/Google/Chrome/Application/chrome.exe"
)
QA_OUTPUT = Path(os.environ.get("QA_OUTPUT", "qa/inline-ct"))


class InlineCtBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(executable_path=CHROME, headless=True)
        QA_OUTPUT.mkdir(parents=True, exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 1000})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], "Unexpected JavaScript errors")

    def ready(self):
        expect(self.page.locator("#realDataStatus")).to_have_class("real-status ready")
        expect(self.page.locator("#realCtImage")).to_be_visible()
        self.page.wait_for_function("""() => {
          const image = document.getElementById('realCtImage');
          return image.complete && image.naturalWidth === 512;
        }""")

    def open_ready(self):
        self.page.goto(BASE_URL)
        self.ready()

    def slice_is(self, number):
        expect(self.page.locator("#realSliceLabel")).to_have_text(f"{number} / 24")
        expect(self.page.locator("#realSliceSlider")).to_have_value(str(number - 1))
        self.ready()

    def set_slice(self, number):
        self.page.locator("#realSliceSlider").evaluate("""(slider, value) => {
          slider.value = value;
          slider.dispatchEvent(new Event('input', {bubbles: true}));
        }""", str(number - 1))

    def assert_cleared(self):
        for selector in ("#realCtImage", "#realOverlayImage"):
            image = self.page.locator(selector)
            expect(image).to_be_hidden()
            self.assertIsNone(image.get_attribute("src"))

    def test_controls_and_persistent_viewer(self):
        self.open_ready()
        page = self.page
        expect(page.locator("#realCtSection")).to_have_count(1)
        expect(page.locator("#detailPanel #realCtSection")).to_have_count(1)
        expect(page.locator("canvas, #ctCanvas")).to_have_count(0)
        expect(page.locator("#real-ct-title")).to_have_text(
            "공개 CT 참고 영상 · 선택한 합성 사례와 무관"
        )
        expect(page.locator("#realCtDescription")).to_contain_text("AI 예측이나 진단 결과가 아닙니다")
        for index in range(3):
            page.locator(".real-case").nth(index).click()
            self.slice_is(13)
            expect(page.locator("#realCtImage")).to_have_attribute(
                "src", f"data/real_cases/web/LL-CT-00{index + 1}/ct/13.webp"
            )
        self.set_slice(7)
        self.slice_is(7)
        page.locator("#realNextSlice").click()
        self.slice_is(8)
        page.locator("#realPreviousSlice").click()
        self.slice_is(7)
        frame = page.locator("#realImageFrame")
        for key, number in (("ArrowRight", 8), ("ArrowUp", 9), ("ArrowLeft", 8), ("ArrowDown", 7)):
            frame.press(key)
            self.slice_is(number)
        frame.hover()
        page.mouse.wheel(0, 100)
        self.slice_is(8)
        frame.hover()
        page.mouse.wheel(0, -100)
        self.slice_is(7)
        for number, button in ((1, "#realPreviousSlice"), (24, "#realNextSlice")):
            self.set_slice(number)
            self.slice_is(number)
            page.locator(button).click()
            self.slice_is(number)
        self.set_slice(7)
        self.slice_is(7)
        page.locator("#realOverlayToggle").click()
        self.ready()
        expect(page.locator("#realOverlayImage")).to_be_hidden()
        page.evaluate("""() => {
          window.savedViewerNodes = Array.from(document.querySelectorAll('#realCtSection, #realCtSection *'));
          window.savedViewerState = document.getElementById('realCtSection').outerHTML;
        }""")
        page.locator('.case[data-id="SYN-003"]').click()
        expect(page.locator("#detailHeader h2")).to_have_text("SYN-003")
        page.locator('.filter[data-filter="quality"]').click()
        page.locator("#workloadSelect").select_option("30")
        page.locator('.case[data-id="SYN-026"]').click()
        expect(page.locator("#detailHeader h2")).to_have_text("SYN-026")
        self.assertTrue(page.evaluate("""() => {
          const nodes = Array.from(document.querySelectorAll('#realCtSection, #realCtSection *'));
          return nodes.length === savedViewerNodes.length && nodes.every((node, i) => node === savedViewerNodes[i])
            && document.getElementById('realCtSection').outerHTML === savedViewerState;
        }"""))
        page.locator("#realNextSlice").click()
        self.slice_is(8)
        page.locator("#realOverlayToggle").click()
        self.ready()
        expect(page.locator("#realOverlayImage")).to_be_visible()
        expect(page.locator("#realOverlayToggle")).to_have_attribute("aria-pressed", "true")

    def test_missing_and_empty_manifest(self):
        for status, body in ((404, "{}"), (200, '{"version":"ai0-lits-local-v1","localOnly":true,"cases":[]}')):
            with self.subTest(status=status):
                self.page.route("**/data/real_cases/manifest.json*", lambda route: route.fulfill(
                    status=status, content_type="application/json", body=body
                ))
                self.page.goto(BASE_URL)
                expect(self.page.locator("#realCtUnavailable")).to_be_visible()
                expect(self.page.locator("#realDataStatus")).to_have_class("real-status error")
                self.assert_cleared()
                self.page.locator('.case[data-id="SYN-003"]').click()
                expect(self.page.locator("#detailHeader h2")).to_have_text("SYN-003")
                expect(self.page.locator("#realCtUnavailable")).to_be_visible()
                self.page.unroute("**/data/real_cases/manifest.json*")

    def test_failed_ct_or_gt_clears_previous_pair_and_recovers(self):
        for asset in ("ct/14.webp", "overlay/14.png"):
            with self.subTest(asset=asset):
                self.open_ready()
                pattern = f"**/LL-CT-001/{asset}"
                self.page.route(pattern, lambda route: route.fulfill(status=404, body="missing"))
                self.page.locator("#realNextSlice").click()
                expect(self.page.locator("#realDataStatus")).to_have_class("real-status error")
                self.assert_cleared()
                expect(self.page.locator("#realCtDescription")).to_contain_text("불러오지 못했습니다")
                self.page.locator('.case[data-id="SYN-003"]').click()
                self.assert_cleared()
                self.page.unroute(pattern)
                self.page.locator("#realPreviousSlice").click()
                self.slice_is(13)
                expect(self.page.locator("#realOverlayImage")).to_be_visible()

    def test_pending_images_clear_stale_content_and_ignore_late_failure(self):
        self.open_ready()
        pending = []
        self.page.route("**/LL-CT-001/ct/14.webp", lambda route: pending.append(route))
        self.page.locator("#realNextSlice").click()
        expect(self.page.locator("#realDataStatus")).to_contain_text("불러오는 중")
        self.assert_cleared()
        # Wait for the intercepted request, without timing-dependent sleeps.
        self.page.wait_for_function("() => document.getElementById('realSliceSlider').value === '13'")
        self.page.locator("#realNextSlice").click()
        self.slice_is(15)
        self.assertEqual(len(pending), 1)
        pending[0].fulfill(status=404, body="late failure")
        # Let the browser process the old image's error before asserting current state.
        self.page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        self.slice_is(15)
        expect(self.page.locator("#realCtImage")).to_have_attribute("src", "data/real_cases/web/LL-CT-001/ct/15.webp")

    def test_desktop_and_mobile_layout(self):
        for width, height in ((1440, 1000), (390, 844), (320, 740)):
            with self.subTest(width=width):
                self.page.set_viewport_size({"width": width, "height": height})
                self.open_ready()
                self.assertTrue(self.page.evaluate("""() =>
                  document.documentElement.scrollWidth <= window.innerWidth
                """), f"Horizontal overflow at {width}px")
                panel = self.page.locator("#detailPanel").bounding_box()
                viewer = self.page.locator("#realCtSection").bounding_box()
                header = self.page.locator("#detailHeader").bounding_box()
                self.assertGreaterEqual(viewer["x"], panel["x"])
                self.assertLessEqual(viewer["x"] + viewer["width"], panel["x"] + panel["width"])
                self.assertGreaterEqual(viewer["y"], header["y"] + header["height"])
                self.page.screenshot(path=str(QA_OUTPUT / f"inline-ct-{width}.png"), full_page=True)
                self.page.locator("#detailPanel").screenshot(path=str(QA_OUTPUT / f"inline-ct-detail-{width}.png"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
