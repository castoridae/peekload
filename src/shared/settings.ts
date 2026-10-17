// Settings storage shared by background, popup, options and viewer.
import { siteKey } from './sites.ts';
import type { FormatId, Settings } from './types.ts';

export const DEFAULTS: Readonly<Settings> = Object.freeze({
  sites: [],
  siteFormats: {},
  autoCopy: true,
  copyFormats: { json: 'raw', csv: 'raw', xml: 'raw', text: 'raw' },
  jsonView: 'tree',
  interceptServer: true,
  openIn: 'tab',
  language: 'auto',
});

export async function getSettings(): Promise<Settings> {
  // No default for copyFormats so the legacy JSON-only `copyFormat` setting can be migrated.
  const query: Record<string, unknown> = { ...DEFAULTS, copyFormats: {}, copyFormat: null };
  const s = (await chrome.storage.sync.get(query)) as unknown as Settings & { copyFormat?: string | null };
  const { copyFormat, ...rest } = s;
  return {
    ...rest,
    copyFormats: {
      ...DEFAULTS.copyFormats,
      ...(copyFormat ? { json: copyFormat } : {}),
      ...s.copyFormats,
    },
  };
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}

export async function setSiteFormats(site: string, formats: FormatId[]): Promise<void> {
  const key = siteKey(site);
  if (!key) return;
  const { siteFormats: current } = await getSettings();
  await setSettings({ siteFormats: { ...current, [key]: formats } });
}

/** Removes a site together with its formats. Returns the remaining sites. */
export async function removeSite(site: string): Promise<string[]> {
  const s = await getSettings();
  const key = siteKey(site);
  const sites = s.sites.filter((x) => siteKey(x) !== key);
  const formats = { ...s.siteFormats };
  if (key) delete formats[key];
  await setSettings({ sites, siteFormats: formats });
  return sites;
}
