/**
 * dsh.127.dev — 托管 DSH 自建市场索引、落地页与静态资源。
 *
 * 路由：
 *  - `/index.json`：返回 GitHub 上的最新市场索引（JSON，边缘缓存 5 分钟）
 *  - `/` 或 `/index.html`：返回 GitHub 上的最新静态落地页（HTML，边缘缓存 5 分钟）
 *  - `/assets/*`：返回静态资源（WebP 截图、favicon、图标，边缘缓存 7 天）
 *  - `/favicon.ico`、`/favicon.svg`、`/apple-touch-icon.png`：映射到 `/assets/*`
 *  - `/api/downloads?pkg=...`：代理 npm 官方周下载量统计（边缘缓存 1 小时）
 *  - 其余路径：404
 *
 * 仓库更新时无需重新部署 Worker，最迟 5 分钟后自动生效。
 */
const BASE_RAW = "https://raw.githubusercontent.com/polunzh/dsh-plugins-index/main";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

function getExt(pathname) {
  const dot = pathname.lastIndexOf(".");
  return dot >= 0 ? pathname.slice(dot).toLowerCase() : "";
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // npm 周下载量代理（带 1 小时边缘缓存）
    if (path === "/api/downloads") {
      const pkg = url.searchParams.get("pkg") || "";
      if (!pkg || !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(pkg)) {
        return new Response(JSON.stringify({ error: "invalid package name" }), {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      const npmUrl = `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(pkg)}`;
      const npmRes = await fetch(npmUrl, {
        cf: { cacheTtl: 3600, cacheEverything: true },
      });
      return new Response(npmRes.body, {
        status: npmRes.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=3600",
          "access-control-allow-origin": "*",
        },
      });
    }

    // 路径映射
    let relative = null;
    let cacheTtl = 300;

    if (path === "/index.json") {
      relative = "index.json";
    } else if (path === "/" || path === "/index.html") {
      relative = "dist/index.html";
    } else if (path === "/favicon.ico") {
      relative = "assets/favicon.ico";
      cacheTtl = 604800;
    } else if (path === "/favicon.svg") {
      relative = "assets/favicon.svg";
      cacheTtl = 604800;
    } else if (path === "/apple-touch-icon.png") {
      relative = "assets/apple-touch-icon.png";
      cacheTtl = 604800;
    } else if (path.startsWith("/assets/")) {
      // 防止路径遍历
      const safe = path.slice(1).replace(/\\/g, "/");
      if (safe.includes("..") || safe.includes("//")) {
        return new Response("forbidden", { status: 403 });
      }
      relative = safe;
      cacheTtl = 604800; // 静态资源缓存 7 天
    } else {
      return new Response("not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const upstreamUrl = `${BASE_RAW}/${relative}`;
    const upstream = await fetch(upstreamUrl, {
      cf: { cacheTtl, cacheEverything: true },
    });

    if (!upstream.ok) {
      return new Response("upstream error", {
        status: upstream.status === 404 ? 404 : 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const ext = getExt(relative);
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": `public, max-age=${cacheTtl}`,
        "x-content-type-options": "nosniff",
      },
    });
  },
};
