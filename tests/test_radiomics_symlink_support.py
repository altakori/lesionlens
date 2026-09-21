import errno
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from symlink_support import require_symlinks

WORKSPACE = Path(__file__).resolve().parents[1]


class SymlinkCapabilityTests(unittest.TestCase):
    def test_only_capability_failures_skip_real_symlink_tests(self):
        error = OSError('Synthetic Windows privilege failure')
        error.winerror = 1314
        for failure in (error, PermissionError(errno.EPERM, 'Synthetic denial'), NotImplementedError()):
            with self.subTest(failure=type(failure).__name__):
                with tempfile.TemporaryDirectory(dir=WORKSPACE) as tmp:
                    with patch.object(Path, 'symlink_to', side_effect=failure):
                        with self.assertRaises(unittest.SkipTest): require_symlinks(self, Path(tmp))

    def test_unexpected_errors_are_not_skipped(self):
        with tempfile.TemporaryDirectory(dir=WORKSPACE) as tmp:
            with patch.object(Path, 'symlink_to', side_effect=OSError(errno.EINVAL, 'Synthetic invalid call')):
                with self.assertRaises(OSError) as caught: require_symlinks(self, Path(tmp))
                self.assertEqual(caught.exception.errno, errno.EINVAL)

if __name__ == '__main__': unittest.main()
