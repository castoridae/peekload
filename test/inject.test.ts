// Tests for src/content/inject.ts (bundled like in the real build) in jsdom:
// supported exports go to the extension, everything else downloads normally.
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { detectFormat } from '../src/shared/formats.ts';

const INJECT = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/content/inject.ts', import.meta.url))],
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  write: false,
}).outputFiles[0]?.text as string;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// jsdom's window has no useful types for the globals patched here, so it is driven through loose handles.
// biome-ignore lint/suspicious/noExplicitAny: see above
type Loose = any;
let dom: JSDOM;
let win: Loose;
let exports: Loose[];
let nativeClicks: { href: string; download: string }[];

/** Polls until `cond` holds instead of guessing delays. */
async function waitFor(cond, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) return;
    await tick(5);
  }
}

/**
 * Fresh window with inject.js loaded. `extensionOk` is the simulated bridge.js reply:
 * true = export taken over, false = site disabled.
 */
function setup({ extensionOk = true, bridge = true } = {}) {
  // Closing the previous window clears its timers (e.g. the 60 s deferred revokeObjectURL).
  dom?.window.close();
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://app.example.com/', runScripts: 'outside-only' });
  win = dom.window;
  // Per-window arrays so late events from earlier windows don't leak into the current test.
  const myExports: Loose[] = [];
  const myClicks: { href: string; download: string }[] = [];
  exports = myExports;
  nativeClicks = myClicks;

  // jsdom lacks URL.createObjectURL and downloads; stub them BEFORE injecting the script,
  // since inject.js wraps the natives that a real browser already has.
  let n = 0;
  win.URL.createObjectURL = () => `blob:https://app.example.com/${++n}`;
  win.URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = function () {
    myClicks.push({ href: this.href, download: this.download });
  };
  // jsdom lacks Blob.prototype.text and TextDecoder; shim them via FileReader and Node.
  win.Blob.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const r = new win.FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsText(this);
    });
  };
  win.TextDecoder = TextDecoder;

  if (bridge) {
    win.addEventListener('message', (e) => {
      const d = e.data;
      if (d?.source !== 'peekload' || d.dir !== 'to-ext') return;
      myExports.push(d.payload);
      // jsdom's postMessage sets MessageEvent.source to null, but inject.js requires
      // source === window, so dispatch the event by hand.
      const data = { source: d.source, dir: 'to-page', type: 'result', id: d.id, ok: extensionOk };
      setTimeout(() => win.dispatchEvent(new win.MessageEvent('message', { data, source: win })), 0);
    });
  }

  win.eval(INJECT);
}

function detachedDownload(content, type, name, { dispatch = false } = {}) {
  const blob = new win.Blob([content], type ? { type } : undefined);
  const a = win.document.createElement('a');
  a.href = win.URL.createObjectURL(blob);
  a.download = name;
  if (dispatch) a.dispatchEvent(new win.MouseEvent('click'));
  else a.click();
  return a;
}

const JSON_TEXT = JSON.stringify({ items: [{ id: 1, name: 'Zażółć' }] });

beforeEach(() => setup());
after(() => dom?.window.close());

test('JSON blob + detached a.click() goes to the extension', async () => {
  detachedDownload(JSON_TEXT, 'application/json', 'export.json');
  await waitFor(() => exports.length);
  await tick(50);
  assert.equal(exports.length, 1);
  assert.equal(exports[0].text, JSON_TEXT);
  assert.equal(exports[0].filename, 'export.json');
  assert.equal(exports[0].pageUrl, 'https://app.example.com/');
  assert.equal(nativeClicks.length, 0, 'there should be no native download');
});

test('dispatchEvent(MouseEvent click) FileSaver.js style', async () => {
  detachedDownload(JSON_TEXT, 'application/json', 'fs.json', { dispatch: true });
  await waitFor(() => exports.length);
  await tick(50);
  assert.equal(exports.length, 1);
  assert.equal(nativeClicks.length, 0);
});

test('blob with no type but a .json name', async () => {
  detachedDownload(JSON_TEXT, '', 'no-type.json');
  await tick(50);
  assert.equal(exports.length, 1);
});

test('text/plain blob with JSON content is detected by content', async () => {
  detachedDownload(JSON_TEXT, 'text/plain', 'data.txt');
  await tick(50);
  assert.equal(exports.length, 1);
});

test('base64 data: URL with non-ASCII characters', async () => {
  const a = win.document.createElement('a');
  const b64 = Buffer.from(JSON_TEXT, 'utf8').toString('base64');
  a.href = `data:application/json;base64,${b64}`;
  a.download = 'data.json';
  a.click();
  await tick(50);
  assert.equal(exports.length, 1);
  assert.equal(exports[0].text, JSON_TEXT);
});

test('<a download> link in the DOM: click is intercepted, default action canceled', async () => {
  const a = win.document.createElement('a');
  a.href = win.URL.createObjectURL(new win.Blob([JSON_TEXT], { type: 'application/json' }));
  a.download = 'in-dom.json';
  win.document.body.append(a);
  const ev = new win.MouseEvent('click', { bubbles: true, cancelable: true });
  const notCanceled = a.dispatchEvent(ev);
  await tick(50);
  assert.equal(notCanceled, false);
  assert.equal(exports.length, 1);
});

test('CSV goes to the extension with format csv', async () => {
  detachedDownload('a;b\n1;2\n', 'text/csv', 'file.csv');
  await tick(50);
  assert.equal(exports.length, 1);
  assert.equal(exports[0].format, 'csv');
  assert.equal(nativeClicks.length, 0);
});

test('CSV on a site without CSV enabled (ok: false) → exactly one normal download', async () => {
  setup({ extensionOk: false });
  detachedDownload('a;b\n1;2\n', 'text/csv', 'file.csv');
  await waitFor(() => nativeClicks.length);
  await tick(50);
  assert.equal(exports.length, 1);
  assert.equal(nativeClicks.length, 1);
  assert.equal(nativeClicks[0].download, 'file.csv');
});

test('invalid JSON in a .txt file goes as text', async () => {
  detachedDownload('{this is not json', 'text/plain', 'note.txt');
  await tick(50);
  assert.equal(exports.length, 1);
  assert.equal(exports[0].format, 'text');
});

for (const [type, name] of [
  ['image/svg+xml', 'logo.svg'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'report.xlsx'],
  ['text/html', 'page.html'],
  ['application/pdf', 'invoice.pdf'],
  ['image/png', 'image.png'],
]) {
  test(`${name} does not go to the extension — downloads normally`, async () => {
    detachedDownload('<svg/> %PDF content', type, name);
    await tick(50);
    assert.equal(exports.length, 0);
    assert.equal(nativeClicks.length, 1);
    assert.equal(nativeClicks[0].download, name);
  });
}

// inject.ts shares detectFormat with the service worker; check the bundled script end to end (all formats enabled).
const FORMAT_CASES = [
  ['application/json', 'a.json', '{"a":1}'],
  ['application/json; charset=utf-8', 'a', 'not json'],
  ['', 'a.json', '[1,2]'],
  ['application/vnd.api+json', 'a', '{}'],
  ['text/csv', 'a', 'x;y'],
  ['', 'a.CSV', 'x,y'],
  ['', 'a.tsv', 'x\ty'],
  ['application/octet-stream', 'a.csv', 'x;y'],
  ['text/xml', 'a', '<a/>'],
  ['application/atom+xml', 'feed', '<feed/>'],
  ['', 'a.xml', '<a/>'],
  ['text/plain', 'a.txt', '<?xml version="1.0"?><a/>'],
  ['text/plain', 'a.txt', '{"a":1}'],
  ['text/plain', 'a.txt', 'plain text'],
  ['text/markdown', 'README', '# x'],
  ['', 'app.log', 'line'],
  ['', 'a.md', '# x'],
  ['application/octet-stream', 'bin', '{"a":1}'],
  ['application/octet-stream', 'bin', 'abc'],
  ['image/svg+xml', 'a.svg', '<svg/>'],
  ['text/html', 'a.html', '<html>'],
  ['application/pdf', 'a.pdf', '%PDF'],
  ['', 'a.xlsx', 'PK'],
  ['text/plain', 'backup.sql', 'select 1;'],
  ['text/plain', 'config.yaml', 'a: 1'],
  ['text/plain', 'no-extension', 'text'],
];

test('inject.ts detects formats like shared detectFormat', async () => {
  for (const [type, name, text] of FORMAT_CASES) {
    setup();
    detachedDownload(text, type, name);
    await tick(30);
    const expected = detectFormat({ mime: type, name, text });
    const label = `${type || '(no type)'} ${name}`;
    assert.equal(exports.length, expected ? 1 : 0, label);
    if (expected) assert.equal(exports[0].format, expected, label);
    else assert.equal(nativeClicks.length, 1, label);
  }
});

test('site disabled in the extension (ok: false) → normal download', async () => {
  setup({ extensionOk: false });
  detachedDownload(JSON_TEXT, 'application/json', 'disabled.json');
  await waitFor(() => nativeClicks.length);
  assert.equal(exports.length, 1);
  assert.equal(nativeClicks.length, 1);
  assert.equal(nativeClicks[0].download, 'disabled.json');
});

test('no extension response → normal download after the timeout', { timeout: 10_000 }, async () => {
  setup({ bridge: false });
  detachedDownload(JSON_TEXT, 'application/json', 'timeout.json');
  await tick(3000);
  assert.equal(nativeClicks.length, 0, 'no download before the timeout');
  await waitFor(() => nativeClicks.length, 3000);
  assert.equal(nativeClicks.length, 1);
  assert.equal(nativeClicks[0].download, 'timeout.json');
});

test('plain links and a.click() without download are left alone', async () => {
  const a = win.document.createElement('a');
  a.href = 'https://example.com/page';
  a.click();
  await tick(50);
  assert.equal(exports.length, 0);
  assert.equal(nativeClicks.length, 1);
});

test('double injection does not duplicate interception', async () => {
  win.eval(INJECT);
  detachedDownload(JSON_TEXT, 'application/json', 'once.json');
  await tick(50);
  assert.equal(exports.length, 1);
});
