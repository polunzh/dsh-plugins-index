#!/usr/bin/env node
/**
 * 生成 dsh.127.dev 的落地页（dist/index.html）。
 *
 * 数据来源：
 *  - `index.json`：插件标题、简介、图标（已内联 data URL）、版本与发布时间
 *  - `site.json`：页面自身的文案与链接
 *  - `.github/workflows/update-index.yml`：索引的刷新周期（用于「刷新间隔」一栏）
 *
 * 产物是**单文件、零外部依赖**的静态页：CSS / JS / 图标全部内联，
 * 由 Cloudflare Worker 直出（见 worker/index.js）。
 *
 *   node scripts/build-page.mjs
 *   node scripts/build-page.mjs --check   # 只比对产物是否与当前数据一致
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const outputPath = join(root, "dist/index.html");

const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const readText = async (path) => readFile(join(root, path), "utf8");

/** 转义为 HTML 文本。 */
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** 转义为 HTML 属性值（换行原样保留，脚本里再还原成 <br>）。 */
const attr = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * 双语文本节点：无 JS 时显示中文，切换语言时由内联脚本改写。
 * 换行会在客户端还原为 <br>。
 */
function bilingualTag(tagName, zh, en, extraAttributes = "") {
  return `<${tagName}${extraAttributes} data-zh="${attr(zh)}" data-en="${attr(en)}">${esc(zh)}</${tagName}>`;
}

const bilingual = (zh, en, className = "") =>
  bilingualTag("span", zh, en, className ? ` class="${className}"` : "");

/** 人类可读的字节数。 */
function humanSize(bytes) {
  return bytes < 1024
    ? `${bytes} B`
    : `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

/** 从 workflow 的 cron 里读出刷新周期（小时）；读不出就不显示这一句。 */
function refreshHours(workflowText) {
  const cron = workflowText.match(/cron:\s*"([^"]+)"/)?.[1];
  const hour = cron?.split(/\s+/)[1];
  const every = hour?.match(/^\*\/(\d+)$/);
  return every ? Number(every[1]) : null;
}

/** `@polunzh/dsh-doc` → `dsh-doc`，详情页的 URL 片段。 */
const slugOf = (name) => name.split("/").pop();

/**
 * npm 周下载量。取不到（新包还没有统计、网络失败）就返回 null，页面自然不显示这一项。
 */
async function fetchWeeklyDownloads(name) {
  const url = `https://api.npmjs.org/downloads/point/last-week/${name}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.downloads === "number" ? body.downloads : null;
  } catch {
    return null;
  }
}

/**
 * 数据整形与条目渲染，构建期与浏览器共用同一份实现：
 * 构建时用 new Function 求值，运行时原样内联进页面。
 * 这样「索引里的数据」和「页面上的条目」不会因为两套模板而走样。
 */
const PAGE_RUNTIME_JS = String.raw`
var PAGE = (function () {
  var ARROW = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 9 9 3M4.5 3H9v4.5"/></svg>';
  var DOT = '<span class="dot" aria-hidden="true"></span>';

  function text(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function attrs(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  /* 双语节点：无 JS 时显示中文，切换语言时改写 */
  function bi(tag, zh, en, extra) {
    return '<' + tag + (extra || '') + ' data-zh="' + attrs(zh) + '" data-en="' + attrs(en) + '">' + text(zh) + '</' + tag + '>';
  }
  function day(seconds) {
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }

  function normalize(index) {
    var meta = index.metadata || {};
    var categories = meta.categories || {};
    var labels = meta.labels || {};
    return (index.plugins || []).map(function (plugin) {
      var versions = plugin.versions || [];
      var latest = versions.length ? versions[versions.length - 1] : null;
      var categoryId = (plugin.metadata && plugin.metadata.category) || '';
      var category = categoryId && categories[categoryId] ? categories[categoryId].title : null;
      var tags = ((plugin.metadata && plugin.metadata.labels) || []).map(function (id) {
        return labels[id] ? labels[id].title : null;
      }).filter(Boolean);
      var repo = plugin.repository && plugin.repository.url ? plugin.repository.url : (plugin.repository || null);
      return {
        name: plugin.name,
        slug: plugin.name.split('/').pop(),
        title: plugin.title || { zh: plugin.name, en: plugin.name },
        description: plugin.description || { zh: '', en: '' },
        icon: plugin.icon || '',
        latest: latest ? latest.version : null,
        publishedAt: latest ? day(latest.publishTimestamp) : null,
        enginesDsh: latest && latest.engines ? (latest.engines.dsh || null) : null,
        categoryId: categoryId,
        category: category,
        tags: tags,
        repoUrl: repo,
        versions: versions.slice().reverse().map(function (version) {
          return {
            version: version.version,
            publishedAt: day(version.publishTimestamp),
            enginesDsh: version.engines ? (version.engines.dsh || null) : null
          };
        }),
        npmUrl: 'https://www.npmjs.com/package/' + plugin.name
      };
    });
  }

  function row(plugin, i, ui) {
    var meta = ['<span>' + text(plugin.name) + '</span>'];
    if (plugin.category) meta.push(DOT, bi('span', plugin.category.zh, plugin.category.en));
    if (plugin.publishedAt) meta.push(DOT, bi('span', plugin.publishedAt + ' ' + ui.zh.updated, ui.en.updated + ' ' + plugin.publishedAt));
    if (plugin.enginesDsh) meta.push(DOT, bi('span', ui.zh.requires + ' ' + plugin.enginesDsh, ui.en.requires + ' ' + plugin.enginesDsh));
    var tags = plugin.tags.map(function (tag) { return bi('li', tag.zh, tag.en); });
    var links = [];
    if (plugin.repoUrl) {
      links.push('<a class="lnk" href="' + attrs(plugin.repoUrl) + '" target="_blank" rel="noopener">' + bi('span', ui.zh.srcLink, ui.en.srcLink) + ARROW + '</a>');
    }
    links.push('<a class="lnk" href="' + attrs(plugin.npmUrl) + '" target="_blank" rel="noopener"><span>npm</span>' + ARROW + '</a>');

    return '<article class="plugin rise" style="--d:' + (120 + i * 60) + 'ms"' +
      ' data-cat="' + attrs(plugin.categoryId) + '"' +
      ' data-plugin="' + attrs(plugin.name) + '"' +
      ' data-version="' + attrs(plugin.latest) + '">' +
        '<a class="plugin__overlay" href="#/plugin/' + attrs(plugin.slug) + '" aria-label="' + attrs(plugin.title.zh + ' / ' + plugin.title.en) + '"></a>' +
        '<img class="plugin__icon" alt="" src="' + attrs(plugin.icon) + '" />' +
        '<div>' +
          '<div class="plugin__title">' +
            '<h3>' + bi('span', plugin.title.zh, plugin.title.en) + '</h3>' +
            (plugin.latest ? '<span class="ver">v' + text(plugin.latest) + '</span>' : '') +
          '</div>' +
          '<div class="plugin__id">' + meta.join('') + '</div>' +
          '<p class="plugin__desc">' + bi('span', plugin.description.zh, plugin.description.en) + '</p>' +
          (tags.length ? '<ul class="tags">' + tags.join('') + '</ul>' : '') +
        '</div>' +
        '<div class="plugin__acts">' + links.join('') + '</div>' +
      '</article>';
  }

  /* 1234 → 1.2k */
  function formatCount(value) {
    if (value == null) return null;
    if (value < 1000) return String(value);
    var k = value / 1000;
    return (k >= 100 ? String(Math.round(k)) : String(Math.round(k * 10) / 10)) + 'k';
  }

  function copyButton(value, labelZh, labelEn) {
    return '<button type="button" class="copy copy--sm" data-copy="' + attrs(value) + '"' +
      ' data-zh="' + attrs(labelZh) + '" data-en="' + attrs(labelEn) + '">' + text(labelZh) + '</button>';
  }

  function cmd(value, labelZh, labelEn) {
    return '<div class="cmd"><code>' + text(value) + '</code>' + copyButton(value, labelZh, labelEn) + '</div>';
  }

  /* 详情页整页内容。detail 来自 plugins.json，缺失时优雅降级 */
  function detailHtml(plugin, detail, copy, indexUrl) {
    var d = detail || {};
    var features = d.features || {};
    var shots = (d.screenshots || []).map(function (shot, i) {
      var narrow = shot.h > shot.w ? ' shot--narrow' : '';
      return '<figure class="shot' + narrow + '">' +
        '<a href="/' + attrs(shot.src) + '" target="_blank" rel="noopener">' +
          '<img src="/' + attrs(shot.src) + '" width="' + attrs(shot.w) + '" height="' + attrs(shot.h) + '"' +
            ' loading="' + (i === 0 ? 'eager' : 'lazy') + '" decoding="async" alt="' + attrs(shot.zh) + '" />' +
        '</a>' +
        '<figcaption>' + bi('span', shot.zh, shot.en) + '</figcaption>' +
      '</figure>';
    }).join('');

    var bullets = [];
    var zhFeatures = features.zh || [];
    var enFeatures = features.en || [];
    for (var i = 0; i < zhFeatures.length; i++) {
      bullets.push('<li>' + bi('span', zhFeatures[i], enFeatures[i] || zhFeatures[i]) + '</li>');
    }

    var versions = plugin.versions || [];
    var versionRows = versions.map(function (version, index) {
      return '<tr>' +
        '<td class="mono">v' + text(version.version) + (index === 0 ? ' <span class="ver">' + bi('span', copy.latestChip.zh, copy.latestChip.en) + '</span>' : '') + '</td>' +
        '<td class="mono">' + text(version.publishedAt) + '</td>' +
        '<td class="mono">' + text(version.enginesDsh || '—') + '</td>' +
      '</tr>';
    }).join('');

    var downloads = typeof d.downloads === 'number' ? formatCount(d.downloads) : (d.downloads || null);
    var metrics = [
      downloads
        ? '<div class="metric"><dt>' + bi('span', copy.weekly.zh, copy.weekly.en) + '</dt>' +
            '<dd data-downloads="' + attrs(plugin.name) + '">' + text(downloads) + '</dd></div>'
        : '',
      '<div class="metric"><dt>' + bi('span', copy.updated.zh, copy.updated.en) + '</dt><dd class="mono">' + text(plugin.publishedAt || '—') + '</dd></div>',
      '<div class="metric"><dt>DSH</dt><dd class="mono">' + text(plugin.enginesDsh || '—') + '</dd></div>',
      '<div class="metric"><dt>' + bi('span', copy.license.zh, copy.license.en) + '</dt><dd class="mono">' + text(d.license || '—') + '</dd></div>',
    ].filter(Boolean).join('');

    var cliProfile = 'desktop';
    var cli = 'dsh plugin --profile ' + cliProfile + ' add ' + plugin.name;

    return '' +
      '<nav class="crumb"><a href="#/">' + bi('span', copy.back.zh, copy.back.en) + '</a></nav>' +

      '<header class="dhead">' +
        '<img class="dhead__icon" src="' + attrs(plugin.icon) + '" alt="" />' +
        '<div class="dhead__body">' +
          '<div class="dhead__title"><h1>' + bi('span', plugin.title.zh, plugin.title.en) + '</h1>' +
            (plugin.latest ? '<span class="ver ver--lg">v' + text(plugin.latest) + '</span>' : '') + '</div>' +
          '<p class="dhead__id"><span>' + text(plugin.name) + '</span>' +
            (plugin.category ? DOT + bi('span', plugin.category.zh, plugin.category.en) : '') +
            (plugin.tags.length ? plugin.tags.map(function (tag) {
              return DOT + bi('span', tag.zh, tag.en);
            }).join('') : '') +
          '</p>' +
          '<p class="dhead__desc">' + bi('span', plugin.description.zh, plugin.description.en) + '</p>' +
          '<div class="dhead__acts">' +
            (plugin.repoUrl ? '<a class="lnk" href="' + attrs(plugin.repoUrl) + '" target="_blank" rel="noopener">' + bi('span', copy.source.zh, copy.source.en) + ARROW + '</a>' : '') +
            '<a class="lnk" href="' + attrs(plugin.npmUrl) + '" target="_blank" rel="noopener"><span>npm</span>' + ARROW + '</a>' +
          '</div>' +
        '</div>' +
      '</header>' +

      '<dl class="metrics">' + metrics + '</dl>' +

      (shots ? '<section class="dsec"><div class="dsec__head"><h2>' + bi('span', copy.shots.zh, copy.shots.en) + '</h2></div>' +
        '<div class="shots">' + shots + '</div></section>' : '') +

      (bullets.length ? '<section class="dsec"><div class="dsec__head"><h2>' + bi('span', copy.features.zh, copy.features.en) + '</h2></div>' +
        '<ul class="features">' + bullets.join('') + '</ul></section>' : '') +

      '<section class="dsec"><div class="dsec__head"><h2>' + bi('span', copy.install.zh, copy.install.en) + '</h2></div>' +
        '<ol class="ways">' +
          '<li>' +
            '<h3>' + bi('span', copy.wayFromIndexTitle.zh, copy.wayFromIndexTitle.en) + '</h3>' +
            '<p>' + bi('span', copy.wayFromIndexBody.zh, copy.wayFromIndexBody.en) + '</p>' +
            cmd(indexUrl, copy.copy.zh, copy.copy.en) +
          '</li>' +
          '<li>' +
            '<h3>' + bi('span', copy.wayByNameTitle.zh, copy.wayByNameTitle.en) + '</h3>' +
            '<p>' + bi('span', copy.wayByNameBody.zh, copy.wayByNameBody.en) + '</p>' +
            cmd(plugin.name, copy.copy.zh, copy.copy.en) +
          '</li>' +
          '<li>' +
            '<h3>' + bi('span', copy.wayCliTitle.zh, copy.wayCliTitle.en) + '</h3>' +
            '<p>' + bi('span', copy.wayCliBody.zh, copy.wayCliBody.en) + '</p>' +
            cmd(cli, copy.copy.zh, copy.copy.en) +
          '</li>' +
        '</ol>' +
        '<p class="dnote">' + bi('span', copy.afterInstall.zh, copy.afterInstall.en) + '</p>' +
      '</section>' +

      (versionRows ? '<section class="dsec"><div class="dsec__head"><h2>' + bi('span', copy.versions.zh, copy.versions.en) + '</h2></div>' +
        '<div class="tablewrap"><table class="versions"><thead><tr>' +
          '<th>' + bi('span', copy.versionCol.zh, copy.versionCol.en) + '</th>' +
          '<th>' + bi('span', copy.dateCol.zh, copy.dateCol.en) + '</th>' +
          '<th>DSH</th>' +
        '</tr></thead><tbody>' + versionRows + '</tbody></table></div></section>' : '');
  }

  function chips(plugins, ui) {
    var seen = {};
    var order = [];
    plugins.forEach(function (plugin) {
      if (plugin.categoryId && plugin.category && !seen[plugin.categoryId]) {
        seen[plugin.categoryId] = plugin.category;
        order.push(plugin.categoryId);
      }
    });
    if (plugins.length < 2 || order.length < 2) return '';
    var out = ['<button type="button" data-cat="*" aria-pressed="true">' + bi('span', ui.zh.all, ui.en.all) + '</button>'];
    order.forEach(function (id) {
      out.push('<button type="button" data-cat="' + attrs(id) + '" aria-pressed="false">' + bi('span', seen[id].zh, seen[id].en) + '</button>');
    });
    return '<div class="chips">' + out.join('') + '</div>';
  }

  function fingerprint(plugins) {
    return plugins.map(function (plugin) {
      return [
        plugin.name, plugin.latest, plugin.publishedAt, plugin.enginesDsh, plugin.categoryId,
        plugin.title.zh, plugin.title.en, plugin.description.zh, plugin.description.en
      ].join('|');
    }).join('\n');
  }

  function hash(value) {
    var h = 5381;
    for (var i = 0; i < value.length; i++) h = ((h * 33) ^ value.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  return {
    normalize: normalize, row: row, chips: chips, detailHtml: detailHtml,
    formatCount: formatCount, fingerprint: fingerprint, hash: hash
  };
})();
`;

/** 构建期求值同一份运行时，用于生成静态 HTML。 */
const PAGE = new Function(`${PAGE_RUNTIME_JS}; return PAGE;`)();

const CSS = String.raw`
  /* ── tokens ─────────────────────────────────────────────── */
  :root, [data-theme="light"] {
    --paper:        oklch(0.972 0.008 85);
    --paper-raised: oklch(0.995 0.004 85);
    --ink:          oklch(0.235 0.012 75);
    --ink-2:        oklch(0.435 0.011 75);
    --ink-3:        oklch(0.545 0.009 75);
    --rule:         color-mix(in oklab, var(--ink) 14%, transparent);
    --rule-soft:    color-mix(in oklab, var(--ink) 8%, transparent);
    --accent:       oklch(0.53 0.115 245);
    --accent-wash:  color-mix(in oklab, var(--accent) 9%, transparent);

    --serif: "Songti SC", "Noto Serif SC", "Source Han Serif SC", "Source Han Serif CN", ui-serif, Georgia, "Times New Roman", serif;
    --sans:  "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", -apple-system, "Helvetica Neue", Arial, sans-serif;
    --mono:  ui-monospace, "SF Mono", "JetBrains Mono", "Menlo", "Consolas", monospace;

    --gutter: clamp(20px, 5vw, 72px);
    --measure: 1180px;
    --ease: cubic-bezier(0.16, 1, 0.3, 1);
  }

  [data-theme="dark"] {
    --paper:        oklch(0.185 0.006 80);
    --paper-raised: oklch(0.222 0.007 80);
    --ink:          oklch(0.94 0.006 85);
    --ink-2:        oklch(0.77 0.008 85);
    --ink-3:        oklch(0.625 0.008 85);
    --rule:         color-mix(in oklab, var(--ink) 17%, transparent);
    --rule-soft:    color-mix(in oklab, var(--ink) 9%, transparent);
    --accent:       oklch(0.76 0.104 240);
    --accent-wash:  color-mix(in oklab, var(--accent) 14%, transparent);
  }

  /* ── base ───────────────────────────────────────────────── */
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    transition: background-color .5s var(--ease), color .5s var(--ease);
  }
  ::selection { background: var(--accent-wash); color: var(--ink); }
  a { color: inherit; text-decoration: none; }
  button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

  .grain {
    position: fixed; inset: 0; z-index: 40; pointer-events: none;
    opacity: .045; mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");
  }
  [data-theme="dark"] .grain { mix-blend-mode: screen; opacity: .035; }

  .wrap { max-width: var(--measure); margin: 0 auto; padding: 0 var(--gutter); }

  /* ── micro type ─────────────────────────────────────────── */
  .cap {
    font-size: 10.5px; font-weight: 550; letter-spacing: .2em;
    text-transform: uppercase; color: var(--ink-3);
    font-family: var(--sans);
  }
  .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }

  /* ── top bar ────────────────────────────────────────────── */
  .top {
    position: sticky; top: 0; z-index: 30;
    backdrop-filter: saturate(140%) blur(14px);
    background: color-mix(in oklab, var(--paper) 78%, transparent);
    border-bottom: 1px solid var(--rule);
  }
  .top__in {
    max-width: var(--measure); margin: 0 auto; padding: 0 var(--gutter);
    height: 60px; display: flex; align-items: center; justify-content: space-between; gap: 24px;
  }
  .brand { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
  .brand__mark { font-family: var(--serif); font-size: 17px; letter-spacing: .02em; }
  .brand__sub { font-size: 12px; color: var(--ink-3); white-space: nowrap; }
  .brand__rule { width: 22px; height: 1px; background: var(--rule); align-self: center; }

  .top__nav { display: flex; align-items: center; gap: clamp(14px, 2.4vw, 30px); }
  .top__nav a {
    font-size: 13px; color: var(--ink-2); position: relative; padding: 4px 0;
    transition: color .25s var(--ease);
  }
  .top__nav a::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1px;
    background: currentColor; transform: scaleX(0); transform-origin: left;
    transition: transform .4s var(--ease);
  }
  .top__nav a:hover { color: var(--ink); }
  .top__nav a:hover::after { transform: scaleX(1); }
  .top__nav .hide-sm { display: inline; }

  .ctrl { display: flex; align-items: center; gap: 2px; padding-left: 6px; }

  .pill {
    display: inline-flex; align-items: center; justify-content: center;
    height: 28px; min-width: 34px; padding: 0 9px;
    border: 1px solid var(--rule); border-radius: 2px;
    font-size: 11px; letter-spacing: .1em; color: var(--ink-2);
    background: transparent;
    transition: border-color .25s var(--ease), color .25s var(--ease), background-color .25s var(--ease);
  }
  .pill:hover { color: var(--ink); border-color: color-mix(in oklab, var(--ink) 34%, transparent); }
  .pill--icon { min-width: 30px; padding: 0; }
  .pill svg { width: 14px; height: 14px; display: block; }
  .pill .i-moon { display: none; }
  [data-theme="dark"] .pill .i-sun { display: none; }
  [data-theme="dark"] .pill .i-moon { display: block; }

  /* ── hero ───────────────────────────────────────────────── */
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1.62fr) minmax(0, 1fr);
    gap: clamp(30px, 5vw, 76px);
    align-items: end;
    padding: clamp(56px, 9vw, 108px) 0 clamp(44px, 6vw, 76px);
  }
  .hero__lead > * { max-width: 34ch; }
  .hero__lead .lede { max-width: 60ch; }
  .eyebrow {
    display: flex; align-items: center; gap: 10px; margin: 0 0 clamp(20px, 3vw, 32px);
    max-width: none;
  }
  .eyebrow::before {
    content: ""; width: 26px; height: 1px; background: var(--accent);
    flex: none;
  }
  h1 {
    font-family: var(--serif);
    font-weight: 500;
    font-size: clamp(2.35rem, 5.1vw, 4.15rem);
    line-height: 1.14;
    letter-spacing: -0.005em;
    margin: 0;
    white-space: pre-line;
    text-wrap: balance;
  }
  .lede {
    margin: clamp(18px, 2.6vw, 26px) 0 0;
    color: var(--ink-2); font-size: clamp(14px, 1.15vw, 15.5px);
    line-height: 1.75; max-width: 46ch;
  }

  /* 索引地址：像一张打孔标签 */
  .src {
    position: relative; margin-top: clamp(30px, 4.4vw, 46px);
    max-width: 560px;
    border: 1px solid var(--rule);
    border-left: 2px solid var(--accent);
    background: var(--paper-raised);
    padding: 15px 16px 13px 18px;
  }
  .src::before, .src::after {
    content: ""; position: absolute; width: 9px; height: 9px; pointer-events: none;
    border-color: color-mix(in oklab, var(--ink) 26%, transparent);
    border-style: solid;
  }
  .src::before { top: -1px; right: -1px; border-width: 1px 1px 0 0; }
  .src::after { bottom: -1px; right: -1px; border-width: 0 1px 1px 0; }
  .src__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
  .src__row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .src__url {
    font-family: var(--mono); font-size: clamp(12.5px, 1.25vw, 14px);
    letter-spacing: -0.01em; color: var(--ink); word-break: break-all;
  }
  .copy {
    margin-left: auto; flex: none;
    height: 30px; padding: 0 13px; border-radius: 2px;
    background: var(--ink); color: var(--paper);
    font-size: 11.5px; letter-spacing: .12em;
    transition: transform .35s var(--ease), background-color .25s var(--ease);
  }
  .copy:hover { transform: translateY(-1px); }
  .copy:active { transform: translateY(0) scale(.985); }
  .copy[data-done="true"] { background: var(--accent); }
  .src__alt {
    margin-top: 11px; padding-top: 10px; border-top: 1px dashed var(--rule-soft);
    font-size: 11.5px; color: var(--ink-3); display: flex; gap: 8px; flex-wrap: wrap;
    align-items: baseline;
  }
  .src__alt code { font-family: var(--mono); font-size: 11px; color: var(--ink-2); word-break: break-all; }

  /* 右侧数据牌 */
  .plate { border-top: 1px solid var(--ink); padding-top: 2px; }
  .plate__title { display: flex; justify-content: space-between; align-items: baseline; padding: 9px 0 10px; }
  .plate dl { margin: 0; }
  .plate__row {
    display: flex; align-items: baseline; justify-content: space-between; gap: 18px;
    padding: 10px 0; border-top: 1px solid var(--rule-soft);
  }
  .plate__row:first-of-type { border-top: 0; }
  .plate__row dt {
    font-size: 11px; letter-spacing: .16em; color: var(--ink-3); margin: 0;
    text-transform: uppercase; flex: none;
  }
  .plate__row dd {
    margin: 0; font-family: var(--mono); font-size: 12.5px; color: var(--ink);
    text-align: right; font-variant-numeric: tabular-nums;
  }
  .plate__foot { margin: 16px 0 0; font-size: 11.5px; color: var(--ink-3); line-height: 1.6; max-width: 34ch; }

  /* ── section scaffolding ────────────────────────────────── */
  section { scroll-margin-top: 78px; }
  .sec__head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 20px;
    padding-top: 14px; border-top: 1px solid var(--ink);
  }
  .sec__title { display: flex; align-items: baseline; gap: 14px; margin: 0; }
  .sec__num {
    font-family: var(--mono); font-size: 11px; color: var(--accent); letter-spacing: .08em;
  }
  .sec__name { font-family: var(--serif); font-size: clamp(19px, 2vw, 23px); font-weight: 500; letter-spacing: .01em; }
  .sec__note { font-size: 11.5px; color: var(--ink-3); text-align: right; }

  /* 分类筛选 */
  .chips { display: flex; gap: 8px; flex-wrap: wrap; padding: 16px 0 0; }
  .chips button {
    font-size: 11px; letter-spacing: .1em; color: var(--ink-2);
    border: 1px solid var(--rule); border-radius: 2px; padding: 4px 11px;
    transition: color .25s var(--ease), border-color .25s var(--ease), background-color .25s var(--ease);
  }
  .chips button:hover { color: var(--ink); border-color: color-mix(in oklab, var(--ink) 32%, transparent); }
  .chips button[aria-pressed="true"] {
    color: var(--accent); border-color: color-mix(in oklab, var(--accent) 45%, transparent);
    background: var(--accent-wash);
  }

  /* ── plugin row ─────────────────────────────────────────── */
  .plugins { padding-bottom: clamp(52px, 7vw, 88px); }
  .plugin {
    display: grid; grid-template-columns: 64px minmax(0, 1fr) auto;
    gap: clamp(18px, 3vw, 34px);
    padding: clamp(26px, 3.4vw, 38px) 0 clamp(30px, 3.4vw, 40px);
    border-bottom: 1px solid var(--rule);
    position: relative;
    transition: background-color .4s var(--ease);
  }
  .plugin[hidden] { display: none; }
  .plugin::after {
    content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px;
    background: var(--ink); transform: scaleX(0); transform-origin: left;
    transition: transform .55s var(--ease);
  }
  .plugin:hover::after { transform: scaleX(1); }
  .plugin__icon {
    width: 64px; height: 64px; display: block;
    transition: transform .5s var(--ease);
  }
  .plugin:hover .plugin__icon { transform: translateY(-2px) scale(1.03); }
  .plugin__title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 2px 0 6px; }
  .plugin__title h3 {
    margin: 0; font-family: var(--serif); font-size: clamp(20px, 1.9vw, 24px);
    font-weight: 500; letter-spacing: .01em;
  }
  .ver {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: .04em;
    color: var(--accent); border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
    padding: 1.5px 6px; border-radius: 2px; background: var(--accent-wash);
  }
  .plugin__id {
    font-family: var(--mono); font-size: 11.5px; color: var(--ink-3);
    display: flex; gap: 9px; align-items: center; flex-wrap: wrap;
  }
  .plugin__id .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--rule); }
  .plugin__desc {
    margin: 14px 0 0; color: var(--ink-2); font-size: 14px; line-height: 1.78; max-width: 60ch;
  }
  .tags { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 16px; padding: 0; list-style: none; }
  .tags li {
    font-size: 10.5px; letter-spacing: .09em; color: var(--ink-2);
    border: 1px solid var(--rule); padding: 2.5px 8px; border-radius: 2px;
  }
  .plugin__acts { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; padding-top: 4px; }
  .lnk {
    font-size: 12px; color: var(--ink-2); display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 0; border-bottom: 1px solid transparent;
    transition: color .25s var(--ease), border-color .25s var(--ease);
    white-space: nowrap;
  }
  .lnk:hover { color: var(--ink); border-bottom-color: currentColor; }
  .lnk svg { width: 10px; height: 10px; opacity: .6; }
  .plugin__hint { margin: 20px 0 0; font-size: 11.5px; color: var(--ink-3); }

  /* ── steps ──────────────────────────────────────────────── */
  .install { padding-bottom: clamp(56px, 8vw, 96px); }
  .steps {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
    margin: clamp(30px, 4vw, 44px) 0 0; padding: 0; list-style: none;
  }
  .steps li { padding: 0 clamp(18px, 2.6vw, 34px); border-left: 1px solid var(--rule); }
  .steps li:first-child { padding-left: 0; border-left: 0; }
  .steps li:last-child { padding-right: 0; }
  .steps__num {
    font-family: var(--serif); font-size: clamp(30px, 3.2vw, 40px); line-height: 1;
    color: var(--ink-3); opacity: .55; display: block; margin-bottom: 14px;
    font-variant-numeric: lining-nums;
  }
  .steps h3 { margin: 0 0 8px; font-size: 14.5px; font-weight: 600; letter-spacing: .01em; }
  .steps p { margin: 0; font-size: 13px; color: var(--ink-2); line-height: 1.72; }
  .install__foot {
    margin: clamp(26px, 3.4vw, 38px) 0 0; padding-top: 16px; border-top: 1px solid var(--rule-soft);
    font-size: 12px; color: var(--ink-3); display: flex; gap: 10px; align-items: baseline;
  }

  /* ── footer ─────────────────────────────────────────────── */
  .foot { border-top: 1px solid var(--rule); padding: 26px 0 44px; }
  .foot__in {
    display: flex; justify-content: space-between; align-items: flex-start; gap: 28px;
    font-size: 11.5px; color: var(--ink-3); flex-wrap: wrap;
  }
  .foot__links { display: flex; gap: 18px; }
  .foot__links a { transition: color .25s var(--ease); }
  .foot__links a:hover { color: var(--ink); }

  /* ── 详情页 ─────────────────────────────────────────────── */
  #listView[hidden], #detailView[hidden] { display: none; }

  .crumb { padding-top: 26px; }
  .crumb a { font-size: 12px; color: var(--ink-3); transition: color .25s var(--ease); }
  .crumb a:hover { color: var(--ink); }

  .dhead {
    display: grid; grid-template-columns: 72px minmax(0, 1fr);
    gap: clamp(18px, 3vw, 30px);
    padding: clamp(24px, 3.6vw, 40px) 0 clamp(24px, 3.4vw, 34px);
    border-bottom: 1px solid var(--ink);
  }
  .dhead__icon { width: 72px; height: 72px; display: block; }
  .dhead__title { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .dhead__title h1 {
    margin: 0; font-family: var(--serif); font-weight: 500;
    font-size: clamp(27px, 3.4vw, 38px); letter-spacing: .01em; line-height: 1.2;
  }
  .dhead__id {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    margin: 10px 0 0; font-family: var(--mono); font-size: 12px; color: var(--ink-3);
  }
  .dhead__desc { margin: 14px 0 0; font-size: 15px; line-height: 1.75; color: var(--ink-2); max-width: 64ch; }
  .dhead__acts { display: flex; gap: 18px; margin-top: 16px; flex-wrap: wrap; }

  .metrics {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    margin: 0; border-bottom: 1px solid var(--rule);
  }
  .metric { padding: 16px 0 18px 18px; border-left: 1px solid var(--rule-soft); }
  .metric:first-child { padding-left: 0; border-left: 0; }
  .metric dt { font-size: 10.5px; letter-spacing: .18em; text-transform: uppercase; color: var(--ink-3); }
  .metric dd { margin: 7px 0 0; font-size: 20px; font-family: var(--serif); color: var(--ink); font-variant-numeric: tabular-nums; }
  .metric dd.mono { font-family: var(--mono); font-size: 13.5px; font-style: normal; }

  .dsec { padding: clamp(28px, 3.8vw, 44px) 0; border-bottom: 1px solid var(--rule); }
  .dsec:last-child { border-bottom: 0; }
  .dsec__head h2 {
    display: flex; align-items: center; gap: 12px; margin: 0 0 clamp(16px, 2.2vw, 24px);
    font-family: var(--serif); font-size: clamp(18px, 1.8vw, 21px); font-weight: 500; letter-spacing: .02em;
  }
  .dsec__head h2::before { content: ""; width: 18px; height: 1px; background: var(--accent); flex: none; }

  .shots { display: grid; gap: clamp(18px, 2.4vw, 26px); max-width: 920px; }
  .shot { margin: 0; }
  .shot a { display: block; border: 1px solid var(--rule); background: var(--paper-raised); transition: border-color .3s var(--ease); }
  .shot a:hover { border-color: color-mix(in oklab, var(--ink) 32%, transparent); }
  .shot img { display: block; width: 100%; height: auto; }
  .shot figcaption { margin-top: 10px; font-size: 11.5px; color: var(--ink-3); }
  .shot--narrow { max-width: 300px; }

  .features { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; max-width: 72ch; }
  .features li { position: relative; padding-left: 20px; font-size: 14px; line-height: 1.78; color: var(--ink-2); }
  .features li::before { content: ""; position: absolute; left: 0; top: .74em; width: 8px; height: 1px; background: var(--accent); }

  .ways { list-style: none; counter-reset: way; margin: 0; padding: 0; display: grid; gap: clamp(20px, 2.8vw, 28px); }
  .ways li { counter-increment: way; position: relative; padding-left: 38px; display: grid; gap: 9px; }
  .ways li::before {
    content: "0" counter(way); position: absolute; left: 0; top: 1px;
    font-family: var(--mono); font-size: 11px; color: var(--accent);
  }
  .ways h3 { margin: 0; font-size: 14.5px; font-weight: 600; letter-spacing: .01em; }
  .ways p { margin: 0; font-size: 13.5px; color: var(--ink-2); line-height: 1.72; max-width: 66ch; }
  .dnote { margin: 22px 0 0; font-size: 12px; color: var(--ink-3); }

  .cmd {
    display: flex; align-items: center; gap: 10px; max-width: 640px;
    border: 1px solid var(--rule); border-left: 2px solid var(--accent);
    background: var(--paper-raised); padding: 7px 9px 7px 12px;
  }
  .cmd code { flex: 1; min-width: 0; font-family: var(--mono); font-size: 12px; color: var(--ink); overflow-x: auto; white-space: nowrap; }
  .copy--sm {
    height: 26px; padding: 0 10px; font-size: 10.5px; letter-spacing: .1em;
    background: transparent; color: var(--ink-2); border: 1px solid var(--rule); flex: none;
  }
  .copy--sm:hover { color: var(--ink); border-color: color-mix(in oklab, var(--ink) 34%, transparent); }
  .copy--sm[data-done="true"] { color: var(--accent); border-color: color-mix(in oklab, var(--accent) 45%, transparent); }
  .copy--sm[data-done="false"] { color: var(--ink-3); }

  .tablewrap { overflow-x: auto; }
  .versions { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .versions th {
    text-align: left; padding: 0 14px 10px 0;
    font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase;
    color: var(--ink-3); font-weight: 550; border-bottom: 1px solid var(--rule);
  }
  .versions td { padding: 10px 14px 10px 0; border-bottom: 1px solid var(--rule-soft); color: var(--ink-2); }
  .versions td:first-child { color: var(--ink); }
  .versions tr:last-child td { border-bottom: 0; }
  .versions .ver { margin-left: 8px; }

  .plugin { position: relative; }
  .plugin__overlay { position: absolute; inset: 0; z-index: 1; }
  .plugin__acts { position: relative; z-index: 2; }
  .plugin:hover .plugin__title h3 span,
  .plugin:focus-within .plugin__title h3 span {
    text-decoration: underline; text-underline-offset: 5px; text-decoration-thickness: 1px;
  }
  .plugin:focus-within::after { transform: scaleX(1); }

  @media (max-width: 900px) {
    .dhead { grid-template-columns: 56px minmax(0, 1fr); }
    .dhead__icon { width: 56px; height: 56px; }
    .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .metric:nth-child(3) { padding-left: 0; border-left: 0; }
    .ways li { padding-left: 32px; }
  }

  @media (max-width: 620px) {
    .dhead { grid-template-columns: 1fr; }
    .dhead__icon { width: 52px; height: 52px; }
    .dhead__title h1 { font-size: 26px; }
    .metric dd { font-size: 17px; }
    .cmd code { font-size: 11px; }
  }

  /* ── entrance ───────────────────────────────────────────── */
  .rise { opacity: 0; transform: translateY(14px); animation: rise .9s var(--ease) forwards; animation-delay: var(--d, 0ms); }
  @keyframes rise { to { opacity: 1; transform: none; } }

  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: .001ms !important; animation-delay: 0ms !important; transition-duration: .001ms !important; }
    .rise { opacity: 1; transform: none; }
    html { scroll-behavior: auto; }
  }

  /* ── responsive ─────────────────────────────────────────── */
  @media (max-width: 900px) {
    .hero { grid-template-columns: 1fr; gap: 36px; align-items: start; }
    .hero__lead > * { max-width: 40ch; }
    .hero__lead .eyebrow { max-width: none; }
    .plugin { grid-template-columns: 56px minmax(0, 1fr); }
    .plugin__icon { width: 56px; height: 56px; }
    .plugin__acts { grid-column: 2; flex-direction: row; align-items: center; gap: 18px; padding-top: 2px; }
    .steps { grid-template-columns: 1fr; }
    .steps li { padding: 22px 0; border-left: 0; border-top: 1px solid var(--rule-soft); }
    .steps li:first-child { border-top: 0; padding-top: 0; }
    .steps__num { font-size: 22px; margin-bottom: 8px; }
  }
  @media (max-width: 620px) {
    .top__nav .hide-sm { display: none; }
    .brand__sub, .brand__rule { display: none; }
    .hero { padding-top: 46px; }
    h1 { font-size: clamp(2rem, 8.6vw, 2.6rem); }
    .src { padding: 13px 13px 12px 14px; }
    .src__row { gap: 10px; }
    .copy { margin-left: 0; }
    .sec__note { display: none; }
    .plugin__desc { font-size: 13.5px; }
    .foot__in { flex-direction: column; gap: 14px; }
  }
`;

/** 页面运行时脚本（内联）。PAGE / PAGE_UI / PAGE_DETAILS 由同一 <script> 先声明。 */
const CLIENT_JS = String.raw`
  (function () {
    var root = document.documentElement;
    var UI = PAGE_UI;
    var DETAIL = PAGE_DETAIL_COPY;
    var DETAILS = PAGE_DETAILS || {};
    var store = {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    };

    var plugins = [];
    var indexUrl = PAGE_INDEX_URL;

    /* ── 主题 ── */
    var themeBtn = document.getElementById('themeBtn');
    themeBtn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store.set('theme', next);
    });

    /* ── 语言 ── */
    var langBtn = document.getElementById('langBtn');
    var query = new URLSearchParams(location.search).get('lang');
    var lang = query === 'zh' || query === 'en'
      ? query
      : store.get('lang') || (navigator.language.indexOf('zh') === 0 ? 'zh' : 'en');
    var DONE_LABEL = { zh: '已复制 ✓', en: 'Copied ✓' };
    var FAIL_LABEL = { zh: '复制失败', en: 'Copy failed' };

    function paint(el, key) {
      var raw = el.getAttribute(key === 'zh' ? 'data-zh' : 'data-en');
      if (raw === null) return;
      el.innerHTML = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    }
    function paintAll() {
      var nodes = document.querySelectorAll('[data-zh]');
      for (var i = 0; i < nodes.length; i++) paint(nodes[i], lang);
    }
    function currentSlug() {
      var m = (location.hash || '').match(/^#\/plugin\/([^/?]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    }
    function updateTitle() {
      var slug = currentSlug();
      var plugin = slug ? findPlugin(slug) : null;
      if (plugin) {
        document.title = plugin.title[lang] + ' · ' + (lang === 'zh' ? 'DSH 插件' : 'DSH plugin');
      } else {
        document.title = root.getAttribute('data-title-' + lang) || document.title;
      }
    }
    function applyLang(next) {
      lang = next;
      root.lang = lang === 'zh' ? 'zh-CN' : 'en';
      paintAll();
      langBtn.textContent = lang === 'zh' ? 'EN' : '中';
      updateTitle();
      store.set('lang', lang);
    }
    langBtn.addEventListener('click', function () { applyLang(lang === 'zh' ? 'en' : 'zh'); });

    /* ── 复制（列表页的索引地址、详情页的命令） ── */
    function legacyCopy(value) {
      var area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(area);
      return ok;
    }
    function flash(btn, key) {
      btn.setAttribute('data-done', key === 'done' ? 'true' : 'false');
      btn.textContent = key === 'done' ? DONE_LABEL[lang] : FAIL_LABEL[lang];
      clearTimeout(btn._timer);
      btn._timer = setTimeout(function () {
        btn.removeAttribute('data-done');
        paint(btn, lang);
      }, 1500);
    }
    document.addEventListener('click', function (event) {
      var btn = event.target.closest ? event.target.closest('[data-copy]') : null;
      if (!btn) return;
      var value = btn.getAttribute('data-copy');
      flash(btn, 'done');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).catch(function () {
          if (!legacyCopy(value)) flash(btn, 'failed');
        });
      } else if (!legacyCopy(value)) {
        flash(btn, 'failed');
      }
    });

    /* ── 分类筛选 ── */
    function bindChips() {
      var chips = document.querySelectorAll('#chipSlot button');
      for (var c = 0; c < chips.length; c++) {
        chips[c].addEventListener('click', function (event) {
          var chip = event.currentTarget;
          var wanted = chip.getAttribute('data-cat');
          var all = document.querySelectorAll('#chipSlot button');
          for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', String(all[i] === chip));
          var rows = document.querySelectorAll('.plugin');
          for (var j = 0; j < rows.length; j++) {
            var match = wanted === '*' || rows[j].getAttribute('data-cat') === wanted;
            if (match) rows[j].removeAttribute('hidden');
            else rows[j].setAttribute('hidden', '');
          }
        });
      }
    }

    /* ── 列表 ── */
    function renderList(list) {
      var host = document.getElementById('pluginList');
      if (host) host.innerHTML = list.map(function (plugin, i) { return PAGE.row(plugin, i, UI); }).join('\n');
      var slot = document.getElementById('chipSlot');
      if (slot) slot.innerHTML = PAGE.chips(list, UI);
      var count = document.getElementById('pluginCount');
      if (count) count.textContent = String(list.length);
      var last = document.getElementById('lastPublish');
      if (last) {
        var dates = list.map(function (plugin) { return plugin.publishedAt; }).filter(Boolean).sort();
        if (dates.length) last.textContent = dates[dates.length - 1];
      }
      bindChips();
      paintAll();
    }

    /* ── 详情 ── */
    function findPlugin(slug) {
      for (var i = 0; i < plugins.length; i++) if (plugins[i].slug === slug) return plugins[i];
      return null;
    }
    function loadDownloads(pkg) {
      if (!window.fetch || location.protocol === 'file:') return;
      fetch('api/downloads?pkg=' + encodeURIComponent(pkg))
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (!data || typeof data.downloads !== 'number') return;
          var node = document.querySelector('[data-downloads="' + pkg + '"]');
          if (!node) return;
          var formatted = PAGE.formatCount(data.downloads);
          if (formatted) node.textContent = formatted;
        })
        .catch(function () {});
    }
    function showDetail(slug) {
      var plugin = findPlugin(slug);
      var host = document.getElementById('detailView');
      var list = document.getElementById('listView');
      if (!plugin || !host) { location.replace('#/'); return; }
      host.innerHTML = PAGE.detailHtml(plugin, DETAILS[slug] || {}, DETAIL, indexUrl);
      host.hidden = false;
      if (list) list.hidden = true;
      paintAll();
      updateTitle();
      window.scrollTo(0, 0);
      loadDownloads(plugin.name);
    }
    function showList() {
      var host = document.getElementById('detailView');
      var list = document.getElementById('listView');
      if (host) { host.hidden = true; host.innerHTML = ''; }
      if (list) list.hidden = false;
      updateTitle();
    }
    function route() {
      var slug = currentSlug();
      if (slug) {
        showDetail(slug);
        return;
      }
      showList();
      var hash = location.hash || '';
      if (hash && hash.indexOf('#/') !== 0) {
        var target = document.getElementById(hash.slice(1));
        if (target) target.scrollIntoView();
      } else {
        window.scrollTo(0, 0);
      }
    }
    window.addEventListener('hashchange', route);

    /* ── 启动：先用构建期的数据，再与 /index.json 对齐 ── */
    plugins = (window.PAGE_PLUGINS || []).slice();
    window.addEventListener('hashchange', route);
    route();
    applyLang(lang);

    function syncIndex() {
      var main = document.querySelector('main');
      var built = main ? main.getAttribute('data-fp') : null;
      if (!built || !window.fetch || location.protocol === 'file:') return;
      fetch('index.json', { credentials: 'omit' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (!data || !data.plugins) return;
          var list = PAGE.normalize(data);
          if (PAGE.hash(PAGE.fingerprint(list)) === built) return;
          plugins = list;
          renderList(list);
          route();
        })
        .catch(function () {});
    }
    syncIndex();
  })();
`;

/** 页面里固定不变的 UI 文案。 */
const UI = {
  zh: {
    navPlugins: "插件",
    navInstall: "安装",
    sourceCap: "索引地址",
    copy: "复制",
    fallback: "备用地址",
    glance: "索引里有什么",
    pluginsTitle: "收录的插件",
    pluginsRow: "插件",
    lastPublish: "最近更新",
    categoryRow: "分类",
    enginesRow: "DSH 版本",
    sourceRow: "来源",
    pluginsNote: "共 {n} 个",
    all: "全部",
    updated: "更新",
    requires: "需要 DSH",
    srcLink: "源码",
    installTitle: "装进 DSH",
    thenText: "索引只存名称、简介、图标和版本号，装的是 npm 上的真实包。",
    footNote: "由 polunzh 维护 · MIT 协议",
    community: "社区市场",
  },
  en: {
    navPlugins: "Plugins",
    navInstall: "Install",
    sourceCap: "Index URL",
    copy: "Copy",
    fallback: "Backup",
    glance: "In this index",
    pluginsTitle: "Plugins",
    pluginsRow: "Plugins",
    lastPublish: "Updated",
    categoryRow: "Categories",
    enginesRow: "DSH version",
    sourceRow: "Source",
    pluginsNote: "{n} total",
    all: "All",
    updated: "updated",
    requires: "needs DSH",
    srcLink: "Source",
    installTitle: "Add to DSH",
    thenText: "The index holds names, descriptions, icons and versions; installs come from the real npm package.",
    footNote: "Maintained by polunzh · MIT",
    community: "Community market",
  },
};

/** 安装步骤（描述的是 DSH 界面，与具体插件无关）。 */
const STEPS = [
  {
    zh: { title: "启用自定义索引", body: "DSH →「插件」→「实验性插件」，打开「自定义插件索引」。" },
    en: { title: "Turn on custom indexes", body: "In DSH, open Plugins → Experimental plugins and enable Custom plugin indexes." },
  },
  {
    zh: { title: "添加索引地址", body: "进「发现」→「添加索引源」，粘贴地址，收录的插件会直接列出来。" },
    en: { title: "Add the index", body: "In Discover, choose Add index source, paste the address, and the plugins show up." },
  },
  {
    zh: { title: "安装插件", body: "点「安装」。装好后可在「已安装」里启用、停用或卸载。" },
    en: { title: "Install", body: "Choose Install. Enable, disable or remove it later under Installed." },
  },
];

/** 详情页的固定文案。 */
const DETAIL_COPY = {
  back: { zh: "← 所有插件", en: "← All plugins" },
  shots: { zh: "界面", en: "Screens" },
  features: { zh: "能做什么", en: "What it does" },
  install: { zh: "安装", en: "Install" },
  versions: { zh: "版本记录", en: "Versions" },
  weekly: { zh: "周下载", en: "downloads / week" },
  updated: { zh: "最近更新", en: "updated" },
  license: { zh: "许可", en: "license" },
  source: { zh: "源码", en: "Source" },
  copy: { zh: "复制", en: "Copy" },
  latestChip: { zh: "最新", en: "latest" },
  versionCol: { zh: "版本", en: "Version" },
  dateCol: { zh: "日期", en: "Date" },
  wayFromIndexTitle: { zh: "从索引安装", en: "Install from the index" },
  wayFromIndexBody: {
    zh: "在「插件 → 发现」里搜插件名，点「安装」。还没加过索引的话，先把下面的地址加进「添加索引源」。",
    en: "Search for the plugin in Plugins → Discover and choose Install. If the index is not added yet, add the address below in Add index source.",
  },
  wayByNameTitle: { zh: "按包名安装", en: "Install by package name" },
  wayByNameBody: {
    zh: "在「插件」页点「添加插件」，填入下面的包名，再选「立即启用」。",
    en: "Open Plugins, choose Add plugin, paste the package name below and pick Enable now.",
  },
  wayCliTitle: { zh: "命令行安装", en: "Install from the command line" },
  wayCliBody: {
    zh: "装了 dsh 命令行的话，可以直接把包装进 profile。示例用 desktop，换成你实际在用的即可。",
    en: "With the dsh CLI installed, add the package to a profile directly. The example uses desktop; swap in the profile you run.",
  },
  afterInstall: {
    zh: "有新版本时，「发现」里的卡片会提示更新；卸载在「已安装」里完成。",
    en: "Cards in Discover flag new versions; uninstall from Installed.",
  },
};

/** 拼出整页。 */
function renderPage({ index, site, plugins, hours, details }) {
  const title = index.title;
  const description = index.description;
  const hero = site.hero;
  const lastPublish = plugins.map((p) => p.publishedAt).filter(Boolean).sort().at(-1);
  const categories = [];
  for (const plugin of plugins) {
    if (plugin.category && !categories.some((c) => c.zh === plugin.category.zh)) categories.push(plugin.category);
  }
  const categoryText = categories.map((c) => c.zh).join("、");
  const categoryTextEn = categories.map((c) => c.en).join(", ");

  const rows = [
    `<div class="plate__row"><dt>${bilingual(UI.zh.pluginsRow, UI.en.pluginsRow)}</dt><dd id="pluginCount">${plugins.length}</dd></div>`,
    lastPublish
      ? `<div class="plate__row"><dt>${bilingual(UI.zh.lastPublish, UI.en.lastPublish)}</dt><dd id="lastPublish">${esc(lastPublish)}</dd></div>`
      : "",
    categories.length
      ? `<div class="plate__row"><dt>${bilingual(UI.zh.categoryRow, UI.en.categoryRow)}</dt><dd>${bilingual(categoryText, categoryTextEn)}</dd></div>`
      : "",
    `<div class="plate__row"><dt>${bilingual(UI.zh.sourceRow, UI.en.sourceRow)}</dt><dd>npm</dd></div>`,
  ].filter(Boolean);

  const steps = STEPS.map(
    (step, i) => `
      <li>
        <span class="steps__num">0${i + 1}</span>
        <h3>${bilingual(step.zh.title, step.en.title)}</h3>
        <p>${bilingual(step.zh.body, step.en.body)}</p>
      </li>`
  ).join("");

  return `<!doctype html>
<html lang="zh-CN" data-theme="light"
      data-title-zh="${attr(`${title.zh} · DSH 插件索引`)}"
      data-title-en="${attr(`${title.en} · DSH plugin index`)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title.zh)} · DSH 插件索引</title>
<meta name="description" content="${attr(description.zh)}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${attr(title.zh)}" />
<meta property="og:description" content="${attr(description.zh)}" />
<meta name="theme-color" content="#f7f5f0" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#1c1c1b" media="(prefers-color-scheme: dark)" />
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/assets/favicon.ico" sizes="any" />
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
<script>
  (function () {
    var theme;
    try {
      var fromQuery = new URLSearchParams(location.search).get('theme');
      theme = fromQuery === 'light' || fromQuery === 'dark' ? fromQuery : localStorage.getItem('theme');
    } catch (e) {}
    if (theme !== 'light' && theme !== 'dark') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  })();
</script>
<style>${CSS}</style>
</head>
<body>
<div class="grain" aria-hidden="true"></div>

<header class="top">
  <div class="top__in">
    <div class="brand">
      <span class="brand__mark">${esc(site.author)}</span>
      <span class="brand__rule" aria-hidden="true"></span>
      <span class="brand__sub">DSH Plugin Index</span>
    </div>
    <nav class="top__nav">
      <a href="#plugins" class="hide-sm">${bilingual(UI.zh.navPlugins, UI.en.navPlugins)}</a>
      <a href="#install" class="hide-sm">${bilingual(UI.zh.navInstall, UI.en.navInstall)}</a>
      <a href="${attr(site.repository)}" target="_blank" rel="noopener">GitHub&nbsp;↗</a>
      <div class="ctrl">
        <button class="pill" id="langBtn" aria-label="Switch language">EN</button>
        <button class="pill pill--icon" id="themeBtn" aria-label="Toggle theme">
          <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/>
          </svg>
          <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20.5 14.5A8.6 8.6 0 1 1 9.6 3.6a6.9 6.9 0 0 0 10.9 10.9Z"/>
          </svg>
        </button>
      </div>
    </nav>
  </div>
</header>

<main class="wrap" data-fp="${PAGE.hash(PAGE.fingerprint(plugins))}">

  <div id="listView">
  <section class="hero">
    <div class="hero__lead">
      <p class="cap eyebrow rise" style="--d:40ms">${bilingual(hero.eyebrow.zh, hero.eyebrow.en)}</p>
      <h1 class="rise" style="--d:110ms">${bilingual(hero.headline.zh, hero.headline.en)}</h1>
      <p class="lede rise" style="--d:190ms">${bilingual(hero.lede.zh, hero.lede.en)}</p>

      <div class="src rise" style="--d:270ms">
        <div class="src__head">
          <span class="cap">${bilingual(UI.zh.sourceCap, UI.en.sourceCap)}</span>
        </div>
        <div class="src__row">
          <span class="src__url" id="indexUrl">${esc(site.indexUrl)}</span>
          <button class="copy" id="copyBtn" type="button" data-zh="${attr(UI.zh.copy)}" data-en="${attr(UI.en.copy)}">${esc(UI.zh.copy)}</button>
        </div>
        <div class="src__alt">
          <span>${bilingual(UI.zh.fallback, UI.en.fallback)}</span>
          <code>${esc(site.fallbackUrl)}</code>
        </div>
      </div>
    </div>

    <aside class="plate rise" style="--d:340ms">
      <div class="plate__title">
        <span class="cap">${bilingual(UI.zh.glance, UI.en.glance)}</span>
      </div>
      <dl>
        ${rows.join("\n        ")}
      </dl>
      ${hours ? `<p class="plate__foot">${bilingual(`新版本发布后，最迟 ${hours} 小时更新。`, `New releases appear here within ${hours} hours.`)}</p>` : ""}
    </aside>
  </section>

  <section class="plugins" id="plugins">
    <div class="sec__head">
      <h2 class="sec__title">
        <span class="sec__num">01</span>
        <span class="sec__name">${bilingual(UI.zh.pluginsTitle, UI.en.pluginsTitle)}</span>
      </h2>
    </div>
    <div id="chipSlot">${PAGE.chips(plugins, UI)}</div>
    <div id="pluginList">
${plugins.map((plugin, i) => PAGE.row(plugin, i, UI)).join("\n")}
    </div>
  </section>

  <section class="install" id="install">
    <div class="sec__head">
      <h2 class="sec__title">
        <span class="sec__num">02</span>
        <span class="sec__name">${bilingual(UI.zh.installTitle, UI.en.installTitle)}</span>
      </h2>
    </div>

    <ol class="steps">${steps}
    </ol>

    <p class="install__foot">${bilingual(UI.zh.thenText, UI.en.thenText)}</p>
  </section>
  </div>

  <div id="detailView" hidden></div>

</main>

<footer class="foot">
  <div class="wrap">
    <div class="foot__in">
      <span>${bilingual(UI.zh.footNote, UI.en.footNote)}</span>
      <div class="foot__links">
        <a href="${attr(site.repository)}" target="_blank" rel="noopener">GitHub</a>
        <a href="${attr(site.npmAuthor)}" target="_blank" rel="noopener">npm</a>
        <a href="${attr(site.communityUrl)}" target="_blank" rel="noopener">${bilingual(UI.zh.community, UI.en.community)}</a>
      </div>
    </div>
  </div>
</footer>

<script>${PAGE_RUNTIME_JS}
var PAGE_UI = ${JSON.stringify(UI)};
var PAGE_PLUGINS = ${JSON.stringify(plugins)};
var PAGE_DETAILS = ${JSON.stringify(details)};
var PAGE_DETAIL_COPY = ${JSON.stringify(DETAIL_COPY)};
var PAGE_INDEX_URL = ${JSON.stringify(site.indexUrl)};
${CLIENT_JS}</script>
</body>
</html>
`;
}

/* ── 主流程 ─────────────────────────────────────────────────── */
const [indexText, site, config] = await Promise.all([
  readText("index.json"),
  readJson("site.json"),
  readJson("plugins.json"),
]);
const index = JSON.parse(indexText);
const workflowPath = ".github/workflows/update-index.yml";
const hours = await readText(workflowPath).then(refreshHours).catch(() => null);
const plugins = PAGE.normalize(index);

/** 从已有产物里读回详情数据（含下载量），--check 时不联网也能比对。 */
function readPreviousDetails(html) {
  if (!html) return null;
  const marker = "var PAGE_DETAILS = ";
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const from = at + marker.length;
  const to = html.indexOf(";\nvar PAGE_DETAIL_COPY", from);
  if (to < 0) return null;
  try {
    return JSON.parse(html.slice(from, to));
  } catch {
    return null;
  }
}

const previousHtml = checkOnly ? await readText("dist/index.html").catch(() => null) : null;
const previousDetails = checkOnly ? readPreviousDetails(previousHtml) : null;

/** 详情页数据：来自 plugins.json 的展示信息 + npm 周下载量。 */
const details = {};
for (const plugin of plugins) {
  const entry = config.plugins.find((item) => item.name === plugin.name);
  const detail = entry?.detail ?? {};
  const downloads = checkOnly
    ? (previousDetails?.[plugin.slug]?.downloads ?? null)
    : await fetchWeeklyDownloads(plugin.name);
  details[plugin.slug] = {
    license: detail.license ?? null,
    features: detail.features ?? null,
    screenshots: detail.screenshots ?? [],
    downloads,
  };
  console.log(
    `  ${plugin.slug}  shots=${details[plugin.slug].screenshots.length}  downloads/wk=${downloads ?? "—"}`,
  );
}

const html = renderPage({
  index,
  site,
  plugins,
  hours,
  details,
});

if (checkOnly) {
  const current = await readText("dist/index.html").catch(() => null);
  if (current !== html) {
    console.error("✗ dist/index.html 与当前数据不一致，请运行 npm run build");
    process.exit(1);
  }
  console.log(`✓ dist/index.html 与数据一致（${plugins.length} 个插件）`);
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  console.log(`✓ 已写出 dist/index.html（${humanSize(Buffer.byteLength(html))}，${plugins.length} 个插件）`);
}
