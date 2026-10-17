// Export formats and their detection. Pure (no chrome.* APIs), so content/inject.ts bundles it too.
import type { FormatId } from './types.ts';

interface FormatInfo {
  labelKey: string;
  /** Untranslated badge text. */
  short: string;
  ext: string;
  mime: string;
}

/** Supported export formats, in UI order. */
export const FORMATS: Readonly<Record<FormatId, FormatInfo>> = Object.freeze({
  json: { labelKey: 'formatJson', short: 'JSON', ext: 'json', mime: 'application/json' },
  csv: { labelKey: 'formatCsv', short: 'CSV', ext: 'csv', mime: 'text/csv' },
  xml: { labelKey: 'formatXml', short: 'XML', ext: 'xml', mime: 'application/xml' },
  text: { labelKey: 'formatText', short: 'TXT', ext: 'txt', mime: 'text/plain' },
});

export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];

/** Formats for a site with no saved config (JSON only, matching behavior before formats existed). */
export const DEFAULT_FORMATS: readonly FormatId[] = Object.freeze(['json']);

export const isFormatId = (id: unknown): id is FormatId => typeof id === 'string' && id in FORMATS;

/** Copy variants per format: [value, i18n key of the label]. */
export const COPY_FORMATS: Readonly<Record<FormatId, ReadonlyArray<readonly [string, string]>>> = Object.freeze({
  json: [
    ['raw', 'copyRaw'],
    ['pretty', 'copyPretty'],
    ['minified', 'copyMinified'],
  ],
  csv: [
    ['raw', 'copyRaw'],
    ['tsv', 'copyTsv'],
    ['json', 'copyCsvJson'],
  ],
  xml: [
    ['raw', 'copyRaw'],
    ['pretty', 'copyPretty'],
  ],
  text: [['raw', 'copyRaw']],
});

const CSV_MIMES = [
  'text/csv',
  'application/csv',
  'text/x-csv',
  'text/comma-separated-values',
  'text/tab-separated-values',
];
const TEXT_MIMES = ['text/plain', 'text/markdown', 'text/x-markdown', 'text/x-log'];
const TEXT_EXTS = ['txt', 'log', 'md', 'markdown'];

const baseMime = (mime: string | null | undefined) =>
  String(mime || '')
    .split(';')[0]
    ?.trim()
    .toLowerCase() ?? '';

/** Lowercase extension from a file name or URL path (ignoring query and hash). */
function extOf(name: string | null | undefined): string {
  let s = String(name || '');
  if (s.includes('://')) {
    try {
      s = new URL(s).pathname;
    } catch {}
  }
  const m = /\.([a-z0-9]+)$/i.exec(
    s
      .replace(/[?#].*$/, '')
      .split('/')
      .pop() ?? '',
  );
  return m?.[1] ? m[1].toLowerCase() : '';
}

const META: Record<FormatId, (mime: string, exts: string[]) => boolean> = {
  json: (mime, exts) => mime.includes('json') || exts.includes('json'),
  csv: (mime, exts) => CSV_MIMES.includes(mime) || exts.includes('csv') || exts.includes('tsv'),
  xml: (mime, exts) => /^(application|text)\/([\w.-]+\+)?xml$/.test(mime) || exts.includes('xml'),
  // text/plain only with no extension or a text one — "backup.sql" or "config.yaml" must still download.
  text: (mime, exts) =>
    TEXT_EXTS.some((e) => exts.includes(e)) ||
    (TEXT_MIMES.includes(mime) && exts.every((e) => !e || TEXT_EXTS.includes(e))),
};

export function isXmlText(text: unknown): boolean {
  return typeof text === 'string' && /^﻿?\s*<\?xml[\s?]/.test(text);
}

export function isJsonText(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const trimmed = text.trimStart();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

interface FormatHints {
  mime?: string | null;
  /** File name(s) and/or URL(s) to take extensions from. */
  name?: string | null | readonly (string | null | undefined)[];
  text?: string;
}

/**
 * Detects the export format from MIME type, file name/URL and optionally content.
 * Returns a format id from `formats` or null. CSV and text are matched by MIME/extension only —
 * almost any content looks like CSV, and we must not hijack a file meant to be downloaded.
 */
export function detectFormat(
  { mime, name, text }: FormatHints,
  formats: readonly FormatId[] = FORMAT_IDS,
): FormatId | null {
  const m = baseMime(mime);
  const exts = ([] as (string | null | undefined)[]).concat(name ?? []).map(extOf);
  const meta = (f: FormatId) => formats.includes(f) && META[f](m, exts);
  for (const f of ['json', 'csv', 'xml'] as const) if (meta(f)) return f;
  if (typeof text === 'string') {
    if (formats.includes('json') && isJsonText(text)) return 'json';
    if (formats.includes('xml') && isXmlText(text)) return 'xml';
  }
  return meta('text') ? 'text' : null;
}

/** Pre-filter for server downloads before the body is read: could the file turn out to be an enabled format? */
export function couldBeFormat({ mime, name }: FormatHints, formats: readonly FormatId[] = FORMAT_IDS): boolean {
  if (detectFormat({ mime, name }, formats)) return true;
  return baseMime(mime) === 'text/plain' && formats.some((f) => f === 'json' || f === 'xml');
}
