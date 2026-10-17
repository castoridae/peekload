import { FORMATS } from './formats.ts';
import { locale, t } from './i18n.ts';
import { icon } from './icons.ts';
import type { HistoryItem } from './types.ts';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Fills `list` (a <ul class="history-list">) with one button per export; `onSelect(item)` runs on click. */
export function renderHistoryList(
  list: HTMLElement,
  items: HistoryItem[],
  { currentId = null, onSelect }: { currentId?: string | null; onSelect: (item: HistoryItem) => void },
): void {
  list.replaceChildren(
    ...items.map((item) => {
      const btn = document.createElement('button');
      btn.title = item.filename || '';
      if (item.id === currentId) btn.setAttribute('aria-current', 'true');

      const fmt = document.createElement('span');
      fmt.className = 'badge-fmt';
      fmt.dataset.format = item.format;
      fmt.textContent = FORMATS[item.format]?.short ?? item.format;

      const text = document.createElement('span');
      text.className = 'text';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.label || item.filename || t('exportFallbackName');
      const meta = document.createElement('span');
      meta.className = 'meta';
      let host = '';
      try {
        host = item.pageUrl ? new URL(item.pageUrl).host : '';
      } catch {}
      meta.textContent = [formatTime(item.createdAt), host].filter(Boolean).join(' · ');
      text.append(name, meta);

      btn.append(fmt, text, icon('chevron-right', 'chev'));
      btn.addEventListener('click', () => onSelect(item));
      const li = document.createElement('li');
      li.append(btn);
      return li;
    }),
  );
}
