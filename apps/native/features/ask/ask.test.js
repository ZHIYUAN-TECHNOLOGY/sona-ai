import { expect, test } from "bun:test";
import { blocking, matchQuestion, needsYou, overdue, soonest, suggestion, toFollowUp, toWatch } from "./answers";
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
