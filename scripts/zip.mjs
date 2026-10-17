// Packs dist/ into release/peekload-<version>.zip for the Chrome Web Store (run `pnpm zip`, which builds first).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(`${root}dist/manifest.json`, 'utf8'));
const out = `${root}release/peekload-${version}.zip`;

mkdirSync(`${root}release`, { recursive: true });
rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', '-D', out, '.', '-x', '.*'], { cwd: `${root}dist`, stdio: 'inherit' });
console.log(`\n${out}`);
