/**
 * dsh.127.dev — 直接返回 GitHub 上的市场索引，保持与 index.json 同步。
 * 只响应 /index.json；其余路径 404。
 */
const UPSTREAM = "https://raw.githubusercontent.com/polunzh/dsh-plugins-index/main/index.json";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/index.json") {
      return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const upstream = await fetch(UPSTREAM, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!upstream.ok) {
      return new Response("upstream error", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response(upstream.body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  },
};
