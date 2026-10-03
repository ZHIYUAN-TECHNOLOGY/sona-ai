import { expect, test } from "bun:test";

import { BOXES } from "./baseten-models";
import { endpointsOf, hosted, payloads, sagemakerFetcher, signed } from "./sagemaker";

const creds = { region: "us-east-1", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };

test("a POST is signed as AWS's own Signature V4 test suite signs it (post-x-www-form-urlencoded)", async () => {
  const headers = await signed(creds, "service", "https://example.amazonaws.com/", new TextEncoder().encode("Param1=value1"),
    "application/x-www-form-urlencoded", new Date("2015-08-30T12:36:00Z"));
  expect(headers.Authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, "
    + "SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a");
  expect(headers["x-amz-date"]).toBe("20150830T123600Z");
});

test("the setting names the moved boxes; anything else in it is dropped", () => {
  expect(endpointsOf("brain=sona-brain, voice=sona-voice,nobox=x,bad")).toEqual({ brain: "sona-brain", voice: "sona-voice" });
  expect(endpointsOf("")).toEqual({});
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
