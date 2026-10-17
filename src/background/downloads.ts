// Server downloads (Content-Disposition: attachment) and blobs that slipped past inject.ts.
import { couldBeFormat, detectFormat } from '../shared/formats.ts';
import { formatsFor, originToMatch, siteKey } from '../shared/sites.ts';
import { settings } from './settings-cache.ts';
import { activeTab, openViewer } from './viewer.ts';

const MAX_REFETCH_BYTES = 50 * 1024 * 1024;

interface FetchedFile {
  text: string;
  type: string;
  tab?: chrome.tabs.Tab;
}

async function refetch(url: string): Promise<FetchedFile> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_REFETCH_BYTES) throw new Error('File too large');
  return { text: await res.text(), type: res.headers.get('content-type') || '' };
}

type BlobRead = { ok: true; text: string; type: string } | { ok: false; error: string };

async function readBlobViaTab(blobUrl: string): Promise<FetchedFile> {
  const origin = siteKey(blobUrl.slice('blob:'.length));
  if (!origin) throw new Error('Unknown blob origin');
  const tabs = await chrome.tabs.query({ url: originToMatch(origin) });

  for (const tab of tabs) {
    if (tab.id == null) continue;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [blobUrl],
        func: async (u: string): Promise<BlobRead> => {
          try {
            const r = await fetch(u);
            return { ok: true, text: await r.text(), type: r.headers.get('content-type') || '' };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        },
      });
      const result = res?.result;
      if (result?.ok) return { text: result.text, type: result.type, tab };
    } catch {
      // No access to this tab; try the next one.
    }
  }
  throw new Error('Could not read the blob');
}

function filenameFrom(item: chrome.downloads.DownloadItem, url: string): string {
  if (item.filename) return item.filename.split(/[\\/]/).pop() ?? '';
  try {
    const last = new URL(url).pathname.split('/').pop();
    return last ? decodeURIComponent(last) : '';
  } catch {
    return '';
  }
}

async function handleDownload(item: chrome.downloads.DownloadItem): Promise<void> {
  if (item.byExtensionId === chrome.runtime.id) return;

  const s = await settings();
  if (!s.interceptServer || !s.sites.length) return;

  const url = item.finalUrl || item.url || '';
  const isBlob = url.startsWith('blob:');
  const isHttp = /^https?:/i.test(url);
  if (!isBlob && !isHttp) return;

  const sourceUrl = isBlob ? url.slice('blob:'.length) : url;
  // Formats enabled for the download's source and for the page it was clicked on (referrer).
  const formats = [...new Set([...formatsFor(sourceUrl, s), ...(item.referrer ? formatsFor(item.referrer, s) : [])])];
  if (!formats.length) return;

  const name = filenameFrom(item, url);
  if (isHttp) {
    // Refetch only files that could be an enabled format, and only with host permission (so session cookies are sent).
    if (!couldBeFormat({ mime: item.mime, name: [name, url] }, formats)) return;
    if (!(await chrome.permissions.contains({ origins: [originToMatch(url)] }))) return;
  }

  // Pause while deciding. If it's not an enabled format or can't be read, resume: never lose the user's download.
  const paused = await chrome.downloads.pause(item.id).then(
    () => true,
    () => false,
  );

  let data: FetchedFile | null = null;
  try {
    data = isBlob ? await readBlobViaTab(url) : await refetch(url);
  } catch (e) {
    console.warn('[Peekload] Could not read the download', url, e);
  }

  const format = data && detectFormat({ mime: data.type, name: [name, url], text: data.text }, formats);
  if (!data || !format) {
    if (paused) chrome.downloads.resume(item.id).catch(() => {});
    return;
  }

  const [current] = await chrome.downloads.search({ id: item.id });
  if (current && current.state === 'in_progress') {
    await chrome.downloads.cancel(item.id).catch(() => {});
    await chrome.downloads.erase({ id: item.id }).catch(() => {});
  }
  // If the download already finished, the file stays on disk; open the viewer anyway.

  await openViewer(
    {
      text: data.text,
      filename: name,
      mime: data.type,
      format,
      pageUrl: item.referrer || sourceUrl,
      pageTitle: data.tab?.title || '',
      via: isBlob ? 'download-blob' : 'download-http',
    },
    data.tab || (await activeTab()),
  );
}

export function registerDownloadHandler(): void {
  // onDeterminingFilename rather than onCreated: the Content-Disposition filename is known by now.
  // suggest() is called right away, without renaming.
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    suggest();
    handleDownload(item).catch((e) => console.warn('[Peekload] download', e));
  });
}
