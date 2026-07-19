// Sona demo site — one worker: serves the showcase page at "/" and streams the
// R2-hosted demo videos at /videos/* with HTTP Range support so browsers can
// seek/scrub. The bucket stays private; this worker is the only door.

export interface Env {
  DEMO: R2Bucket;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sona — On-device AI Clinical Scribe</title>
<style>
  :root {
    --green: #0e7c52; --green-deep: #0a5c3e; --green-soft: #e9f5ef;
    --ink: #10231b; --ink2: #42534b; --ink3: #5f6d64;
    --bg: #f6f5f0; --card: #ffffff; --line: #e5e3da; --amber: #8a5a00; --amber50: #fdf5e6;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: var(--bg); color: var(--ink); line-height: 1.6; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 48px 20px 80px; }
  header { text-align: center; margin-bottom: 56px; }
  .brand { font-size: 40px; font-weight: 700; letter-spacing: -0.02em; color: var(--green-deep); }
  .tagline { font-size: 19px; color: var(--ink2); margin-top: 8px; }
  .moat { display: inline-block; margin-top: 16px; background: var(--green-soft); color: var(--green-deep);
          font-weight: 600; font-size: 14px; padding: 6px 16px; border-radius: 999px; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 20px;
            padding: 32px; margin-bottom: 36px; box-shadow: 0 1px 3px rgba(11,30,22,0.05); }
  .kicker { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
            color: var(--green); margin-bottom: 6px; }
  h2 { font-size: 26px; letter-spacing: -0.01em; margin-bottom: 14px; }
  video { width: 100%; border-radius: 14px; background: #000; display: block; margin: 18px 0 22px; }
  ul { list-style: none; }
  li { padding-left: 26px; position: relative; margin-bottom: 10px; color: var(--ink2); font-size: 15.5px; }
  li::before { content: "✓"; position: absolute; left: 0; color: var(--green); font-weight: 700; }
  li strong { color: var(--ink); }
  .privacy { background: var(--amber50); border-radius: 12px; padding: 12px 16px; font-size: 13.5px;
             color: var(--amber); font-weight: 600; margin-top: 18px; }
  footer { text-align: center; color: var(--ink3); font-size: 13px; margin-top: 24px; }
  @media (max-width: 600px) { .brand { font-size: 30px; } section { padding: 22px; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">Sona</div>
    <div class="tagline">On-device AI clinical scribe for Malaysian clinics</div>
    <div class="moat">🔒 Every model runs on the phone — patient audio &amp; text never leave the device</div>
  </header>

  <section>
    <div class="kicker">Feature 1</div>
    <h2>AI Transcribe — consult to signed SOAP note</h2>
    <video controls preload="metadata" src="/videos/ai-transcribe.mp4"></video>
    <ul>
      <li><strong>Tri-lingual live transcription</strong> — Malay, English and Mandarin code-switch in one consult, powered by Whisper large-v3-turbo running fully on-device</li>
      <li><strong>Speaker separation</strong> — doctor and patient turns split automatically, correctable with one tap</li>
      <li><strong>Privacy gate</strong> — names, IC, phone and address are de-identified by an on-device redaction sweep <em>before</em> any AI model reads a word; a live audit trail proves 0 bytes transmitted</li>
      <li><strong>AI SOAP note</strong> — structured Subjective / Objective / Assessment / Plan with orders &amp; follow-ups, drafted on-device from the de-identified transcript</li>
      <li><strong>Clinical highlights</strong> — doses &amp; vitals, timeframes and red-flag symptoms colour-coded; negated symptoms ("no chest pain") correctly left unmarked</li>
      <li><strong>Sign &amp; seal</strong> — clinician reviews line-by-line, signs on screen; raw audio is destroyed on signing</li>
    </ul>
    <div class="privacy">The consultation recording never leaves the phone — transcription, de-identification and note drafting are all local.</div>
  </section>

  <section>
    <div class="kicker">Feature 2</div>
    <h2>AI SmartScan — paper documents into structured notes</h2>
    <video controls preload="metadata" src="/videos/ai-smartscan.mp4"></video>
    <ul>
      <li><strong>Native document scanner</strong> — live edge detection, per-page crop and perspective correction (Apple VisionKit), multi-page in one session</li>
      <li><strong>On-device OCR</strong> — reads printed and handwritten documents in Malay, English and 中文; prescriptions, referral letters, lab reports</li>
      <li><strong>Automatic de-identification</strong> — the same redaction engine strips patient identifiers from the extracted text before any AI step</li>
      <li><strong>AI document note</strong> — structured summary (document type, key findings, medications &amp; doses, follow-up) generated on-device; fragmentary scan text is copied as written, never guessed</li>
      <li><strong>Attach to consult</strong> — scanned documents feed the consult note so referrals and results inform the SOAP draft</li>
      <li><strong>PHI hygiene</strong> — page images are destroyed the moment OCR completes; only verified text is kept</li>
    </ul>
    <div class="privacy">Scans are processed entirely on the phone — the image and its text never touch a server.</div>
  </section>

  <footer>Sona · ZHIYUAN Technology · demo build — all AI inference on-device</footer>
</div>
</body>
</html>`;

function rangeResponse(object: R2ObjectBody, start: number, end: number, size: number): Response {
  return new Response(object.body, {
    status: 206,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
    }

    if (url.pathname.startsWith("/videos/")) {
      const key = url.pathname.slice(1); // videos/<name>.mp4
      const rangeHeader = request.headers.get("Range");

      if (rangeHeader) {
        const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
        if (m) {
          const head = await env.DEMO.head(key);
          if (!head) return new Response("Not found", { status: 404 });
          const size = head.size;
          const start = Number(m[1]);
          // Cap open-ended / oversized ranges; browsers re-request as needed.
          const end = Math.min(m[2] ? Number(m[2]) : size - 1, size - 1);
          if (start >= size) return new Response("Range not satisfiable", { status: 416 });
          const object = await env.DEMO.get(key, { range: { offset: start, length: end - start + 1 } });
          if (!object) return new Response("Not found", { status: 404 });
          return rangeResponse(object as R2ObjectBody, start, end, size);
        }
      }

      // HEAD (link checkers, players probing size): headers only, no body read.
      if (request.method === "HEAD") {
        const head = await env.DEMO.head(key);
        if (!head) return new Response(null, { status: 404 });
        return new Response(null, {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(head.size),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      const object = await env.DEMO.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(object.body, {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(object.size),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
