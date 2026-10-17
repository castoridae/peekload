// Site list helpers: origin normalization, matching and per-site formats. Pure, no chrome.* APIs.
import { DEFAULT_FORMATS, isFormatId } from './formats.ts';
import { t } from './i18n.ts';
import type { FormatId, Settings } from './types.ts';

// Wildcard entry "https://*.example.com" covers example.com and all subdomains, like Chrome's
// match pattern "https://*.example.com/*". Parsed by hand because not every URL implementation
// accepts "*" in a hostname.
const WILDCARD_SITE = /^(https?:)\/\/\*\.([^/:?#]+)/i;

/**
 * Normalizes user input ("app.example.com", "https://app.example.com/x?y", "*.example.com")
 * to "https://app.example.com" / "https://*.example.com". The port is dropped because Chrome
 * match patterns don't support it anyway.
 */
export function normalizeOrigin(input: string): string {
  let s = String(input).trim();
  if (!s) throw new Error(t('errSiteEmpty'));
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let wildcard = false;
  s = s.replace(/^([a-z][a-z0-9+.-]*:\/\/)\*\./i, (_, scheme: string) => {
    wildcard = true;
    return scheme;
  });
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error(t('errSiteInvalid'));
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error(t('errSiteProtocol'));
  }
  if (u.hostname.includes('*')) {
    throw new Error(t('errSiteWildcard'));
  }
  return `${u.protocol}//${wildcard ? '*.' : ''}${u.hostname}`;
}

/** "https://app.example.com" → "https://app.example.com/*", "https://*.example.com" → "https://*.example.com/*" */
export function originToMatch(origin: string): string {
  return `${siteKey(origin)}/*`;
}

/** Comparison key: protocol + host (no port or path); keeps a leading "*.". Null for unparsable input. */
export function siteKey(url: string): string | null {
  const w = WILDCARD_SITE.exec(url);
  if (w) return `${w[1]}//*.${w[2]}`.toLowerCase();
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return null;
  }
}

export function siteMatches(site: string, url: string): boolean {
  const s = siteKey(site);
  const key = siteKey(url);
  if (!s || !key) return false;
  if (s === key) return true;
  const w = WILDCARD_SITE.exec(s);
  if (!w) return false;
  // `url` may itself be a wildcard entry (e.g. when adding *.a.example.com).
  const k = WILDCARD_SITE.exec(key);
  const parsed = k ? null : new URL(key);
  const protocol = k ? k[1] : parsed?.protocol;
  const host = k ? k[2] : parsed?.hostname;
  return protocol === w[1] && !!host && (host === w[2] || host.endsWith(`.${w[2]}`));
}

/**
 * The site entry that enables `url`, or null. When several match, the most specific wins: an exact
 * entry, then the wildcard with the longest domain (*.app.example.com before *.example.com).
 * This lets an exact entry have different formats than a wildcard covering it.
 */
export function findSite(url: string, sites: readonly string[]): string | null {
  const key = siteKey(url);
  let best: string | null = null;
  let bestScore = -1;
  for (const s of sites) {
    if (!siteMatches(s, url)) continue;
    const sKey = siteKey(s);
    const score = sKey === key ? Number.POSITIVE_INFINITY : (sKey?.length ?? 0);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

export function isSiteEnabled(url: string, sites: readonly string[]): boolean {
  return !!findSite(url, sites);
}

/** Formats enabled for a site entry (JSON only when it has no saved config). */
export function siteFormats(site: string, settings: Pick<Settings, 'siteFormats'>): FormatId[] {
  const key = siteKey(site);
  const list = (key && settings.siteFormats?.[key]) || DEFAULT_FORMATS;
  return list.filter(isFormatId);
}

/** Formats intercepted at `url` (empty list = site disabled). */
export function formatsFor(url: string, settings: Pick<Settings, 'sites' | 'siteFormats'>): FormatId[] {
  const site = findSite(url, settings.sites);
  return site ? siteFormats(site, settings) : [];
}
