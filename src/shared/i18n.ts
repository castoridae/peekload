// By default chrome.i18n uses the browser UI language, falling back to English (default_locale).
// chrome.i18n can't switch to a language picked in settings (`language`), so initI18n() then loads
// _locales/<lang>/messages.json itself. Without chrome.i18n (tests) t() returns the key.

/** Available languages: [_locales directory, native name]. */
export const LANGUAGES: readonly (readonly [code: string, name: string])[] = Object.freeze([
  ['en', 'English'],
  ['pl', 'Polski'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['pt_BR', 'Português (Brasil)'],
  ['pt_PT', 'Português (Portugal)'],
  ['it', 'Italiano'],
  ['nl', 'Nederlands'],
  ['uk', 'Українська'],
]);

type Messages = Record<string, { message: string }>;

let override: Messages | null = null; // messages.json of the chosen language; null = browser language
let rules: Intl.PluralRules | undefined;

/**
 * Sets the language: a LANGUAGES code, "auto", or (no argument) the `language` setting.
 * Pages call this before localize(); the service worker before its first t().
 */
export async function initI18n(lang?: string): Promise<void> {
  lang ??= ((await globalThis.chrome?.storage?.sync.get({ language: 'auto' })) as { language?: string } | undefined)
    ?.language;
  override = null;
  rules = undefined;
  if (!LANGUAGES.some(([code]) => code === lang)) return;
  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
    override = (await res.json()) as Messages;
  } catch {
    // Missing file or error: keep the browser language.
  }
}

/** Substitutions like chrome.i18n: $1…$9 → subs, "$$" → literal "$". */
export function formatMessage(message: string, subs: unknown[] = []): string {
  return message.replace(/\$(\$|[1-9])/g, (_, c: string) => (c === '$' ? '$' : String(subs[Number(c) - 1] ?? '')));
}

export function t(key: string, ...subs: unknown[]): string {
  const own = override?.[key]?.message;
  if (own) return formatMessage(own, subs);
  const msg = globalThis.chrome?.i18n?.getMessage(key, subs.map(String));
  return msg || key;
}

/** Language code of the translations actually in use (e.g. "pl", "pt-BR"), for Intl and <html lang>. */
export function locale(): string {
  const l = t('locale');
  return l === 'locale' ? 'en' : l;
}

/**
 * Plurals: key_one / _few / _many / _other via Intl.PluralRules for the translation language
 * (Polish and Ukrainian need one/few/many). Missing form falls back to _other. $1 defaults to the count.
 */
export function plural(key: string, count: number, subs: unknown[] = [count]): string {
  rules ??= new Intl.PluralRules(locale());
  const variant = `${key}_${rules.select(count)}`;
  const msg = t(variant, ...subs);
  return msg === variant ? t(`${key}_other`, ...subs) : msg;
}

/**
 * Translates static HTML: data-i18n (textContent), data-i18n-placeholder, -title, -aria-label.
 * The English text in the HTML is the fallback.
 */
export function localize(root: Document | HTMLElement = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = t(el.dataset.i18n ?? '');
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) {
      el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`) ?? ''));
    }
  }
  if (root === document) document.documentElement.lang = locale();
}
