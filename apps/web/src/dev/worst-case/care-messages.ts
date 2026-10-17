import { fixture, rows } from "./fixture";

// Sona Care messages: a 300-message thread (unbounded: care.messages.list returns the whole thread) whose newest
// messages carry the worst cases: 1,000 characters (the schema's max), medicine photos at the reading's limits
// (name 120, dose 60), an unbreakable link, Chinese, and Sona's automatic call-999 safety reply.
const MIN = 60_000, now = Date.now();
const photo = (name: string, dose?: string, decision?: "added" | "declined") => ({
  attachment: {
    kind: "medicine-photo" as const, key: "care-photos/h/p/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f.jpg", reading: { name, dose },
    ...decision && { decision: { status: decision, reading: { name, dose }, by: "Dr. Christopher Alexander Montgomery III", at: new Date(now).toISOString() } },
  },
});

type From = "patient" | "care-team";
type Extra = { attachment?: ReturnType<typeof photo>["attachment"]; rule?: "call-999"; unseen?: true };
const msg = (id: string, from: From, text: string, minutesAgo: number, { attachment, rule, unseen }: Extra = {}) => ({
  id: `m-${id}`, from, text, createdAt: new Date(now - minutesAgo * MIN),
  seenAt: from === "patient" && !unseen ? new Date(now - (minutesAgo - 5) * MIN) : null, attachment: attachment ?? null, ...rule && { rule },
});

const LONG = "Selamat petang doktor. Saya nak tanya tentang ubat baru yang diberi semasa keluar wad. Sejak mula ambil Entresto (sacubitril/valsartan) 49/51 mg dua kali sehari, saya rasa pening bila bangun dari katil terutamanya waktu pagi, dan tekanan darah saya di rumah sekitar 98/60. Anak saya kata mungkin sebab ubat itu. Saya juga masih ambil furosemide 40 mg pagi dan bisoprolol 2.5 mg. Kaki tidak bengkak lagi, berat badan turun 1.2 kg dalam seminggu. Patutkah saya kurangkan dos atau tunggu temujanji klinik pada 14 Oktober? Saya juga nak tahu sama ada boleh minum kopi satu cawan sehari dan bila boleh mula berjalan di taman semula. Terima kasih banyak atas bantuan pasukan doktor dan jururawat di Wad 7B Kardiologi. Saya hantar gambar kotak ubat di bawah supaya doktor boleh semak.".slice(0, 1000);

const NEWEST = [
  msg("w1", "care-team", "Hi Puan Siti, thank you for the photo. Please keep taking it as written. See the leaflet: https://hospital.example.org/patients/leaflets/cardiology/heart-failure/sacubitril-valsartan-starting-at-home?lang=ms&ref=care-message", 300),
  msg("w2", "patient", LONG, 240, photo("Sacubitril/valsartan (Entresto) film-coated tablets, 49 mg/51 mg, Novartis Pharmaceuticals (Malaysia) Sdn Bhd", "49 mg/51 mg twice daily after food, swallow whole", "added")),
  msg("w3", "patient", "Ini?", 200, photo("Ubat batuk")),
  msg("w4", "patient", "医生，我昨晚胸口很闷，呼吸困难，现在还是不舒服。", 30, photo("Furosemide 40 mg", undefined, "declined")),
  msg("w5", "care-team", "Puan Siti, you wrote about chest pain and trouble breathing. Call 999 now or go to the nearest emergency department. Do not wait for a reply here. Your care team has been told.", 29, { rule: "call-999" as const }),
  msg("w6", "patient", "Ok", 2),
];
const older = (n: number) => rows(n, i => {
  const from: From = i % 3 === 2 ? "care-team" : "patient";
  return msg(`o${i}`, from, from === "care-team" ? "Noted. We will review at your clinic visit." : "Today my blood pressure was 128/80 and my weight 64.2 kg.", (n - i) * 180 + 400, i % 9 === 0 && from === "patient" ? photo("Bisoprolol fumarate 2.5 mg", "1 tablet in the morning", "added") : {});
});

export default [
  fixture("care.messages.list", {
    worst: [...older(300 - NEWEST.length), ...NEWEST],
    empty: [],
    one: [msg("1", "patient", "Hi", 1, { unseen: true })],
    huge: [...older(1000 - NEWEST.length), ...NEWEST],
  }),
  fixture("care.messages.send", {
    worst: ({ text, requestId }) => msg(requestId, "patient", text, 0, { unseen: true }),
  }),
];
