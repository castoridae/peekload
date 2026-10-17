// JSON tree for the viewer: nodes render lazily (large exports don't build the whole DOM up front),
// optional searchJson filter (shows only branches with matches) and query highlighting.
import { t } from '../shared/i18n.ts';
import { children, formatPath, isContainer, type Json, type PathPart, type SearchResult } from './lib/json-path.ts';

const CHUNK = 200; // children rendered at once; the rest behind a "show more" button
export interface TreeFilter extends Pick<SearchResult, 'match' | 'keep'> {
  /** Lowercase text to highlight. */
  query: string;
}

export interface TreeOptions {
  /** How deep to expand nodes initially. */
  expandDepth?: number;
  /** From searchJson; shows only branches with matches. */
  filter?: TreeFilter;
  /** Key click (e.g. copy the path). */
  onPath?: (path: string) => void;
  /** For path results (the node is not the document root). */
  rootParts?: PathPart[];
  rootLabel?: string;
}

function preview(value: Json[] | { [key: string]: Json }) {
  if (Array.isArray(value)) return `[${value.length}]`;
  const n = Object.keys(value).length;
  return `{${n}}`;
}

/** Text with occurrences of `query` highlighted. `query` must already be lowercase. */
export function marked(text: string, query: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (!query) {
    frag.append(text);
    return frag;
  }
  const lower = text.toLowerCase();
  let pos = 0;
  for (let i = lower.indexOf(query); i >= 0; i = lower.indexOf(query, pos)) {
    frag.append(text.slice(pos, i));
    const m = document.createElement('mark');
    m.textContent = text.slice(i, i + query.length);
    frag.append(m);
    pos = i + query.length;
  }
  frag.append(text.slice(pos));
  return frag;
}

function primitive(value: Exclude<Json, unknown[] | object> | null, query: string) {
  const span = document.createElement('span');
  if (typeof value === 'string') {
    span.className = 's';
    span.append(marked(JSON.stringify(value), query));
  } else {
    span.className = typeof value === 'number' ? 'n' : 'l';
    span.append(marked(String(value), query));
  }
  return span;
}

/**
 * Renders the tree. Options:
 * - expandDepth: how deep to expand nodes initially,
 * - filter: { match, keep, query } from searchJson; shows only branches with matches,
 * - onPath(path): key click (e.g. copy the path),
 * - rootParts / rootLabel: for path results (the node is not the document root).
 */
export function renderTree(value: Json, opts: TreeOptions = {}): HTMLElement {
  const { rootParts = [], rootLabel } = opts;
  return node(rootLabel, value, rootParts, 0, opts, opts.filter);
}

function node(
  key: PathPart | undefined,
  value: Json,
  parts: PathPart[],
  depth: number,
  opts: TreeOptions,
  filter: TreeFilter | undefined | null,
): HTMLElement {
  const path = formatPath(parts);
  const query = filter?.query ?? '';
  const el = document.createElement('div');
  el.className = 'node';

  const row = document.createElement('div');
  row.className = 'row';
  el.append(row);

  const caret = document.createElement('button');
  caret.className = 'caret';
  caret.tabIndex = -1;
  row.append(caret);

  if (key !== undefined) {
    const k = document.createElement('span');
    k.className = typeof key === 'number' ? 'key idx' : 'key';
    k.title = t('treeKeyTitle', path);
    k.append(marked(typeof key === 'number' ? String(key) : key, query));
    k.addEventListener('click', () => opts.onPath?.(path));
    row.append(k, document.createTextNode(': '));
  }

  if (!isContainer(value)) {
    caret.disabled = true;
    caret.classList.add('leaf');
    row.append(primitive(value, query));
    return el;
  }

  const summary = document.createElement('span');
  summary.className = 'preview';
  summary.textContent = preview(value);
  row.append(summary);

  // Filter mode: a matching container is shown whole (collapsed); others are expanded and show
  // only the branches leading to matches.
  const childFilter = filter && !filter.match.has(path) ? filter : null;
  const expanded = filter ? !!childFilter : depth < (opts.expandDepth ?? 1);
  let kids: HTMLDivElement | null = null;

  const toggle = (open: boolean) => {
    caret.setAttribute('aria-expanded', String(open));
    if (open && !kids) {
      kids = document.createElement('div');
      kids.className = 'children';
      let list = children(value);
      if (childFilter) list = list.filter(([k]) => childFilter.keep.has(formatPath([...parts, k])));
      renderChunk(kids, list, 0, parts, depth, opts, childFilter);
      el.append(kids);
    }
    if (kids) kids.hidden = !open;
  };
  caret.addEventListener('click', () => toggle(caret.getAttribute('aria-expanded') !== 'true'));
  summary.addEventListener('click', () => toggle(caret.getAttribute('aria-expanded') !== 'true'));
  toggle(expanded);
  return el;
}

function renderChunk(
  container: HTMLElement,
  list: [PathPart, Json][],
  from: number,
  parts: PathPart[],
  depth: number,
  opts: TreeOptions,
  filter: TreeFilter | null,
) {
  const to = Math.min(list.length, from + CHUNK);
  for (let i = from; i < to; i++) {
    const [k, v] = list[i] as [PathPart, Json];
    container.append(node(k, v, [...parts, k], depth + 1, opts, filter));
  }
  if (to < list.length) {
    const more = document.createElement('button');
    more.className = 'more';
    more.textContent = t('treeShowMore', Math.min(CHUNK, list.length - to), list.length - to);
    more.addEventListener('click', () => {
      more.remove();
      renderChunk(container, list, to, parts, depth, opts, filter);
    });
    container.append(more);
  }
}
