// Runs in the page's MAIN world from document_start: no chrome.* (talks to bridge.ts via postMessage).
// Intercepts in-browser exports (blob:/data: URL + <a download>). Only pre-filters unsupported formats;
// background decides whether the format is enabled for the site (ok:false -> normal download).
import { detectFormat } from '../shared/formats.ts';
import type { ExportPayload } from '../shared/types.ts';

declare global {
  interface Window {
    __peekload?: true;
  }
}

interface ReadData {
  text: string;
  type: string;
  blob: Blob | null;
}

interface Pending {
  fallback: () => void;
  timer: ReturnType<typeof setTimeout>;
}

(() => {
  if (window.__peekload) return;
  Object.defineProperty(window, '__peekload', { value: true });

  const SOURCE = 'peekload';
  const RESULT_TIMEOUT_MS = 4000;
  const REVOKE_DELAY_MS = 60_000;

  const blobs = new Map<string, Blob>(); // blob URL -> Blob
  const pending = new Map<string, Pending>(); // id -> fallback + timeout
  const bypassed = new WeakSet<HTMLAnchorElement>(); // anchors we re-click to download normally

  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origClick = HTMLAnchorElement.prototype.click;
  const origDispatch = EventTarget.prototype.dispatchEvent;

  // --- blob tracking -----------------------------------------------------------

  URL.createObjectURL = function createObjectURL(obj: Blob | MediaSource) {
    const url = origCreate.call(URL, obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };

  // Pages often revoke right after the click; delay it so we can still read the blob (or fall back to a normal download).
  URL.revokeObjectURL = function revokeObjectURL(url: string) {
    if (blobs.has(url)) {
      setTimeout(() => {
        blobs.delete(url);
        origRevoke.call(URL, url);
      }, REVOKE_DELAY_MS);
      return;
    }
    return origRevoke.call(URL, url);
  };

  // --- helpers -----------------------------------------------------------------

  function anchorHref(a: HTMLAnchorElement): string {
    return a.getAttribute('href') ? a.href : '';
  }

  function isCandidate(a: EventTarget | null | undefined): a is HTMLAnchorElement {
    if (!(a instanceof HTMLAnchorElement) || bypassed.has(a)) return false;
    if (!a.hasAttribute('download')) return false;
    const href = anchorHref(a);
    return href.startsWith('blob:') || href.startsWith('data:');
  }

  function decodeDataUrl(href: string): ReadData {
    const comma = href.indexOf(',');
    if (comma < 0) throw new Error('Invalid data: URL');
    const meta = href.slice(5, comma);
    const payload = href.slice(comma + 1);
    const type = meta.split(';')[0] || '';
    let text: string;
    if (/;base64/i.test(meta)) {
      const bin = atob(payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      text = new TextDecoder().decode(bytes);
    } else {
      text = decodeURIComponent(payload);
    }
    return { text, type, blob: null };
  }

  async function readAnchor(href: string): Promise<ReadData> {
    if (href.startsWith('data:')) return decodeDataUrl(href);
    const blob = blobs.get(href);
    if (blob) return { text: await blob.text(), type: blob.type, blob };
    // Blob created before this script loaded, or in another context.
    const res = await fetch(href);
    const fetched = await res.blob();
    return { text: await fetched.text(), type: fetched.type, blob: fetched };
  }

  /** Normal download that bypasses interception. Every path that doesn't take the export ends here: never lose the user's download. */
  function passThrough(href: string, name: string, blob: Blob | null | undefined) {
    const a = document.createElement('a');
    a.href = blob ? origCreate.call(URL, blob) : href;
    a.download = name || '';
    bypassed.add(a);
    origClick.call(a);
    if (blob) setTimeout(() => origRevoke.call(URL, a.href), REVOKE_DELAY_MS);
  }

  // --- intercepted export --------------------------------------------------------

  function handle(a: HTMLAnchorElement) {
    const href = anchorHref(a);
    const name = a.getAttribute('download') || '';

    (async () => {
      let data: ReadData;
      try {
        data = await readAnchor(href);
      } catch {
        return passThrough(href, name, blobs.get(href));
      }

      const format = detectFormat({ mime: data.type, name, text: data.text });
      if (!format) return passThrough(href, name, data.blob);

      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const fallback = () => passThrough(href, name, data.blob);
      const timer = setTimeout(() => {
        if (pending.delete(id)) fallback();
      }, RESULT_TIMEOUT_MS);
      pending.set(id, { fallback, timer });

      const payload: ExportPayload = {
        text: data.text,
        filename: name || null,
        mime: data.type || '',
        format,
        pageUrl: location.href,
        pageTitle: document.title,
      };
      window.postMessage({ source: SOURCE, dir: 'to-ext', type: 'export', id, payload }, '*');
    })();
  }

  // Reply via bridge.ts. If the extension didn't take the export (site disabled, extension reloaded), download normally.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== SOURCE || d.dir !== 'to-page' || d.type !== 'result') return;
    const entry = pending.get(d.id);
    if (!entry) return;
    pending.delete(d.id);
    clearTimeout(entry.timer);
    if (!d.ok) entry.fallback();
  });

  // --- interception points -----------------------------------------------------

  // 1) a.click() on a detached anchor (most common pattern).
  //    Connected anchors are handled by the listener in 3).
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    if (!this.isConnected && isCandidate(this)) {
      handle(this);
      return;
    }
    return origClick.call(this);
  };

  // 2) a.dispatchEvent(new MouseEvent('click')) on a detached anchor (e.g. FileSaver.js).
  EventTarget.prototype.dispatchEvent = function dispatchEvent(this: EventTarget, event: Event) {
    if (
      event &&
      event.type === 'click' &&
      this instanceof HTMLAnchorElement &&
      !this.isConnected &&
      isCandidate(this)
    ) {
      handle(this);
      return false; // report the event as canceled
    }
    return origDispatch.call(this, event);
  };

  // 3) Real and synthetic clicks on <a download> links in the DOM.
  window.addEventListener(
    'click',
    (e) => {
      const a = e.composedPath().find((n) => n instanceof HTMLAnchorElement);
      if (!a || !isCandidate(a)) return;
      e.preventDefault();
      handle(a);
    },
    true,
  );
})();
