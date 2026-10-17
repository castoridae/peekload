// Runs in the isolated content-script world; relays messages between inject.ts (MAIN world) and the service worker.
import type { ExportResult, Message } from '../shared/types.ts';

declare global {
  var __peekloadBridge: true | undefined;
}

(() => {
  if (globalThis.__peekloadBridge) return;
  globalThis.__peekloadBridge = true;

  const SOURCE = 'peekload';

  function reply(id: string, ok: boolean) {
    window.postMessage({ source: SOURCE, dir: 'to-page', type: 'result', id, ok }, '*');
  }

  window.addEventListener('message', async (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== SOURCE || d.dir !== 'to-ext' || d.type !== 'export') return;

    try {
      const res = await chrome.runtime.sendMessage<Message, ExportResult | undefined>({
        type: 'export',
        payload: d.payload,
      });
      reply(d.id, !!res?.ok);
    } catch {
      // E.g. "Extension context invalidated" after the extension is reloaded.
      reply(d.id, false);
    }
  });
})();
