"""Capability gate for real filesystem symlink tests only."""
import errno
from pathlib import Path
import tempfile


def require_symlinks(test, root):
    try:
        with tempfile.TemporaryDirectory(dir=root) as tmp:
            probe = Path(tmp)
            (probe / 'file').write_bytes(b'probe')
            (probe / 'directory').mkdir()
            (probe / 'file-link').symlink_to(probe / 'file')
            (probe / 'directory-link').symlink_to(probe / 'directory', target_is_directory=True)
    except NotImplementedError:
        test.skipTest('Real filesystem symlink creation is not implemented')
    except OSError as exc:
        unsupported = {errno.EPERM, errno.EACCES, errno.ENOSYS, errno.EOPNOTSUPP}
        if getattr(exc, 'winerror', None) == 1314 or exc.errno in unsupported:
            test.skipTest('Real filesystem symlink creation unavailable (permission/platform capability)')
        raise
