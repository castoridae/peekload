// JSON paths ($.items[0].name) and key/value search for the viewer's tree.
import { t } from '../../shared/i18n.ts';

/** Any parsed JSON value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type PathPart = string | number;

export interface PathResult {
  parts: PathPart[];
  path: string;
  value: Json;
}

export interface SearchResult {
  match: Set<string>;
  keep: Set<string>;
  count: number;
  truncated: boolean;
}

type Segment = { type: 'deep' | 'key'; key: string } | { type: 'all' } | { type: 'index'; index: number };

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** ["items", 0, "a b"] → '$.items[0]["a b"]' */
export function formatPath(parts: readonly PathPart[]): string {
  let out = '$';
  for (const p of parts) {
    if (typeof p === 'number') out += `[${p}]`;
    else if (IDENT.test(p)) out += `.${p}`;
    else out += `[${JSON.stringify(p)}]`;
  }
  return out;
}

/**
 * Parses a JSONPath subset: $, .key, ["key"], [0], [-1], [*], .*, ..key (any depth).
 * Returns a list of segments or throws an error with a localized message.
 */
export function parsePath(input: string): Segment[] {
  const s = input.trim();
  if (!s.startsWith('$')) throw new Error(t('errPathStart'));
  const segs: Segment[] = [];
  let i = 1;
  while (i < s.length) {
    if (s.startsWith('..', i)) {
      const m = /^[^.[\]\s]+/.exec(s.slice(i + 2));
      if (!m) throw new Error(t('errPathDeepKey', i + 1));
      segs.push({ type: 'deep', key: m[0] });
      i += 2 + m[0].length;
    } else if (s[i] === '.') {
      const m = /^[^.[\]\s]+/.exec(s.slice(i + 1));
      if (!m) throw new Error(t('errPathKey', i + 1));
      segs.push(m[0] === '*' ? { type: 'all' } : { type: 'key', key: m[0] });
      i += 1 + m[0].length;
    } else if (s[i] === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) throw new Error(t('errPathBracket'));
      const inner = s.slice(i + 1, end).trim();
      if (inner === '*') segs.push({ type: 'all' });
      else if (/^-?\d+$/.test(inner)) segs.push({ type: 'index', index: Number(inner) });
      else if (/^(["']).*\1$/.test(inner)) segs.push({ type: 'key', key: inner.slice(1, -1) });
      else throw new Error(t('errPathSelector', inner));
      i = end + 1;
    } else {
      throw new Error(t('errPathChar', s[i], i + 1));
    }
  }
  return segs;
}

export const isContainer = (v: unknown): v is Json[] | { [key: string]: Json } => v !== null && typeof v === 'object';

export function children(value: Json): [PathPart, Json][] {
  if (Array.isArray(value)) return value.map((v, i) => [i, v]);
  if (isContainer(value)) return Object.entries(value);
  return [];
}

/** Path result: a list of { parts, path, value }. */
export function evaluatePath(root: Json, input: string, limit = 10_000): PathResult[] {
  type Node = { parts: PathPart[]; value: Json };
  let current: Node[] = [{ parts: [], value: root }];
  for (const seg of parsePath(input)) {
    const next: Node[] = [];
    for (const { parts, value } of current) {
      if (seg.type === 'key') {
        if (isContainer(value) && !Array.isArray(value) && Object.hasOwn(value, seg.key)) {
          next.push({ parts: [...parts, seg.key], value: value[seg.key] as Json });
        }
      } else if (seg.type === 'index') {
        if (Array.isArray(value)) {
          const i = seg.index < 0 ? value.length + seg.index : seg.index;
          if (i >= 0 && i < value.length) next.push({ parts: [...parts, i], value: value[i] as Json });
        }
      } else if (seg.type === 'all') {
        for (const [k, v] of children(value)) next.push({ parts: [...parts, k], value: v });
      } else if (seg.type === 'deep') {
        const stack: Node[] = [{ parts, value }];
        while (stack.length && next.length < limit) {
          const n = stack.pop() as Node;
          const kids = children(n.value);
          for (let j = kids.length - 1; j >= 0; j--) {
            const [k, v] = kids[j] as [PathPart, Json];
            stack.push({ parts: [...n.parts, k], value: v });
          }
          if (!Array.isArray(n.value) && isContainer(n.value) && Object.hasOwn(n.value, seg.key)) {
            next.push({ parts: [...n.parts, seg.key], value: n.value[seg.key] as Json });
          }
        }
      }
      if (next.length >= limit) break;
    }
    current = next.slice(0, limit);
  }
  return current.map((r) => ({ ...r, path: formatPath(r.parts) }));
}

/**
 * Case-insensitive search in keys and primitive values.
 * Returns { match: Set of matching node paths, keep: Set of paths to show (incl. ancestors), count, truncated }.
 */
export function searchJson(root: Json, query: string, limit = 1000): SearchResult {
  const q = query.toLowerCase();
  const match = new Set<string>();
  const keep = new Set<string>();
  let count = 0;
  let truncated = false;

  const visit = (value: Json, parts: PathPart[], key?: PathPart): boolean => {
    if (truncated) return false;
    const path = formatPath(parts);
    let hit = key !== undefined && String(key).toLowerCase().includes(q);
    if (!isContainer(value)) hit ||= String(value).toLowerCase().includes(q);
    let below = false;
    if (isContainer(value)) {
      for (const [k, v] of children(value)) if (visit(v, [...parts, k], k)) below = true;
    }
    if (hit) {
      if (count >= limit) {
        truncated = true;
        return below;
      }
      match.add(path);
      count++;
    }
    if (hit || below) keep.add(path);
    return hit || below;
  };
  visit(root, []);
  return { match, keep, count, truncated };
}

/** Deep copy with keys sorted recursively (for comparing exports). */
export function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isContainer(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys((value as Record<string, Json>)[k] as Json)]),
  );
}
