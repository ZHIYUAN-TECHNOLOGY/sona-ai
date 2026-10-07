import { expect, test } from "bun:test";

import { BOXES } from "./baseten-models";
import { endpointsOf, hosted, payloads, sagemakerEmbedder, sagemakerFetcher, sagemakerLive, signed } from "./sagemaker";

const creds = { region: "us-east-1", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };

test("a POST is signed as AWS's own Signature V4 test suite signs it (post-x-www-form-urlencoded)", async () => {
  const headers = await signed(creds, "service", "https://example.amazonaws.com/", new TextEncoder().encode("Param1=value1"),
    "application/x-www-form-urlencoded", new Date("2015-08-30T12:36:00Z"));
  expect(headers.Authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, "
    + "SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a");
  expect(headers["x-amz-date"]).toBe("20150830T123600Z");
});

test("the setting names the moved boxes and the embedder; anything else in it is dropped", () => {
  expect(endpointsOf("brain=sona-brain, voice=sona-voice,embed=sona-embed,nobox=x,bad")).toEqual({ brain: "sona-brain", voice: "sona-voice", embed: "sona-embed" });
  expect(endpointsOf("")).toEqual({});
});

test("the embedder on its box: prompted texts signed to the endpoint, vectors back; a short or broken answer throws", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const vector = Array.from({ length: 768 }, () => 0.1);
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    const n = (JSON.parse(new TextDecoder().decode(init!.body as Uint8Array)) as { text: string[] }).text.length;
    return Response.json({ data: Array.from({ length: n }, () => vector) });
  }) as typeof fetch;
  const embed = sagemakerEmbedder({ ...creds, region: "ap-southeast-5", endpoint: "sona-embed" }, fetcher, () => new Date("2026-10-07T00:00:00Z"));
  expect(await embed(["Boleh berhenti antibiotik?", "肾脏感染"], "query")).toEqual([vector, vector]);
  expect(seen[0]!.url).toBe("https://runtime.sagemaker.ap-southeast-5.amazonaws.com/endpoints/sona-embed/invocations");
  expect(new TextDecoder().decode(seen[0]!.init!.body as Uint8Array)).toBe(JSON.stringify({ text: ["task: search result | query: Boleh berhenti antibiotik?", "task: search result | query: 肾脏感染"] }));
  expect((seen[0]!.init!.headers as Record<string, string>).Authorization).toStartWith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261007/ap-southeast-5/sagemaker/aws4_request");
  const broken = sagemakerEmbedder({ ...creds, region: "ap-southeast-5", endpoint: "sona-embed" }, (async () => Response.json({ data: [[1, 2]] })) as typeof fetch);
  await expect(broken(["q"], "query")).rejects.toThrow("sona-embed answered out of shape");
  const down = sagemakerEmbedder({ ...creds, region: "ap-southeast-5", endpoint: "sona-embed" }, (async () => new Response("no", { status: 503 })) as typeof fetch);
  await expect(down(["q"], "query")).rejects.toThrow("sona-embed answered 503");
});

test("a moved box's call goes to its SageMaker endpoint, signed; other boxes stay on Baseten; health and wake answer here", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => { seen.push({ url: String(url), init }); return Response.json({ ok: true }); }) as typeof fetch;
  const f = sagemakerFetcher({ ...creds, region: "ap-southeast-5", endpoints: { brain: "sona-brain" } }, fetcher, () => new Date("2026-10-04T00:00:00Z"));
  const base = (box: keyof typeof BOXES) => `https://model-${BOXES[box]}.api.baseten.co/environments/production`;

  expect((await f(`${base("brain")}/sync/health`)).status).toBe(200);
  expect((await f(`${base("brain")}/wake`, { method: "POST" })).status).toBe(200);
  expect(seen).toEqual([]);

  await f(`${base("brain")}/sync/v1/chat/completions`, { method: "POST", body: '{"model":"m"}', headers: { Authorization: "Api-Key k", "Content-Type": "application/json" } });
  expect(seen[0]!.url).toBe("https://runtime.sagemaker.ap-southeast-5.amazonaws.com/endpoints/sona-brain/invocations");
  const sent = seen[0]!.init!.headers as Record<string, string>;
  expect(sent.Authorization).toStartWith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261004/ap-southeast-5/sagemaker/aws4_request");
  expect(sent["content-type"]).toBe("application/json");

  await f(`${base("xray")}/sync/v1/chat/completions`, { method: "POST", body: "{}" });
  expect(seen[1]!.url).toBe(`${base("xray")}/sync/v1/chat/completions`);
});

test("a streamed chat goes to the response-stream route, and its event-stream frames come back as the model's bytes", async () => {
  const frame = (payload: string, event = "PayloadPart") => {
    const headers = new TextEncoder().encode(`\x0b:event-type\x07\x00${String.fromCharCode(event.length)}${event}`), body = new TextEncoder().encode(payload);
    const bytes = new Uint8Array(12 + headers.length + body.length + 4), view = new DataView(bytes.buffer);
    view.setUint32(0, bytes.length); view.setUint32(4, headers.length);
    bytes.set(headers, 12); bytes.set(body, 12 + headers.length);
    return bytes;
  };
  const a = frame('data: {"x":1}\n\n'), b = frame("data: [DONE]\n\n");
  const joined = new Uint8Array([...a, ...b]);
  // Frames arrive split anywhere: here mid-way through the first.
  const chunks = [joined.slice(0, 20), joined.slice(20)];
  let url = "";
  const fetcher = (async (u: RequestInfo | URL) => { url = String(u); return new Response(new ReadableStream({ start(c) { chunks.forEach(x => c.enqueue(x)); c.close(); } })); }) as typeof fetch;
  const f = sagemakerFetcher({ ...creds, endpoints: { brain: "sona-brain" } }, fetcher);
  const res = await f(`https://model-${BOXES.brain}.api.baseten.co/environments/production/sync/v1/chat/completions`,
    { method: "POST", body: '{"stream": true}', headers: { "Content-Type": "application/json" } });
  expect(url).toEndWith("/endpoints/sona-brain/invocations-response-stream");
  expect(await res.text()).toBe('data: {"x":1}\n\ndata: [DONE]\n\n');

  const failed = new Response(new ReadableStream({ start(c) { c.enqueue(frame("the model failed", "ModelStreamError")); c.close(); } })).body!.pipeThrough(payloads());
  expect(new Response(failed).text()).rejects.toThrow("SageMaker stream");
});

test("hosting follows the settings: no key, no models; no moved boxes or no AWS keys, Baseten alone", () => {
  expect(hosted({})).toBeUndefined();
  expect(hosted({ BASETEN_API_KEY: "k" })).toEqual({ apiKey: "k" });
  expect(hosted({ BASETEN_API_KEY: "k", SAGEMAKER_ENDPOINTS: "brain=sona-brain" })).toEqual({ apiKey: "k" });
  expect(hosted({ BASETEN_API_KEY: "k", SAGEMAKER_ENDPOINTS: "brain=sona-brain", AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "s" })!.fetcher).toBeFunction();
});

test("a box named lambda:<function> is invoked as a Lambda function: the request as an HTTP event, the service's reply out of the event", async () => {
  let seen: { url: string; init?: RequestInit } | undefined;
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen = { url: String(url), init };
    return Response.json({ statusCode: 200, headers: { "content-type": "application/json" }, body: '{"entities":[]}' });
  }) as typeof fetch;
  const f = sagemakerFetcher({ ...creds, region: "ap-southeast-5", endpoints: { pii: "lambda:sona-pii" } }, fetcher);
  const res = await f(`https://model-${BOXES.pii}.api.baseten.co/environments/production/sync/pii/extract`,
    { method: "POST", body: '{"text":"Seen with her son Hafiz."}', headers: { "content-type": "application/json", Authorization: "Api-Key k" } });
  expect(seen!.url).toBe("https://lambda.ap-southeast-5.amazonaws.com/2015-03-31/functions/sona-pii/invocations");
  expect((seen!.init!.headers as Record<string, string>).Authorization).toContain("/ap-southeast-5/lambda/aws4_request");
  const event = JSON.parse(new TextDecoder().decode(seen!.init!.body as Uint8Array));
  expect([event.rawPath, event.requestContext.http.method, event.body]).toEqual(["/pii/extract", "POST", '{"text":"Seen with her son Hafiz."}']);
  expect([res.status, await res.json()]).toEqual([200, { entities: [] }]);
  // A function that failed answers 200 with an error header: a failed call to the caller.
  const failing = sagemakerFetcher({ ...creds, endpoints: { pii: "lambda:sona-pii" } }, (async () => new Response("{}", { headers: { "x-amz-function-error": "Unhandled" } })) as typeof fetch);
  expect((await failing(`https://model-${BOXES.pii}.api.baseten.co/environments/production/sync/pii/extract`, { method: "POST", body: "{}" })).status).toBe(502);
});

test("a live call on SageMaker: the start, then audio a second a request, in order; the box's frames come back from one streamed request", async () => {
  // An AWS event-stream frame around some of the box's bytes, as the response-stream route sends them.
  const wrap = (payload: Uint8Array) => {
    const headers = new TextEncoder().encode("\x0b:event-type\x07\x00\x0bPayloadPart");
    const bytes = new Uint8Array(12 + headers.length + payload.length + 4), view = new DataView(bytes.buffer);
    view.setUint32(0, bytes.length); view.setUint32(4, headers.length);
    bytes.set(headers, 12); bytes.set(payload, 12 + headers.length);
    return bytes;
  };
  const boxFrame = (kind: number, data: Uint8Array) => { const f = new Uint8Array(5 + data.length); f[0] = kind; new DataView(f.buffer).setUint32(1, data.length); f.set(data, 5); return f; };
  const said = [boxFrame(0, new TextEncoder().encode('{"type":"unit","i":1}')), boxFrame(1, new Uint8Array([1, 2, 3, 4])), boxFrame(2, new Uint8Array(0))];
  const all = new Uint8Array(said.flatMap(f => [...f]));
  const sent: string[] = [];
  let heardBoth = () => {};
  const bothSeconds = new Promise<void>(done => { heardBoth = done; });
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = init!.body as Uint8Array, type = (init!.headers as Record<string, string>)["content-type"];
    sent.push(`${String(url).split("/").pop()} ${type === "application/json" ? new TextDecoder().decode(body) : `${body.length} bytes`}`);
    if (sent.filter(s => s.endsWith("bytes")).length === 2) heardBoth();
    if (String(url).endsWith("-response-stream")) // the box answers once it has heard both seconds; its frames split across two chunks, mid-frame
      return bothSeconds.then(() => new Response(new ReadableStream({ start(c) { c.enqueue(wrap(all.slice(0, 9))); c.enqueue(wrap(all.slice(9))); c.close(); } })));
    return new Response(type === "application/json" && sent.length === 1 ? '{"type":"ready"}' : null);
  }) as typeof fetch;
  const link = sagemakerLive({ ...creds, region: "ap-southeast-5" }, "sona-live", fetcher), got: (string | ArrayBuffer)[] = [];
  const over = new Promise<void>(done => { link.onclose = done; });
  link.onmessage = data => got.push(data);
  link.send('{"type":"start","system":"s"}');
  link.send(new Uint8Array(20_000).buffer); // under a second: held
  link.send(new Uint8Array(50_000).buffer); // 70,000 bytes so far: two seconds go, 6,000 wait
  await over;
  expect(sent).toEqual(['invocations {"type":"start","system":"s"}', 'invocations-response-stream {"type":"listen"}', "invocations 32000 bytes", "invocations 32000 bytes"]);
  expect(got.map(g => typeof g === "string" ? g : [...new Uint8Array(g)])).toEqual(['{"type":"ready"}', '{"type":"unit","i":1}', [1, 2, 3, 4]]);
});
