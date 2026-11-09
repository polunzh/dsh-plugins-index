# polunzh DSH Plugins

[中文](./README.zh-CN.md) | **English**

A self-hosted **plugin market index (format 1)** for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness), plus the landing page that goes with it.

Add the URL below once to DSH's Discover tab to browse, install, track updates and uninstall the plugins listed here.

```
https://dsh.127.dev/index.json
```

Fallback URL, same content: `https://raw.githubusercontent.com/polunzh/dsh-plugins-index/main/index.json`

> This is a **self-hosted** index covering only polunzh's own plugins. The community market [dshopen.org](https://dshopen.org/) index (`https://dshopen.org/index.json`) can be added at the same time — they do not conflict.

![Landing page](docs/images/preview-en.png)

## Plugins

| Plugin | What it does | Latest |
|---|---|---|
| **Task Notifier** · [`@polunzh/dsh-task-notifier`](https://www.npmjs.com/package/@polunzh/dsh-task-notifier) | Chime + system/browser notification when a task finishes, plus a Tasks sidebar panel filtering unread / running / completed sessions; unread state persists locally. Bilingual, no network access. [Source](https://github.com/polunzh/dsh-task-notifier) | 1.2.1 (`index.json` is authoritative) |
| **Print Studio** · [`@polunzh/dsh-doc`](https://www.npmjs.com/package/@polunzh/dsh-doc) | Word-style A4 editor for handouts: compose on a real paper sheet with a formatting ribbon, review full-size pagination and layout guards, then print duplex on a LAN printer and get a delivery receipt. Bilingual, renders and prints locally. [Source](https://github.com/polunzh/dsh-doc) | 0.2.1 (`index.json` is authoritative) |

## How to use

1. DSH → **Plugins** → **Experimental plugins** → enable **Custom plugin indexes**
2. **Plugins** → **Discover** → **Add index source** → paste the URL above
3. Search or browse in Discover → **Install**
4. Afterwards:
   - **Update**: when a new version exists the entry shows `update-available` (this index refreshes from npm every 6 hours)
   - **Uninstall**: **Plugins** → **Installed** → the plugin → uninstall

> The index only carries metadata (name, description, icon, versions, npm source). Installation is still performed by DSH's plugin manager against the real npm package; the index hosts no code or tarballs.

## How it stays current

- Sources: `plugins.json` (hand-maintained metadata) + the **npm registry** (versions, publish timestamps, `engines.dsh`)
- `scripts/build-index.mjs` writes `index.json` and validates it with the official validator `@deepseek-ai/dsh-plugin-market-index`; nothing is written if validation fails
- `scripts/build-page.mjs` turns `index.json` + `site.json` into a single self-contained `dist/index.html` (CSS, JS and icons inlined, no external requests). The page also re-reads `/index.json` on load, so an index refresh shows up without rebuilding it
- GitHub Actions runs every 6 hours and commits only when something changed; `workflow_dispatch` is available too
- Net effect: **publish a new npm version → it appears in the index and on the page within 6 hours**

## Hosting

`https://dsh.127.dev/` is served by the Cloudflare Worker in this repo (`worker/index.js` + `wrangler.toml`):

- `/` or `/index.html` → the landing page
- `/index.json` → the market index
- anything else → 404

Both are read from GitHub per request and cached at the edge for 5 minutes. Refreshing the index or the page needs no Worker redeploy; `npx wrangler deploy` is only needed when the Worker code changes.

## Build and validate locally

```bash
npm install          # install the official validator
npm run build        # fetch latest from npm, rewrite index.json and dist/index.html
npm run check        # validate index.json and confirm dist/index.html is up to date (offline)
```

The page also takes `?lang=en|zh` and `?theme=light|dark` for quick previews of either version.

## Adding a plugin

1. Drop an icon at `icons/<slug>.svg` (≤32 KiB; SVG/PNG/JPEG/WebP; inlined as a `data:` URL at build time)
2. Add an entry to the `plugins` array in `plugins.json`:

```json
{
  "name": "@polunzh/dsh-your-plugin",
  "author": "polunzh",
  "icon": "icons/your-plugin.svg",
  "category": "interface",
  "keywords": ["your", "keywords"],
  "labels": ["bilingual"],
  "sortKeys": { "added": 2 },
  "homepage": "https://github.com/polunzh/dsh-your-plugin#readme",
  "repository": "https://github.com/polunzh/dsh-your-plugin",
  "title": { "en": "Your Plugin", "zh": "你的插件" },
  "description": { "en": "…", "zh": "…" }
}
```

3. `npm run build` → commit `plugins.json`, the icon, `index.json` and `dist/index.html`

Constraints (enforced by the official format 1 validator during the build):
`name` must be a valid npm package name; `versions` must be non-empty with exact SemVer versions and Unix-second publish timestamps;
every `category` / `labels` / `sortKeys` id must be declared in `metadata`; `title` must contain `en`; inline icons must stay under 32 KiB.
Prerelease versions are excluded by default (for example the `0.0.0-stage` placeholder left behind by npm's staged publishing flow).

Page copy and links live in `site.json`; category filters on the page appear automatically once more than one category is in use.

## License

[MIT](./LICENSE). `index.json` and `dist/index.html` are generated data and may be referenced freely.
