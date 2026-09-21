"""Real local images + deliberately held responses. No server startup/downloads.
Run in parent's installed Windows Playwright environment against localhost:4173.
CHROME_EXECUTABLE may select the existing Chrome binary.
"""
import asyncio
import os
import re

from playwright.async_api import async_playwright, expect

BASE = 'http://127.0.0.1:4173'
SOURCES = ('ct', 'gt', 'cappyv2', 'cp050', 'baseline')


async def main():
    async with async_playwright() as p:
        options = {'headless': True}
        if os.environ.get('CHROME_EXECUTABLE'):
            options['executable_path'] = os.environ['CHROME_EXECUTABLE']
        browser = await p.chromium.launch(**options)
        context = await browser.new_context(viewport={'width':1440, 'height':1000})
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        held, seen = {}, set()
        fail_once = {(5, 'baseline')}
        # First source slice is 001. Hold transitions, not initial loading.
        for n in (2,3,4,5,6):
            for source in SOURCES:
                held[n,source] = asyncio.Event()

        async def intercept(route):
            match = re.search(r'/case_000/(ct|gt|cappyv2|cp050|baseline)/(\d+)\.(?:png|webp)$', route.request.url)
            if not match:
                await route.continue_()
                return
            source, n = match.group(1), int(match.group(2))
            key = (n, source)
            if key in held:
                seen.add(key)
                await held[key].wait()
            if key in fail_once:
                fail_once.remove(key)
                await route.abort('failed')
            else:
                await route.continue_()

        await page.route('**/data/model_compare/web/case_000/**', intercept)
        await page.goto(BASE)
        await page.locator('[data-case-id]').first.wait_for()
        await page.locator('#mdFilter').select_option('all')
        card = page.locator('[data-case-id="case_000"]')
        await card.wait_for()
        await card.get_by_role('button', name='CT 확대', exact=True).click()
        viewer = card.locator('.md-inline-viewer')
        canvases = viewer.locator('canvas')
        slider = viewer.get_by_label('공통 절편', exact=True)
        output = viewer.locator('output')

        async def committed(index):
            await expect(viewer).to_have_attribute('data-load-state', 'ready')
            await expect(viewer).to_have_attribute('data-slice', str(index))
            assert await canvases.count() == 4
            assert await canvases.evaluate_all('(nodes) => nodes.every(n => !n.hidden)')
            assert await canvases.evaluate_all('(nodes) => nodes.map(n => n.dataset.slice)') == [str(index)] * 4

        async def pixels():
            return await canvases.evaluate_all('(nodes) => nodes.map(n => n.toDataURL())')

        async def requested(n):
            async def wait():
                while not all((n, source) in seen for source in SOURCES):
                    await asyncio.sleep(.01)
            await asyncio.wait_for(wait(), timeout=30)

        def release(n, sources=SOURCES):
            for source in sources:
                held[n, source].set()

        async def set_slice(index):
            await slider.evaluate('''(node, value) => {
                node.value=String(value); node.dispatchEvent(new Event('input',{bubbles:true}));
            }''', index)

        await committed(0)
        initial = await pixels()
        # Sample real animation frames: no blank/hidden or mixed-slice canvases
        # may become visible after the first complete frame. Store only faults.
        await viewer.evaluate('''host => {
          window.scrollFaults=[]; window.scrollWatch=true;
          const tick=()=>{
            if(!window.scrollWatch)return;
            const nodes=[...host.querySelectorAll('canvas')];
            if(nodes.length && host.dataset.slice!==''){
              const mixed=nodes.some(n=>n.dataset.slice!==host.dataset.slice);
              const blank=nodes.some(n=>n.hidden || !n.getContext('2d').getImageData(0,0,n.width,n.height).data.some((v,i)=>i%4===3 && v>0));
              if(mixed||blank)window.scrollFaults.push({mixed,blank,slice:host.dataset.slice});
            }
            requestAnimationFrame(tick);
          };requestAnimationFrame(tick);
        }''')
        await canvases.first.hover()
        await page.mouse.wheel(0, 100)
        await expect(viewer).to_have_attribute('data-pending-slice', '1')
        await requested(2)
        assert await pixels() == initial
        await expect(viewer).to_have_attribute('data-slice', '0')
        await expect(output).to_contain_text('표시 1 /')
        await expect(output).to_contain_text('요청 2 /')
        release(2, ('ct','gt','cappyv2','cp050'))
        await page.wait_for_timeout(300)  # Baseline deliberately remains held.
        assert await pixels() == initial
        await expect(viewer).to_have_attribute('data-load-state', 'loading')
        release(2, ('baseline',))
        await committed(1)

        # Newer complete slice wins; later completion of canceled requests must
        # not overwrite it. Actual HTTP bytes still come from the local server.
        await set_slice(2)
        await requested(3)
        await set_slice(3)
        await requested(4)
        release(4)
        await committed(3)
        newest = await pixels()
        release(3)
        await page.wait_for_timeout(200)
        await committed(3)
        assert await pixels() == newest

        # A declared overlay failure is not an available CT-only replacement.
        await set_slice(4)
        await requested(5)
        release(5)
        await expect(viewer).to_have_attribute('data-load-state', 'error')
        await expect(viewer).to_have_attribute('data-slice', '3')
        await expect(output).to_contain_text('요청 5 실패')
        await expect(output).to_contain_text('이전 영상 유지')
        assert await pixels() == newest
        await viewer.get_by_role('button', name='절편 다시 불러오기', exact=True).click()
        await committed(4)

        # Closing invalidates the entire pending generation even if its real
        # responses arrive after a new instance is mounted on the same host.
        await set_slice(5)
        await requested(6)
        await card.get_by_role('button', name='CT 접기', exact=True).click()
        assert await canvases.count() == 0
        await card.get_by_role('button', name='CT 확대', exact=True).click()
        await committed(0)
        reopened = await pixels()
        release(6)
        await page.wait_for_timeout(200)
        await committed(0)
        assert await pixels() == reopened
        assert await page.evaluate('window.scrollFaults') == []
        await page.evaluate('() => { window.scrollWatch=false; }')
        assert errors == [], errors
        await context.close()
        await browser.close()
    print('Delayed real-image scroll, atomic commits, failures and close/reopen passed')


if __name__ == '__main__':
    asyncio.run(main())
