/**
 * Live check of training de-identification on the PII box: 10 synthetic Malaysian snippets (Malay, Chinese and Indian
 * names, first names alone, relatives and staff, IC numbers, phones, addresses, Malay-English) through the rules alone,
 * then through the Worker's adapter (rules, then OpenMed). Prints what each leaves behind, what the leak gate would
 * block, clinical words lost, and the model's latency. Wakes the box (billed until 5 idle minutes pass).
 *
 *   BASETEN_API_KEY=... bun packages/infra/baseten/pii/check.ts
 */
import { setTimeout as sleep } from "node:timers/promises";

import { basetenModels } from "../../../api/src/baseten-models";
import { deidentifyByRules, leakGate, type KnownIdentity } from "../../../domain/src/training";

type Kind = "full name" | "first name" | "someone else" | "ic" | "phone" | "email" | "mrn" | "address";
type Snippet = { about: string; known: KnownIdentity; text: string; identity: [Kind, string][]; clinical: string[] };

// Synthetic: every person and number below is invented (the towns are real).
const SNIPPETS: Snippet[] = [
  { about: "Malay, note", known: { names: ["Nurul Aisyah binti Ahmad"], ic: "910215-14-5562", mrn: "SYN-2001" },
    text: "Nurul Aisyah binti Ahmad, 34F, IC 910215-14-5562, presented with fever for 3 days. Aisyah reports myalgia and retro-orbital pain. Husband Faizal brought her in. Plan: FBC, dengue NS1, oral rehydration.",
    identity: [["full name", "Nurul Aisyah binti Ahmad"], ["ic", "910215-14-5562"], ["first name", "Aisyah"], ["someone else", "Faizal"]], clinical: ["myalgia", "retro-orbital pain", "dengue NS1"] },
  { about: "Chinese, Manglish reply", known: { names: ["Tan Mei Ling"], phone: "+60 16-228 9014", mrn: "SYN-2002" },
    text: "Doctor, this is Mei Ling. My cough still got lah, but fever already gone. My daughter Jia Hui will bring me for review on Friday. Can call me at 016-228 9014.",
    identity: [["first name", "Mei Ling"], ["someone else", "Jia Hui"], ["phone", "016-228 9014"]], clinical: ["cough", "fever"] },
  { about: "Indian, note with address", known: { names: ["Rajesh a/l Subramaniam"], ic: "780923-08-5121", mrn: "SYN-2003" },
    text: "Mr Rajesh a/l Subramaniam, 47M, lives at No. 12, Jalan Mawar 3, Taman Sri Muda, 40400 Shah Alam, Selangor. Known T2DM on metformin 500 mg BD. Rajesh was advised to see the dietitian.",
    identity: [["full name", "Rajesh a/l Subramaniam"], ["first name", "Rajesh"], ["address", "Jalan Mawar 3"]], clinical: ["T2DM", "metformin 500 mg BD", "dietitian"] },
  { about: "Malay, Malay reply", known: { names: ["Siti Nurhaliza binti Hassan"], phone: "019-876 5432", mrn: "SYN-2004" },
    text: "Assalamualaikum doktor, saya Siti. Demam saya dah kurang tapi batuk masih ada. Anak saya Hafiz boleh hantar saya ke klinik hari Isnin. Nombor saya 019-876 5432.",
    identity: [["first name", "Siti"], ["someone else", "Hafiz"], ["phone", "019-876 5432"]], clinical: ["Demam", "batuk"] },
  { about: "Chinese, Chinese reply", known: { names: ["Lim Wei Jie", "林伟杰"], ic: "020512-14-0087", mrn: "SYN-2005" },
    text: "医生你好，我是伟杰。我的身份证号码是020512-14-0087。我住在吉隆坡蕉赖路23号。咳嗽好一点了，但是晚上还会喘。",
    identity: [["first name", "伟杰"], ["ic", "020512-14-0087"], ["address", "蕉赖路23号"]], clinical: ["咳嗽好一点了"] },
  { about: "Indian, Manglish transcript", known: { names: ["Muthu a/l Krishnan"], phone: "011-2345 6789", mrn: "SYN-2006" },
    text: "Doctor: Uncle Muthu, how's the chest pain? Patient: Aiyo doctor, still got pain lah, especially at night. My son Vikram said must come to hospital. Doctor: OK, we do an ECG first, then I'll call Dr. Wong from cardiology.",
    identity: [["first name", "Muthu"], ["someone else", "Vikram"], ["someone else", "Wong"]], clinical: ["chest pain", "ECG", "cardiology"] },
  { about: "Malay, referral", known: { names: ["Nur Farah Hanim binti Zulkifli"], ic: "990101-01-1234", mrn: "SYN-2007" },
    text: "Referral: Farah Hanim (MRN SYN-2007, IC 990101011234), 26F, G2P1 at 32 weeks with gestational diabetes. Contact farah.hanim@mail.test or her mother, Puan Rohani, at 013-778 2201. Address: Lot 5, Kampung Baru Sungai Buloh, 47000 Selangor.",
    identity: [["first name", "Farah Hanim"], ["mrn", "SYN-2007"], ["ic", "990101011234"], ["email", "farah.hanim@mail.test"], ["someone else", "Rohani"], ["phone", "013-778 2201"], ["address", "Kampung Baru Sungai Buloh"]],
    clinical: ["gestational diabetes", "32 weeks"] },
  { about: "Chinese, Malay-English ward note", known: { names: ["Wong Ah Kow"], ic: "450318-07-5011", mrn: "SYN-2008" },
    text: "Pt Ah Kow, 81M, warded for AECOPD. Pakcik masih sesak nafas, SpO2 92% on 2L. Anak perempuan, Mei Fong, minta update. IC 450318-07-5011. Plan: neb salbutamol 4-hourly, IV hydrocortisone, review esok.",
    identity: [["first name", "Ah Kow"], ["someone else", "Mei Fong"], ["ic", "450318-07-5011"]], clinical: ["AECOPD", "sesak nafas", "salbutamol", "hydrocortisone"] },
  { about: "Indian, discharge with landline", known: { names: ["Kavitha a/p Ramasamy"], phone: "+6012-887 6543", mrn: "SYN-2009" },
    text: "Kavitha, 52F, discharged well after laparoscopic cholecystectomy. Follow-up at Klinik Kesihatan Sentul in 2 weeks. Husband Ganesan is contactable at 03-4021 5566. Home: 8, Lorong Ipoh 2, Sentul, 51100 Kuala Lumpur.",
    identity: [["first name", "Kavitha"], ["someone else", "Ganesan"], ["phone", "03-4021 5566"], ["address", "Lorong Ipoh 2"]], clinical: ["laparoscopic cholecystectomy"] },
  { about: "Malay, Malay-English note", known: { names: ["Ahmad Faris bin Kamal"], ic: "870611-05-6119", mrn: "SYN-2010" },
    text: "AHMAD FARIS BIN KAMAL (SYN-2010) datang dengan sakit perut sejak semalam. Faris kata dia makan nasi lemak di gerai Kak Yah. Wife (Nadia) noted vomiting x4. Dx: acute gastroenteritis. Plan: ORS, MC 2 hari.",
    identity: [["full name", "AHMAD FARIS BIN KAMAL"], ["mrn", "SYN-2010"], ["first name", "Faris"], ["someone else", "Yah"], ["someone else", "Nadia"]], clinical: ["sakit perut", "nasi lemak", "acute gastroenteritis"] },
];

const apiKey = process.env.BASETEN_API_KEY;
if (!apiKey) {
  console.error("Usage: BASETEN_API_KEY=... bun packages/infra/baseten/pii/check.ts");
  process.exit(1);
}
const models = basetenModels({ apiKey });

// The adapter answers from the rules while the box is cold (and wakes it), so wait until the model answers.
const started = Date.now();
while ((await models.deidentify({ text: "Seen with her son Hafiz.", known: { names: [] } })).source !== "model") {
  if (Date.now() - started > 15 * 60_000) { console.error("The PII box did not answer within 15 minutes."); process.exit(1); }
  console.log(`${((Date.now() - started) / 60_000).toFixed(1)} min  waiting for the PII box…`);
  await sleep(20_000);
}

const left = (text: string, s: Snippet) => s.identity.filter(([, value]) => text.toLowerCase().includes(value.toLowerCase()));
const tally = { rules: new Map<Kind, number>(), model: new Map<Kind, number>() };
const total = new Map<Kind, number>();
const blocked = { rules: 0, model: 0 };
let lost = 0;
const ms: number[] = [];
for (const s of SNIPPETS) {
  const rules = deidentifyByRules(s.text, s.known).text;
  const t = Date.now();
  const both = await models.deidentify({ text: s.text, known: s.known });
  ms.push(Date.now() - t);
  if (both.source !== "model") console.log("  (the model did not answer this one: rules only)");
  for (const [kind] of s.identity) total.set(kind, (total.get(kind) ?? 0) + 1);
  for (const [kind] of left(rules, s)) tally.rules.set(kind, (tally.rules.get(kind) ?? 0) + 1);
  for (const [kind] of left(both.text, s)) tally.model.set(kind, (tally.model.get(kind) ?? 0) + 1);
  const gates = [leakGate(rules, s.known).kinds, leakGate(both.text, s.known).kinds];
  blocked.rules += gates[0]!.length ? 1 : 0;
  blocked.model += gates[1]!.length ? 1 : 0;
  const clinicalLost = s.clinical.filter(c => !both.text.includes(c));
  lost += clinicalLost.length;
  console.log(`\n${s.about}  (${ms.at(-1)} ms)\n  rules:         ${rules}\n  rules + model: ${both.text}`);
  console.log(`  left by rules: ${left(rules, s).map(([k, v]) => `${k} "${v}"`).join(", ") || "nothing"}${gates[0]!.length ? " (gate blocks)" : ""}`);
  console.log(`  left by both:  ${left(both.text, s).map(([k, v]) => `${k} "${v}"`).join(", ") || "nothing"}${gates[1]!.length ? " (gate blocks)" : ""}`);
  if (clinicalLost.length) console.log(`  clinical words lost: ${clinicalLost.join(", ")}`);
}

console.log("\nIdentifiers left behind (of those in the snippets):");
for (const [kind, n] of total) console.log(`  ${kind.padEnd(13)} rules ${tally.rules.get(kind) ?? 0}/${n}   rules + model ${tally.model.get(kind) ?? 0}/${n}`);
const sum = (m: Map<Kind, number>) => [...m.values()].reduce((a, b) => a + b, 0);
console.log(`  ${"all".padEnd(13)} rules ${sum(tally.rules)}/${sum(total)}   rules + model ${sum(tally.model)}/${sum(total)}`);
console.log("Addresses stay by design: the review screen has no [ADDRESS] placeholder yet (packages/api/src/pii-model.ts).");
console.log(`Samples the leak gate would block: rules ${blocked.rules}/10, rules + model ${blocked.model}/10. Clinical words lost to the model: ${lost}.`);
console.log(`Round trip through the adapter (rules, then the warm box): median ${ms.sort((a, b) => a - b)[ms.length >> 1]} ms, max ${ms.at(-1)} ms.`);
