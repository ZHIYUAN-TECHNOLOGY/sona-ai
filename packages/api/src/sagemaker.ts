import { BOXES, type Baseten, type Box } from "./baseten-models";

/**
 * The same boxes on Amazon SageMaker in Malaysia (packages/infra/aws): a fetcher for `boxes()` that sends a moved box's
 * calls to its SageMaker endpoint and leaves every other box on Baseten, so nothing above the fetcher changes.
 * A SageMaker endpoint has one route, POST /endpoints/<name>/invocations, signed with AWS Signature V4. The containers
 * take the same bodies there (vLLM's /invocations; the voice gateway tells its three jobs apart by what is sent).
 * A streamed chat goes to /invocations-response-stream, whose AWS event-stream frames are unwrapped back into the
 * model's own bytes (its SSE lines).
 * ponytail: an endpoint that exists is taken to be up, and wake does nothing; when the endpoints scale to zero, health
 * needs DescribeEndpoint and wake a scale-up.
 * A box named "lambda:<function>" is an AWS Lambda function instead (the PII box, packages/infra/aws/pii): it bills per
 * call, wakes by being called, and takes the request as an HTTP event (Lambda's web adapter hands it to the service).
 */
export type SageMaker = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** With temporary credentials (a local test with `aws login`). */
  sessionToken?: string;
  /** The boxes that have moved, and their endpoint names: { brain: "sona-brain", pii: "lambda:sona-pii" }. */
  endpoints: Partial<Record<Box, string>>;
};

/** "brain=sona-brain,voice=sona-voice" (the SAGEMAKER_ENDPOINTS setting) as the endpoints of a SageMaker. */
export function endpointsOf(setting: string): SageMaker["endpoints"] {
  const pairs = setting.split(",").map(p => p.trim().split("=")).filter(p => p.length === 2 && p[0]! in BOXES && p[1]);
  return Object.fromEntries(pairs);
}

/** The server's settings that name where the boxes are hosted (apps/server/.env.schema). */
export type HostingEnv = {
  BASETEN_API_KEY?: string; SAGEMAKER_ENDPOINTS?: string; SAGEMAKER_REGION?: string;
  AWS_ACCESS_KEY_ID?: string; AWS_SECRET_ACCESS_KEY?: string; AWS_SESSION_TOKEN?: string;
};

type Aws = Omit<SageMaker, "endpoints">;

/** The AWS identity and region in the server's settings; none without both keys. */
export function awsOf(env: HostingEnv): Aws | undefined {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return undefined;
  return { region: env.SAGEMAKER_REGION || "ap-southeast-5", accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN || undefined };
}

/** How to reach the boxes: Baseten with its key, and the boxes SAGEMAKER_ENDPOINTS names on SageMaker. None without a key. */
export function hosted(env: HostingEnv, fetcher: typeof fetch = fetch): Baseten | undefined {
  if (!env.BASETEN_API_KEY) return undefined;
  const endpoints = endpointsOf(env.SAGEMAKER_ENDPOINTS ?? ""), aws = awsOf(env);
  if (!Object.keys(endpoints).length || !aws) return { apiKey: env.BASETEN_API_KEY };
  return { apiKey: env.BASETEN_API_KEY, fetcher: sagemakerFetcher({ ...aws, endpoints }, fetcher) };
}

const BASETEN = /^https:\/\/model-([a-z0-9]+)\.api\.baseten\.co\/environments\/production\/(wake|sync\/health|sync\/.+)$/;
const boxOf = (id: string) => (Object.keys(BOXES) as Box[]).find(b => BOXES[b] === id);

export function sagemakerFetcher(sm: SageMaker, fetcher: typeof fetch = fetch, now: () => Date = () => new Date()): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const [, id, route] = BASETEN.exec(String(input instanceof Request ? input.url : input)) ?? [];
    const box = id ? boxOf(id) : undefined, endpoint = box && sm.endpoints[box];
    if (!endpoint || !route) return fetcher(input, init);
    if (route === "wake" || route === "sync/health") return new Response(null, { status: 200 });
    // The body as bytes, with the content type a form sets for itself (its boundary).
    // Baseten's Authorization header is not carried over: AWS signs its own.
    const type = new Headers(init?.headers).get("content-type");
    const sent = new Request("https://sagemaker.invalid", { method: "POST", body: init?.body, headers: type ? { "content-type": type } : undefined });
    const body = new Uint8Array(await sent.arrayBuffer()), contentType = sent.headers.get("content-type") ?? "application/octet-stream";
    if (endpoint.startsWith("lambda:")) return viaLambda(sm, endpoint.slice(7), route.slice(4), body, contentType, fetcher, now(), init?.signal);
    const streamed = contentType.startsWith("application/json") && /"stream"\s*:\s*true/.test(new TextDecoder().decode(body));
    const url = `https://runtime.sagemaker.${sm.region}.amazonaws.com/endpoints/${encodeURIComponent(endpoint)}/${streamed ? "invocations-response-stream" : "invocations"}`;
    const headers = await signed(sm, "sagemaker", url, body, contentType, now());
    const res = await fetcher(url, { method: "POST", body, headers, signal: init?.signal });
    if (!streamed || !res.ok || !res.body) return res;
    return new Response(res.body.pipeThrough(payloads()), { status: res.status, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
}

/**
 * One call to a Lambda function behind Lambda's web adapter: the request as an API Gateway v2 event, the service's
 * reply out of the event it answers with. ponytail: text bodies only (the PII box speaks JSON); base64 both ways for bytes.
 */
async function viaLambda(sm: SageMaker, name: string, path: string, body: Uint8Array, contentType: string, fetcher: typeof fetch, at: Date, signal?: AbortSignal | null) {
  const event = text.encode(JSON.stringify({ version: "2.0", rawPath: path, rawQueryString: "", headers: { "content-type": contentType },
    requestContext: { http: { method: "POST", path, sourceIp: "127.0.0.1" } }, body: new TextDecoder().decode(body), isBase64Encoded: false }));
  const url = `https://lambda.${sm.region}.amazonaws.com/2015-03-31/functions/${encodeURIComponent(name)}/invocations`;
  const res = await fetcher(url, { method: "POST", body: event, headers: await signed(sm, "lambda", url, event, "application/json", at), signal });
  // A function that failed still answers 200, with this header.
  if (!res.ok || res.headers.get("x-amz-function-error")) return new Response(await res.text(), { status: res.ok ? 502 : res.status });
  const out = await res.json() as { statusCode?: number; headers?: Record<string, string>; body?: string };
  return new Response(out.body ?? "", { status: out.statusCode ?? 502, headers: { "content-type": out.headers?.["content-type"] ?? "application/json" } });
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const text = new TextEncoder();
const sha256 = async (data: Uint8Array | string) => hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? text.encode(data) : data));
async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, text.encode(data));
}

/** The headers of a POST signed with AWS Signature V4 (content type, date, and the session token when there is one). */
export async function signed(creds: Pick<SageMaker, "region" | "accessKeyId" | "secretAccessKey" | "sessionToken">, service: string,
  url: string, body: Uint8Array, contentType: string, at: Date): Promise<Record<string, string>> {
  const { host, pathname } = new URL(url);
  const stamp = at.toISOString().replace(/[-:]|\.\d{3}/g, ""), day = stamp.slice(0, 8);
  const sign: Record<string, string> = { "content-type": contentType, host, "x-amz-date": stamp, ...creds.sessionToken ? { "x-amz-security-token": creds.sessionToken } : {} };
  const names = Object.keys(sign).sort().join(";");
  const request = ["POST", pathname, "", ...Object.keys(sign).sort().map(n => `${n}:${sign[n]}`), "", names, await sha256(body)].join("\n");
  const scope = `${day}/${creds.region}/${service}/aws4_request`;
  let key: ArrayBuffer | Uint8Array = text.encode(`AWS4${creds.secretAccessKey}`);
  for (const part of [day, creds.region, service, "aws4_request"]) key = await hmac(key, part);
  const signature = hex(await hmac(key, ["AWS4-HMAC-SHA256", stamp, scope, await sha256(request)].join("\n")));
  const { host: _, ...rest } = sign;
  return { ...rest, Authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${names}, Signature=${signature}` };
}

/**
 * AWS event-stream frames to the bytes they carry. A frame: total length (4), headers length (4), prelude CRC (4),
 * headers, payload, message CRC (4). A PayloadPart's payload is the model's own bytes; any other event ends the stream
 * as an error (ModelStreamError, InternalStreamFailure). ponytail: the CRCs are not checked (TLS already guards the bytes).
 */
export function payloads() {
  let held = new Uint8Array(0);
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, out) {
      const all = joined(held, chunk);
      let at = 0;
      while (all.length - at >= 12) {
        const view = new DataView(all.buffer, all.byteOffset + at), total = view.getUint32(0), headersLength = view.getUint32(4);
        if (all.length - at < total) break;
        const headers = new TextDecoder().decode(all.subarray(at + 12, at + 12 + headersLength));
        const payload = all.subarray(at + 12 + headersLength, at + total - 4);
        if (!headers.includes("PayloadPart")) return out.error(new Error(`SageMaker stream: ${new TextDecoder().decode(payload).slice(0, 200) || headers}`));
        out.enqueue(payload.slice());
        at += total;
      }
      held = all.slice(at);
    },
  });
}

/** One live call's link to box ④: what its agent needs of a WebSocket (apps/server/src/agents/live.ts). */
export type LiveLink = { send(data: string | ArrayBuffer): void; close(): void; onmessage?: (data: string | ArrayBuffer) => void; onclose?: () => void };

/** A second of the phone's audio (16 kHz PCM16): what one request to the box carries, and what the model hears at a time. */
const SECOND = 32_000;

/**
 * A live call with box ④ on a SageMaker endpoint. SageMaker in Malaysia carries no WebSocket (its two-way streaming is
 * not offered in ap-southeast-5, 4 Oct 2026), so the call goes as requests, in order: the start, then the patient's
 * audio a second at a time; and one streamed request at a time brings back everything the box says, as frames
 * (packages/infra/aws/live/serve.py: a byte for text, voice or "over", a length, the bytes), asked again when it ends.
 * ponytail: a request a second, so a Worker's limit on requests (10,000 a call on the paid plan) ends a call near 2.7 h.
 */
export function sagemakerLive(aws: Aws, endpoint: string, fetcher: typeof fetch = fetch, now: () => Date = () => new Date()): LiveLink {
  const base = `https://runtime.sagemaker.${aws.region}.amazonaws.com/endpoints/${encodeURIComponent(endpoint)}/`;
  let closed = false, held = new Uint8Array(0), line: Promise<unknown> = Promise.resolve();
  const post = async (route: string, body: Uint8Array, contentType: string) => {
    const res = await fetcher(base + route, { method: "POST", body, headers: await signed(aws, "sagemaker", base + route, body, contentType, now()) });
    if (!res.ok) throw new Error(`box ④ answered ${res.status}`);
    return res;
  };
  const lost = () => { if (!closed) { closed = true; link.onclose?.(); } };
  const next = (job: () => Promise<unknown>) => { line = line.then(() => closed ? undefined : job()).catch(lost); };
  /** Everything the box sends, until the call is over. */
  async function listen() {
    while (!closed) {
      const res = await post("invocations-response-stream", text.encode('{"type":"listen"}'), "application/json");
      let got = new Uint8Array(0);
      for await (const chunk of res.body!.pipeThrough(payloads()) as unknown as AsyncIterable<Uint8Array>) {
        got = joined(got, chunk);
        while (got.length >= 5) {
          const length = new DataView(got.buffer, got.byteOffset).getUint32(1);
          if (got.length < 5 + length) break;
          const kind = got[0], payload = got.slice(5, 5 + length);
          got = got.slice(5 + length);
          if (kind === 2) return lost();
          if (!closed) link.onmessage?.(kind === 1 ? payload.buffer : new TextDecoder().decode(payload));
        }
      }
    }
  }
  const link: LiveLink = {
    send(data) {
      if (typeof data === "string") {
        return next(async () => {
          const res = await post("invocations", text.encode(data), "application/json");
          if ((JSON.parse(data) as { type?: string }).type !== "start") return;
          link.onmessage?.(await res.text()); // the box's "ready"
          void listen().catch(lost);
        });
      }
      held = joined(held, new Uint8Array(data));
      for (; held.length >= SECOND; held = held.slice(SECOND)) {
        const second = held.slice(0, SECOND);
        next(() => post("invocations", second, "application/octet-stream"));
      }
    },
    close() {
      if (closed) return;
      closed = true;
      void post("invocations", text.encode('{"type":"stop"}'), "application/json").catch(() => {});
    },
  };
  return link;
}

function joined(a: Uint8Array, b: Uint8Array) {
  const all = new Uint8Array(a.length + b.length);
  all.set(a); all.set(b, a.length);
  return all;
}
