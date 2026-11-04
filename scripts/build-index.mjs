#!/usr/bin/env node
/**
 * 生成 DSH 插件市场索引（format 1）。
 *
 * 数据来源：
 *  - `plugins.json`：人工维护的插件元数据（标题、简介、分类、关键词、图标路径）
 *  - npm registry：真实版本号、发布时间戳、engines.dsh
 *
 * 输出：`index.json`，用官方校验器 `@deepseek-ai/dsh-plugin-market-index` 校验后才写出。
 *
 *   node scripts/build-index.mjs
 *   node scripts/build-index.mjs --check   # 只校验现有 index.json，不访问网络
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

/** 读取并解析 JSON 文件。 */
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** 把本地 SVG 图标转成索引允许的内联 data URL（≤32 KiB）。 */
async function inlineIcon(relativePath) {
  const path = join(root, relativePath);
  if (!existsSync(path)) throw new Error(`图标不存在：${relativePath}`);
  const bytes = await readFile(path);
  if (bytes.byteLength > 32 * 1024) throw new Error(`图标超过 32 KiB：${relativePath}`);
  return `data:image/svg+xml;base64,${bytes.toString("base64")}`;
}

/** 带超时与重试的 npm registry 请求。 */
async function fetchPackument(registry, name, attempts = 4) {
  const url = `${registry}${encodeURIComponent(name)}`;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404) throw new Error(`${name} 在 npm 上不存在`);
      if (!response.ok) throw new Error(`registry 返回 ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((done) => setTimeout(done, 800 * attempt));
    }
  }
  throw new Error(`拉取 ${name} 失败：${lastError?.message ?? lastError}`);
}

/** 从 packument 里整理出索引需要的版本列表（按发布顺序）。 */
function buildVersions(packument, registry) {
  const times = packument.time ?? {};
  // registry 的 time 是 ISO 字符串；统一转成毫秒。
  const publishedAt = (version) => {
    const stamp = times[version];
    const ms = typeof stamp === "number" ? stamp : Date.parse(stamp ?? "");
    return Number.isFinite(ms) ? ms : null;
  };
  const includePrerelease = packument.__includePrerelease === true;
  const versions = Object.keys(packument.versions ?? {})
    .filter((version) => publishedAt(version) !== null)
    // 默认只收录正式版本；`0.0.0-stage` 之类是发布流程的暂存版本，不该出现在市场里
    .filter((version) => includePrerelease || !version.includes("-"))
    .sort((left, right) => publishedAt(left) - publishedAt(right))
    .map((version) => {
      const manifest = packument.versions[version];
      const dsh = manifest?.engines?.dsh;
      return {
        version,
        publishTimestamp: Math.floor(publishedAt(version) / 1000),
        source: { type: "npm", registry },
        ...(typeof dsh === "string" ? { engines: { dsh } } : {}),
      };
    });
  if (versions.length === 0) {
    // 只有预发布版本时回退，避免整个插件消失
    return Object.keys(packument.versions ?? {})
      .filter((version) => publishedAt(version) !== null)
      .sort((left, right) => publishedAt(left) - publishedAt(right))
      .map((version) => ({
        version,
        publishTimestamp: Math.floor(publishedAt(version) / 1000),
        source: { type: "npm", registry },
        ...(typeof packument.versions?.[version]?.engines?.dsh === "string"
          ? { engines: { dsh: packument.versions[version].engines.dsh } }
          : {}),
      }));
  }
  return versions;
}

/** 生成索引对象。 */
async function buildIndex() {
  const config = await readJson(join(root, "plugins.json"));
  const registry = config.registry ?? "https://registry.npmjs.org/";
  const plugins = [];

  for (const entry of config.plugins) {
    const packument = await fetchPackument(registry, entry.name);
    const versions = buildVersions(packument, registry);
    const latest = packument["dist-tags"]?.latest ?? versions.at(-1).version;
    plugins.push({
      name: entry.name,
      title: entry.title,
      description: entry.description,
      icon: await inlineIcon(entry.icon),
      ...(entry.author ? { author: entry.author } : {}),
      ...(entry.homepage ? { homepage: entry.homepage } : {}),
      repository: { url: entry.repository },
      metadata: {
        ...(entry.category ? { category: entry.category } : {}),
        keywords: entry.keywords ?? [],
        labels: entry.labels ?? [],
        sortKeys: entry.sortKeys ?? {},
      },
      versions,
    });
    console.log(`  ${entry.name}  latest=${latest}  versions=${versions.length}`);
  }

  return {
    format: 1,
    title: config.index.title,
    description: config.index.description,
    metadata: config.metadata,
    plugins,
  };
}

const { parseMarketIndex } = await import("@deepseek-ai/dsh-plugin-market-index");
const indexPath = join(root, "index.json");
const indexUrl = "https://dsh.127.dev/index.json";

if (checkOnly) {
  const index = await readJson(indexPath);
  parseMarketIndex(index, indexUrl);
  console.log(`✓ ${indexPath} 通过官方校验（${index.plugins.length} 个插件）`);
} else {
  console.log("构建索引…");
  const index = await buildIndex();
  parseMarketIndex(index, indexUrl); // 校验不过直接抛错，不写文件
  const text = `${JSON.stringify(index, null, 2)}\n`;
  await writeFile(indexPath, text, "utf8");
  console.log(`✓ 已写出 ${indexPath}（${Buffer.byteLength(text)} 字节，${index.plugins.length} 个插件）`);
}
