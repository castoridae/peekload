// CSV/TSV parsing (RFC 4180: quoted fields, "" escapes, newlines inside fields) and copy conversions.

const DELIMITERS = [',', ';', '\t', '|'];

/**
 * Guesses the delimiter from the first lines: the winner appears the same number of times in the
 * most lines (many European exports use ";").
 */
export function detectDelimiter(text: string): string {
  const sample = stripBom(text).slice(0, 64 * 1024);
  const perLine: number[][] = DELIMITERS.map(() => []);
  let current = DELIMITERS.map(() => 0);
  let quoted = false;
  let lines = 0;

  const endLine = () => {
    if (current.some(Boolean)) {
      for (const [k, n] of current.entries()) perLine[k]?.push(n);
    }
    current = DELIMITERS.map(() => 0);
    lines++;
  };
  for (let i = 0; i < sample.length && lines < 20; i++) {
    const c = sample[i] as string;
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === '\n') endLine();
    else if (!quoted) {
      const k = DELIMITERS.indexOf(c);
      if (k >= 0) current[k] = (current[k] ?? 0) + 1;
    }
  }
  endLine();

  let best = ',';
  let bestScore = 0;
  DELIMITERS.forEach((d, k) => {
    const freq = new Map<number, number>();
    for (const n of perLine[k] ?? []) if (n > 0) freq.set(n, (freq.get(n) || 0) + 1);
    for (const [n, lines] of freq) {
      const score = lines * 1000 + n;
      if (score > bestScore) {
        best = d;
        bestScore = score;
      }
    }
  });
  return best;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Returns { rows: string[][], delimiter }. A trailing empty line does not produce a row. */
export function parseCsv(
  text: string,
  delimiter: string = detectDelimiter(text),
): { rows: string[][]; delimiter: string } {
  const src = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < src.length) {
    const c = src[i] as string;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += c;
      }
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (c === '\r' && src[i + 1] === '\n') i++;
    } else {
      field += c;
    }
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows, delimiter };
}

/** TSV for pasting into a spreadsheet: fields with tabs, newlines or quotes get quoted. */
export function toTsv(rows: string[][]): string {
  const cell = (v: string) => (/[\t\r\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join('\t')).join('\n');
}

/** First row is the header; empty and duplicate names get unique replacements. */
export function toObjects(rows: string[][]): Record<string, string>[] {
  const [first] = rows;
  if (!first) return [];
  const width = Math.max(...rows.map((r) => r.length));
  const seen = new Set<string>();
  const header = Array.from({ length: width }, (_, i) => {
    const base = (first[i] ?? '').trim() || `column_${i + 1}`;
    let name = base;
    for (let n = 2; seen.has(name); n++) name = `${base}_${n}`;
    seen.add(name);
    return name;
  });
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}
