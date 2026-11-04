# polunzh DSH Plugins · 自建插件索引

**中文** | [English](#english)

给 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 用的**市场索引（format 1）**。
把下面这一个 URL 加进 DSH「发现」，就能浏览、安装、检测更新、卸载本仓库收录的插件。

```
https://dsh.127.dev/index.json
```

（备用地址，内容相同：`https://raw.githubusercontent.com/polunzh/dsh-plugins-index/main/index.json`）

> 这是**自建索引**，只收录 polunzh 自研的插件；社区市场 [dshopen.org](https://dshopen.org/zh/) 的索引 `https://dshopen.org/index.json` 可以同时添加，互不冲突。

---

## 中文

### 收录的插件

| 插件 | 说明 | 最新版 |
|---|---|---|
| **任务通知台** · [`@polunzh/dsh-task-notifier`](https://www.npmjs.com/package/@polunzh/dsh-task-notifier) | 任务完成时响提示音并弹系统/浏览器通知；侧边栏「任务」面板可筛选已完成未读 / 运行中 / 已完成 / 全部，未读状态本地持久化。中英双语，纯本地不联网。[源码](https://github.com/polunzh/dsh-task-notifier) | 1.1.0（以 `index.json` 为准） |

### 怎么用

1. DSH → **插件** → **实验性插件** → 打开 **自定义插件市场**
2. 回到 **插件** 页 → **发现** → **添加索引源** → 粘贴上面的 URL
3. 在「发现」里搜索或浏览 → 安装
4. 之后：
   - **更新**：插件有新版本时，列表会显示 `update-available`（本索引每 6 小时随 npm 刷新）
   - **卸载**：**插件** → **已安装** → 对应插件 → 卸载

> 索引只提供元数据（名称、简介、图标、版本、npm 源）。安装动作仍然由 DSH 的插件管理器执行，装的是 npm 上的真实包，索引本身不托管任何代码或 tarball。

### 更新机制

- 数据源：`plugins.json`（人工维护元数据）+ **npm registry**（版本号、发布时间、`engines.dsh`）
- `scripts/build-index.mjs` 生成 `index.json`，**先过官方校验器** `@deepseek-ai/dsh-plugin-market-index`，失败不写文件
- GitHub Actions 每 6 小时跑一次，只有内容变化才提交；也可以手动 `workflow_dispatch`
- 因此：**发 npm 新版本 → 最迟 6 小时自动出现在索引里**，无需手工改 JSON

### 本地构建 / 校验

```bash
npm install                                  # 安装官方校验器
npm run build                                # 抓 npm 最新版本并重写 index.json
npm run check                                # 只校验现有 index.json（不联网）
```

### 新增一个插件

1. 把图标放到 `icons/<slug>.svg`（≤32 KiB，SVG/PNG/JPEG/WebP，构建时内联为 `data:` URL）
2. 在 `plugins.json` 的 `plugins` 数组里加一项：

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

3. `npm run build` → 提交 `plugins.json`、图标和新的 `index.json`

约束（与官方 format 1 一致，构建脚本会强制校验）：
`name` 必须是合法 npm 包名；`versions` 非空、版本号是精确 SemVer、发布时间是 Unix 秒；
`category` / `labels` / `sortKeys` 引用到的 id 必须先在 `metadata` 里声明；
`title` 必须含 `en`；图标内联不超过 32 KiB。默认**不收录预发布版本**（如 npm 发布流程留下的 `0.0.0-stage`）。

### 目录结构

```
plugins.json                    人工维护的插件元数据
icons/                          图标（构建时内联进 index.json）
scripts/build-index.mjs         抓 npm + 生成 + 官方校验
index.json                      生成产物（DSH 读取的就是它）
.github/workflows/update-index.yml  每 6 小时刷新
```

---

<a id="english"></a>
## English

A community-style **plugin market index (format 1)** for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness).
Add the URL below once to DSH's Discover tab to browse, install, track updates and uninstall the plugins listed here.

```
https://dsh.127.dev/index.json
```

Fallback URL, same content: `https://raw.githubusercontent.com/polunzh/dsh-plugins-index/main/index.json`

> This is a **self-hosted** index covering only polunzh's own plugins. The community market [dshopen.org](https://dshopen.org/) index (`https://dshopen.org/index.json`) can be added at the same time — they do not conflict.

### Plugins

| Plugin | What it does | Latest |
|---|---|---|
| **Task Notifier** · [`@polunzh/dsh-task-notifier`](https://www.npmjs.com/package/@polunzh/dsh-task-notifier) | Chime + system/browser notification when a task finishes, plus a Tasks panel filtering unread / running / completed sessions; unread state persists locally. Bilingual, no network access. [Source](https://github.com/polunzh/dsh-task-notifier) | 1.1.0 (`index.json` is authoritative) |

### How to use

1. DSH → **Plugins** → **Experimental plugins** → enable **Custom plugin markets**
2. **Plugins** → **Discover** → **Add index source** → paste the URL above
3. Search or browse in Discover → install
4. Afterwards:
   - **Update**: when a new version exists the entry shows `update-available` (this index refreshes from npm every 6 hours)
   - **Uninstall**: **Plugins** → **Installed** → the plugin → uninstall

> The index only carries metadata (name, description, icon, versions, npm source). Installation is still performed by DSH's plugin manager against the real npm package; the index hosts no code or tarballs.

### How it stays current

- Sources: `plugins.json` (hand-maintained metadata) + the **npm registry** (versions, publish timestamps, `engines.dsh`)
- `scripts/build-index.mjs` writes `index.json` and **validates it with the official validator** `@deepseek-ai/dsh-plugin-market-index`; nothing is written if validation fails
- GitHub Actions runs every 6 hours and commits only when something changed; `workflow_dispatch` is available too
- Net effect: **publish a new npm version → it appears in the index within 6 hours**, no manual JSON editing

### Build and validate locally

```bash
npm install                                  # install the official validator
npm run build                                # fetch latest from npm and rewrite index.json
npm run check                                # validate the existing index.json (offline)
```

### Adding a plugin

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

3. `npm run build` → commit `plugins.json`, the icon and the regenerated `index.json`

Constraints (enforced by the official format 1 validator during the build):
`name` must be a valid npm package name; `versions` must be non-empty with exact SemVer versions and Unix-second publish timestamps;
every `category` / `labels` / `sortKeys` id must be declared in `metadata`; `title` must contain `en`; inline icons must stay under 32 KiB.
Prerelease versions are excluded by default (for example the `0.0.0-stage` placeholder left behind by npm's staged publishing flow).

### Layout

```
plugins.json                        hand-maintained plugin metadata
icons/                              icons (inlined into index.json at build time)
scripts/build-index.mjs             fetch npm + generate + validate
index.json                          generated artifact (this is what DSH reads)
.github/workflows/update-index.yml  refresh every 6 hours
```

## License

[MIT](./LICENSE). `index.json` is generated data and may be referenced freely.
