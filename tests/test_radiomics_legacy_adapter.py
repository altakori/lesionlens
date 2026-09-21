"""Verify the adapter contract using a synthetic legacy test class only."""
import runpy
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class AdapterTests(unittest.TestCase):
    def test_navigation_result_and_all_inherited_tests_preserved(self):
        events = []
        response = object()

        class Locator:
            def __init__(self, selector): self.selector = selector
            def wait_for(self, **kwargs): events.append(('wait', self.selector, kwargs))
            def click(self): events.append(('click', self.selector))

        class Page:
            def goto(self, *args, **kwargs):
                events.append(('goto', args, kwargs)); return response
            def locator(self, selector): return Locator(selector)

        class LegacyBase(unittest.TestCase):
            def setUp(self):
                self.page = Page(); self.context = object(); self.errors = []; self.cases = ['synthetic']
            def test_existing_assertion(self): pass

        stub = types.ModuleType('browser_capp_cases'); stub.CappBrowserTests = LegacyBase
        with patch.dict(sys.modules, {'browser_capp_cases': stub}):
            namespace = runpy.run_path(str(Path(__file__).with_name('browser_integrated_legacy.py')))
        adapter = namespace['IntegratedLegacyBrowserTests']
        self.assertIs(adapter.test_existing_assertion, LegacyBase.test_existing_assertion)
        self.assertNotIn('CappBrowserTests', namespace)
        instance = adapter('test_existing_assertion'); instance.setUp()
        for i in range(2):
            self.assertIs(instance.page.goto('http://local/', wait_until='load'), response)
        self.assertEqual(events[:4], [('goto', ('http://local/',), {'wait_until': 'load'}),
                                      ('wait', '#showLegacy', {'state': 'visible'}),
                                      ('click', '#showLegacy'),
                                      ('wait', '#legacyPanel', {'state': 'visible'})])
        self.assertEqual(events[:4], events[4:])
        self.assertEqual(instance.errors, [])
        self.assertEqual(instance.cases, ['synthetic'])

if __name__ == '__main__': unittest.main()
