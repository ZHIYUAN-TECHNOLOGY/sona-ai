// Pure test for the haptic moment→plan mapping. No device, no native module.
//   npx tsx lib/haptics/plan.test.ts

import assert from "node:assert/strict";

import { hapticPlan, type HapticMoment } from "./plan";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

const ALL: HapticMoment[] = [
  "recordStart", "recordStop", "redactionDone", "noteReady",
  "signSuccess", "select", "tap", "warn", "error",
];

const IMPACTS = new Set(["light", "medium", "heavy", "soft", "rigid"]);
const NOTIFIES = new Set(["success", "warning", "error"]);

// Every moment resolves to a structurally valid plan.
for (const m of ALL) {
  const p = hapticPlan(m);
  if (p.kind === "impact") ok(IMPACTS.has(p.strength), `${m}: valid impact strength`);
  else if (p.kind === "notify") ok(NOTIFIES.has(p.strength), `${m}: valid notify strength`);
  else ok(p.kind === "selection", `${m}: selection`);
}

// A few semantic expectations.
ok(hapticPlan("noteReady").kind === "notify", "noteReady notifies (success)");
ok(hapticPlan("signSuccess").kind === "notify", "signSuccess notifies");
ok(hapticPlan("select").kind === "selection", "select is a selection tick");
ok(hapticPlan("recordStart").kind === "impact", "recordStart is an impact");
ok(hapticPlan("error").kind === "notify" && hapticPlan("error").kind === "notify", "error notifies");

// eslint-disable-next-line no-console
console.log(`haptics: ${checks}/${checks} checks pass`);
