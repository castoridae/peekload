# Peekload

**Preview exports instead of downloading them.**

A Chrome extension (Manifest V3). On sites you choose, JSON exports (and optionally CSV/TSV, XML and text files)
**are not saved to disk**. They open in a preview tab instead and are copied to the clipboard.

## Installation

1. Build the extension: `pnpm install && pnpm build` (creates `dist/`).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` directory.
4. Pin the extension icon to the toolbar.

Also works in Edge, Brave and other Chromium browsers, version 111 or newer.

## Usage

1. Open the site you export data from.
2. Click the extension icon, turn on the switch next to the site address and accept the permission prompt.
3. Trigger an export on the site. It opens in a new tab and is copied to the clipboard.

A new site captures JSON only. Other formats are enabled per site in the popup or in the settings:
**JSON**, **CSV / TSV**, **XML**, **Text** (`.txt`, `.log`, `.md` and `text/plain` without an extension).

In the preview you can:

- **JSON**: browse a collapsible tree, a formatted or a raw view. Formatting and minifying only touch whitespace,
  so large numbers (e.g. IDs above 2^53) stay exactly as exported. The filter searches keys and values, or takes
  a path such as `$.items[0].id`, `$.items[*].name` or `$..id`; **Copy result** copies the matches. Clicking a key
  copies its path.
- **CSV / TSV**: view a table (`,` `;` tab `|` separators are detected automatically) and filter rows. Copy as TSV
  to paste into Excel or Google Sheets, or as JSON (an array of objects).
- **XML**: switch between a formatted (indented, highlighted) and a raw view.
- **Compare** the export with another one from history (**Compare with…**). For JSON, key order can be ignored.
- **Name** the export (click the title or ✎). The name shows in history and is used as the file name by **Save file**.
- **Save & copy path**: saves the file to `Downloads/peekload/` and copies its full path. Paste it into e.g. Claude Code
  (or as `@path`) and Claude reads the file. Content and extension follow the selected copy format (CSV as TSV gives
  `.tsv`). For Claude Code, set the JSON copy format to "formatted" — a single very long line gets truncated when the
  file is read. Browsers don't allow putting an actual file on the clipboard; web pages can only write text, HTML and
  PNG images.
- **Browse history** with the clock button (top left): a sidebar with recent exports, hidden by default and remembered
  between visits. Selecting an export opens it in the same tab without touching the clipboard.
- **Save file** to disk anyway.

`Ctrl/Cmd+C` with nothing selected copies everything, `/` focuses the filter.

The popup lists **recent exports** (up to 10, kept until the browser closes). `Alt+Shift+J` opens the latest one;
change it at `chrome://extensions/shortcuts`.

**Settings** (the gear in the popup, or right-click the icon → Options) hold the site list and:

- language,
- auto-copy and the copy format (separately for JSON, CSV and XML),
- where the preview opens: tab, window or a small popup window,
- capturing files downloaded from the server.

## Languages

English (default), Polish, German, French, Spanish, Portuguese (Brazil and Portugal), Italian, Dutch and Ukrainian.
Pick one in **Settings → Behavior → Language**. **Automatic** uses the browser UI language and falls back to English.
The extension name and description on the extensions page always follow the browser language.

To add a language, create `public/_locales/<code>/messages.json` with the same keys as `public/_locales/en`, and add it to
`LANGUAGES` in `src/shared/i18n.ts`. `pnpm test` reports missing or extra keys.

## What gets captured

| How the site exports                                         | Captured                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `Blob` + `URL.createObjectURL` + `<a download>.click()`      | ✅ (the common case)                                                      |
| `a.dispatchEvent(new MouseEvent('click'))` (FileSaver.js)    | ✅                                                                        |
| `<a download href="blob:…">` in the DOM, clicked by the user | ✅                                                                        |
| `data:application/json…` with a `download` attribute         | ✅                                                                        |
| Server response with `Content-Disposition: attachment` (GET) | ✅ the download is paused and the file is fetched again with your session |
| Server response to a **POST** (e.g. an export form)          | ❌ downloads normally                                                     |
| `showSaveFilePicker` (File System Access API)                | ❌ downloads normally                                                     |

JSON is recognized by MIME type or the `.json` extension, falling back to checking whether the content parses.
CSV and text are recognized only by MIME type or extension; XML also by a leading `<?xml` declaration. Only formats
enabled for the site are captured. Everything else (XLSX, PDF, images…) downloads normally.

If the export comes from another domain than the page (page on `app.example.com`, file from `api.example.com`),
add that domain in the settings, or add `*.example.com`, which covers `example.com` and all its subdomains.
The asterisk is only allowed at the start, as in Chrome permission patterns. An exact entry (`app.example.com`)
takes precedence over `*.example.com`, so it can have different formats.

The toolbar icon is in color on enabled sites and grayed out elsewhere. A gray icon on a listed site means its
permission hasn't been granted; the settings then show a **Grant** button next to it.

**Browsers that block permission prompts in the popup:** turning the switch on opens the settings
with the address filled in. Click **Add**, accept the prompt and reload the site's tab.

## Development

```bash
pnpm install
pnpm dev        # rebuild dist/ on every change (reload the extension in chrome://extensions)
pnpm build      # one-off build into dist/
pnpm check      # Biome (lint + format check), tsc, tests
pnpm format     # apply Biome formatting and safe fixes
pnpm test       # capture tests (jsdom), site/format helpers, preview modules, translations
pnpm serve      # test page at http://localhost:8080
pnpm zip        # build and pack release/peekload-<version>.zip for the Chrome Web Store
pnpm release patch  # check, bump version (patch|minor|major|x.y.z), build and pack the zip
```

The source is TypeScript in `src/`, bundled with esbuild (type checking is `tsc --noEmit`). Static files
(manifest, icons, translations) live in `public/`.

On the test page, enable the extension and click through all the buttons. With the default formats (JSON only),
items 7 and 10–15 download normally. With CSV / TSV, XML and Text enabled in the popup they open in the preview,
except 14 (PDF), which always downloads.

## Privacy

Nothing leaves your browser. Captured exports are kept in `chrome.storage.session`, which is cleared when the browser
closes, and only the 10 most recent are kept (fewer if they are large: the limit is about 10 MB in total, oldest
removed first). Host permissions are optional and granted separately for each site you enable.

## Support

Peekload is free. If it saves you time, you can [buy me a coffee](https://ko-fi.com/castoridae).

## License

MIT with the [Commons Clause](https://commonsclause.com): free to use (including at work), modify and fork,
but you may not sell the software or a product or service whose value comes substantially from it. See [LICENSE](LICENSE).
