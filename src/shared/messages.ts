// Typed wrappers around runtime.sendMessage for extension pages.
import type { HistoryItem, Message, PayloadRecord } from './types.ts';

export const getPayload = (id: string): Promise<PayloadRecord | null> =>
  chrome.runtime.sendMessage<Message, PayloadRecord | null>({ type: 'getPayload', id });

/** Export history, newest first; empty when the service worker doesn't answer. */
export const listHistory = async (): Promise<HistoryItem[]> =>
  (await chrome.runtime.sendMessage<Message, HistoryItem[]>({ type: 'listHistory' }).catch(() => [])) ?? [];

export const renameExport = (id: string, label: string): Promise<boolean> =>
  chrome.runtime.sendMessage<Message, boolean>({ type: 'renameExport', id, label }).catch(() => false);
