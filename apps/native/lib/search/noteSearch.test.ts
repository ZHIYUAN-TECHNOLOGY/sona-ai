// Pure test for on-device note search ranking. No device, no native module.
//   npx tsx lib/search/noteSearch.test.ts

import assert from "node:assert/strict";

import { rankNotes, type SearchDoc } from "./noteSearch";

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  checks++;
};

const docs: SearchDoc[] = [
  {
    consultId: "1",
    title: "URTI follow-up",
    text: "Productive cough for 3 days with fever. Throat erythematous. Paracetamol 1g QID.",
    createdAt: 300,
    status: "signed",
  },
  {
    consultId: "2",
    title: "Cough and fever",
    text: "Dry cough, no fever now. Chest clear. Advised rest and fluids.",
    createdAt: 200,
    status: "noted",
  },
  {
    consultId: "3",
    title: "Ankle sprain review",
    text: "Twisted ankle playing football. No bony tenderness. RICE advised.",
    createdAt: 100,
    status: "complete",
  },
];

// Empty / stopword-only query → no hits.
ok(rankNotes("", docs).length === 0, "empty query returns nothing");
ok(rankNotes("the a of", docs).length === 0, "stopword-only query returns nothing");

// Term hit ranks the containing notes; unrelated note excluded.
const cough = rankNotes("cough", docs);
ok(cough.length === 2, "cough matches two notes, not the ankle one");
ok(
  cough.every((h) => h.doc.consultId !== "3"),
  "ankle note not in cough results",
);

// Title match outranks body-only match: doc 2 has "Cough" in the TITLE, doc 1 only in body.
ok(cough[0].doc.consultId === "2", "title hit ('Cough and fever') outranks body-only hit");

// Phrase in title wins big.
const phrase = rankNotes("ankle sprain", docs);
ok(phrase[0].doc.consultId === "3", "exact title phrase ranks first");

// Prefix match: "fever" query should still hit; "cough" hits "coughing"-style stems.
const feverish = rankNotes("feverish", docs);
ok(feverish.length === 0, "no stem match for unrelated 'feverish' beyond prefix rules");
const prefix = rankNotes("throat", docs);
ok(prefix.length === 1 && prefix[0].doc.consultId === "1", "body term 'throat' matches one note");

// Snippet contains context around the matched term.
ok(/throat/i.test(rankNotes("throat", docs)[0].snippet), "snippet includes the matched term");

// Multi-term coverage: both terms present scores higher than one.
const both = rankNotes("cough fever", docs);
ok(both[0].doc.consultId === "2", "note with cough+fever in title ranks first");

// A bare-draft doc (empty text) still searchable by title, snippet falls back to title.
const draftDocs: SearchDoc[] = [
  { consultId: "9", title: "Migraine review", text: "", createdAt: 50, status: "noted" },
];
const draft = rankNotes("migraine", draftDocs);
ok(draft.length === 1 && draft[0].snippet.includes("Migraine"), "empty-body doc matches by title");

// eslint-disable-next-line no-console
console.log(`noteSearch: ${checks}/${checks} checks pass`);
