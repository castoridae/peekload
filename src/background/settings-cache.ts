// Settings cached in service worker memory (invalidated on change) and lazy i18n setup.
import { initI18n } from '../shared/i18n.ts';
import { getSettings } from '../shared/settings.ts';
import type { Settings } from '../shared/types.ts';

let cache: Settings | null = null;

export async function settings(): Promise<Settings> {
  cache ??= await getSettings();
  return cache;
}

export function invalidateSettings(): void {
  cache = null;
}

// Service workers can't use top-level await, so the language setting is loaded lazily before the first t().
let i18nReady: Promise<void> | null = null;

export function i18n(): Promise<void> {
  i18nReady ??= initI18n();
  return i18nReady;
}

export function reloadI18n(language: string): void {
  i18nReady = initI18n(language);
}
