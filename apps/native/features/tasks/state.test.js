import { describe, expect, it } from "bun:test";
import { createTaskOnce, mentionQuery, parseDuePhrase, taskDraftErrors, taskProposal } from "./state";

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
