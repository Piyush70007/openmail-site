"""Ensure Vercel and local verification use the same runtime dependency set."""
from pathlib import Path
import tomllib


def test_vercel_lock_matches_audited_runtime_requirements():
    root = Path(__file__).resolve().parents[2]
    lock = tomllib.loads((root / 'uv.lock').read_text())
    packages = {package['name']: package for package in lock['package']}
    pending = [item['name'] for item in packages['openmail']['dependencies']]
    deployed = set()
    while pending:
        package = packages[pending.pop()]
        pin = package['name'] + '==' + package['version']
        if pin in deployed:
            continue
        deployed.add(pin)
        pending.extend(item['name'] for item in package.get('dependencies', []))
    audited = {line for line in (root / 'requirements.txt').read_text().splitlines() if line and not line.startswith('#')}
    assert deployed == audited
