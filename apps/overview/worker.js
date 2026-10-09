// Static assets ignore Range, and Safari will not play a video without 206 responses. Slice clips here.
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(new Request(request.url)); // plain GET: full body, even for HEAD or Range
    const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") ?? "");
    if (!m || res.status !== 200 || (!m[1] && !m[2])) return request.method === "HEAD" ? new Response(null, res) : res;
    const body = await res.arrayBuffer(), size = body.byteLength;
    const start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
    const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const headers = new Headers(res.headers);
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Accept-Ranges", "bytes");
    return new Response(request.method === "HEAD" ? null : body.slice(start, end + 1), { status: 206, headers });
  },
};
