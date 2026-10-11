import type { AnswerCard, Mark } from "@sona-ai/domain/answer-parts";

/**
 * SYNTHETIC answers, as care.ask would send them, that between them carry every mark kind, every card and every action
 * Sona Care shows: for the preview screen (app/answer-preview, dev builds), which renders them with no server, and for
 * the tests. Invented values for the demo patient; the doctors are the directory's synthetic ones.
 */
export type SampleAnswer = { question: string; answer: string; source: string; marks: Mark[]; cards: AnswerCard[] };

export const SAMPLE_ANSWERS: SampleAnswer[] = [
  {
    question: "How do I take my azithromycin?",
    answer: "Take azithromycin 1 tablet once a day for 2 more days, with or without food. Your chest infection is getting better, and the cough can last a few weeks. Call 999 if you have chest pain or trouble breathing.",
    source: "From your record · medicines",
    marks: [
      { text: "azithromycin", kind: "medicine" }, { text: "1 tablet", kind: "dose" }, { text: "once a day", kind: "dose" }, { text: "for 2 more days", kind: "dose" },
      { text: "chest infection", kind: "condition" }, { text: "cough", kind: "symptom" }, { text: "Call 999", kind: "warning" }, { text: "chest pain", kind: "warning" }, { text: "trouble breathing", kind: "warning" },
    ],
    cards: [
      { type: "medicine", name: "Azithromycin", dose: "1 tablet", times: ["08:00"], how: "With or without food", note: "2 more days", source: "Your discharge plan" },
      { type: "steps", title: "While you recover", items: ["Rest, and drink plenty of water", "Finish the azithromycin, even if you feel better", "Use your own inhaler when you need it"] },
      { type: "warning", level: "soon", title: "Tell your care team if", items: ["Your fever comes back", "You cough up green or bloody phlegm"] },
    ],
  },
  {
    question: "Is my potassium OK now?",
    answer: "Your potassium was 3.1 mmol/L on Friday, a little low, and it has not been checked again yet. Your blood pressure this morning, 128/82 mmHg, is normal. Shall I add tonight's reading?",
    source: "From your record · results",
    marks: [{ text: "potassium was 3.1 mmol/L", kind: "test" }, { text: "a little low", kind: "caution" }, { text: "has not been checked again yet", kind: "caution" }, { text: "blood pressure this morning, 128/82 mmHg", kind: "test" }],
    cards: [
      { type: "result", test: "Potassium", value: "3.1", unit: "mmol/L", flag: "low", range: "3.5 to 5.1 mmol/L", at: "2026-10-09T01:30:00.000Z", source: "Lab result" },
      { type: "reading", label: "Blood pressure", value: "128/82", unit: "mmHg", flag: "normal", at: "2026-10-11T00:15:00.000Z" },
      { type: "action", do: "logReading", title: "Log blood pressure 124/80 mmHg", items: ["Tonight, 9:00 PM"], what: "It goes on your chart, and your care team sees it at your next visit.", confirm: "Save reading", done: "Saved to your chart", payload: { kind: "blood_pressure", value: 124, value2: 80, takenAt: "2026-10-11T13:00:00.000Z" } },
    ],
  },
  {
    question: "When is my next visit?",
    answer: "Your clinic review is on Saturday, 24 October at 10:00 AM in Clinic 3B. Your request to see Dr. Aisyah Rahman is still waiting for the care team. Dr. Lim Wei Jie has a free slot on Thursday.",
    source: "From your record · visits",
    marks: [{ text: "clinic review", kind: "dose" }, { text: "Saturday, 24 October at 10:00 AM", kind: "dose" }, { text: "still waiting for the care team", kind: "caution" }, { text: "Thursday", kind: "dose" }],
    cards: [
      { type: "appointment", title: "Clinic review", when: "2026-10-24T02:00:00.000Z", where: "Clinic 3B, Level 3", status: "upcoming" },
      { type: "appointment", title: "Dr. Aisyah Rahman · Cardiology", when: "2026-10-14T03:00:00.000Z", where: "Heart Centre, Level 2", status: "requested" },
      { type: "appointment", title: "Day 2 check-in", when: "2026-10-10T01:00:00.000Z", status: "missed" },
      { type: "doctor", id: "lim", name: "Dr. Lim Wei Jie", specialty: "Respiratory", room: "Clinic 3B, Level 3", rating: 4.8, careTeam: true },
      { type: "action", do: "book", title: "Book Dr. Lim Wei Jie", items: ["Thursday 15 Oct, 9:00 AM", "Clinic 3B, Level 3"], what: "Your care team confirms the time, usually within a day.", confirm: "Send request", done: "Requested · your care team will confirm", payload: { doctorId: "lim", startsAt: "2026-10-15T01:00:00.000Z", reason: "Follow-up after pneumonia" } },
    ],
  },
  {
    question: "I took my 8 AM azithromycin",
    answer: "Well done. Shall I log your 8:00 AM azithromycin as taken? Your next dose is tomorrow at 8:00 AM.",
    source: "From your record · doses",
    marks: [{ text: "8:00 AM", kind: "dose" }, { text: "azithromycin", kind: "medicine" }, { text: "tomorrow at 8:00 AM", kind: "dose" }],
    cards: [
      { type: "action", do: "logDose", title: "Azithromycin 1 tablet, 8:00 AM", what: "It shows as taken on your dose screen.", confirm: "Log as taken", done: "Logged as taken", payload: { key: "Azithromycin@2026-10-11T00:00:00.000Z" } },
    ],
  },
  {
    question: "I feel dizzy and my lips look a bit blue",
    answer: "Feeling dizzy with blue lips can mean you are not getting enough oxygen. Call 999 now. I've drafted a message so your care team knows too.",
    source: "General answer · not from your records",
    marks: [{ text: "dizzy", kind: "symptom" }, { text: "blue lips", kind: "warning" }, { text: "not getting enough oxygen", kind: "warning" }, { text: "Call 999 now", kind: "warning" }],
    cards: [
      { type: "warning", level: "urgent", title: "Call 999 if you have", items: ["Blue lips or face", "Trouble breathing", "Chest pain"] },
      { type: "warning", level: "info", title: "Good to know", items: ["Sit or lie down until the dizziness passes"] },
      { type: "action", do: "tellCareTeam", title: "Message to your care team", items: ["\"I feel dizzy and my lips look a bit blue.\""], what: "Your care team sees it now, and replies here.", confirm: "Send to my care team", done: "Sent · your care team has it", payload: { text: "I feel dizzy and my lips look a bit blue." } },
    ],
  },
];
