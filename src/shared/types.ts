// Types shared across the service worker, content scripts and extension pages.

export type FormatId = 'json' | 'csv' | 'xml' | 'text';
export type OpenIn = 'tab' | 'window' | 'popup';
export type JsonView = 'tree' | 'pretty' | 'raw';

export interface Settings {
  /** Enabled sites as port-less origins, e.g. "https://app.example.com" or "https://*.example.com". */
  sites: string[];
  /** Per-site formats: { [siteKey]: ["json", "csv", …] }. Missing entry = DEFAULT_FORMATS. */
  siteFormats: Record<string, FormatId[]>;
  /** Copy to clipboard as soon as the viewer opens. */
  autoCopy: boolean;
  /** What to copy per format (values from COPY_FORMATS). */
  copyFormats: Record<FormatId, string>;
  /** Last JSON view in the viewer. */
  jsonView: JsonView;
  /** Also intercept server downloads (Content-Disposition: attachment). */
  interceptServer: boolean;
  /** Where to open the viewer. */
  openIn: OpenIn;
  /** UI language: "auto" (browser language) or a code from LANGUAGES in shared/i18n.ts. */
  language: string;
}

/** What inject.js sends for a captured export. */
export interface ExportPayload {
  text: string;
  filename: string | null;
  mime: string;
  format?: FormatId;
  pageUrl: string;
  pageTitle: string;
}

export type ExportSource = 'page' | 'download-blob' | 'download-http';

/** A stored export (viewer payload). */
export interface PayloadRecord {
  text: string;
  filename: string;
  mime: string;
  format: FormatId;
  pageUrl: string;
  pageTitle: string;
  via: ExportSource;
  createdAt: number;
  /** Custom name set by the user. */
  label?: string;
}

/** History entry: a record without its (possibly multi-MB) text. */
export interface HistoryItem {
  id: string;
  label: string;
  filename: string;
  format: FormatId;
  size: number;
  createdAt: number;
  pageUrl: string;
  pageTitle: string;
}

export type ExportResult = { ok: true } | { ok: false; reason: string };

/** Messages to the service worker. */
export type Message =
  | { type: 'export'; payload: ExportPayload }
  | { type: 'getPayload'; id: string }
  | { type: 'listHistory' }
  | { type: 'renameExport'; id: string; label: string };
