import { describe, expect, it } from "bun:test";
import { changeReceipt, createTaskOnce, dueRuler, friendlyDate, mentionQuery, parseDuePhrase, taskDraftErrors, taskProposal } from "./state";

const emptyEncounter = () => ({ revision: 1, cards: [], requests: [], note: "", noteReviewed: false, transcript: [], recording: "idle", recordingSeconds: 0, language: "english", tasks: [] });
const draft = { operationId: "task-operation-1", title: "Follow-up review", owner: "Demo clinician", due: "2026-09-30" };

describe("follow-up action state", () => {
  it("keeps a single receipt when a create request is retried", () => {
    const created = createTaskOnce(emptyEncounter(), draft);
    const retry = createTaskOnce(created, draft);
    expect(retry).toBe(created);
    expect(retry.tasks).toHaveLength(1);
    expect(retry.tasks[0]?.id).toBe(draft.operationId);
  });
  it("does not silently invent missing ownership or dates", () => {
    const empty = emptyEncounter();
    expect(createTaskOnce(empty, { ...draft, owner: " " })).toBe(empty);
    expect(createTaskOnce(empty, { ...draft, due: "" })).toBe(empty);
    expect(taskDraftErrors({ ...draft, title: " " })).toContain("Add a task title.");
  });
  it("rejects dates normalized by JavaScript into another month", () => {
    expect(taskDraftErrors({ ...draft, due: "2026-02-30" })).toContain("Choose a valid due date.");
  });
  it("a retry cannot undo a later completion", () => {
    const created = createTaskOnce(emptyEncounter(), draft);
    const completed = { ...created, tasks: created.tasks.map(task => ({ ...task, completed: true })) };
    expect(createTaskOnce(completed, draft).tasks[0]?.completed).toBe(true);
  });
  it("retains the originating source and who supplied the saved details", () => {
    const sourced = { ...draft, sourceId: "history", sourceRevision: 3, provenance: "clinician" };
    const receipt = createTaskOnce(emptyEncounter(), sourced).tasks[0];
    expect(receipt.sourceId).toBe("history");
    expect(receipt.sourceRevision).toBe(3);
    expect(receipt.provenance).toBe("clinician");
  });
  it("proposes the saved clinical plan and retains its source after later edits", () => {
    const source = { id: "clinical-note", title: "Clinical note", date: "Today", kind: "record", synthetic: true, excerpt: "Plan: review symptoms at follow-up." };
    const encounter = { ...emptyEncounter(), noteSections: { plan: "Review symptoms at follow-up." } };
    const proposal = taskProposal(encounter, { sources: [source] });
    expect(proposal.title).toBe("Review symptoms at follow-up.");
    expect(proposal.provenance).toBe("clinician");
    const receipt = createTaskOnce(encounter, { ...draft, ...proposal }).tasks[0];
    source.excerpt = "Later edited note";
    expect(receipt.sourceSnapshot.excerpt).toBe("Plan: review symptoms at follow-up.");
  });
  it("uses an available plan draft, bounds its title, and does not invent absent sources", () => {
    const proposal = taskProposal({ ...emptyEncounter(), noteSectionDraft: { plan: "A".repeat(280) } }, { sources: [] });
    expect(proposal.title).toHaveLength(240);
    expect(proposal.sourceId).toBe("clinical-note");
    expect(proposal.sourceSnapshot).toBeUndefined();
  });
  it("does not promote an empty or placeholder plan to a clinician task", () => {
    for (const plan of ["", "To be completed by the clinician."]) {
      const proposal = taskProposal({ ...emptyEncounter(), noteSections: { plan: "Superseded plan" }, noteSectionDraft: { plan } }, { sources: [] });
      expect(proposal.title).toBe("Arrange a follow-up review");
      expect(proposal.provenance).toBe("fixture");
    }
  });
});

describe("inline task parsing", () => {
  const thursday = new Date(2026, 8, 24);
  it("reads a due-date phrase at the end of the sentence", () => {
    expect(parseDuePhrase("Review bloods tomorrow", thursday)).toEqual({ phrase: "tomorrow", due: "2026-09-25" });
    expect(parseDuePhrase("Repeat X-ray in 2 weeks", thursday)).toEqual({ phrase: "in 2 weeks", due: "2026-10-08" });
    expect(parseDuePhrase("Call back 10d", thursday)).toEqual({ phrase: "10d", due: "2026-10-04" });
    expect(parseDuePhrase("Clinic review mon", thursday)).toEqual({ phrase: "mon", due: "2026-09-28" });
    expect(parseDuePhrase("Clinic review next thursday", thursday)?.due).toBe("2026-10-01");
  });
  it("ignores words that only look like dates", () => {
    expect(parseDuePhrase("Monitor saturation", thursday)).toBeUndefined();
    expect(parseDuePhrase("Check the months", thursday)).toBeUndefined();
    expect(parseDuePhrase("Arrange a follow-up review", thursday)).toBeUndefined();
    expect(parseDuePhrase("Review in 0 days", thursday)).toBeUndefined();
  });
  it("finds the owner being mentioned", () => {
    expect(mentionQuery("Review bloods @nur")).toBe("nur");
    expect(mentionQuery("Review bloods @")).toBe("");
    expect(mentionQuery("email@host")).toBeUndefined();
    expect(mentionQuery("Review @nurse today")).toBeUndefined();
  });
});

describe("friendlyDate", () => {
  const today = new Date(2026, 8, 29);
  it("reads the composer's dates and keeps the words other flows write", () => {
    expect(friendlyDate("2026-09-29", today)).toBe("Today");
    expect(friendlyDate("2026-09-30", today)).toBe("Tomorrow");
    expect(friendlyDate("2026-10-13", today)).toBe("Tue 13 Oct");
    expect(friendlyDate("13 Oct", today)).toBe("13 Oct");
    expect(friendlyDate("Today", today)).toBe("Today");
    expect(friendlyDate("", today)).toBe("");
  });
});

it("says what changed and when after a task is reassigned or redated", () => {
  const at = new Date(2026, 8, 29, 14, 5);
  expect(changeReceipt({ owner: "Pharmacist" }, at)).toBe("Reassigned to Pharmacist · 14:05");
  expect(changeReceipt({ due: "2026-09-30" }, at)).toBe("Due tomorrow · 14:05");
  expect(changeReceipt({ due: "2026-10-02" }, at)).toBe("Due Fri 2 Oct · 14:05");
  expect(changeReceipt({ owner: "Clinic nurse", due: "2026-09-29" }, new Date(2026, 8, 29, 9, 0))).toBe("Reassigned to Clinic nurse · Due today · 09:00");
});

it("the due-date ruler saves once per drag, when the finger lifts, and never an unchanged day", () => {
  const today = new Date(2026, 9, 1, 9, 0), saves = [];
  const ruler = dueRuler("2026-10-01", 12, due => saves.push(due), today);
  // Placing the ruler on open (a scroll nobody dragged) saves nothing, even for an overdue task it parks on today.
  dueRuler("2026-09-28", 12, due => saves.push(due), today).settle(0);
  expect(saves).toEqual([]);
  // A flick: one save at lift, at the tick it will rest on (forward takes the next tick); its settle there adds none.
  ruler.drag(); ruler.release(5.2 * 12, 0.8); ruler.settle(6 * 12);
  expect(saves).toEqual(["2026-10-07"]);
  // Moving back takes the previous tick; still, the nearest. Dragging back to the saved day saves nothing.
  ruler.drag(); ruler.release(3.6 * 12, -0.4); ruler.settle(3 * 12);
  ruler.drag(); ruler.release(3.4 * 12, 0); ruler.settle(3 * 12);
  expect(saves).toEqual(["2026-10-07", "2026-10-04"]);
  // Where it settles corrects the lift only if they differ.
  ruler.drag(); ruler.release(9 * 12, 0); ruler.settle(10 * 12);
  expect(saves.slice(2)).toEqual(["2026-10-10", "2026-10-11"]);
  // The server's copy arriving is the new saved day; a tapped interval or picked date saves at once, unchanged ones never.
  ruler.sync("2026-10-15"); ruler.jump(14); ruler.jump(28); ruler.jump(28);
  expect(saves.slice(4)).toEqual(["2026-10-29"]);
});
