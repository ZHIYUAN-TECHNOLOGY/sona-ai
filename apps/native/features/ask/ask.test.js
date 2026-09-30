import { expect, test } from "bun:test";
import { beforeSigning, blocking, exportBlockers, matchQuestion, mostMoney, needsYou, noteNext, overdue, soonest, suggestion, toCheck, toFollowUp, toWatch, waitingLongest } from "./answers";
import { validateAskSpec } from "./catalog";
import { withSaved } from "./saved";

const parts = answer => Object.values(answer.spec.elements).filter(e => e.type !== "AskColumn");

test("every rule answer is a valid spec from the ask catalogue, empty or full", () => {
  const answers = [
    needsYou([]), needsYou([{ id: "SYN-1", title: "Daniel Rahman", detail: "Low potassium", tone: "urgent", op: "open:SYN-1" }]),
    overdue([]), overdue([{ id: "t1", patientId: "SYN-1", patientName: "Daniel", title: "Repeat K+", owner: "Nurse", due: "2026-09-28", group: "overdue" }]),
    soonest([]), soonest([{ bed: "Bed 6", name: "Amelia", status: "fit", blockers: [{ label: "GL pending" }], waitingHours: 6 }, { bed: "Bed 11", name: "Lim", status: "fit", blockers: [] }]),
    toWatch([]), toWatch([{ id: "c1", patientId: "SYN-1", name: "Siti", priority: "watch", situation: "K+ 2.9" }]),
  ];
  for (const a of answers) expect(validateAskSpec(a.spec)).not.toBeNull();
});

test("empty answers say so plainly and offer no rows or actions", () => {
  expect(parts(needsYou([])).map(p => [p.type, p.props.text])).toEqual([["AskLead", "Nobody needs you right now."]]);
  expect(parts(overdue([]))[0].props.text).toBe("Nothing is overdue or due today.");
});

test("the ward answer counts free beds and bed-hours held, and the overdue answer reviews the first overdue task", () => {
  const ward = soonest([{ bed: "Bed 6", name: "Amelia", status: "fit", blockers: [{ label: "GL pending" }], waitingHours: 6 }, { bed: "Bed 11", name: "Lim", status: "fit", blockers: [] }, { bed: "Bed 3", name: "Siti", status: "watch", blockers: [] }]);
  expect(parts(ward)[0].props.text).toBe("1 bed can free now; 1 discharge is blocked, about 6 bed-hours waiting.");
  expect(parts(ward)[1].props.rows.map(r => [r.title, r.tone])).toEqual([["Bed 11 · Lim", "good"], ["Bed 6 · Amelia", "soon"]]);
  const tasks = overdue([{ id: "t1", patientId: "SYN-1", patientName: "Daniel", title: "Repeat K+", owner: "Nurse", due: "2026-09-28", group: "overdue" }, { id: "t2", patientId: "SYN-2", patientName: "Amelia", title: "Claim", owner: "Billing", due: "Today", group: "today" }]);
  expect(parts(tasks)[0].props.text).toBe("1 task overdue, 1 due today.");
  expect(parts(tasks)[2]).toMatchObject({ type: "AskReview", props: { op: "task-done:SYN-1:t1", confirm: "Mark done" } });
});

test("a spec with an unknown part, a nested part or a code-like action is refused", () => {
  const ok = needsYou([{ id: "SYN-1", title: "Daniel", detail: "x", tone: "urgent", op: "open:SYN-1" }]).spec;
  expect(validateAskSpec({ ...ok, elements: { ...ok.elements, "needs-0": { type: "Script", props: {}, children: [] } } })).toBeNull();
  const bad = structuredClone(ok); bad.elements["needs-1"].props.rows[0].op = "javascript:alert(1)";
  expect(validateAskSpec(bad)).toBeNull();
  const nested = structuredClone(ok); nested.elements["needs-0"].children = ["needs-1"];
  expect(validateAskSpec(nested)).toBeNull();
});

test("a typed question finds this page's answer by its words", () => {
  const answers = [needsYou([]), overdue([])];
  expect(matchQuestion("who is most urgent?", answers)?.id).toBe("needs");
  expect(matchQuestion("anything late?", answers)?.id).toBe("overdue");
  expect(matchQuestion("what's the weather", answers)).toBeUndefined();
});

test("review pages: what blocks the decision comes from the page's own checks, and open findings need a decision", () => {
  const checks = [{ id: "gl", label: "Guarantee letter", status: "blocked", detail: "Not sent" }, { id: "obs", label: "Observations", status: "passed", detail: "Stable" }];
  const d = blocking("discharge", "What's still blocking discharge?", "Amelia can go home", checks);
  expect({ worth: d.worth, lead: parts(d)[0].props.text, rows: parts(d)[1].props.rows.map(r => r.title) }).toEqual({ worth: true, lead: "1 thing left before Amelia can go home; 1 of 2 checks passed.", rows: ["Guarantee letter"] });
  const clear = blocking("claim", "What's left before sending?", "the letter can go", [checks[1]]);
  expect({ worth: clear.worth, lead: parts(clear)[0].props.text }).toEqual({ worth: false, lead: "Nothing is blocking: the one check passed." });
  const x = toFollowUp([{ id: "f1", label: "9 mm nodule", status: "open" }, { id: "f2", label: "Heart size", status: "tracked" }, { id: "f3", label: "Old", status: "dismissed" }]);
  expect(parts(x)[1].props.rows.map(r => [r.title, r.tone])).toEqual([["9 mm nodule", "soon"], ["Heart size", "good"]]);
  for (const a of [d, clear, x]) expect(validateAskSpec(a.spec)).not.toBeNull();
});

test("saved views: newest first, one per answer, three at most", () => {
  const v = id => ({ id, question: id });
  const list = ["needs", "overdue", "soonest", "needs"].reduce((l, id) => withSaved(l, v(id)), []);
  expect(list.map(s => s.id)).toEqual(["needs", "soonest", "overdue"]);
  expect(withSaved(list, v("extra")).map(s => s.id)).toEqual(["extra", "needs", "soonest"]);
});

test("the dock's suggestion: the first answer worth showing, worded as its review when it has one, else none", () => {
  const late = [{ id: "t1", patientId: "SYN-1", patientName: "Daniel", title: "Repeat K+", owner: "Nurse", due: "2026-09-28", group: "overdue" }, { id: "t2", patientId: "SYN-2", patientName: "Amelia", title: "Claim", owner: "Billing", due: "2026-09-29", group: "overdue" }];
  expect(suggestion([needsYou([]), overdue(late)])).toMatchObject({ text: "Mark “Repeat K+” done", answer: { id: "overdue" } });
  // Live mode has no review card, so the suggestion stays a question.
  expect(suggestion([overdue(late, false)])?.text).toBe("What's overdue?");
  expect(suggestion([overdue([{ ...late[0], group: "today" }])])?.text).toBe("What's due today?");
  expect(suggestion([needsYou([]), overdue([])])).toBeUndefined();
});

test("queue pages: messages rank urgent first then the longest wait, and each row opens its thread", () => {
  const now = "2026-09-30T12:00:00Z";
  const threads = [
    { patientId: "p1", name: "Aina", bed: null, label: "clinical", waitingSince: "2026-09-30T09:00:00Z" },
    { patientId: "p2", name: "Ben", bed: "Bed 3", label: "urgent", reason: "Chest pain", waitingSince: "2026-09-30T11:50:00Z" },
    { patientId: "p3", name: "Chen", label: "admin", waitingSince: "2026-09-30T10:00:00Z" },
    { patientId: "p4", name: "Dina", label: "clinical", waitingSince: "2026-09-29T12:00:00Z", handled: true },
  ];
  const a = waitingLongest(threads, now);
  expect(parts(a)[0].props.text).toBe("3 patients waiting for a reply, 1 urgent; urgent first, then the longest wait.");
  expect(parts(a)[1].props.rows.map(r => [r.title, r.detail, r.tone, r.op])).toEqual([
    ["Ben · Bed 3", "Urgent · Chest pain · waiting 10 min", "urgent", "go:/inbox/p2"],
    ["Aina", "Clinical · waiting 3 h", "soon", "go:/inbox/p1"],
    ["Chen", "Admin · waiting 2 h", "calm", "go:/inbox/p3"],
  ]);
  expect(waitingLongest([], now)).toMatchObject({ worth: false });
  for (const x of [a, waitingLongest([], now)]) expect(validateAskSpec(x.spec)).not.toBeNull();
  expect(matchQuestion("who has waited longest?", [a])?.id).toBe("waiting");
});

test("queue pages: the audit ranks by money at risk, and once every query is out it suggests the next step", () => {
  const line = (id, risk) => ({ id, patient: id, bed: "", doctor: "Dr Lee", gap: "Gap", risk });
  const a = mostMoney([line("a", 500), line("b", 3050), line("c", 1200), line("d", 900)], 0);
  expect(parts(a)[0].props.text).toBe("RM 5,650 at risk across 4 notes; the top 3 hold RM 5,150.");
  expect(parts(a)[1].props.rows.map(r => [r.id, r.op])).toEqual([["b", "tab:b"], ["c", "tab:c"], ["d", "tab:d"], ["a", "tab:a"]]);
  const out = mostMoney([], 12);
  expect(parts(out).map(p => p.props.text ?? p.props.items?.[0].op)).toEqual(["Every query is out (12 sent); nothing is left at risk.", "go:/ward"]);
  for (const x of [a, out]) expect(validateAskSpec(x.spec)).not.toBeNull();
});

test("queue pages: the next export waits on approvals, and leak-blocked samples never export", () => {
  const samples = [{ id: "s1", title: "Note edit · Patient A", status: "pending" }, { id: "s2", title: "Transcript · Patient B", status: "blocked", leak: "Blocked by leak check · name found" }];
  const waiting = exportBlockers({ ready: 0, next: 2 }, samples);
  expect({ worth: waiting.worth, lead: parts(waiting)[0].props.text, rows: parts(waiting)[1].props.rows.map(r => [r.id, r.tone]) }).toEqual({
    worth: true, lead: "v2 needs approved rows: 1 sample is waiting for review. 1 sample blocked by the leak check can't export.", rows: [["s2", "urgent"], ["s1", "soon"]] });
  const ready = exportBlockers({ ready: 3, next: 2 }, [samples[0]]);
  expect({ worth: ready.worth, lead: parts(ready)[0].props.text }).toEqual({ worth: false, lead: "Nothing is blocking: 3 approved rows will export as v2; 1 more waiting for review." });
  for (const x of [waiting, ready, exportBlockers({ ready: 0, next: 1 }, [])]) expect(validateAskSpec(x.spec)).not.toBeNull();
});

test("the note says what's left before signing, then the visit's next step once saved", () => {
  const base = { drafted: true, saved: false, reviewed: false, empty: ["Plan"], unsureLines: 2, fromSample: false, plan: "", openTasks: 0 };
  const draft = beforeSigning(base);
  expect(parts(draft)[1].props.rows.map(r => r.id)).toEqual(["empty-Plan", "unsure", "save"]);
  expect(parts(draft).some(p => p.type === "AskActions")).toBe(false);
  const done = beforeSigning({ ...base, saved: true, reviewed: true, empty: [], unsureLines: 0, plan: "Repeat K+ tomorrow. Review in clinic; stop ramipril" });
  expect(parts(done).map(p => p.props.text ?? p.props.items?.[0])).toEqual(["Nothing left: the note is reviewed.", { label: "Add the plan's 3 steps as tasks", op: "go:/tasks", primary: true }]);
  expect(noteNext({ saved: true, plan: "Repeat K+", openTasks: 2 })).toEqual({ label: "Hand over", op: "go:/handover" });
  expect(noteNext({ saved: false, plan: "x", openTasks: 0 })).toBeUndefined();
  for (const x of [draft, done, beforeSigning({ ...base, drafted: false })]) expect(validateAskSpec(x.spec)).not.toBeNull();
});

test("the scan says what still needs checking: unsure words and low-confidence medicines, and what is unticked", () => {
  const a = toCheck({ unsure: ["amlodipne"], low: [{ id: "low-med:0", label: "Amlodipine 5 mg" }], off: [{ id: "task:1", label: "Repeat FBC" }] });
  expect(parts(a)[0].props.text).toBe("2 things to check before adding to the record; 1 unticked won't be added.");
  expect(parts(a)[1].props.rows.map(r => r.tone)).toEqual(["soon", "soon", "calm"]);
  const clear = toCheck({ unsure: [], low: [], off: [] });
  expect({ worth: clear.worth, lead: parts(clear)[0].props.text }).toEqual({ worth: false, lead: "Nothing left to check: every item is ticked and read clearly." });
  for (const x of [a, clear]) expect(validateAskSpec(x.spec)).not.toBeNull();
});

test("handover watch rows are amber, like the Watch chip", () => {
  expect(parts(toWatch([{ id: "c1", name: "Siti", priority: "watch", situation: "K+ 2.9" }]))[1].props.rows[0].tone).toBe("soon");
});
