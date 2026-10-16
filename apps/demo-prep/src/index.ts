import { createDb } from "@sona-ai/db";
import { resetDemo } from "@sona-ai/db/reset";
import { noteFor } from "@sona-ai/domain/claim";

/**
 * Pitch-day prep for the Sona Care demo ("sona, what medicine I makan" / "what time 我 吃药"): Care answers those from
 * Amelia's take-home list, which exists only once she is discharged in Pro. Three buttons: reset the demo hospital
 * (packages/db resetDemo on DATABASE_URL, as `bun run db:reset-demo` does), then, through the real app's own routes on
 * SONA_URL as the demo doctor and the demo patient, walk Amelia from note to discharge, and ask Care both questions.
 */
type Env = { SONA_URL: string; PREP_KEY: string; DATABASE_URL: string; SONA?: Fetcher };
/**
 * Calls to the Sona Worker. On Cloudflare they go through the SONA service binding: a Worker fetching another Worker's
 * workers.dev URL on the same account is refused (error 1042, 11 Oct). Locally (no binding) they go over the network.
 */
let sonaFetch: (input: string, init: RequestInit) => Promise<Response> = (input, init) => fetch(input, init);

const VISIT = "visit-1042";
const QUESTIONS = ["sona, what medicine I makan", "what time 我 吃药"];
const DOCTOR = { email: "doctor@sona.test", password: "123" }; // the public demo account the sign-in page prints
const PATIENT = { phoneNumber: "+601100000000", code: "123456" }; // DEMO_PATIENT_PHONE / DEMO_SIGN_IN_CODE

/** One signed-in user on the Sona server: its cookie, carried call to call. */
function session(base: string) {
  let cookie = "";
  const call = async (path: string, body: unknown, form = false) => {
    const r = await sonaFetch(base + path, {
      method: "POST", redirect: "manual",
      headers: { origin: base, cookie, "content-type": form ? "application/x-www-form-urlencoded" : "application/json" },
      body: form ? new URLSearchParams(body as Record<string, string>) : JSON.stringify(body),
    });
    const set = r.headers.getSetCookie();
    if (set.length) cookie = set.map(c => c.split(";")[0]).join("; ");
    const text = await r.text();
    if (r.status >= 400) throw new Error(`${path} answered ${r.status}: ${text.slice(0, 300)}`);
    return text.startsWith("{") ? JSON.parse(text) : null;
  };
  return { call, rpc: async (path: string, input: unknown = null) => (await call(`/rpc/${path}`, { json: input })).json };
}

async function doctor(base: string) {
  const s = session(base);
  const { user } = await s.call("/api/auth/sign-in/email", DOCTOR);
  return { ...s, id: user.id as string };
}

async function patient(base: string) {
  const s = session(base);
  await s.call("/api/auth/phone-number/send-otp", { phoneNumber: PATIENT.phoneNumber });
  await s.call("/api/auth/phone-number/verify", PATIENT);
  return s;
}

/** Amelia from her admission to discharged, each step skipped when already done, so a second press finishes a first. */
async function ready(base: string, log: (line: string) => void) {
  const dr = await doctor(base);
  const note = await dr.rpc("note/get", { encounterId: VISIT });
  if (!note.revision) {
    // Sample mode's authored note for her visit, with the organism and IV reason the letter asks for.
    await dr.rpc("note/save", { encounterId: VISIT, expectedRevision: 0, sentences: noteFor({ organismConfirmed: true, ivReasonAdded: true, status: "draft" }) });
    log("Saved Amelia's visit note.");
  } else log(`Her note is already saved (revision ${note.revision}).`);

  let claim = await dr.rpc("claim/status", { encounterId: VISIT });
  if (claim.status !== "approved") {
    await dr.rpc("claim/suggestCodes", { encounterId: VISIT });
    await dr.rpc("claim/send", { encounterId: VISIT, requestId: crypto.randomUUID(), approvedBy: dr.id });
    claim = await dr.rpc("claim/status", { encounterId: VISIT });
    if (!claim.reviewUrl) throw new Error("The letter was sent but the server gave no insurer link");
    await session(base).call(new URL(claim.reviewUrl).pathname, { decision: "approve" }, true);
    log("Sent the guarantee letter; the insurer approved it.");
  } else log("Guarantee letter already approved.");

  const plan = await dr.rpc("discharge/plan", { encounterId: VISIT });
  if (plan.state.dischargedAt) log(`Already discharged at ${plan.state.dischargedAt}. Press 1 first for a fresh discharge.`);
  else {
    await dr.rpc("discharge/update", { encounterId: VISIT, medsConfirmed: true, followUp: "2w" });
    await dr.rpc("discharge/request", { encounterId: VISIT, requestId: crypto.randomUUID(), approvedBy: dr.id });
    log("Confirmed her medicines and 2-week review; discharge approved.");
  }

  const home = await (await patient(base)).rpc("care/discharge", { lang: "en" });
  for (const [group, list] of Object.entries(home.medicines ?? {}) as [string, { name: string; at?: string[] }[]][])
    for (const m of list) log(`Care shows: ${m.name} (${group})${m.at?.length ? ` at ${m.at.join(", ")}` : ""}`);
}

async function test(base: string, log: (line: string) => void) {
  const me = await patient(base);
  for (const question of QUESTIONS) {
    const t = Date.now();
    const a = await me.rpc("care/ask", { question });
    log(`Q: ${question}  (${((Date.now() - t) / 1000).toFixed(1)} s)\n${a.answer}`);
  }
}

const page = (body: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sona demo prep</title>
<style>body{font:16px system-ui;max-width:640px;margin:24px auto;padding:0 16px;color:#111;background:#fff}button{font:inherit;padding:12px 16px;margin:4px 0;width:100%;border-radius:10px;border:1px solid #888;background:#f4f4f4}button.go{background:#0b6;color:#fff;border-color:#0b6}pre{white-space:pre-wrap;background:#f6f6f6;padding:12px;border-radius:8px}input{font:inherit;padding:10px;width:100%;box-sizing:border-box}</style>
<h1>Sona demo prep</h1>
<p>Staging. Press 1, then 2, then 3. Then sign in to Sona Care with the demo number and start the voice call.</p>
<form method="post"><input type="password" name="key" placeholder="Prep key" required>
<button name="do" value="reset" onclick="return confirm('Reset the staging demo hospital? Every demo run so far is deleted.')">1 · Reset demo hospital</button>
<button name="do" value="ready" class="go">2 · Get Amelia ready (note, letter, discharge)</button>
<button name="do" value="test">3 · Test both questions</button></form>${body}`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export default {
  async fetch(req: Request, env: Env) {
    if (req.method !== "POST") return page("");
    const form = await req.formData();
    if (!env.PREP_KEY || form.get("key") !== env.PREP_KEY) return page("<pre>Wrong key.</pre>");
    if (env.SONA) { const sona = env.SONA; sonaFetch = (input, init) => sona.fetch(input, init); }
    const lines: string[] = [], log = (l: string) => { lines.push(l); };
    const t = Date.now();
    try {
      const what = form.get("do");
      if (what === "reset") { await resetDemo(createDb({ DATABASE_URL: env.DATABASE_URL })); log("Reset the demo hospital to its seeded start: Amelia is back in her ward bed, the demo clock on real time."); }
      else if (what === "ready") await ready(env.SONA_URL, log);
      else await test(env.SONA_URL, log);
      log(`Done in ${((Date.now() - t) / 1000).toFixed(0)} s.`);
    } catch (error) {
      log(`Stopped: ${error instanceof Error ? error.message : String(error)}`);
    }
    return page(`<pre>${esc(lines.join("\n\n"))}</pre>`);
  },
};
