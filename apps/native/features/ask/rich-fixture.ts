/**
 * Two ask.free answers as a new server sends them (docs/answer-parts.md): a lead with a mark of every kind, and between
 * them a card of every kind, so the preview (/answer-preview) shows each and the tests check each against the contract.
 * At most six cards ride on one answer, hence two. Synthetic patient; the doctor card is Sona Care's and Pro leaves it out.
 */
export const RICH_ANSWERS = [
  {
    question: "How is Daniel's potassium?",
    lead: "Daniel Rahman's potassium is low at 3.1 mmol/L on furosemide 40 mg twice daily; recheck the U&E tomorrow morning. Hypokalaemia can cause palpitations, and his ECG is still pending.",
    marks: [
      { text: "low at 3.1 mmol/L", kind: "warning" }, { text: "furosemide", kind: "medicine" }, { text: "40 mg twice daily", kind: "dose" },
      { text: "U&E", kind: "test" }, { text: "tomorrow morning", kind: "dose" }, { text: "Hypokalaemia", kind: "condition" },
      { text: "palpitations", kind: "symptom" }, { text: "ECG is still pending", kind: "caution" },
    ],
    cards: [
      { type: "result", test: "Potassium", value: "3.1", unit: "mmol/L", flag: "low", range: "3.5 to 5.1 mmol/L", at: "2026-10-11T00:30:00.000Z", source: "Lab result" },
      { type: "reading", label: "Heart rate", value: "112", unit: "/min", flag: "high", at: "2026-10-11T01:10:00.000Z" },
      { type: "medicine", name: "Furosemide", dose: "40 mg", times: ["08:00", "20:00"], how: "By mouth", note: "Review if potassium stays low", source: "Prescription" },
      { type: "warning", level: "urgent", title: "Call the medical officer now if", items: ["Heart rate above 120 or new palpitations", "Potassium below 3.0 mmol/L on recheck"] },
      { type: "steps", title: "Replacing potassium", items: ["Oral potassium chloride 600 mg three times daily", "Recheck U&E tomorrow 06:00", "Continue cardiac monitoring until it is above 3.5"] },
      {
        type: "action", do: "createTask", title: "Recheck U&E tomorrow 06:00", items: ["Daniel Rahman · Bed 6", "Owner: Night nurse", "Due Mon 12 Oct"],
        what: "Adds it to this visit's follow-up tasks; the night nurse sees it on Tasks.", confirm: "Add task", done: "Task added: Recheck U&E tomorrow 06:00",
        payload: { encounterId: "ENC-PREVIEW", title: "Recheck U&E tomorrow 06:00", owner: "Night nurse", due: "2026-10-12" },
      },
    ],
  },
  {
    question: "What's next for Siti?",
    lead: "Siti Aminah's sodium is critical at 118 mmol/L; her renal clinic review is requested for Thursday.",
    marks: [{ text: "critical at 118 mmol/L", kind: "warning" }, { text: "renal clinic review", kind: "caution" }],
    cards: [
      { type: "result", test: "Sodium", value: "118", unit: "mmol/L", flag: "critical", range: "135 to 145 mmol/L", at: "2026-10-11T02:05:00.000Z", source: "Lab result" },
      { type: "appointment", title: "Renal clinic review", when: "2026-10-15T02:00:00.000Z", where: "Clinic 3, Level 2", status: "requested" },
      { type: "appointment", title: "Diabetes clinic", when: "2026-10-20T06:30:00.000Z", status: "confirmed" },
      { type: "warning", level: "soon", title: "Before discharge", items: ["Sodium above 125 mmol/L on two checks", "Fluid restriction explained to her family"] },
      { type: "warning", level: "info", title: "Her home readings are synced from Sona Care", items: [] },
      { type: "doctor", id: "doc-lim", name: "Dr Lim Wei Ming", specialty: "Nephrology", room: "Clinic 3, Level 2", rating: 4.8 },
    ],
  },
] as const;
