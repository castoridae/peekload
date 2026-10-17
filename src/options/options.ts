import { formatLabel } from '../shared/format-label.ts';
import { formatPicker } from '../shared/format-picker.ts';
import { COPY_FORMATS } from '../shared/formats.ts';
import { initI18n, LANGUAGES, localize, t } from '../shared/i18n.ts';
import { icon } from '../shared/icons.ts';
import { getSettings, removeSite, setSettings } from '../shared/settings.ts';
import { findSite, normalizeOrigin, originToMatch, siteKey } from '../shared/sites.ts';
import type { FormatId, OpenIn, Settings } from '../shared/types.ts';

await initI18n();
localize();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const sitesEl = $('sites');
const addForm = $<HTMLFormElement>('add-form');
const addInput = $<HTMLInputElement>('add-input');
const addError = $('add-error');
const addHint = $('add-hint');
const savedEl = $('saved');

let savedTimer: ReturnType<typeof setTimeout>;
function flashSaved() {
  savedEl.textContent = t('optionsSaved');
  savedEl.className = 'toast show';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (savedEl.className = 'toast'), 1400);
}

function hint(text: string) {
  addHint.textContent = text;
  addHint.hidden = !text;
}

/** Display name: "https://" is hidden, "http://" stays visible. */
function siteName(site: string) {
  const el = document.createElement('span');
  el.className = 'site-host';
  el.title = site;
  if (site.startsWith('http://')) {
    const scheme = document.createElement('span');
    scheme.className = 'scheme';
    scheme.textContent = 'http://';
    el.append(scheme);
  }
  el.append(site.replace(/^https?:\/\//, ''));
  return el;
}

function badge(text: string, variant: string, iconName?: string) {
  const el = document.createElement('span');
  el.className = `badge ${variant}`;
  if (iconName) el.append(icon(iconName));
  el.append(text);
  return el;
}

async function siteRow(site: string, settings: Settings) {
  const li = document.createElement('li');
  const main = document.createElement('div');
  main.className = 'site-main';
  main.append(siteName(site));
  if (site.includes('://*.')) main.append(badge(t('optionsWildcard'), 'accent'));

  const granted = await chrome.permissions.contains({ origins: [originToMatch(site)] });
  if (!granted) {
    main.append(badge(t('optionsNoPermission'), 'warn', 'lock'));
    const fix = document.createElement('button');
    fix.className = 'sm';
    fix.textContent = t('optionsGrant');
    fix.addEventListener('click', () => {
      chrome.permissions.request({ origins: [originToMatch(site)] }).then(renderSites);
    });
    main.append(fix);
  }

  const remove = document.createElement('button');
  remove.className = 'ghost danger icon-only sm';
  remove.title = t('optionsRemove');
  remove.setAttribute('aria-label', `${t('optionsRemove')}: ${site}`);
  remove.append(icon('trash'));
  remove.addEventListener('click', async () => {
    await removeSite(site);
    await chrome.permissions.remove({ origins: [originToMatch(site)] }).catch(() => {});
    renderSites();
  });
  main.append(remove);
  li.append(main, formatPicker(site, settings, flashSaved));
  return li;
}

async function renderSites() {
  const settings = await getSettings();
  const { sites } = settings;
  if (!sites.length) {
    const li = document.createElement('li');
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const text = document.createElement('span');
    text.textContent = t('optionsNoSites');
    empty.append(icon('globe'), text);
    li.append(empty);
    sitesEl.replaceChildren(li);
    return;
  }
  // Build the whole list before swapping it in so concurrent refreshes don't duplicate rows.
  sitesEl.replaceChildren(...(await Promise.all(sites.map((site) => siteRow(site, settings)))));
}

// The popup redirects here (?add=<origin>) when the browser can't request permissions from a popup.
const fromPopup = new URLSearchParams(location.search).get('add');
if (fromPopup) {
  addInput.value = fromPopup;
  addInput.focus();
  hint(t('optionsAddHintFromPopup'));
}

addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  addError.textContent = '';
  addInput.classList.remove('invalid');

  let origin: string;
  try {
    origin = normalizeOrigin(addInput.value);
  } catch (err) {
    addError.textContent = (err as Error).message;
    addInput.classList.add('invalid');
    return;
  }

  // permissions.request needs a user gesture: call it synchronously in the event handler.
  chrome.permissions
    .request({ origins: [originToMatch(origin)] })
    .then(async (granted) => {
      if (!granted) {
        addError.textContent = t('optionsPermissionDenied');
        return;
      }
      const { sites } = await getSettings();
      // An exact entry under a wildcard is allowed: it takes precedence and can have its own formats.
      const covering = findSite(origin, sites);
      const exists = sites.some((s) => siteKey(s) === siteKey(origin));
      if (!exists) await setSettings({ sites: [...sites, origin] });
      addInput.value = '';
      renderSites();
      if (exists) hint(t('optionsAlreadyListed'));
      else if (covering) hint(t('optionsAddedOverride', covering));
      else if (fromPopup === origin) hint(t('optionsAddedReload'));
      else hint('');
      if (!exists) flashSaved();
    })
    .catch((err) => {
      addError.textContent = t('optionsPermissionError', (err as Error).message);
    });
});

async function initOptions() {
  const s = await getSettings();
  $<HTMLInputElement>('autoCopy').checked = s.autoCopy;
  $<HTMLSelectElement>('openIn').value = s.openIn;

  // Language names are shown in their own language (not translated); changing it reloads the page.
  const language = $<HTMLSelectElement>('language');
  language.append(
    new Option(t('optionsLanguageAuto'), 'auto'),
    ...LANGUAGES.map(([code, name]) => new Option(name, code)),
  );
  language.value = s.language;
  language.addEventListener('change', async () => {
    await setSettings({ language: language.value });
    location.reload();
  });

  for (const [format, options] of Object.entries(COPY_FORMATS) as [FormatId, (typeof COPY_FORMATS)[FormatId]][]) {
    if (options.length < 2) continue;
    const row = document.createElement('div');
    row.className = 'setting';
    const text = document.createElement('div');
    text.className = 'setting-text';
    const label = document.createElement('label');
    label.htmlFor = `copy-${format}`;
    label.textContent = formatLabel(format);
    text.append(label);
    const select = document.createElement('select');
    select.id = `copy-${format}`;
    for (const [value, key] of options) select.append(new Option(t(key), value));
    select.value = s.copyFormats[format] ?? 'raw';
    select.addEventListener('change', async () => {
      const { copyFormats } = await getSettings();
      await setSettings({ copyFormats: { ...copyFormats, [format]: select.value } });
      flashSaved();
    });
    row.append(text, select);
    $('copy-formats').append(row);
  }

  const commands = await chrome.commands.getAll().catch(() => []);
  const shortcut = commands.find((c) => c.name === 'open-last-export')?.shortcut;
  const kbd = document.createElement(shortcut ? 'kbd' : 'span');
  kbd.className = shortcut ? '' : 'muted small';
  kbd.textContent = shortcut || t('optionsShortcutNone');
  $('shortcut').replaceChildren(kbd);
  // Some browsers may refuse to open chrome:// URLs; then show the path to open manually.
  $('shortcut-change').addEventListener('click', () =>
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => {
      savedEl.textContent = t('popupShortcutTitle');
      savedEl.className = 'toast show err';
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => (savedEl.className = 'toast'), 6000);
    }),
  );
  $('version').textContent = t('optionsVersion', chrome.runtime.getManifest().version);
  $<HTMLInputElement>('interceptServer').checked = s.interceptServer;

  for (const id of ['autoCopy', 'interceptServer'] as const) {
    $<HTMLInputElement>(id).addEventListener('change', (e) =>
      setSettings({ [id]: (e.target as HTMLInputElement).checked }).then(flashSaved),
    );
  }
  $<HTMLSelectElement>('openIn').addEventListener('change', (e) =>
    setSettings({ openIn: (e.target as HTMLSelectElement).value as OpenIn }).then(flashSaved),
  );
}

await Promise.all([renderSites(), initOptions()]);
requestAnimationFrame(() => document.body.classList.remove('preload'));
