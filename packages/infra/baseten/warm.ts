/**
 * Demo-day warm-up for Sona's Baseten boxes (docs/handoff.md#baseten-boxes): wakes brain, voice, xray and Laya,
 * then checks every box every 20 s, printing each one's state and the minutes elapsed, until all four answer
 * (45 minutes at most). Cold starts have taken 9–30 minutes, so run it at least 30 minutes before the demo.
 *
 *   BASETEN_API_KEY=... bun packages/infra/baseten/warm.ts wake
 *
 * Every box is billed while it is up. A woken box still scales back to zero after 5 idle minutes, so to keep
 * the boxes warm through a demo, set Min replicas to 1 in each model's production autoscaling settings (the
 * Baseten UI, or the Baseten MCP) and back to 0 afterwards: the Worker's invoke-only key cannot change autoscaling.
 */
import { setTimeout as sleep } from "node:timers/promises";

import { BOXES, COLD_START_MIN, type Box } from "../../api/src/baseten-models";
import { layaEvaluator, pickCard } from "../../api/src/laya";

const key = process.env.BASETEN_API_KEY;
if (process.argv[2] !== "wake" || !key) {
  console.error("Usage: BASETEN_API_KEY=... bun packages/infra/baseten/warm.ts wake");
  process.exit(1);
}
const headers = { Authorization: `Api-Key ${key}` };
const base = (box: Box) => `https://model-${BOXES[box]}.api.baseten.co/environments/production`;
const wake = (box: Box) => fetch(`${base(box)}/wake`, { method: "POST", headers, signal: AbortSignal.timeout(10_000) });
const keyed = ((url: string, init?: RequestInit) => fetch(url, { ...init, headers: { ...init?.headers as Record<string, string>, ...headers } })) as typeof fetch;
/** 200 from the health route (a cold box holds the request open, so 5 s is enough). Laya has no reliable one, so it is asked a card, as the Worker asks it. */
const ready = (box: Box) => box === "laya"
  ? pickCard(layaEvaluator({ url: `${base(box)}/sync`, fetcher: keyed }), { request: "Brief me", patient: "Respiratory review" }).then(() => true, () => false)
  : fetch(`${base(box)}/sync/health`, { headers, signal: AbortSignal.timeout(5000) }).then(res => res.status === 200, () => false);

const names = Object.keys(BOXES) as Box[];
// A wrong key shows here, not after 45 minutes.
for (const [i, res] of (await Promise.all(names.map(wake))).entries()) {
  if (!res.ok) { console.error(`${names[i]}: wake answered ${res.status}; check BASETEN_API_KEY.`); process.exit(1); }
}
console.log(`Waking ${names.map(box => `${box} (~${COLD_START_MIN[box]} min)`).join(", ")}.`);

const started = Date.now();
for (;;) {
  // Every box, every round: one that answers is kept busy while the slowest starts, and one that slept again is re-woken.
  const up = await Promise.all(names.map(async box => (await ready(box)) || (await wake(box).catch(() => undefined), false)));
  const minutes = (Date.now() - started) / 60_000;
  console.log(`${minutes.toFixed(1).padStart(4)} min  ${names.map((box, i) => `${box} ${up[i] ? "ready" : "starting"}`).join(" · ")}`);
  if (up.every(Boolean)) break;
  if (minutes >= 45) {
    console.error("Not all ready after 45 minutes: check the starting ones' logs in Baseten.");
    process.exit(1);
  }
  await sleep(20_000);
}
console.log("All four answer. Idle boxes scale to zero after 5 minutes unless Min replicas is 1 (see this file's header).");
