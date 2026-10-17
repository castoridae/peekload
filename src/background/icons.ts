// Toolbar icon: colored on enabled sites, grayed out elsewhere.
import { t } from '../shared/i18n.ts';
import { isSiteEnabled } from '../shared/sites.ts';
import { i18n, settings } from './settings-cache.ts';

const ICON_SIZES = [16, 32] as const;

type IconSet = Record<number, ImageData>;

/** Loads the manifest icons and derives grayed-out versions (no separate PNGs). */
let iconsPromise: Promise<{ on: IconSet; off: IconSet }> | null = null;

function icons() {
  iconsPromise ??= (async () => {
    const on: IconSet = {};
    const off: IconSet = {};
    for (const size of ICON_SIZES) {
      const blob = await (await fetch(chrome.runtime.getURL(`icons/icon${size}.png`))).blob();
      const ctx = new OffscreenCanvas(size, size).getContext('2d');
      if (!ctx) throw new Error('No 2d context');
      ctx.drawImage(await createImageBitmap(blob), 0, 0, size, size);
      const colored = ctx.getImageData(0, 0, size, size);
      on[size] = colored;
      const data = new Uint8ClampedArray(colored.data);
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
        data[i] = data[i + 1] = data[i + 2] = gray;
        data[i + 3] = (data[i + 3] ?? 0) * 0.6;
      }
      off[size] = new ImageData(data, size, size);
    }
    return { on, off };
  })().catch((e) => {
    iconsPromise = null;
    throw e;
  });
  return iconsPromise;
}

// Without the "tabs" permission `tab.url` is only set on granted hosts, so other tabs get the gray icon, as intended.
export async function updateIcon(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab || tab.id == null || tab.id < 0) return;
  const { sites } = await settings();
  const on = !!tab.url && isSiteEnabled(tab.url, sites);
  const set = await icons();
  await i18n();
  await chrome.action.setIcon({ tabId: tab.id, imageData: on ? set.on : set.off });
  await chrome.action.setTitle({ tabId: tab.id, title: t(on ? 'iconTitleOn' : 'iconTitleOff') });
}

export async function updateAllIcons(): Promise<void> {
  try {
    // Global default, for tabs not updated yet.
    await chrome.action.setIcon({ imageData: (await icons()).off });
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((tab) => updateIcon(tab).catch(() => {})));
  } catch (e) {
    console.error('[Peekload] icons', e);
  }
}
