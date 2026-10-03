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
 */
export type SageMaker = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** With temporary credentials (a local test with `aws login`). */
  sessionToken?: string;
  /** The boxes that have moved, and their endpoint names: { brain: "sona-brain" }. */
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

/** How to reach the boxes: Baseten with its key, and the boxes SAGEMAKER_ENDPOINTS names on SageMaker. None without a key. */
export function hosted(env: HostingEnv, fetcher: typeof fetch = fetch): Baseten | undefined {
  if (!env.BASETEN_API_KEY) return undefined;
  const endpoints = endpointsOf(env.SAGEMAKER_ENDPOINTS ?? "");
  if (!Object.keys(endpoints).length || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) return { apiKey: env.BASETEN_API_KEY };
  return {
    apiKey: env.BASETEN_API_KEY,
    fetcher: sagemakerFetcher({ region: env.SAGEMAKER_REGION || "ap-southeast-5", accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN || undefined, endpoints }, fetcher),
  };
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
    const streamed = contentType.startsWith("application/json") && /"stream"\s*:\s*true/.test(new TextDecoder().decode(body));
    const url = `https://runtime.sagemaker.${sm.region}.amazonaws.com/endpoints/${encodeURIComponent(endpoint)}/${streamed ? "invocations-response-stream" : "invocations"}`;
    const headers = await signed(sm, "sagemaker", url, body, contentType, now());
    const res = await fetcher(url, { method: "POST", body, headers, signal: init?.signal });
    if (!streamed || !res.ok || !res.body) return res;
    return new Response(res.body.pipeThrough(payloads()), { status: res.status, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
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
      const all = new Uint8Array(held.length + chunk.length);
      all.set(held); all.set(chunk, held.length);
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
