// Registers the content scripts for enabled sites that have granted host permissions.
import { originToMatch } from '../shared/sites.ts';
import { settings } from './settings-cache.ts';

async function syncContentScripts(): Promise<void> {
  const { sites } = await settings();
  const matches: string[] = [];
  for (const site of sites) {
    const match = originToMatch(site);
    if (await chrome.permissions.contains({ origins: [match] })) matches.push(match);
  }

  // Unregister all of our scripts, including legacy jei-* IDs from before the rename;
  // otherwise pages would get two interceptors after an update.
  const registered = await chrome.scripting.getRegisteredContentScripts();
  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
  }
  if (!matches.length) return;

  await chrome.scripting.registerContentScripts([
    {
      id: 'peekload-main',
      matches,
      js: ['content/inject.js'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: true,
    },
    {
      id: 'peekload-bridge',
      matches,
      js: ['content/bridge.js'],
      runAt: 'document_start',
      allFrames: true,
    },
  ]);
}

// Serialized so concurrent syncs don't race over the same script IDs.
let syncQueue: Promise<void> = Promise.resolve();

export function scheduleSync(): Promise<void> {
  syncQueue = syncQueue.then(syncContentScripts).catch((e) => console.error('[Peekload] sync', e));
  return syncQueue;
}
