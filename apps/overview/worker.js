// Judges' overview: the page is a static asset; clips, posters and diagrams come from R2 (bucket sona-overview-media).
// R2 answers Range requests itself, and Safari will not play a video without 206 responses.
const STAGING = "https://sona-ai-server-staging-uxfqzyce5rxhzsju.zhiyuantech.workers.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Short links printed on the judges' handout: /pro and /care open the staging sign-in pages.
    const app = { "/pro": "/pro/sign-in", "/care": "/care/sign-in" }[url.pathname.replace(/\/$/, "")];
    if (app) return Response.redirect(STAGING + app, 302);
    if (!url.pathname.startsWith("/media/")) return env.ASSETS.fetch(request);
    const key = decodeURIComponent(url.pathname.slice(1));
    const obj = request.method === "HEAD"
      ? await env.MEDIA.head(key)
      : await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
    if (!obj) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("ETag", obj.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    if (request.method === "HEAD") return new Response(null, { headers: { ...Object.fromEntries(headers), "Content-Length": String(obj.size) } });
    if (!("body" in obj)) return new Response(null, { status: 304, headers });
    const r = request.headers.has("Range") && obj.range;
    if (!r) return new Response(obj.body, { headers: { ...Object.fromEntries(headers), "Content-Length": String(obj.size) } });
    const start = r.suffix != null ? obj.size - r.suffix : r.offset ?? 0;
    const length = r.suffix != null ? r.suffix : r.length ?? obj.size - start;
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${obj.size}`);
    headers.set("Content-Length", String(length));
    return new Response(obj.body, { status: 206, headers });
  },
};
