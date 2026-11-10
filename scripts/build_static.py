"""Package the compiled homepage and explicit approved mailbox assets only."""
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.static_assets import MAILBOX_FILES, landing_files, safe_file  # noqa: E402


def build(root=ROOT):
    root = Path(root)
    compiled = root / 'landing-dist'
    landing = landing_files(compiled)
    sources = [(root / name, name) for name in sorted(MAILBOX_FILES)]
    sources.extend((compiled / name, name) for name in landing)
    for source, name in sources:
        if safe_file(root, source.relative_to(root).as_posix()) is None:
            raise ValueError(f'Required public asset missing or unsafe: {name}')
    destination = root / 'public'
    if destination.is_symlink():
        raise ValueError('The generated public directory must not be a symlink.')
    # Validate the whole input before replacing the generated deployment output.
    if destination.exists():
        shutil.rmtree(destination)
    for source, name in sources:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    print(f'Prepared {len(landing)} compiled homepage files and {len(MAILBOX_FILES)} approved mailbox assets.')


if __name__ == '__main__':
    build()
