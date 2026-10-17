// JSON pretty-printing and minification without JSON.parse: only whitespace outside strings changes,
// so numbers (e.g. IDs > 2^53), string escapes and key order stay byte-for-byte identical.
// Input must be valid JSON (already checked with JSON.parse).

const isSpace = (c: string | undefined) => c === ' ' || c === '\n' || c === '\r' || c === '\t';

/** Index of the closing quote of the string that starts at `i`. */
function stringEnd(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
  return j;
}

/** Like JSON.stringify(JSON.parse(text), null, indent), without losing number precision. */
export function reindentJson(text: string, indent = '  '): string {
  const out: string[] = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"') {
      const end = stringEnd(text, i);
      out.push(text.slice(i, end + 1));
      i = end + 1;
    } else if (isSpace(c)) {
      i++;
    } else if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']';
      let j = i + 1;
      while (j < text.length && isSpace(text[j])) j++;
      if (text[j] === close) {
        out.push(c + close);
        i = j + 1;
      } else {
        depth++;
        out.push(c, '\n', indent.repeat(depth));
        i++;
      }
    } else if (c === '}' || c === ']') {
      depth--;
      out.push('\n', indent.repeat(depth), c);
      i++;
    } else if (c === ',') {
      out.push(',\n', indent.repeat(depth));
      i++;
    } else if (c === ':') {
      out.push(': ');
      i++;
    } else {
      // Number or literal: copy verbatim up to the next structural character.
      let j = i + 1;
      while (j < text.length && !',:{}[]"'.includes(text[j] as string) && !isSpace(text[j])) j++;
      out.push(text.slice(i, j));
      i = j;
    }
  }
  return out.join('');
}

/** Like JSON.stringify(JSON.parse(text)), without losing number precision. */
export function minifyJson(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      const end = stringEnd(text, i);
      out.push(text.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] !== '"') j++;
    out.push(text.slice(i, j).replace(/[ \n\r\t]+/g, ''));
    i = j;
  }
  return out.join('');
}
