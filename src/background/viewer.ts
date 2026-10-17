// Opening the preview in a tab or window.
import type { PayloadRecord } from '../shared/types.ts';
import { storePayload } from './payloads.ts';
import { settings } from './settings-cache.ts';

export async function openViewer(
  payload: Omit<PayloadRecord, 'createdAt'>,
  openerTab: chrome.tabs.Tab | undefined,
): Promise<void> {
  const id = crypto.randomUUID();
  await storePayload(id, { ...payload, createdAt: Date.now() });

  const url = chrome.runtime.getURL(`viewer/viewer.html?id=${id}`);
  const { openIn } = await settings();

  if (openIn === 'window' || openIn === 'popup') {
    await chrome.windows.create({
      url,
      type: openIn === 'popup' ? 'popup' : 'normal',
      width: 960,
      height: 780,
      focused: true,
    });
    return;
  }

  const placement = openerTab
    ? { index: openerTab.index + 1, windowId: openerTab.windowId, openerTabId: openerTab.id }
    : {};
  await chrome.tabs.create({ url, active: true, ...placement });
}

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}
