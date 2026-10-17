import { COPY_FORMATS, FORMATS, isFormatId } from '../shared/formats.ts';
import { renderHistoryList } from '../shared/history-list.ts';
import { initI18n, locale, localize, plural, t } from '../shared/i18n.ts';
import { icon } from '../shared/icons.ts';
import { getPayload, listHistory, renameExport } from '../shared/messages.ts';
import { getSettings, setSettings } from '../shared/settings.ts';
import type { FormatId, JsonView, PayloadRecord } from '../shared/types.ts';
import { marked, renderTree } from './json-tree.ts';
import { parseCsv, toObjects, toTsv } from './lib/csv.ts';
import { type DiffOp, diffLines, diffStats, withContext } from './lib/diff.ts';
import { minifyJson, reindentJson } from './lib/json-format.ts';
import { evaluatePath, type Json, type PathResult, searchJson, sortKeys } from './lib/json-path.ts';
import { prettyXml, xmlSegments } from './lib/xml.ts';

const DISPLAY_LIMIT = 5 * 1024 * 1024; // above this only the beginning is shown
const HIGHLIGHT_LIMIT = 512 * 1024; // above this no syntax highlighting
const TABLE_ROWS = 2000; // CSV rows rendered (the filter still searches all of them)
const PATH_RESULTS = 500; // path results shown in the tree
const DIFF_MAX_LINES = 200_000; // total across both exports
const DIFF_RENDER_LINES = 20_000;
const FILE_DIR = 'peekload'; // subfolder of Downloads for "Copy as file"

const VIEWS: Record<FormatId, ReadonlyArray<readonly [view: string, labelKey: string]>> = {
  json: [
    ['tree', 'viewTree'],
    ['pretty', 'viewPretty'],
    ['raw', 'viewRaw'],
  ],
  csv: [
    ['table', 'viewTable'],
    ['raw', 'viewRaw'],
  ],
  xml: [
    ['pretty', 'viewPretty'],
    ['raw', 'viewRaw'],
  ],
  text: [],
};

await initI18n();
localize();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const mainEl = $('main');
const noticeEl = $('notice');
const toastEl = $('toast');
const copyFormatEl = $<HTMLSelectElement>('copy-format');
const filterEl = $<HTMLInputElement>('filter');
const compareEl = $<HTMLSelectElement>('compare');

let id: string | null = null;
// Assigned during startup before anything renders; a missing record shows the "expired" state and returns early.
let record = null as unknown as PayloadRecord;
let format: FormatId = 'json';
let parsed: Json | undefined; // JSON: undefined = invalid JSON
let view = 'raw';
let pathResults: PathResult[] | null = null; // $… path results for "Copy result"
let diff: { other: PayloadRecord } | null = null; // set while comparing

// ---------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout>;
function toast(text: string, isError = false) {
  toastEl.textContent = text;
  toastEl.className = `toast show${isError ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = 'toast'), 1800);
}

function notice(text: string) {
  noticeEl.textContent = text;
  noticeEl.hidden = !text;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Time of day; also the date for exports from another day (e.g. comparing with yesterday's). */
function time(ts: number): string {
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
  if (d.toDateString() !== new Date().toDateString()) Object.assign(opts, { day: 'numeric', month: 'short' });
  return d.toLocaleString(locale(), opts);
}

// --- derived data (computed lazily) ----------------------------------------------

let csvCache: ReturnType<typeof parseCsv> | null = null;
function csvData() {
  const tsv = /\.tsv$/i.test(record.filename || '') || /tab-separated/i.test(record.mime || '');
  csvCache ??= parseCsv(record.text, tsv ? '\t' : undefined);
  return csvCache;
}

let xmlCache: string | null = null;
function xmlPretty() {
  xmlCache ??= prettyXml(record.text);
  return xmlCache;
}

let prettyCache: string | null = null;
/** Pretty JSON without JSON.stringify, so large numbers (e.g. IDs) stay exactly as exported. */
function jsonPretty() {
  prettyCache ??= reindentJson(record.text);
  return prettyCache;
}

function textFor(copyFormat: string): string {
  if (format === 'json' && parsed !== undefined) {
    if (copyFormat === 'minified') return minifyJson(record.text);
    if (copyFormat === 'pretty') return jsonPretty();
  }
  if (format === 'csv') {
    if (copyFormat === 'tsv') return toTsv(csvData().rows);
    if (copyFormat === 'json') return JSON.stringify(toObjects(csvData().rows), null, 2);
  }
  if (format === 'xml' && copyFormat === 'pretty') return xmlPretty();
  return record.text;
}

// --- clipboard -------------------------------------------------------------------

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback: works on extension pages with the clipboardWrite permission,
    // even when the document doesn't have focus yet.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    return ok;
  }
}

async function copy(copyFormat: string = copyFormatEl.value) {
  const ok = await copyText(textFor(copyFormat));
  toast(t(ok ? 'toastCopied' : 'toastCopyFailed'), !ok);
  return ok;
}

async function copyPath(path: string) {
  const ok = await copyText(path);
  toast(ok ? t('toastPathCopied', path) : t('toastCopyFailed'), !ok);
}

// --- syntax highlighting ---------------------------------------------------------

const JSON_TOKEN_RE =
  /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function highlightJson(el: HTMLElement, text: string) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(JSON_TOKEN_RE)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    const span = document.createElement('span');
    if (m[1] !== undefined) {
      span.className = m[2] ? 'k' : 's';
      span.textContent = m[1];
      frag.append(span);
      if (m[2]) frag.append(m[2]);
    } else {
      span.className = m[3] ? 'l' : 'n';
      span.textContent = m[0];
      frag.append(span);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  el.replaceChildren(frag);
}

function highlightXml(el: HTMLElement, text: string) {
  const frag = document.createDocumentFragment();
  for (const [cls, part] of xmlSegments(text)) {
    if (!cls) {
      frag.append(part);
      continue;
    }
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = part;
    frag.append(span);
  }
  el.replaceChildren(frag);
}

// --- views -----------------------------------------------------------------------

function availableViews() {
  if (format === 'json' && parsed === undefined) return [];
  return VIEWS[format];
}

function renderViewButtons() {
  const views = availableViews();
  const box = $('views');
  box.hidden = views.length < 2;
  box.replaceChildren(
    ...views.map(([value, labelKey]) => {
      const b = document.createElement('button');
      b.textContent = t(labelKey);
      b.setAttribute('aria-pressed', String(!diff && view === value));
      b.addEventListener('click', () => {
        view = value;
        if (format === 'json') setSettings({ jsonView: value as JsonView });
        stopDiff();
      });
      return b;
    }),
  );
}

function render() {
  renderViewButtons();
  const notes: string[] = [];
  $('diffbar').hidden = !diff;
  $('filterbar').hidden = !!diff || !(view === 'tree' || view === 'table');
  // Hide the toolbar entirely when empty (e.g. plain text: one view, no filter).
  $('toolbar').hidden = $('views').hidden && $('filterbar').hidden && $('diffbar').hidden;
  $('copy-result').hidden = true;
  filterEl.classList.remove('invalid');
  pathResults = null;

  if (diff) renderDiff(notes, diff);
  else if (view === 'tree') renderJsonTree();
  else if (view === 'table') renderTable(notes);
  else renderText(notes);

  if (format === 'json' && parsed === undefined) notes.unshift(t('noticeInvalidJson'));
  notice(notes.join(' '));
}

function renderText(notes: string[]) {
  let text = record.text;
  let highlight: ((el: HTMLElement, text: string) => void) | null = null;
  if (format === 'json' && parsed !== undefined) {
    if (view === 'pretty') text = jsonPretty();
    highlight = highlightJson;
  } else if (format === 'xml') {
    if (view === 'pretty') text = xmlPretty();
    highlight = highlightXml;
  }

  const truncated = text.length > DISPLAY_LIMIT;
  const shown = truncated ? text.slice(0, DISPLAY_LIMIT) : text;
  const pre = document.createElement('pre');
  pre.className = 'mono';
  if (highlight && shown.length <= HIGHLIGHT_LIMIT) highlight(pre, shown);
  else pre.textContent = shown;
  mainEl.replaceChildren(pre);

  if (truncated) notes.push(t('noticeTruncated', formatBytes(DISPLAY_LIMIT)));
}

function renderJsonTree() {
  if (parsed === undefined) return;
  const q = filterEl.value.trim();
  const box = document.createElement('div');
  box.className = 'tree mono';
  const info = $('filter-info');
  info.textContent = '';

  if (q.startsWith('$')) {
    let results: PathResult[];
    try {
      results = evaluatePath(parsed, q);
    } catch (e) {
      filterEl.classList.add('invalid');
      info.textContent = (e as Error).message;
      mainEl.replaceChildren(box);
      return;
    }
    pathResults = results;
    info.textContent = results.length ? plural('nResults', results.length) : t('noResults');
    if (results.length > PATH_RESULTS) info.textContent += ` ${t('resultsShown', PATH_RESULTS)}`;
    $('copy-result').hidden = !results.length;
    for (const r of results.slice(0, PATH_RESULTS)) {
      const wrap = document.createElement('div');
      wrap.className = 'result';
      wrap.append(renderTree(r.value, { rootParts: r.parts, rootLabel: r.path, expandDepth: 1, onPath: copyPath }));
      box.append(wrap);
    }
  } else if (q) {
    const found = searchJson(parsed, q);
    info.textContent = found.count
      ? `${plural('nMatches', found.count)}${found.truncated ? ` ${t('matchesTruncated')}` : ''}`
      : t('noMatches');
    if (found.count) {
      box.append(renderTree(parsed, { filter: { ...found, query: q.toLowerCase() }, onPath: copyPath }));
    }
  } else {
    box.append(renderTree(parsed, { expandDepth: Array.isArray(parsed) ? 1 : 2, onPath: copyPath }));
  }
  mainEl.replaceChildren(box);
}

function renderTable(notes: string[]) {
  const { rows, delimiter } = csvData();
  const q = filterEl.value.trim().toLowerCase();
  const info = $('filter-info');
  if (!rows.length) {
    info.textContent = '';
    mainEl.replaceChildren(
      Object.assign(document.createElement('p'), { className: 'table-empty', textContent: t('emptyFile') }),
    );
    return;
  }

  const header = rows[0] ?? [];
  let body = rows.slice(1).map((r, i): [number, string[]] => [i + 1, r]);
  const total = body.length;
  if (q) body = body.filter(([, r]) => r.some((c) => c.toLowerCase().includes(q)));
  const sep = delimiter === '\t' ? t('separatorTab') : delimiter;
  info.textContent = q
    ? plural('rowsFiltered', total, [body.length, total])
    : t('tableInfo', plural('nRows', total), sep);

  const shown = body.slice(0, TABLE_ROWS);
  if (body.length > TABLE_ROWS) {
    notes.push(t(q ? 'noticeTableRowsFiltered' : 'noticeTableRows', TABLE_ROWS));
  }
  const width = Math.max(header.length, ...shown.map(([, r]) => r.length));

  const table = document.createElement('table');
  table.className = 'csv';
  const thead = table.createTHead().insertRow();
  thead.append(Object.assign(document.createElement('th'), { textContent: '#' }));
  for (let i = 0; i < width; i++) {
    const th = document.createElement('th');
    th.append(marked(header[i] ?? '', q));
    thead.append(th);
  }
  const tbody = table.createTBody();
  for (const [n, r] of shown) {
    const tr = tbody.insertRow();
    const num = tr.insertCell();
    num.className = 'num';
    num.textContent = String(n);
    for (let i = 0; i < width; i++) tr.insertCell().append(marked(r[i] ?? '', q));
  }
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.append(table);
  mainEl.replaceChildren(wrap);
}

// --- history sidebar ---------------------------------------------------------------

async function renderSidebar() {
  const items = await listHistory();
  $('sidebar-list').hidden = !items.length;
  $('sidebar-empty').hidden = !!items.length;
  renderHistoryList($('sidebar-list'), items, {
    currentId: id,
    // Same tab, so Back returns to the previous export; noCopy keeps browsing from overwriting the clipboard.
    onSelect: (item) => item.id !== id && location.assign(`?id=${encodeURIComponent(item.id)}&noCopy=1`),
  });
}

function setSidebar(open: boolean) {
  $('sidebar').hidden = !open;
  $('history-toggle').setAttribute('aria-pressed', String(open));
  try {
    localStorage.setItem('sidebar', open ? '1' : '0');
  } catch {}
  if (open) renderSidebar();
}

// --- compare -----------------------------------------------------------------------

function displayName(rec: PayloadRecord): string {
  return rec.label || rec.filename || `${t('exportFallbackName')}.${FORMATS[rec.format || 'json']?.ext ?? 'txt'}`;
}

function diffText(rec: PayloadRecord, sort: boolean): string {
  const fmt = rec.format || 'json';
  if (fmt === 'json') {
    try {
      const v = JSON.parse(rec.text);
      return JSON.stringify(sort ? sortKeys(v) : v, null, 2);
    } catch {}
  }
  if (fmt === 'xml') return prettyXml(rec.text);
  return rec.text.replace(/\r\n?/g, '\n');
}

function renderDiff(notes: string[], { other }: { other: PayloadRecord }) {
  const sort = $<HTMLInputElement>('diff-sort').checked;
  const bothJson = (other.format || 'json') === 'json' && format === 'json';
  $('diff-sort-wrap').hidden = !bothJson;

  const [older, newer] = (other.createdAt ?? 0) <= record.createdAt ? [other, record] : [record, other];
  const a = diffText(older, sort).split('\n');
  const b = diffText(newer, sort).split('\n');
  const box = document.createElement('div');
  box.className = 'diff mono';
  mainEl.replaceChildren(box);

  const label = t('diffLabel', displayName(older), time(older.createdAt), displayName(newer), time(newer.createdAt));
  const empty = (text: string) =>
    box.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: text }));

  if (a.length + b.length > DIFF_MAX_LINES) {
    $('diff-info').textContent = label;
    return empty(t('diffTooBig'));
  }
  const ops = diffLines(a, b);
  if (!ops) {
    $('diff-info').textContent = label;
    return empty(t('diffTooDifferent'));
  }
  const { added, removed } = diffStats(ops);
  $('diff-info').textContent = `${label} · +${added} −${removed}`;
  if (!added && !removed) {
    return empty(t(bothJson && sort ? 'diffIdenticalSorted' : 'diffIdentical'));
  }

  const line = (op: DiffOp) => {
    const div = document.createElement('div');
    div.className = `line${op.type === '+' ? ' add' : op.type === '-' ? ' del' : ''}`;
    div.dataset.sign = op.type === ' ' ? '' : op.type === '-' ? '−' : '+';
    div.textContent = op.text || ' ';
    return div;
  };
  let rendered = 0;
  for (const op of withContext(ops, 3)) {
    if (rendered >= DIFF_RENDER_LINES) {
      notes.push(t('noticeDiffLines', DIFF_RENDER_LINES));
      break;
    }
    if (op.type === 'skip') {
      const btn = document.createElement('button');
      btn.className = 'skip';
      btn.textContent = plural('nUnchangedLines', op.lines.length);
      btn.addEventListener('click', () => btn.replaceWith(...op.lines.map(line)));
      box.append(btn);
      rendered++;
    } else {
      box.append(line(op));
      rendered++;
    }
  }
}

async function populateCompare() {
  const items = await listHistory();
  const others = items.filter((i) => i.id !== id);
  $('compare-wrap').hidden = !others.length;
  compareEl.replaceChildren(new Option(t('viewerCompare'), ''));
  for (const i of others) {
    const fmt = FORMATS[i.format]?.short ?? i.format;
    compareEl.append(
      new Option(`${i.label || i.filename || t('exportFallbackName')} · ${fmt} · ${time(i.createdAt)}`, i.id),
    );
  }
}

async function startDiff(otherId: string) {
  const other = await getPayload(otherId);
  if (!other) {
    toast(t('toastExpired'), true);
    compareEl.value = '';
    return;
  }
  diff = { other };
  render();
}

function stopDiff() {
  diff = null;
  compareEl.value = '';
  render();
}

// --- export name ----------------------------------------------------------------------

/** Filename safe for chrome.downloads (no / \ : * ? " < > | and no trailing dots). */
function safeFilename(name: string, ext: string): string {
  const base =
    name
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are invalid in file names
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, 150) || 'export';
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : base + ext;
}

function saveFilename() {
  const ext = /\.[a-z0-9]+$/i.exec(record.filename || '')?.[0] || `.${FORMATS[format].ext}`;
  return safeFilename(record.label || record.filename || 'export', ext);
}

/**
 * File for "Copy as file": content follows the selected copy format (e.g. pretty JSON reads better
 * in Claude Code than one long line), with a matching extension.
 */
function copyFile() {
  const copyFormat = copyFormatEl.value;
  let ext = /\.[a-z0-9]+$/i.exec(record.filename || '')?.[0] || `.${FORMATS[format].ext}`;
  let mime = record.mime || FORMATS[format].mime;
  if (format === 'csv' && copyFormat === 'tsv') [ext, mime] = ['.tsv', 'text/tab-separated-values'];
  if (format === 'csv' && copyFormat === 'json') [ext, mime] = ['.json', 'application/json'];
  const base = record.label || (record.filename || '').replace(/\.[a-z0-9]+$/i, '') || t('exportFallbackName');
  // No spaces, so the path pastes cleanly as @path in Claude Code.
  return { text: textFor(copyFormat), name: safeFilename(base, ext).replace(/\s+/g, '_'), mime };
}

/**
 * Waits for the download to finish; resolves with the DownloadItem (full path in `filename`).
 * Long timeout because with "Ask where to save" enabled the browser may still show a save dialog.
 */
function waitForDownload(id: number, timeoutMs = 10 * 60_000): Promise<chrome.downloads.DownloadItem> {
  return new Promise((resolve, reject) => {
    const finish = <V>(fn: (value: V) => void, value: V) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      fn(value);
    };
    const check = async () => {
      const [item] = await chrome.downloads.search({ id });
      if (item?.state === 'complete') finish(resolve, item);
      else if (item?.state === 'interrupted') finish(reject, new Error(item.error || 'interrupted'));
    };
    const onChanged = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id === id && delta.state) check();
    };
    const timer = setTimeout(() => finish(reject, new Error('timeout')), timeoutMs);
    chrome.downloads.onChanged.addListener(onChanged);
    check();
  });
}

function renderMeta() {
  const name = displayName(record);
  document.title = t('viewerDocTitle', name);
  $('filename').textContent = name;
  const badge = $('format-badge');
  badge.textContent = FORMATS[format].short;
  badge.dataset.format = format;
  badge.hidden = false;

  const sub = $('sub');
  sub.replaceChildren();
  const parts = [];
  if (record.label && record.filename) parts.push(record.filename);
  parts.push(formatBytes(new Blob([record.text]).size), time(record.createdAt));
  sub.append(parts.join(' · '));
  if (record.pageUrl) {
    sub.append(' · ');
    const a = document.createElement('a');
    a.href = record.pageUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    try {
      a.textContent = record.pageTitle || new URL(record.pageUrl).host;
    } catch {
      a.textContent = record.pageUrl;
    }
    sub.append(a);
  }
}

function startRename() {
  const input = $<HTMLInputElement>('rename-input');
  input.value = record.label || record.filename || '';
  $('filename').hidden = true;
  $('rename').hidden = true;
  input.hidden = false;
  input.focus();
  input.select();
}

async function finishRename(save: boolean) {
  const input = $<HTMLInputElement>('rename-input');
  if (input.hidden || !id) return;
  input.hidden = true;
  $('filename').hidden = false;
  $('rename').hidden = false;
  if (!save) return;
  // A name equal to the filename means no custom name.
  const label = input.value.trim() === record.filename ? '' : input.value.trim();
  if (label === (record.label || '')) return;
  const ok = await renameExport(id, label);
  if (!ok) return toast(t('toastNameFailed'), true);
  record.label = label;
  renderMeta();
  if (!$('sidebar').hidden) renderSidebar();
  toast(t(label ? 'toastNameSaved' : 'toastNameRemoved'));
}

// --- actions ----------------------------------------------------------------------------

$('copy').addEventListener('click', () => copy());
copyFormatEl.addEventListener('change', async () => {
  const { copyFormats } = await getSettings();
  await setSettings({ copyFormats: { ...copyFormats, [format]: copyFormatEl.value } });
});

$('copy-result').addEventListener('click', async () => {
  if (!pathResults?.length) return;
  const value = pathResults.length === 1 ? pathResults[0]?.value : pathResults.map((r) => r.value);
  const ok = await copyText(JSON.stringify(value, null, 2));
  toast(t(ok ? 'toastResultCopied' : 'toastCopyFailed'), !ok);
});

let filterTimer: ReturnType<typeof setTimeout>;
filterEl.addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(render, 200);
});

compareEl.addEventListener('change', () => {
  if (compareEl.value) startDiff(compareEl.value);
  else stopDiff();
});
$('diff-close').addEventListener('click', stopDiff);
$('diff-sort').addEventListener('change', render);

$('filename').addEventListener('click', startRename);
$('rename').addEventListener('click', startRename);
$('rename-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') finishRename(true);
  if (e.key === 'Escape') finishRename(false);
});
$('rename-input').addEventListener('blur', () => finishRename(true));

$('download').addEventListener('click', async () => {
  const blob = new Blob([record.text], { type: record.mime || FORMATS[format].mime });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: saveFilename(), saveAs: true });
  } catch (e) {
    toast(t('toastSaveFailed', (e as Error).message), true);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
});

// The web clipboard can't hold files (only text, HTML, PNG), so save the file to Downloads via
// chrome.downloads and copy its full path instead; e.g. Claude Code reads the file from a pasted path.
$('copy-file').addEventListener('click', async () => {
  const { text, name, mime } = copyFile();
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  try {
    const id = await chrome.downloads.download({
      url,
      filename: `${FILE_DIR}/${name}`,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    const item = await waitForDownload(id);
    const ok = await copyText(item.filename);
    toast(ok ? t('toastFileCopied', item.filename.split(/[\\/]/).pop()) : t('toastCopyFailed'), !ok);
  } catch (e) {
    toast(t('toastFileFailed', (e as Error).message), true);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
});

$('close').addEventListener('click', () => window.close());
$('history-toggle').addEventListener('click', () => setSidebar(!!$('sidebar').hidden));
// New exports can arrive while this tab is in the background.
window.addEventListener('focus', () => {
  if (!$('sidebar').hidden) renderSidebar();
});

document.addEventListener('keydown', (e) => {
  const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  // Ctrl/Cmd+C with no selection copies everything
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !inField && !String(window.getSelection())) {
    e.preventDefault();
    copy();
  }
  if (e.key === '/' && !inField && !$('filterbar').hidden) {
    e.preventDefault();
    filterEl.focus();
  }
});

// --- startup ------------------------------------------------------------------------------

(async () => {
  const params = new URLSearchParams(location.search);
  id = params.get('id');
  let sidebarOpen = false;
  try {
    sidebarOpen = localStorage.getItem('sidebar') === '1';
  } catch {}
  if (sidebarOpen) setSidebar(true);
  const loaded = id ? await getPayload(id) : null;

  if (!loaded) {
    $('filename').textContent = t('viewerNoData');
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const text = document.createElement('span');
    text.textContent = t('noticeExpired');
    empty.append(icon('clock'), text);
    mainEl.replaceChildren(empty);
    for (const el of document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
      '.vw-actions :is(button, select):not(#close), .title-row button',
    )) {
      el.disabled = true;
    }
    $('toolbar').hidden = true;
    document.body.classList.remove('preload');
    return;
  }
  record = loaded;

  format = isFormatId(record.format) ? record.format : 'json';
  if (format === 'json') {
    try {
      parsed = JSON.parse(record.text);
    } catch {
      parsed = undefined;
    }
  }

  const settings = await getSettings();
  const views = availableViews().map(([v]) => v);
  view = format === 'json' && views.includes(settings.jsonView) ? settings.jsonView : (views[0] ?? 'raw');

  const copyOptions = COPY_FORMATS[format];
  copyFormatEl.replaceChildren(...copyOptions.map(([value, key]) => new Option(t(key), value)));
  copyFormatEl.value = settings.copyFormats[format] ?? 'raw';
  copyFormatEl.hidden = copyOptions.length < 2;
  filterEl.placeholder = t(format === 'csv' ? 'filterPlaceholderCsv' : 'filterPlaceholderJson');

  renderMeta();
  render();
  populateCompare();
  mainEl.focus();
  requestAnimationFrame(() => document.body.classList.remove('preload'));

  if (settings.autoCopy && !params.has('noCopy')) await copy(copyFormatEl.value);
})();
