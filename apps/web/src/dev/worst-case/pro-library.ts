import { fixture, rows } from "./fixture";

// Library: the sources Sona answers from. A PubMed import keeps the journal's own title, which runs past the 200 a
// typed source allows (the column is unbounded text); a scan's source is "pdf" or "photo"; uploadedBy is optional.
const TITLES = [
  "Management of community-acquired pneumonia in adults with chronic obstructive pulmonary disease and type 2 diabetes mellitus admitted to general medical wards in Malaysia: a multicentre retrospective cohort study of antibiotic choice, IV-to-oral switch timing and 30-day readmission",
  "CPG",
  "Garis Panduan Amalan Klinikal: Pengurusan Hiperkalemia di Wad Perubatan, Hospital Canselor Tuanku Muhriz UKM (Edisi Ketiga, disemak semula)",
  "急性肾损伤诊疗指南 (2023 年版)",
  "IMG_20250914_183022_HDR_ward-4B_potassium-protocol_scan_edited.pdf",
];
const SOURCES = ["Malaysian Journal of Medical Sciences, Universiti Sains Malaysia Press", "MOH", "pdf", "photo", "PDF, 128 pages"];
const KINDS = ["pubmed", "text", "scan", "scan", "pdf"] as const;
const BY = ["Dr Aleksandra Wiśniewska-Kowalczyk", null, "Siti Nur Aisyah binti Mohd Khairuddin", "Jo", "王秀英"];
const doc = (i: number) => ({
  id: `doc-${i}`, title: TITLES[i % TITLES.length]!, source: SOURCES[i % SOURCES.length]!, kind: KINDS[i % KINDS.length]!,
  year: [2009, 2026, 2019, 2023, 2026][i % 5]!, sections: [1_284, 1, 0, 37, 12][i % 5]!, uploadedBy: BY[i % BY.length] ?? null,
  scope: i % 3 ? "hospital" as const : "me" as const, license: null, createdAt: new Date(Date.UTC(2026, 9, 7) - i * 86_400_000),
});

export default [
  fixture("library.list", { worst: rows(12, doc), empty: [], one: [{ ...doc(1), year: 2018, sections: 1 }], huge: rows(500, doc) }),
];
