// Per-site format checkboxes, used by the popup and the options page.
import { formatLabel } from './format-label.ts';
import { FORMAT_IDS, FORMATS } from './formats.ts';
import { setSiteFormats } from './settings.ts';
import { siteFormats } from './sites.ts';
import type { FormatId, Settings } from './types.ts';

/**
 * Format checkboxes for `site`; changes are saved immediately.
 * The last checked format is locked: a site with no formats would intercept nothing
 * (disabling a site is done via the toggle / remove button instead).
 * `compact`: short labels (JSON, CSV, XML, TXT) with the full name as a tooltip, for the narrow popup.
 */
export function formatPicker(
  site: string,
  settings: Settings,
  onChange: ((formats: FormatId[]) => void) | null,
  { compact = false } = {},
): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'format-picker';
  const current = new Set(siteFormats(site, settings));
  const inputs: HTMLInputElement[] = [];

  const sync = () => {
    const checked = inputs.filter((i) => i.checked);
    for (const i of inputs) i.disabled = checked.length === 1 && i.checked;
  };

  for (const id of FORMAT_IDS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = id;
    input.checked = current.has(id);
    input.addEventListener('change', async () => {
      sync();
      const formats = inputs.filter((i) => i.checked).map((i) => i.value as FormatId);
      await setSiteFormats(site, formats);
      onChange?.(formats);
    });
    inputs.push(input);
    label.append(input, compact ? FORMATS[id].short : formatLabel(id));
    if (compact) label.title = formatLabel(id);
    box.append(label);
  }
  sync();
  return box;
}
