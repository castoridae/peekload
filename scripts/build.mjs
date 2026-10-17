// Bundles src/ into dist/ (load that directory unpacked). `node scripts/build.mjs --watch` rebuilds on change.
import { cp, mkdir, readdir, rm, watch } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');

// Page and service-worker bundles are ES modules; content scripts are classic scripts (IIFE) without imports.
const common = { bundle: true, target: 'chrome111', sourcemap: false, legalComments: 'none', logLevel: 'info' };
const moduleEntries = ['background/index', 'popup/popup', 'options/options', 'viewer/viewer'];
const scriptEntries = ['content/inject', 'content/bridge'];

const entry = (name) => ({ in: join(src, `${name}.ts`), out: name });
const configs = [
  { ...common, format: 'esm', entryPoints: moduleEntries.map(entry), outdir: dist },
  ...scriptEntries.map((name) => ({ ...common, format: 'iife', entryPoints: [entry(name)], outdir: dist })),
];

const STATIC = /\.(html|css|svg)$/;

// Static assets from src/ (the .ts files are bundled instead); copied file by file so no empty directories appear.
async function copyStatic() {
  await cp(join(root, 'public'), dist, { recursive: true });
  for (const file of await readdir(src, { recursive: true })) {
    if (STATIC.test(file)) await cp(join(src, file), join(dist, file));
  }
}

const watching = process.argv.includes('--watch');

if (!watching) {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await copyStatic();
  await Promise.all(configs.map((c) => build(c)));
} else {
  await mkdir(dist, { recursive: true });
  await copyStatic();
  await Promise.all(configs.map(async (c) => (await context(c)).watch()));
  for await (const e of watch(src, { recursive: true })) {
    if (e.filename && STATIC.test(e.filename)) await copyStatic();
  }
}
