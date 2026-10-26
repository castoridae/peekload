// Cuts a release: `pnpm release <patch|minor|major|x.y.z>`.
// Runs the checks, bumps the version in package.json and public/manifest.json, then builds and packs release/.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = ['package.json', 'public/manifest.json'].map((f) => `${root}${f}`);
const versionLine = /("version"\s*:\s*")([^"]+)(")/;

function bump(current, arg) {
  if (/^\d+\.\d+\.\d+$/.test(arg)) return arg;
  const [major, minor, patch] = current.split('.').map(Number);
  if (arg === 'major') return `${major + 1}.0.0`;
  if (arg === 'minor') return `${major}.${minor + 1}.0`;
  if (arg === 'patch') return `${major}.${minor}.${patch + 1}`;
  console.error('Usage: pnpm release <patch|minor|major|x.y.z>');
  process.exit(1);
}

const pnpm = (...args) => execFileSync('pnpm', args, { cwd: root, stdio: 'inherit' });

const texts = files.map((f) => readFileSync(f, 'utf8'));
const versions = texts.map((t) => t.match(versionLine)?.[2]);
if (new Set(versions).size !== 1 || !versions[0]) {
  console.error(`package.json and manifest.json versions differ or are missing: ${versions.join(' vs ')}`);
  process.exit(1);
}

const current = versions[0];
const next = bump(current, process.argv[2] ?? '');
if (next === current) {
  console.error(`Version is already ${current}.`);
  process.exit(1);
}

// Check before touching any file, so a failure leaves nothing to revert.
pnpm('check');
for (const [i, f] of files.entries()) writeFileSync(f, texts[i].replace(versionLine, `$1${next}$3`));
console.log(`\nVersion ${current} -> ${next}\n`);
pnpm('zip');
console.log(`\nReleased ${next}. Commit the bump and tag it: git tag v${next}`);
