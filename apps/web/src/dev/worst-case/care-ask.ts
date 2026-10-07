import { fixture } from "./fixture";

// Sona Care Ask: the answer a question gets (care.ask). Worst is about 2,000 characters with a numbered list and
// line breaks, a care-team line, and five leaflet sources with long titles; "one" is a one-word answer; "empty" is
// no answer while the model wakes. (care.followUps and care.discharge only add two suggestions here; their own
// pages' fixture files cover them.)
const LIST = `Selepas keluar wad kerana kegagalan jantung, ini perkara yang paling penting minggu ini:

1. Timbang berat badan setiap pagi selepas ke tandas dan sebelum sarapan. Jika berat naik lebih daripada 1 kg dalam sehari atau 2 kg dalam seminggu, hubungi pasukan penjagaan anda.
2. Ambil ubat mengikut jadual: furosemide 40 mg pada waktu pagi, bisoprolol 2.5 mg sekali sehari, dan sacubitril/valsartan 49/51 mg dua kali sehari. Jangan berhenti atau tukar dos tanpa berbincang dengan doktor.
3. Hadkan garam kepada kurang daripada satu sudu teh sehari. Elakkan makanan dalam tin, mi segera, ikan masin, kicap berlebihan dan makanan segera.
4. Minum tidak lebih daripada 1.5 liter cecair sehari, termasuk sup, teh dan buah-buahan berair seperti tembikai.
5. Berjalan perlahan 10 hingga 15 minit dua kali sehari jika anda tidak sesak nafas. Berhenti dan berehat jika dada rasa berat.
6. Tidur dengan dua bantal jika anda sesak nafas apabila berbaring.

Tanda yang perlu diberi perhatian: kaki atau perut semakin bengkak, batuk pada waktu malam, sesak nafas semasa berehat, atau pening sehingga hampir pitam. Jika anda rasa sakit dada, sukar bernafas atau pengsan, hubungi 999 dengan segera.

Temujanji klinik kardiologi anda yang seterusnya ialah pada hari Rabu, 14 Oktober, jam 9:30 pagi di Klinik Pakar Kardiologi, Aras 3, Blok C. Bawa senarai ubat, buku catatan berat badan dan tekanan darah anda.`;

const SOURCES = [
  "Living well with heart failure: a guide for patients and families after discharge (Cardiology Department, 2025 edition)",
  "Panduan diet rendah garam untuk pesakit jantung",
  "Sacubitril/valsartan: starting your new heart medicine at home",
  "Fluid restriction",
  "低盐饮食指南",
].map(title => ({ title, kind: "leaflet" as const }));

export default [
  fixture("care.ask", {
    worst: { answer: LIST, source: "fixture", grounded: true, urgent: true, withheld: 1, sources: SOURCES, careTeam: {
      line: "Saya sudah memberitahu pasukan penjagaan anda tentang sesak nafas ini. Mereka akan menghubungi anda hari ini.",
      taskId: "t-ask-1", title: "Call back about breathlessness at rest", label: "worse", readBy: { source: "fixture", decidedBy: "rules" },
    }, },
    one: { answer: "Ya.", source: "fixture", grounded: false, urgent: false, withheld: 0, sources: [] },
    empty: { answer: "", source: "fixture", grounded: false, urgent: false, withheld: 0, sources: [], waking: 4 },
  }),
];
