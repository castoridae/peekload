// Messages: exports from content scripts, payload reads from the viewer; plus the keyboard shortcut.
import { detectFormat } from '../shared/formats.ts';
import { formatsFor } from '../shared/sites.ts';
import type { ExportPayload, ExportResult, Message } from '../shared/types.ts';
import { listHistory, loadPayload, renameExport } from './payloads.ts';
import { settings } from './settings-cache.ts';
import { openViewer } from './viewer.ts';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

async function handleExportMessage(
  payload: ExportPayload | undefined,
  sender: chrome.runtime.MessageSender,
): Promise<ExportResult> {
  const origin = sender.origin || sender.url;
  const formats = origin ? formatsFor(origin, await settings()) : [];
  if (!formats.length) return { ok: false, reason: 'disabled' };
  if (!payload || typeof payload.text !== 'string') return { ok: false, reason: 'invalid' };
  const format = detectFormat({ mime: payload.mime, name: str(payload.filename), text: payload.text }, formats);
  if (!format) return { ok: false, reason: 'format' };

  await openViewer(
    {
      text: payload.text,
      filename: str(payload.filename),
      mime: str(payload.mime),
      format,
      pageUrl: sender.tab?.url || str(payload.pageUrl),
      pageTitle: sender.tab?.title || str(payload.pageTitle),
      via: 'page',
    },
    sender.tab,
  );
  return { ok: true };
}

export function registerMessageHandlers(): void {
  chrome.runtime.onMessage.addListener((msg: Message | undefined, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;

    if (msg?.type === 'export' && sender.tab) {
      handleExportMessage(msg.payload, sender).then(sendResponse, (e) =>
        sendResponse({ ok: false, reason: String(e) }),
      );
      return true;
    }

    // The rest is for extension pages only (viewer, popup), never content scripts.
    if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;

    if (msg?.type === 'getPayload') {
      loadPayload(msg.id).then(sendResponse, () => sendResponse(null));
      return true;
    }
    if (msg?.type === 'listHistory') {
      listHistory().then(sendResponse, () => sendResponse([]));
      return true;
    }
    if (msg?.type === 'renameExport') {
      renameExport(msg.id, msg.label).then(sendResponse, () => sendResponse(false));
      return true;
    }
  });

  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'open-last-export') return;
    const [last] = await listHistory();
    if (last) await chrome.tabs.create({ url: chrome.runtime.getURL(`viewer/viewer.html?id=${last.id}`) });
  });
}
