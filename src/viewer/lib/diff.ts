// Line-by-line diff of two texts (Myers' algorithm) and grouping into hunks with context.

export interface DiffOp {
  type: ' ' | '-' | '+';
  text: string;
}

export interface SkipOp {
  type: 'skip';
  lines: DiffOp[];
}

/**
 * Returns ops [{ type: ' ' | '-' | '+', text }], or null when there are more than `maxEdits`
 * differences (the result would be unreadable anyway, and expensive to compute).
 */
export function diffLines(a: string[], b: string[], maxEdits = 5000): DiffOp[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const middle = myers(a.slice(start, endA), b.slice(start, endB), maxEdits);
  if (!middle) return null;
  return [
    ...a.slice(0, start).map((text): DiffOp => ({ type: ' ', text })),
    ...middle,
    ...a.slice(endA).map((text): DiffOp => ({ type: ' ', text })),
  ];
}

function myers(a: string[], b: string[], maxEdits: number): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  if (!n) return b.map((text): DiffOp => ({ type: '+', text }));
  if (!m) return a.map((text): DiffOp => ({ type: '-', text }));

  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  const at = (k: number) => v[offset + k] as number;

  for (let d = 0; d <= max; d++) {
    // Store only the used slice of v (k from -d to d): O(D²) memory instead of O(D·(N+M)).
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? at(k + 1) : at(k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, d);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], a: string[], b: string[], dEnd: number): DiffOp[] {
  const ops: DiffOp[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = dEnd; d > 0; d--) {
    const vd = trace[d] as Int32Array; // v after step d-1, k from -d to d → vd[k + d]
    const get = (k: number) => vd[k + d] as number;
    const k = x - y;
    const prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ type: ' ', text: a[x] as string });
    }
    if (x === prevX) {
      y--;
      ops.push({ type: '+', text: b[y] as string });
    } else {
      x--;
      ops.push({ type: '-', text: a[x] as string });
    }
  }
  while (x > 0) {
    x--;
    ops.push({ type: ' ', text: a[x] as string });
  }
  return ops.reverse();
}

/**
 * Groups ops: changes keep `context` lines around them; longer unchanged runs become
 * { type: 'skip', lines: [...] } (expandable in the UI).
 */
export function withContext(ops: DiffOp[], context = 3): (DiffOp | SkipOp)[] {
  const out: (DiffOp | SkipOp)[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i] as DiffOp;
    if (op.type !== ' ') {
      out.push(op);
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && ops[j]?.type === ' ') j++;
    const run = ops.slice(i, j);
    const head = i === 0 ? 0 : context;
    const tail = j === ops.length ? 0 : context;
    if (run.length > head + tail + 1) {
      out.push(...run.slice(0, head));
      out.push({ type: 'skip', lines: run.slice(head, run.length - tail) });
      out.push(...run.slice(run.length - tail));
    } else {
      out.push(...run);
    }
    i = j;
  }
  return out;
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const o of ops) {
    if (o.type === '+') added++;
    else if (o.type === '-') removed++;
  }
  return { added, removed };
}
