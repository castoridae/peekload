// Payload storage for the viewer and the export history.
import type { HistoryItem, PayloadRecord } from '../shared/types.ts';

const PAYLOAD_PREFIX = 'payload:';
const MAX_KEPT = 10;

// storage.session has a ~10 MB quota; larger exports live only in SW memory
// (enough, since the viewer reads them right after opening).
const memoryStore = new Map<string, PayloadRecord>();

export async function storePayload(id: string, record: PayloadRecord): Promise<void> {
  memoryStore.set(id, record);
  while (memoryStore.size > MAX_KEPT) {
    const oldest = memoryStore.keys().next().value;
    if (oldest === undefined) break;
    memoryStore.delete(oldest);
  }

  // Larger than the whole quota: keep only in memoryStore, don't evict older exports for nothing.
  const quota = chrome.storage.session.QUOTA_BYTES ?? 10 * 1024 * 1024;
  if (new Blob([JSON.stringify(record)]).size > quota) return;

  let older: string[];
  try {
    const all = (await chrome.storage.session.get(null)) as Record<string, PayloadRecord>;
    const keys = Object.keys(all)
      .filter((k) => k.startsWith(PAYLOAD_PREFIX))
      .sort((a, b) => (all[a]?.createdAt ?? 0) - (all[b]?.createdAt ?? 0));
    const stale = keys.slice(0, Math.max(0, keys.length - (MAX_KEPT - 1)));
    if (stale.length) await chrome.storage.session.remove(stale);
    older = keys.slice(stale.length);
  } catch {
    return;
  }

  // Out of space: evict oldest first. The newest must survive SW suspension (history, shortcut, compare).
  for (;;) {
    try {
      await chrome.storage.session.set({ [PAYLOAD_PREFIX + id]: record });
      return;
    } catch {
      const oldest = older.shift();
      if (!oldest) return;
      await chrome.storage.session.remove(oldest).catch(() => {});
    }
  }
}

export async function loadPayload(id: string): Promise<PayloadRecord | null> {
  const cached = memoryStore.get(id);
  if (cached) return cached;
  const key = PAYLOAD_PREFIX + id;
  const res = (await chrome.storage.session.get(key)) as Record<string, PayloadRecord | undefined>;
  return res[key] ?? null;
}

/** Export history, newest first. Metadata only: the text can be several MB. */
export async function listHistory(): Promise<HistoryItem[]> {
  const records = new Map<string, PayloadRecord>();
  const all = (await chrome.storage.session.get(null)) as Record<string, PayloadRecord>;
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(PAYLOAD_PREFIX)) records.set(k.slice(PAYLOAD_PREFIX.length), v);
  }
  for (const [id, v] of memoryStore) records.set(id, v);
  return [...records]
    .map(([id, r]) => ({
      id,
      label: r.label || '',
      filename: r.filename || '',
      format: r.format || 'json',
      size: r.text?.length ?? 0,
      createdAt: r.createdAt ?? 0,
      pageUrl: r.pageUrl || '',
      pageTitle: r.pageTitle || '',
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function renameExport(id: string, label: unknown): Promise<boolean> {
  const record = await loadPayload(id);
  if (!record) return false;
  const updated = {
    ...record,
    label: String(label || '')
      .trim()
      .slice(0, 200),
  };
  if (memoryStore.has(id)) memoryStore.set(id, updated);
  await chrome.storage.session.set({ [PAYLOAD_PREFIX + id]: updated }).catch(() => {});
  return true;
}
