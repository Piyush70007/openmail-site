"""Generated landing assets cannot turn the repository into a public directory."""
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from backend import application
from backend.static_assets import MAILBOX_FILES, landing_path
from scripts.build_static import build


def fixture_tree(root):
    for name in MAILBOX_FILES:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('unchanged mailbox: ' + name)
    compiled = root / 'landing-dist'
    assets = compiled / 'landing-assets'
    assets.mkdir(parents=True)
    (compiled / 'index.html').write_text('<main>React homepage</main><script type="module" src="/landing-assets/index-test.js"></script>')
    (assets / 'index-test.js').write_text('document.documentElement.dataset.built = "true";')
    (assets / 'index-test.css').write_text('body { background: black; }')
    # None of these inputs belongs in the deployment CDN directory.
    (root / 'index.html').write_text('legacy homepage')
    (root / 'app.js').write_text('legacy demo script')
    (root / '.env.local').write_text('SYNTHETIC_PRIVATE_VALUE=never-publish')
    (root / 'backend').mkdir()
    (root / 'backend/core.py').write_text('SYNTHETIC_PRIVATE_SOURCE = True')
    (compiled / 'private.env').write_text('not-an-asset')
    (compiled / '.vite').mkdir()
    (compiled / '.vite/manifest.json').write_text('{}')
    return compiled


def test_packaging_uses_built_homepage_and_exact_mailbox_allowlist(tmp_path):
    compiled = fixture_tree(tmp_path)
    build(tmp_path)
    output = tmp_path / 'public'
    expected = MAILBOX_FILES | {'index.html', 'landing-assets/index-test.js', 'landing-assets/index-test.css'}
    actual = {path.relative_to(output).as_posix() for path in output.rglob('*') if path.is_file()}
    assert actual == expected
    assert (output / 'index.html').read_bytes() == (compiled / 'index.html').read_bytes()
    assert 'legacy' not in (output / 'index.html').read_text()
    for name in MAILBOX_FILES:
        assert (output / name).read_bytes() == (tmp_path / name).read_bytes()


def test_missing_build_fails_before_replacing_existing_public_files(tmp_path):
    output = tmp_path / 'public'
    output.mkdir()
    (output / 'existing.html').write_text('previous successful build')
    with pytest.raises(ValueError, match='Built homepage missing'):
        build(tmp_path)
    assert (output / 'existing.html').read_text() == 'previous successful build'


@pytest.mark.parametrize('unsafe_name', ['source.js.map', '.env', 'backend.py', 'private.json'])
def test_unexpected_generated_asset_fails_packaging(tmp_path, unsafe_name):
    compiled = fixture_tree(tmp_path)
    (compiled / 'landing-assets' / unsafe_name).write_text('must not publish')
    with pytest.raises(ValueError, match='Unexpected generated landing asset'):
        build(tmp_path)
    assert not (tmp_path / 'public').exists()


def test_asset_symlink_cannot_publish_server_source(tmp_path):
    compiled = fixture_tree(tmp_path)
    (compiled / 'landing-assets/leak.js').symlink_to(tmp_path / 'backend/core.py')
    assert landing_path(compiled, 'landing-assets/leak.js') is None
    with pytest.raises(ValueError, match='symlinks'):
        build(tmp_path)


@pytest.mark.parametrize('path', ['../backend/core.py', '/backend/core.py', 'landing-assets/../../backend/core.py',
                                  'landing-assets/../private.env', 'landing-assets/nested/source.js',
                                  'landing-assets/.hidden.js', 'landing-assets/index-test.js.map'])
def test_landing_path_rejects_traversal_sources_and_maps(tmp_path, path):
    compiled = fixture_tree(tmp_path)
    assert landing_path(compiled, path) is None


def test_fastapi_serves_compiled_html_assets_and_unchanged_mailbox(tmp_path, monkeypatch):
    compiled = fixture_tree(tmp_path)
    monkeypatch.setattr(application, 'ROOT', tmp_path)
    monkeypatch.setattr(application, 'LANDING_DIR', compiled)
    with TestClient(application.app, base_url='https://openmail.test') as client:
        for url in ('/', '/index.html'):
            response = client.get(url)
            assert response.status_code == 200
            assert response.content == (compiled / 'index.html').read_bytes()
            assert response.headers['x-content-type-options'] == 'nosniff'
        assert client.head('/').content == b''
        response = client.get('/landing-assets/index-test.js')
        assert response.status_code == 200
        assert response.content == (compiled / 'landing-assets/index-test.js').read_bytes()
        assert client.get('/app.html').content == (tmp_path / 'app.html').read_bytes()
        assert client.post('/landing-assets/index-test.js').status_code == 404


@pytest.mark.parametrize('path', ['/frontend/index.html', '/frontend/src/App.jsx', '/backend/core.py', '/.env.local',
                                  '/landing-dist/index.html', '/landing-assets/index-test.js.map',
                                  '/landing-assets/%2e%2e/backend/core.py', '/landing-assets/%2e%2e/.env.local',
                                  '/landing-assets/%2e%2e%2fprivate.env', '/app.js', '/.vite/manifest.json'])
def test_fastapi_denies_sources_legacy_demo_and_traversal(tmp_path, monkeypatch, path):
    compiled = fixture_tree(tmp_path)
    monkeypatch.setattr(application, 'ROOT', tmp_path)
    monkeypatch.setattr(application, 'LANDING_DIR', compiled)
    with TestClient(application.app, base_url='https://openmail.test') as client:
        response = client.get(path)
        assert response.status_code == 404
        assert 'SYNTHETIC_PRIVATE' not in response.text


def test_missing_local_homepage_never_falls_back_to_old_root_index(tmp_path, monkeypatch):
    (tmp_path / 'index.html').write_text('legacy homepage')
    monkeypatch.setattr(application, 'ROOT', tmp_path)
    monkeypatch.setattr(application, 'LANDING_DIR', tmp_path / 'landing-dist')
    with TestClient(application.app, base_url='https://openmail.test') as client:
        response = client.get('/')
        assert response.status_code == 503
        assert response.json() == {'error': 'The homepage build is not available.'}
