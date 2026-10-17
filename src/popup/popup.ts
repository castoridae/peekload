import { formatPicker } from '../shared/format-picker.ts';
import { renderHistoryList } from '../shared/history-list.ts';
import { initI18n, localize, t } from '../shared/i18n.ts';
import { icon } from '../shared/icons.ts';
import { listHistory } from '../shared/messages.ts';
import { getSettings, removeSite, setSettings } from '../shared/settings.ts';
import { findSite, originToMatch, siteKey } from '../shared/sites.ts';

await initI18n();
localize();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const siteEl = $('site');
const statusEl = $('status');
const toggle = $<HTMLInputElement>('toggle');
const reloadBtn = $('reload');

let tab: chrome.tabs.Tab | undefined;
let origin: string | null = null;
let enabled = false;
/** Site entry enabling the current page (may be a wildcard, e.g. https://*.example.com). */
let enabledBy: string | null = null;

/** "https://app.example.com" → "app.example.com"; http:// stays visible because it matters. */
const displaySite = (site: string) => site.replace(/^https:\/\//, '');

function renderHost(origin: string) {
  siteEl.replaceChildren();
  if (origin.startsWith('http://')) {
    const scheme = document.createElement('span');
    scheme.className = 'scheme';
    scheme.textContent = 'http://';
    siteEl.append(scheme);
  }
  siteEl.append(origin.replace(/^https?:\/\//, ''));
  siteEl.title = origin;
}

function renderStatus(viaWildcard: boolean) {
  const dot = document.createElement('span');
  dot.className = 'dot';
  const text = document.createElement('span');
  text.textContent = !enabled
    ? t('popupStatusInactive')
    : viaWildcard
      ? t('popupStatusCovered', displaySite(enabledBy ?? ''))
      : t('popupStatusActive');
  text.title = text.textContent;
  statusEl.replaceChildren(dot, text);
  // A wildcard entry covers the whole domain, so it can't be turned off with one click from the popup.
  if (viaWildcard) {
    const manage = document.createElement('button');
    manage.className = 'link';
    manage.textContent = t('popupManage');
    manage.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });
    statusEl.append(manage);
  }
}

function render() {
  const card = $('site-card');
  if (!origin) {
    siteEl.textContent = t('popupUnsupportedSite');
    statusEl.textContent = t('popupUnsupportedHint');
    $('site-icon').replaceChildren(icon('slash'));
    toggle.hidden = true;
    card.classList.remove('on');
    return;
  }
  const viaWildcard = enabled && enabledBy !== origin;
  renderHost(origin);
  renderStatus(viaWildcard);
  card.classList.toggle('on', enabled);
  toggle.checked = enabled;
  toggle.disabled = viaWildcard;
  renderFormats();
}

async function renderFormats() {
  $('formats').hidden = !enabled;
  if (!enabled || !enabledBy) return;
  // On a page covered by a wildcard, the checkboxes edit the wildcard entry's formats.
  $('formats-label').textContent =
    enabledBy !== origin ? t('popupFormatsFor', displaySite(enabledBy)) : t('popupFormats');
  $('formats-picker').replaceChildren(formatPicker(enabledBy, await getSettings(), null, { compact: true }));
}

async function renderHistory() {
  const items = await listHistory();
  const list = $('history-list');
  list.hidden = !items.length;
  $('history-empty').hidden = !!items.length;
  renderHistoryList(list, items, {
    onSelect: async (item) => {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`viewer/viewer.html?id=${item.id}`) });
      window.close();
    },
  });
}

async function renderShortcut() {
  const commands = await chrome.commands.getAll().catch(() => []);
  const cmd = commands.find((c) => c.name === 'open-last-export');
  if (!cmd?.shortcut) return;
  const kbd = document.createElement('kbd');
  kbd.textContent = cmd.shortcut;
  $('shortcut').replaceChildren(kbd);
  $('shortcut').title = t('popupShortcutTitle');
}

/** Note below the site card; `kind` = "ok" | "reload" | "warn" sets icon and color. */
function note(text: string, kind: 'ok' | 'reload' | 'warn' = 'ok') {
  $('note-text').textContent = text;
  $('note').hidden = !text;
  $('note').classList.toggle('warn', kind === 'warn');
  $('note-icon').replaceWith(
    Object.assign(icon({ ok: 'check', reload: 'refresh', warn: 'alert' }[kind]), { id: 'note-icon' }),
  );
  reloadBtn.hidden = kind !== 'reload';
}

async function injectNow(tabId: number) {
  // So the page works right after enabling, without a reload.
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['content/inject.js'],
    world: 'MAIN',
  });
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['content/bridge.js'],
  });
}

async function enable(origin: string) {
  // permissions.request needs a user gesture: call it synchronously from the click handler, before any await.
  let granted: boolean;
  try {
    granted = await chrome.permissions.request({ origins: [originToMatch(origin)] });
  } catch {
    // Some browsers can't show the permission prompt from a popup ("Could not find an active window"),
    // so ask from the options page in a tab instead (options.html?add=<origin>).
    const url = chrome.runtime.getURL(`options/options.html?add=${encodeURIComponent(origin)}`);
    await chrome.tabs.create({ url });
    window.close();
    return;
  }
  if (!granted) {
    render(); // resets the toggle to off
    note(t('popupNoPermission'), 'warn');
    return;
  }
  const { sites } = await getSettings();
  enabledBy = findSite(origin, sites);
  if (!enabledBy) {
    await setSettings({ sites: [...sites, origin] });
    enabledBy = origin;
  }
  enabled = true;
  render();
  try {
    if (tab?.id == null) throw new Error('No active tab');
    await injectNow(tab.id);
    note(t('popupReady'));
  } catch {
    note(t('popupEnabledReload'), 'reload');
  }
}

async function disable(origin: string) {
  const remaining = await removeSite(origin);
  await chrome.permissions.remove({ origins: [originToMatch(origin)] }).catch(() => {});
  // The page may still be covered by a wildcard entry.
  enabledBy = findSite(origin, remaining);
  enabled = !!enabledBy;
  render();
  note(enabled ? '' : t('popupDisabledReload'), 'reload');
}

toggle.addEventListener('change', () => {
  if (!origin) return;
  if (toggle.checked) enable(origin);
  else disable(origin);
});

reloadBtn.addEventListener('click', () => {
  if (tab?.id != null) chrome.tabs.reload(tab.id);
  window.close();
});

$('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

[tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const key = tab?.url ? siteKey(tab.url) : null;
origin = key && /^https?:/.test(key) ? key : null;
if (origin) {
  const { sites } = await getSettings();
  enabledBy = findSite(origin, sites);
  enabled = !!enabledBy;
}
render();
await Promise.all([renderHistory(), renderShortcut()]);
requestAnimationFrame(() => document.body.classList.remove('preload'));
