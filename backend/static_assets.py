"""Explicit public-file boundaries shared by packaging and local serving."""
from pathlib import Path
import re


MAILBOX_FILES = frozenset((
    'app.html', 'styles.css', 'app.css', 'workspace.css', 'insights.css', 'app-ui.js',
    'app-ai-documents.js', 'favicon.svg', 'vendor/MAMMOTH-LICENSE.txt',
    'vendor/PDFJS-LICENSE.txt', 'vendor/mammoth.browser.min.js',
    'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs',
))
LANDING_ASSET = re.compile(
    r'landing-assets/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|css|svg|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|mp4|webm)$'
)


def safe_file(directory: Path, name: str):
    """Resolve a fixed public name without following symlinks or escaping its root."""
    candidate = directory / name
    for parent in (candidate, *candidate.parents):
        if parent == directory.parent:
            break
        if parent.is_symlink():
            return None
    if not candidate.is_file():
        return None
    if not candidate.resolve().is_relative_to(directory.resolve()):
        return None
    return candidate


def landing_path(build_dir: Path, name: str):
    """Resolve only generated HTML/assets, excluding maps, symlinks and traversal."""
    if name != 'index.html' and not LANDING_ASSET.fullmatch(name):
        return None
    return safe_file(build_dir, name)


def landing_files(build_dir: Path):
    """Return the built homepage plus allowlisted emitted files; fail before deploy."""
    if landing_path(build_dir, 'index.html') is None:
        raise ValueError('Built homepage missing or unsafe. Run npm run build before serving or deploying.')
    names = ['index.html']
    assets = build_dir / 'landing-assets'
    if assets.is_symlink():
        raise ValueError('Generated landing assets must not contain symlinks.')
    if assets.exists():
        for path in sorted(assets.rglob('*')):
            if path.is_symlink():
                raise ValueError('Generated landing assets must not contain symlinks.')
            if path.is_file():
                name = path.relative_to(build_dir).as_posix()
                if landing_path(build_dir, name) is None:
                    raise ValueError(f'Unexpected generated landing asset: {name}')
                names.append(name)
    return tuple(names)
