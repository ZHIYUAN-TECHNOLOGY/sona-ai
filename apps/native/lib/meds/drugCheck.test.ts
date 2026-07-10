// Pure test for the medication-safety checker. No device.
//   npx tsx lib/meds/drugCheck.test.ts

import assert from "node:assert/strict";

import { checkOrders, drugsInText, type DrugEntry, type Interaction } from "./drugCheck";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

const drugs: DrugEntry[] = [
  { name: "paracetamol", aliases: ["acetaminophen", "pcm"], maxDoseAdult: "4 g/day", note: "hepatotoxic in overdose", source: "BNF" },
  { name: "ibuprofen", aliases: ["brufen"], klass: "nsaid", note: "GI/renal caution", source: "BNF" },
  { name: "warfarin", aliases: [], klass: "anticoagulant", source: "BNF" },
  { name: "amoxicillin", aliases: [], source: "BNF" },
];

const interactions: Interaction[] = [
  { a: "warfarin", b: "nsaid", severity: "severe", risk: "Increased bleeding risk", source: "Stockley's" },
];

// --- drugsInText ----------------------------------------------------------
ok(drugsInText("Paracetamol 1g QDS", drugs)[0]?.name === "paracetamol", "matches by name, case-insensitive");
ok(drugsInText("PCM and brufen", drugs).map((d) => d.name).sort().join(",") === "ibuprofen,paracetamol", "matches by aliases");
ok(drugsInText("Advised rest and fluids", drugs).length === 0, "no drug → none");
ok(drugsInText("paracetamolic acid", drugs).length === 0, "whole-word only (no substring match)");

// --- checkOrders: interaction spanning two order lines --------------------
{
  const flags = checkOrders([{ text: "Warfarin 5mg OD" }, { text: "Ibuprofen 400mg TDS PRN" }], drugs, interactions);
  const severe = flags.filter((f) => f.severity === "severe");
  ok(severe.length === 1 && /bleeding/i.test(severe[0].message), "warfarin + NSAID → severe interaction (class match)");
  ok(flags[0].severity === "severe", "most-severe flag sorted first");
}

// --- checkOrders: single-drug caution (info) ------------------------------
{
  const flags = checkOrders([{ text: "Paracetamol 1g QDS" }], drugs, interactions);
  ok(flags.length === 1 && flags[0].severity === "info", "lone paracetamol → info reminder only");
  ok(flags[0].message.includes("max 4 g/day"), "info reminder includes the max dose");
}

// --- no false interaction when only one side present ----------------------
{
  const flags = checkOrders([{ text: "Amoxicillin 500mg TDS" }], drugs, interactions);
  ok(!flags.some((f) => f.severity === "severe"), "no interaction when only one drug present");
}

// --- same drug can't interact with itself ---------------------------------
{
  const selfInt: Interaction[] = [{ a: "nsaid", b: "ibuprofen", severity: "moderate", risk: "x", source: "y" }];
  const flags = checkOrders([{ text: "Ibuprofen 400mg" }], drugs, selfInt);
  ok(!flags.some((f) => f.severity === "moderate"), "one drug matching both sides is not an interaction");
}

// eslint-disable-next-line no-console
console.log(`drugCheck: ${checks}/${checks} checks pass`);
