// _locales consistency: every locale has the same keys and substitutions as English (the default),
// and every key used in code exists.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { installI18n, loadMessages } from './chrome-i18n.ts';

const root = new URL('../', import.meta.url);
const LOCALES = readdirSync(new URL('public/_locales/', root));
const en = loadMessages('en');
const PLURAL = /^(.+)_(zero|one|two|few|many|other)$/;

/** Splits keys into plain keys and plural base names (`nRows_one` → `nRows`). */
function shape(messages) {
  const plain = new Set();
  const plurals = new Set();
  for (const key of Object.keys(messages)) {
    const m = PLURAL.exec(key);
    if (m) plurals.add(m[1]);
    else plain.add(key);
  }
  return { plain, plurals };
}

/** Highest $n substitution in a message, ignoring escaped "$$". */
const maxSub = (msg) => Math.max(0, ...[...msg.replaceAll('$$', '').matchAll(/\$([1-9])/g)].map((m) => Number(m[1])));

const enShape = shape(en);

test('English is the manifest default language', () => {
  const manifest = JSON.parse(readFileSync(new URL('public/manifest.json', root), 'utf8'));
  assert.equal(manifest.default_locale, 'en');
  for (const key of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) assert.ok(en[key[1]], key[1]);
});

for (const locale of LOCALES) {
  test(`public/_locales/${locale}: keys and substitutions match English`, () => {
    const messages = loadMessages(locale);
    const { plain, plurals } = shape(messages);
    assert.deepEqual([...plain].sort(), [...enShape.plain].sort(), 'non-plural keys');
    assert.deepEqual([...plurals].sort(), [...enShape.plurals].sort(), 'plural keys');

    for (const [key, { message }] of Object.entries(messages)) {
      assert.equal(typeof message, 'string', key);
      assert.ok(message.trim(), `${key}: empty message`);
      // Chrome treats "$NAME$" as a named placeholder, so a literal "$" must be written as "$$".
      assert.doesNotMatch(message.replaceAll('$$', '').replace(/\$[1-9]/g, ''), /\$/, `${key}: unescaped $`);
      const base = PLURAL.exec(key)?.[1];
      const ref = en[key] ?? en[`${base}_other`];
      assert.equal(maxSub(message), maxSub(ref.message), `${key}: different $n substitutions than English`);
    }

    // Chrome / Chrome Web Store limit for the manifest description.
    assert.ok(
      messages.extDescription.message.length <= 132,
      `extDescription: ${messages.extDescription.message.length} > 132 characters`,
    );
    for (const base of plurals) assert.ok(messages[`${base}_other`], `${base}_other`);
    const lang = messages.locale.message;
    assert.equal(Intl.PluralRules.supportedLocalesOf([lang]).length, 1, `locale "${lang}"`);
    // Plural forms the language's rules require (e.g. Polish: one/few/many).
    const needed = new Intl.PluralRules(lang).resolvedOptions().pluralCategories.filter((c) => c !== 'other');
    for (const base of plurals) {
      for (const cat of needed) {
        // In fr/es/it/pt "many" only covers millions; _other is enough.
        if (cat === 'many' && ['fr', 'es', 'it', 'pt'].includes(lang.split('-')[0])) continue;
        assert.ok(messages[`${base}_${cat}`], `${locale}: missing ${base}_${cat}`);
      }
    }
  });
}

test('every key used in code exists in English, and every English key is used', () => {
  const files = [
    ...readdirSync(new URL('src/', root), { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(ts|html)$/.test(f))
      .map((f) => `src/${f}`),
    'public/manifest.json',
  ];
  const source = files.map((f) => readFileSync(new URL(f, root), 'utf8')).join('\n');
  const used = new Set();
  const patterns = [
    /\bt\(\s*'(\w+)'/g,
    /\bplural\(\s*'(\w+)'/g,
    /data-i18n(?:-[a-z-]+)?="(\w+)"/g,
    /__MSG_(\w+)__/g,
    // Keys in arrays and ternaries: 'viewTree', t(ok ? 'toastCopied' : 'toastCopyFailed'), etc.
    /'((?:view|copy|format|toast|popup|options|viewer|notice|diff|err|tree|filter|icon|n)[A-Z]\w*)'/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) used.add(m[1]);
  // Plural keys count as used via their base name (plural('nRows', …)).
  const known = new Set([...enShape.plain, ...enShape.plurals]);
  for (const key of used) assert.ok(known.has(key), `key missing from public/_locales/en: ${key}`);
  for (const key of known) {
    if (key === 'locale') continue;
    assert.ok(used.has(key), `unused key in _locales/en: ${key}`);
  }
});

test('plural() picks forms per language (Polish: 1 / 2–4 / 5+)', async () => {
  installI18n('pl');
  // @ts-expect-error the query suffix gives this import its own module instance
  const { plural } = await import('../src/shared/i18n.ts?pl');
  assert.match(plural('nRows', 1), /^1 \S+$/);
  const [one, few, many] = [1, 3, 5].map((n) => plural('nRows', n).split(' ')[1]);
  assert.notEqual(one, few);
  assert.notEqual(few, many);
  assert.equal(plural('nRows', 22).split(' ')[1], few);
  assert.equal(plural('nRows', 12).split(' ')[1], many);
  installI18n('en');
});

test('language list in settings = _locales directories', async () => {
  const { LANGUAGES } = await import('../src/shared/i18n.ts');
  assert.deepEqual(LANGUAGES.map(([code]) => code).sort(), [...LOCALES].sort());
});

test('initI18n: the language from settings overrides the browser language, "auto" returns to it', async () => {
  installI18n('en');
  const realFetch = globalThis.fetch;
  const stub = globalThis.chrome as unknown as Record<string, unknown>;
  stub.runtime = { getURL: (p: string) => new URL(`public/${p}`, root).href };
  stub.storage = { sync: { get: async (d: object) => ({ ...d, language: 'de' }) } };
  globalThis.fetch = (async (url: string) => ({
    json: async () => JSON.parse(readFileSync(new URL(url), 'utf8')),
  })) as unknown as typeof fetch;
  try {
    // @ts-expect-error the query suffix gives this import its own module instance
    const i18n = await import('../src/shared/i18n.ts?override');
    await i18n.initI18n();
    assert.equal(i18n.t('optionsAdd'), 'Hinzufügen');
    assert.equal(i18n.locale(), 'de');
    assert.equal(i18n.t('toastPathCopied', '$.a'), 'Pfad $.a kopiert');
    assert.equal(i18n.plural('nRows', 2), '2 Zeilen');
    await i18n.initI18n('auto');
    assert.equal(i18n.t('optionsAdd'), 'Add');
    assert.equal(i18n.plural('nRows', 2), '2 rows');
    await i18n.initI18n('xx');
    assert.equal(i18n.t('optionsAdd'), 'Add');
  } finally {
    globalThis.fetch = realFetch;
  }
});
