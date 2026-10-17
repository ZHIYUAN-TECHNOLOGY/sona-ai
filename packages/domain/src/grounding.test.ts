import { expect, test } from "bun:test";
import { NOT_FOUND, grounded, groundsOf, sentencesOf, unsupported, type Reason } from "./grounding";

// A fictional patient's record in the shape recordText gives the model (packages/api/src/routers/care-plan.ts):
// pneumonia, penicillin allergy, azithromycin until 6 Oct 2026, cetirizine at night, clinic review Thu 8 Oct 2026 10:30.
const RECORD = `Discharged: 2026-10-03T02:00:00.000Z
Medicines:
- Azithromycin (changed): 500 mg once a day, until 5 days in all are finished; 1 tablet, with or without food; last dose Tue, 06 Oct 2026
- Paracetamol (new): For pain or fever: 1 g every 6 hours if you need it, no more than 4 g a day
- Cetirizine (continue): 10 mg at night; 1 tablet at night
Come back or call if:
- Your breathing gets harder or faster
- Your fever comes back
- Chest pain or fainting: call 999
Follow-up: Clinic review on Thu Oct 08 2026
Check-ins: day 2 and day 7 after discharge
Leaflet (English):
You were treated for pneumonia. Finish the azithromycin even if you feel better. Rest and drink plenty of fluids.
Now: Mon, 05 Oct 2026 09:15 (Malaysia time)
Visits booked:
- Clinic review: Thu, 08 Oct 2026 10:30 (coming up)
Visits requested, waiting for the care team to confirm:
- none
Recorded by the hospital:
Age 42, female. Came in with: Cough for five days, with fever since yesterday.
History: Asthma since childhood
Allergies: Penicillin — reported rash
Medicines before admission: Salbutamol inhaler, as needed; Cetirizine 10 mg at night
Observations (latest of each): Temperature 37.2 °C (Fri, 02 Oct 2026) · Pulse 88 bpm (Fri, 02 Oct 2026) · Systolic 118 mmHg (Fri, 02 Oct 2026) · Oxygen saturation 97 % (Fri, 02 Oct 2026)
Results:
- Sodium 132 mmol/L, low (Fri, 02 Oct 2026)
- CRP 48 mg/L, high (Wed, 30 Sep 2026)
Doctor's note (saved Fri, 02 Oct 2026):
Community-acquired pneumonia, mild; CURB-65 0. Oral azithromycin 500 mg daily to complete 5 days.
Check-in replies:
- Day 2 check-in, Mon, 05 Oct 2026: "Batuk kurang, tiada demam" (read as better)
Doses since going home: 2 of 3 due marked taken; not marked taken: Cetirizine Sun, 04 Oct 2026 21:00`;

// Hospital leaflet text the model was also given.
const PASSAGES = [
  "Paracetamol: adults may take 500 mg to 1 g every 4 to 6 hours, no more than 4 g in 24 hours.",
  "Respiratory clinic, Level 2: open Monday to Friday, 08:00 to 17:00. A normal sodium is 135 to 145 mmol/L.",
  "阿奇霉素（Azithromycin）是一种抗生素，请按医嘱服完整个疗程。",
];
const g = groundsOf(RECORD, PASSAGES);

// Each sentence, and why it is removed ("" when it is kept).
const CASES: [sentence: string, removed: Reason | ""][] = [
  // English: her own facts, in the formats a model writes them.
  ["Your azithromycin is 500 mg once a day.", ""],
  ["Take your azithromycin 500mg, 1 tablet daily.", ""],
  ["Your last dose of azithromycin is on Tuesday 6 October.", ""],
  ["You have 2 more days of azithromycin.", ""], // today (5 Oct) and the last dose (6 Oct)
  ["Your clinic review is on Thursday 8 Oct at 10:30 am.", ""],
  ["Your appointment is on 08/10/2026 at 10.30 a.m.", ""],
  ["Your follow-up is booked for October 8th, 2026.", ""],
  ["Your sodium was 132 mmol/L, which is a little low.", ""],
  ["Your temperature was 37.2 and your pulse was 88.", ""],
  ["Your oxygen saturation was 97% and your CRP was 48 mg/L.", ""],
  ["You can take paracetamol 1000 mg every 6 hours if you need it.", ""], // the record's "1 g"
  ["Your cetirizine is 10 mg at night.", ""],
  ["You may take 1 tablet of your cetirizine at night.", ""], // "may 1" is not the first of May
  ["You are allergic to penicillin, so tell any doctor before they give you an antibiotic.", ""],
  // English: invented.
  ["Your potassium was 3.1 mmol/L.", "result"],
  ["Your sodium was 128 mmol/L.", "result"],
  ["Sodium was 128 on the last test.", "result"], // no "your": a named result with a value is still hers
  ["Your temperature was 39.4°C this morning.", "result"],
  ["Take your azithromycin 250 mg once a day.", "dose"],
  ["Your azithromycin dose is 10 mg.", "dose"], // cetirizine's 10 mg does not vouch for azithromycin
  ["Take 2 tablets of your cetirizine at night.", "dose"],
  ["Take your azithromycin 500 mg twice a day.", "frequency"], // right medicine, wrong frequency: removed
  ["Take your azithromycin for 10 more days.", "duration"],
  ["Keep taking your amoxicillin.", "medicine"],
  ["Your next appointment is on 12 Oct at 2 pm.", "date"],
  ["Your appointment is on 6 Oct.", "date"], // her last-dose day is not a visit
  ["Your clinic review is on Friday.", "date"],
  ["Your clinic review is on Thursday at 3 pm.", "time"],
  // English: general advice, generic numbers.
  ["Most adults need 7 to 9 hours of sleep.", ""],
  ["Drink about 8 glasses of water a day.", ""],
  ["In 2 to 3 weeks most people recover from pneumonia.", ""],
  ["Paracetamol can help with fever.", ""],
  ["Ibuprofen is another medicine that lowers a fever.", ""],
  ["A normal sodium is 135 to 145 mmol/L.", ""],
  ["A fever is a temperature of 38°C or higher.", ""],
  ["Adults usually take paracetamol 500 mg to 1 g every 4 to 6 hours.", ""],
  // English: safety is never removed.
  ["If your breathing gets worse, call 999.", ""],
  ["Your potassium was 3.1, so call 999 now if you feel faint.", ""],
  ["Go to the emergency department immediately if your temperature goes above 39°C.", ""],

  // Malay.
  ["Azithromycin anda ialah 500 mg sekali sehari.", ""],
  ["Azitromisin anda ialah 500 mg sekali sehari.", ""], // the Malay spelling of the record's name
  ["Temu janji anda pada 8 Oktober 2026, pukul 10.30 pagi.", ""],
  ["Temu janji anda pada hari Khamis, 8hb Oktober.", ""],
  ["Natrium anda ialah 132 mmol/L.", ""],
  ["Ambil cetirizine anda 1 biji pada waktu malam.", ""],
  ["Kalium anda ialah 3.1 mmol/L.", "result"],
  ["Suhu anda ialah 39.5.", "result"],
  ["Ambil azithromycin anda dua kali sehari.", "frequency"],
  ["Ambil azitromisin anda 250 mg sekali sehari.", "dose"],
  ["Temu janji anda pada 15 Okt pukul 2 petang.", "date"],
  ["Ubat amoxicillin anda perlu dihabiskan.", "medicine"],
  ["Minum 8 gelas air sehari dan tidur 7 hingga 9 jam.", ""],
  ["Kebanyakan orang pulih dalam 2 hingga 3 minggu.", ""],
  ["Jika sesak nafas, hubungi 999 segera.", ""],
  // Malay mixed with English.
  ["Your next appointment pada hari Khamis, 8 Okt pukul 10.30 pagi kat klinik.", ""],
  ["Ubat you azithromycin 500 mg, makan once a day je.", ""],
  ["Sodium you 125 je, low sikit.", "result"],
  ["Appointment you 9 Okt, pukul 3 petang.", "date"],

  // Chinese: full-width digits, 毫克, Chinese numerals.
  ["您的阿奇霉素每天一次，每次５００毫克。", ""], // the name is in a passage
  ["您的复诊时间是10月8日上午10点30分。", ""],
  ["您的预约在二〇二六年十月八日，星期四，上午十点半。", ""],
  ["您的钠是132。", ""],
  ["您的体温是37.2度。", ""],
  ["您对青霉素过敏。", ""],
  ["您的钾是3.1。", "result"],
  ["您的体温是39度。", "result"],
  ["您的阿奇霉素每次２５０毫克。", "dose"],
  ["你的阿奇霉素每天两次。", "frequency"],
  ["您的预约在10月9日下午两点。", "date"],
  ["您的西替利嗪每晚一片。", "medicine"], // a Chinese name neither the record nor a passage holds
  ["一般成人每晚需要7到9小时的睡眠。", ""],
  ["多喝一点水，每天8杯左右。", ""],
  ["布洛芬可以帮助退烧。", ""],
  ["发烧是指体温达到38度或以上。", ""],
  ["如果体温超过38度，请立即就医。", ""],
];

test.each(CASES)("%s", (sentence, removed) => {
  expect(unsupported(sentence, g)?.reason ?? "").toBe(removed);
});

test("the table covers three languages and at least 40 sentences", () => {
  expect(CASES.length).toBeGreaterThanOrEqual(40);
});

test("a general answer passes untouched: today's regression", () => {
  const answer = "请多喝水并休息。保持环境空气清新对康复有帮助。如有呼吸困难请立即就医。";
  expect(grounded(answer, g, "zh")).toEqual({ text: answer, kept: answer, removed: [], changed: false });
  const english = "Rest, and drink plenty of water: about 8 glasses a day.\n\n1. Sleep 7 to 9 hours.\n2. Call 999 if you cannot breathe.";
  expect(grounded(english, g).text).toBe(english);
  // With no record at all, general advice still passes.
  expect(grounded(english, groundsOf("")).changed).toBe(false);
});

test("an invented sentence is taken out, the rest is kept, and the answer says so once", () => {
  const out = grounded("Your sodium was 132 mmol/L. Your potassium was 3.1 mmol/L. Your next appointment is on 12 Oct. Rest and drink water.", g);
  expect(out.kept).toBe("Your sodium was 132 mmol/L. Rest and drink water.");
  expect(out.text).toBe(`Your sodium was 132 mmol/L. Rest and drink water. ${NOT_FOUND.en}`);
  expect(out.removed).toEqual([
    { sentence: "Your potassium was 3.1 mmol/L.", reason: "result", fact: "3.1 mmol/l" },
    { sentence: "Your next appointment is on 12 Oct.", reason: "date", fact: "12 oct" },
  ]);
  expect(out.changed).toBe(true);
});

test("an answer with every sentence removed is only the truthful line, in her language", () => {
  expect(grounded("Kalium anda ialah 3.1 mmol/L. Temu janji anda pada 15 Okt.", g, "ms")).toMatchObject({ text: NOT_FOUND.ms, kept: "", changed: true });
  expect(grounded("您的钾是3.1。您的预约在10月9日。", g, "zh").text).toBe(NOT_FOUND.zh);
  expect(grounded("您的钠是132。您的钾是3.1。", g, "zh").text).toBe(`您的钠是132。${NOT_FOUND.zh}`);
});

test("a call judges each sentence as it arrives, and says the line once at the end", () => {
  const spoken: string[] = [];
  let removed = false;
  for (const sentence of ["Your review is on Thursday at 10:30.", "Your potassium was 3.1.", "Take your azithromycin 250 mg.", "Call 999 if you cannot breathe."]) {
    if (unsupported(sentence, g)) removed = true;
    else spoken.push(sentence);
  }
  if (removed) spoken.push(NOT_FOUND.en);
  expect(spoken).toEqual(["Your review is on Thursday at 10:30.", "Call 999 if you cannot breathe.", NOT_FOUND.en]);
});

test("a passage supports a general statement, never her own results or appointments", () => {
  expect(unsupported("The respiratory clinic opens at 8:00.", g)).toBeUndefined();
  expect(unsupported("The clinic is open Monday to Friday.", g)).toBeUndefined();
  expect(unsupported("The respiratory clinic opens at 8:00.", groundsOf(RECORD))).toEqual({ reason: "time", fact: "8:00" });
  expect(unsupported("Your appointment is at 8:00.", g)?.reason).toBe("time");
  // 135 is in the leaflet's normal range, not in her results.
  expect(unsupported("Your sodium was 135 mmol/L.", g)?.reason).toBe("result");
  // A dose for a medicine that is not hers can come from a passage; one for hers only from her own lines.
  expect(unsupported("You can take ibuprofen 400 mg.", g)?.reason).toBe("dose");
  expect(unsupported("You can take ibuprofen 400 mg.", groundsOf(RECORD, ["Ibuprofen 400 mg with food."]))).toBeUndefined();
  expect(unsupported("Take your azithromycin 250 mg.", groundsOf(RECORD, ["Azithromycin 250 mg tablets."]))?.reason).toBe("dose");
});

test("a frequency is removed only when her record says another; when it says none, it is kept", () => {
  expect(unsupported("Use your salbutamol twice a day.", g)).toBeUndefined(); // the record says only "as needed"
  expect(unsupported("Take your paracetamol 4 times a day.", g)).toBeUndefined(); // every 6 hours
  expect(unsupported("Take your cetirizine twice a day.", g)?.reason).toBe("frequency");
});

test("sentences split on English and Chinese stops, not inside a number, a time or a numbered list", () => {
  expect(sentencesOf("Your sodium was 3.1 mmol/L. Come at 10.30 a.m. on Thursday! 好的。请休息")).toEqual(["Your sodium was 3.1 mmol/L.", " Come at 10.30 a.m. on Thursday!", " 好的。", "请休息"]);
  expect(sentencesOf("1. Rest.\n2. Drink water.")).toEqual(["1. Rest.\n", "2. Drink water."]);
});
