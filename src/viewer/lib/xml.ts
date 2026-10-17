// XML pretty-printing and highlighting without DOMParser, so it also works on malformed XML
// (indentation may be off; only whitespace between tags ever changes).

const TOKEN_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/g;

type TokenKind = 'text' | 'close' | 'other' | 'open';

function kind(token: string): TokenKind {
  if (!token.startsWith('<')) return 'text';
  if (token.startsWith('</')) return 'close';
  if (token.startsWith('<!--') || token.startsWith('<?') || token.startsWith('<!')) return 'other';
  if (token.endsWith('/>')) return 'other';
  return 'open';
}

export function prettyXml(text: string, indent = '  '): string {
  const tokens = (text.replace(/^﻿/, '').match(TOKEN_RE) || [])
    .map((t) => (t.startsWith('<') ? t : t.trim()))
    .filter(Boolean);
  const out: string[] = [];
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    const k = kind(t);
    const pad = indent.repeat(depth);

    if (k === 'open') {
      // Keep <a>text</a> and <a></a> on one line.
      const next = tokens[i + 1];
      if (next !== undefined && kind(next) === 'close') {
        out.push(pad + t + next);
        i += 1;
        continue;
      }
      const afterNext = tokens[i + 2];
      if (next !== undefined && kind(next) === 'text' && afterNext && kind(afterNext) === 'close') {
        out.push(pad + t + next + afterNext);
        i += 2;
        continue;
      }
      out.push(pad + t);
      depth++;
    } else if (k === 'close') {
      depth = Math.max(0, depth - 1);
      out.push(indent.repeat(depth) + t);
    } else {
      out.push(pad + t);
    }
  }
  return out.join('\n');
}

const ATTR_RE = /(\s+)([^\s=/>]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+))?/g;

/**
 * Splits XML into [class, text] segments for highlighting: tags "k", attribute names "l",
 * attribute values "s", comments/declarations "c", everything else "".
 */
export function xmlSegments(text: string): [cls: string, text: string][] {
  const segs: [string, string][] = [];
  let last = 0;
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][\s\S]*?>|<\/?[^\s/>!?]+(?:"[^"]*"|'[^']*'|[^'">])*>/g;
  for (const m of text.matchAll(tagRe)) {
    if (m.index > last) segs.push(['', text.slice(last, m.index)]);
    const tag = m[0];
    if (/^<[!?]/.test(tag)) {
      segs.push(['c', tag]);
    } else {
      const head = /^<\/?[^\s/>]+/.exec(tag)?.[0] ?? '';
      segs.push(['k', head]);
      const end = tag.endsWith('/>') ? 2 : 1;
      const attrs = tag.slice(head.length, tag.length - end);
      let pos = 0;
      for (const a of attrs.matchAll(ATTR_RE)) {
        if (a.index > pos) segs.push(['', attrs.slice(pos, a.index)]);
        segs.push(['', a[1] ?? ''], ['l', a[2] ?? '']);
        if (a[3]) segs.push(['', a[3]], ['s', a[4] ?? '']);
        pos = a.index + a[0].length;
      }
      if (pos < attrs.length) segs.push(['', attrs.slice(pos)]);
      segs.push(['k', tag.slice(tag.length - end)]);
    }
    last = m.index + tag.length;
  }
  if (last < text.length) segs.push(['', text.slice(last)]);
  return segs;
}
