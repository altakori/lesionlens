"""Run every inherited legacy assertion after explicitly selecting its cohort."""
import unittest
from browser_capp_cases import CappBrowserTests


class IntegratedLegacyBrowserTests(CappBrowserTests):
    def setUp(self):
        super().setUp()
        original_goto = self.page.goto

        def goto_with_legacy(*args, **kwargs):
            response = original_goto(*args, **kwargs)
            self.page.locator('#showLegacy').wait_for(state='visible')
            self.page.locator('#showLegacy').click()
            self.page.locator('#legacyPanel').wait_for(state='visible')
            return response

        self.page.goto = goto_with_legacy


# Avoid unittest discovering the imported base a second time.
del CappBrowserTests

if __name__ == '__main__':
    unittest.main()
