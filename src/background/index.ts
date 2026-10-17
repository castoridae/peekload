// Service worker entry point: wires up listeners. The logic lives in the sibling modules.

import { scheduleSync } from './content-scripts.ts';
import { registerDownloadHandler } from './downloads.ts';
import { updateAllIcons, updateIcon } from './icons.ts';
import { registerMessageHandlers } from './messages.ts';
import { invalidateSettings, reloadI18n } from './settings-cache.ts';

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  invalidateSettings();
  if (changes.language) reloadI18n(changes.language.newValue as string);
  if (changes.sites || changes.language) updateAllIcons();
  if (changes.sites) scheduleSync();
});

chrome.runtime.onInstalled.addListener(scheduleSync);
chrome.runtime.onStartup.addListener(scheduleSync);
chrome.permissions.onAdded.addListener(scheduleSync);
chrome.permissions.onRemoved.addListener(scheduleSync);

chrome.runtime.onInstalled.addListener(updateAllIcons);
chrome.runtime.onStartup.addListener(updateAllIcons);
chrome.permissions.onAdded.addListener(updateAllIcons);
chrome.permissions.onRemoved.addListener(updateAllIcons);
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.url || info.status === 'loading') updateIcon(tab).catch(() => {});
});
chrome.tabs.onReplaced.addListener((tabId) => {
  chrome.tabs
    .get(tabId)
    .then(updateIcon)
    .catch(() => {});
});

registerMessageHandlers();
registerDownloadHandler();
