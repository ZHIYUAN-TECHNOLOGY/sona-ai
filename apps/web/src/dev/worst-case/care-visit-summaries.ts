import { at } from "./care-follow-ups";
import { fixture, rows } from "./fixture";

// Visit summaries (/care/visit-summaries): visit_summaries.text and whatChanged are unbounded.

// About 3,000 characters in Malay, as a doctor writes it: short "Heading:" paragraphs and one long run-on block.
const MALAY = `Ringkasan lawatan:
Puan Siti datang ke Klinik Pakar Respiratori untuk pemeriksaan semula selepas dimasukkan ke wad kerana jangkitan paru-paru (pneumonia) pada bulan lepas. Beliau memberitahu bahawa batuknya semakin berkurangan tetapi masih ada kahak berwarna kuning pada waktu pagi. Beliau tidak lagi demam sejak seminggu yang lalu. Semput hanya berlaku apabila menaiki tangga ke tingkat tiga rumahnya.

Pemeriksaan:
Tekanan darah 128/82 mmHg, nadi 88 seminit, suhu badan 36.9°C, kadar pernafasan 18 seminit dan ketepuan oksigen 96% pada udara biasa. Bunyi pernafasan di bahagian bawah paru-paru kanan masih sedikit kasar tetapi lebih baik berbanding semasa di wad. Tiada bengkak pada kaki. X-ray dada hari ini menunjukkan bayang-bayang di paru-paru kanan semakin berkurangan.

Ubat-ubatan:
Antibiotik amoksisilin-klavulanat telah tamat dan tidak perlu diteruskan. Inhaler salbutamol (biru) boleh digunakan apabila perlu sahaja, dua sedutan setiap kali, tidak lebih daripada empat kali sehari. Inhaler budesonida-formoterol (merah) perlu diambil setiap pagi dan malam, dua sedutan, walaupun anda rasa sihat. Sila berkumur selepas menggunakan inhaler merah. Dos metformin dinaikkan kepada 1,000 mg dua kali sehari selepas makan kerana bacaan gula dalam darah di rumah masih tinggi, iaitu antara 9 hingga 14 mmol/L.

Apa yang perlu dilakukan di rumah: teruskan latihan pernafasan yang diajar oleh ahli fisioterapi sekurang-kurangnya tiga kali sehari, berjalan perlahan-lahan selama sepuluh minit selepas makan, minum air secukupnya, elakkan asap rokok dan asap pembakaran terbuka, ambil bacaan gula dalam darah sebelum sarapan dan sebelum makan malam setiap hari dan catatkan dalam aplikasi Sona Care supaya doktor dapat melihatnya sebelum lawatan seterusnya, dan jangan memandu sehingga semput anda benar-benar hilang kerana ubat batuk yang diberikan boleh menyebabkan rasa mengantuk.

Bila perlu kembali:
Sila datang ke Jabatan Kecemasan dengan segera atau hubungi 999 jika anda mengalami sesak nafas yang teruk semasa berehat, sakit dada, bibir atau jari menjadi kebiruan, batuk berdarah, demam melebihi 38°C yang berterusan lebih daripada dua hari, atau rasa sangat mengantuk dan keliru. Temu janji seterusnya ialah dalam masa enam minggu untuk ulangan X-ray dada dan ujian fungsi paru-paru. Ujian darah HbA1c akan diambil pada lawatan yang sama.

Nota untuk keluarga:
Anak perempuan Puan Siti yang menemaninya hari ini bertanya sama ada ibunya boleh berpuasa pada bulan hadapan. Kami menasihatkan supaya berbincang semula pada lawatan seterusnya selepas bacaan gula dalam darah lebih stabil, kerana dos metformin baru sahaja dinaikkan dan risiko gula rendah semasa berpuasa perlu dinilai dahulu. Keluarga juga digalakkan membantu Puan Siti menggunakan aplikasi Sona Care untuk menjawab soalan semakan harian, supaya pasukan penjagaan dapat mengesan sebarang perubahan lebih awal.`;

const CHANGED = [
  "Antibiotik amoksisilin-klavulanat sudah tamat; jangan teruskan.",
  "Metformin naik ke 1,000 mg dua kali sehari selepas makan.",
  "Inhaler merah budesonida-formoterol setiap pagi dan malam, dua sedutan, walaupun rasa sihat.",
  ...rows(37, i => [
    "Check your blood sugar before breakfast and dinner every day.",
    "Walk slowly for ten minutes after meals.",
    "Jangan memandu sehingga semput hilang sepenuhnya kerana ubat batuk boleh menyebabkan rasa mengantuk dan mengganggu tumpuan.",
    "Next X-ray in six weeks.",
  ][i % 4]!),
];

const summary = (i: number, text: string, whatChanged: string[]) => ({ id: `vs-${i}`, at: at(-7 * i - 1, "11:00"), text, whatChanged });

export default [
  fixture("care.visitSummaries.list", {
    worst: [
      summary(0, MALAY, CHANGED),
      summary(1, "Seen in clinic. Chest is clear. Take amoxicillin 500 mg three times a day for 2 more days, then stop. Return if fever comes back.", []),
      summary(2, "Klinik Pakar Respiratori — pemeriksaan semula. Tiada perubahan.", []),
      summary(3, "复诊：咳嗽减轻，继续使用吸入器，两周后复查。", ["继续使用吸入器"]),
      ...rows(8, i => summary(4 + i, "Routine review. Nothing changed.", [])),
    ],
    empty: [],
    one: [summary(0, "Seen in clinic. Take one tablet daily.", ["Take one tablet daily."])],
    huge: rows(1000, i => summary(i, i % 2 ? MALAY : "Routine review. Nothing changed.", i % 2 ? CHANGED : [])),
  }),
];
