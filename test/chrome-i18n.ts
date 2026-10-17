// Minimal chrome.i18n stub for node tests: reads _locales/<locale>/messages.json and
// handles $1…$9 and "$$" → "$" like Chrome.
import { readFileSync } from 'node:fs';
import { formatMessage } from '../src/shared/i18n.ts';

export type Messages = Record<string, { message: string }>;

export function loadMessages(locale: string): Messages {
  return JSON.parse(readFileSync(new URL(`../public/_locales/${locale}/messages.json`, import.meta.url), 'utf8'));
}

export function installI18n(locale = 'en') {
  const messages = loadMessages(locale);
  const g = globalThis as unknown as { chrome?: Record<string, unknown> };
  g.chrome ??= {};
  g.chrome.i18n = {
    getMessage: (key: string, subs?: string | string[]) =>
      messages[key] ? formatMessage(messages[key].message, [subs ?? []].flat(2)) : '',
    getUILanguage: () => locale.replace('_', '-'),
  };
}
