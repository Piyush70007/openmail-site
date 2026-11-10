// Vercel's FastAPI builder installs Python dependencies with uv, not npm.
// Keep that install step intact and install the locked frontend tools here.
import { execFileSync } from 'node:child_process';

if (process.env.VERCEL === '1') {
  execFileSync('npm', ['ci', '--ignore-scripts', '--include=dev'], { stdio: 'inherit' });
}
