/**
 * dsh.127.dev — 托管 DSH 自建市场索引及落地页。
 *
 * 路由：
 *  - `/index.json`：返回 GitHub 上的最新市场索引（JSON）
 *  - `/` 或 `/index.html`：返回 GitHub 上的最新静态落地页（HTML）
 *  - 其余路径：404
 *
 * 两者均由 Cloudflare 边缘缓存 5 分钟（cacheTtl: 300），
 * 仓库有更新时无需重新部署 Worker，最迟 5 分钟后自动生效。
 */
const BASE_RAW = "https://raw.githubusercontent.com/polunzh/dsh-plugins-index/main";
const UPSTREAM_INDEX = `${BASE_RAW}/index.json`;
const UPSTREAM_PAGE = `${BASE_RAW}/dist/index.html`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    let targetUrl;
    let contentType;

    if (path === "/index.json") {
      targetUrl = UPSTREAM_INDEX;
      contentType = "application/json; charset=utf-8";
    } else if (path === "/" || path === "/index.html") {
      targetUrl = UPSTREAM_PAGE;
      contentType = "text/html; charset=utf-8";
    } else {
      return new Response("not found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const upstream = await fetch(targetUrl, {
      cf: { cacheTtl: 300, cacheEverything: true },
    });

    if (!upstream.ok) {
      return new Response("upstream error", {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response(upstream.body, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  },
};
