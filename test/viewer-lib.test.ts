// Tests for the DOM-free viewer modules in viewer/lib.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectDelimiter, parseCsv, toObjects, toTsv } from '../src/viewer/lib/csv.ts';
import { diffLines, diffStats, withContext } from '../src/viewer/lib/diff.ts';
import { evaluatePath, formatPath, parsePath, searchJson, sortKeys } from '../src/viewer/lib/json-path.ts';
import { prettyXml, xmlSegments } from '../src/viewer/lib/xml.ts';
import { installI18n } from './chrome-i18n.ts';

installI18n('en');

// --- CSV ------------------------------------------------------------------------

test('CSV: delimiter detection', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3\n'), ',');
  assert.equal(detectDelimiter('id;name;amount\n1;Jan;1,50\n2;Ola;2,75\n'), ';');
  assert.equal(detectDelimiter('a\tb\n1\t2\n'), '\t');
  assert.equal(detectDelimiter('"x;y",b\n"1;2",3\n'), ',', 'delimiter inside quotes is not counted');
  assert.equal(detectDelimiter('single column\nvalue\n'), ',');
});

test('CSV: quotes, newlines in a field, CRLF, BOM', () => {
  const { rows, delimiter } = parseCsv('﻿id;desc\r\n1;"Ann; ""cat""\nnew line"\r\n2;\r\n');
  assert.equal(delimiter, ';');
  assert.deepEqual(rows, [
    ['id', 'desc'],
    ['1', 'Ann; "cat"\nnew line'],
    ['2', ''],
  ]);
});

test('CSV: no trailing newline and explicit delimiter', () => {
  assert.deepEqual(parseCsv('a|b\n1|2', '|').rows, [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('CSV → TSV quotes fields with a tab, newline and quote', () => {
  assert.equal(
    toTsv([
      ['a', 'b\tc'],
      ['x "y"', 'p\nq'],
    ]),
    'a\t"b\tc"\n"x ""y"""\t"p\nq"',
  );
});

test('CSV → objects: empty and repeated headers', () => {
  assert.deepEqual(toObjects([['id', '', 'id'], ['1', 'x', '2'], ['3']]), [
    { id: '1', column_2: 'x', id_2: '2' },
    { id: '3', column_2: '', id_2: '' },
  ]);
});

// --- XML ------------------------------------------------------------------------

test('XML: indentation, elements with text on one line', () => {
  const src = '<?xml version="1.0"?><root a="1"><item><name>Zażółć</name><empty/><x></x></item><!-- k --></root>';
  assert.equal(
    prettyXml(src),
    [
      '<?xml version="1.0"?>',
      '<root a="1">',
      '  <item>',
      '    <name>Zażółć</name>',
      '    <empty/>',
      '    <x></x>',
      '  </item>',
      '  <!-- k -->',
      '</root>',
    ].join('\n'),
  );
});

test('XML: ">" in an attribute value does not break the tag', () => {
  assert.equal(prettyXml('<a t="x>y"><b>1</b></a>'), '<a t="x>y">\n  <b>1</b>\n</a>');
});

test('XML: highlighting segments reassemble into the same text', () => {
  const src = '<?xml version="1.0"?>\n<a x="1" y=\'2\'>\n  <b/>t<!-- c --></a>';
  const segs = xmlSegments(src);
  assert.equal(segs.map((s) => s[1]).join(''), src);
  assert.ok(segs.some(([c, t]) => c === 'l' && t === 'x'));
  assert.ok(segs.some(([c, t]) => c === 's' && t === '"1"'));
  assert.ok(segs.some(([c, t]) => c === 'c' && t === '<!-- c -->'));
});

// --- JSON paths -------------------------------------------------------------------

const DATA = {
  items: [
    { id: 1, name: 'Alfa', tags: ['x'] },
    { id: 2, name: 'Beta', 'with space': true },
  ],
  meta: { id: 'm', total: 2 },
};

test('formatPath and parsePath', () => {
  assert.equal(formatPath(['items', 0, 'with space']), '$.items[0]["with space"]');
  assert.deepEqual(parsePath('$.items[*]..id'), [
    { type: 'key', key: 'items' },
    { type: 'all' },
    { type: 'deep', key: 'id' },
  ]);
  assert.throws(() => parsePath('items'), /\$/);
  assert.throws(() => parsePath('$.items[abc]'), /selector/);
});

test('evaluatePath: keys, indexes, *, negative index, ..', () => {
  assert.deepEqual(
    evaluatePath(DATA, '$.items[*].name').map((r) => r.value),
    ['Alfa', 'Beta'],
  );
  assert.equal(evaluatePath(DATA, '$.items[-1].id')[0].value, 2);
  assert.equal(evaluatePath(DATA, '$.items[1]["with space"]')[0].path, '$.items[1]["with space"]');
  assert.deepEqual(
    evaluatePath(DATA, '$..id').map((r) => r.path),
    ['$.items[0].id', '$.items[1].id', '$.meta.id'],
  );
  assert.deepEqual(evaluatePath(DATA, '$.missing.x'), []);
});

test('searchJson: matches in keys and values with ancestors', () => {
  const r = searchJson(DATA, 'BETA');
  assert.deepEqual([...r.match], ['$.items[1].name']);
  assert.ok(r.keep.has('$') && r.keep.has('$.items') && r.keep.has('$.items[1]'));
  assert.ok(!r.keep.has('$.items[0]'));
  assert.equal(searchJson(DATA, 'total').count, 1);
  const limited = searchJson(DATA, 'i', 2);
  assert.equal(limited.count, 2);
  assert.equal(limited.truncated, true);
});

test('sortKeys sorts recursively, arrays keep their order', () => {
  assert.equal(JSON.stringify(sortKeys({ b: 1, a: [{ d: 1, c: 2 }] })), '{"a":[{"c":2,"d":1}],"b":1}');
});

// --- diff ---------------------------------------------------------------------------

const apply = (ops) => ({
  a: ops.filter((o) => o.type !== '+').map((o) => o.text),
  b: ops.filter((o) => o.type !== '-').map((o) => o.text),
});

test('diffLines: result reproduces both texts and is minimal', () => {
  const a = ['a', 'b', 'c', 'd', 'e', 'f'];
  const b = ['a', 'x', 'c', 'd', 'f', 'g'];
  const ops = diffLines(a, b);
  assert.deepEqual(apply(ops), { a, b });
  assert.deepEqual(diffStats(ops), { added: 2, removed: 2 });
});

test('diffLines: edge cases and random data', () => {
  assert.deepEqual(diffLines([], ['a']), [{ type: '+', text: 'a' }]);
  assert.deepEqual(diffLines(['a'], []), [{ type: '-', text: 'a' }]);
  assert.deepEqual(diffLines(['a'], ['a']), [{ type: ' ', text: 'a' }]);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed % 4;
  };
  for (let t = 0; t < 50; t++) {
    const a = Array.from({ length: 30 }, rnd).map(String);
    const b = Array.from({ length: 25 }, rnd).map(String);
    assert.deepEqual(apply(diffLines(a, b)), { a, b });
  }
});

test('diffLines: too many differences → null', () => {
  const a = Array.from({ length: 100 }, (_, i) => `a${i}`);
  const b = Array.from({ length: 100 }, (_, i) => `b${i}`);
  assert.equal(diffLines(a, b, 50), null);
});

test('withContext collapses long unchanged stretches', () => {
  const a = Array.from({ length: 20 }, (_, i) => String(i));
  const b = [...a];
  b[10] = 'changed';
  const out = withContext(diffLines(a, b), 2);
  const skips = out.filter((o) => o.type === 'skip');
  assert.equal(skips.length, 2);
  assert.equal(skips[0].lines.length, 8);
  assert.equal(skips[1].lines.length, 7);
});

// --- JSON formatting without parsing --------------------------------------------------

test('reindentJson/minifyJson match JSON.stringify for ordinary data', async () => {
  const { reindentJson, minifyJson } = await import('../src/viewer/lib/json-format.ts');
  const samples = [
    DATA,
    [],
    {},
    { a: [], b: {}, c: [{}], d: '', e: 'with "quotes" and \\ backslash, {braces} [and] commas: yes' },
    [1, -2.5, 3e21, true, false, null, 'ąę\n\ttab', [[[]]]],
    'just a string',
    42,
  ];
  for (const v of samples) {
    const ugly = JSON.stringify(v, null, '\t').replace(/\n/g, '\r\n   ');
    assert.equal(reindentJson(ugly), JSON.stringify(v, null, 2), JSON.stringify(v));
    assert.equal(minifyJson(ugly), JSON.stringify(v), JSON.stringify(v));
  }
});

test('reindentJson/minifyJson do not round large numbers or alter escapes', async () => {
  const { reindentJson, minifyJson } = await import('../src/viewer/lib/json-format.ts');
  const src = '{"id":12345678901234567890,"x":1.000,"s":"\\u0041\\"b"}';
  assert.equal(reindentJson(src), '{\n  "id": 12345678901234567890,\n  "x": 1.000,\n  "s": "\\u0041\\"b"\n}');
  assert.equal(minifyJson(' { "id" : 12345678901234567890 } '), '{"id":12345678901234567890}');
});
