/**
 * A patient's health summary as one PDF, the file a patient (Sona Care) or their hospital (Sona Pro) sends to another
 * hospital. Built by routers/health-summary from the rows the apps already read; rendered here in the Worker with
 * takumi-pdf, so the web portals and both iPhone apps get the same file. Insight first: who, key problems, allergies,
 * medicines and the next visit on top, the detail after. A section with no rows is left out, never filled in.
 */
export type HealthSummary = {
  hospital: string; generatedAt: Date;
  patient: { id: string; name: string; age: number; sex: string };
  allergies: string | null; problems: string; complaint: string; history: string[]; family?: string; social?: string;
  medicines: { name: string; detail: string; change: "new" | "changed" | "stopped" | "unchanged" }[];
  results: { test: string; value: string; unit: string | null; flag: string | null; at: Date }[];
  observations: { label: string; at?: Date }[];
  visitSummary?: { at: Date; text: string; whatChanged: string[] };
  visits: { at: Date; title: string; detail?: string }[];
  discharge?: { at: Date; warningSigns: string[] };
  followUps: { title: string; date: Date }[];
  careTeam: { name: string; specialty: string; room: string }[];
};

const INK = "#1D1F23", MUTED = "#59616B", BORDER = "#D8DBE0", RED = "#B42318", AMBER = "#8A5A00", BLUE = "#245BCC";
// The discharge plan's type (apps/web/src/lib/pdf/theme.ts): Noto Sans for English and Malay, Noto Sans SC for Chinese.
const FONT = "Noto Sans, Noto Sans SC, sans-serif";

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** "01 Oct 2026": the day in Malaysia, the same on any server. */
const day = (at: Date) => new Date(new Date(at).getTime() + 8 * 3600_000).toUTCString().slice(5, 16);
const current = (s: HealthSummary) => s.medicines.filter(m => m.change !== "stopped");
/** Red for must-not-miss (critical, abnormal), amber for pending; a normal result stays ink. */
const flagColour = (flag: string | null) => !flag || flag === "normal" ? INK : flag === "pending" ? AMBER : RED;

const section = (title: string, body: string) => `<section style="display:flex;flex-direction:column;gap:6px;margin-top:16px;break-inside:avoid"><h2 style="font-size:13px;font-weight:600;margin:0;padding-bottom:4px;border-bottom:1px solid ${BORDER}">${esc(title)}</h2>${body}</section>`;
const row = (label: string, value: string, colour = INK) => `<div style="display:flex;gap:12px"><span style="width:120px;flex-shrink:0;color:${MUTED}">${esc(label)}</span><span style="flex:1;color:${colour}">${value}</span></div>`;
const list = (items: string[]) => `<div style="display:flex;flex-direction:column;gap:3px">${items.map(i => `<div style="display:flex;gap:6px"><span style="color:${MUTED}">•</span><span style="flex:1">${i}</span></div>`).join("")}</div>`;

/** The document as HTML for takumi: one column, A4, the discharge plan's colours. */
export function healthSummaryHtml(s: HealthSummary) {
  const meds = current(s), next = s.followUps[0];
  const top = [
    row("Key problems", esc(s.problems)),
    row("Allergies", s.allergies ? `<b>${esc(s.allergies)}</b>` : "None recorded", s.allergies ? RED : INK),
    row("Medicines", meds.length ? `${meds.length} current${s.medicines.length > meds.length ? `, ${s.medicines.length - meds.length} stopped` : ""}` : "None recorded"),
    s.discharge ? row("Discharged", day(s.discharge.at)) : "",
    row("Next visit", next ? `${esc(next.title)}, ${day(next.date)}` : "None booked", next ? BLUE : INK),
  ].join("");
  const body = [
    `<div style="display:flex;flex-direction:column;gap:2px"><h1 style="font-size:22px;font-weight:600;margin:0">${esc(s.patient.name)}</h1>
      <div style="color:${MUTED}">${s.patient.age} years · ${esc(s.patient.sex)} · Hospital ID ${esc(s.patient.id)}</div></div>`,
    `<div style="display:flex;flex-direction:column;gap:5px;margin-top:12px;padding:12px 14px;border:1px solid ${BORDER};border-radius:8px;background:#F6F7F9">${top}</div>`,
    section("Problems and history", [
      row("Came in with", esc(s.complaint || "Not recorded")),
      row("Medical history", esc(s.history.join(", ") || "None recorded")),
      s.family ? row("Family history", esc(s.family)) : "",
      s.social ? row("Social history", esc(s.social)) : "",
    ].join("")),
    s.medicines.length ? section("Medicines", list(s.medicines.map(m =>
      `<b>${esc(m.name)}</b> <span style="color:${MUTED}">${esc(m.detail)}</span>${m.change === "unchanged" ? "" : ` <span style="color:${m.change === "stopped" ? AMBER : BLUE}">(${m.change})</span>`}`))) : "",
    s.results.length ? section("Recent results", `<div style="display:flex;flex-direction:column;gap:3px">${s.results.map(r =>
      `<div style="display:flex;gap:12px"><span style="flex:1">${esc(r.test)}</span><span style="width:150px;color:${flagColour(r.flag)}">${esc([r.value, r.unit].filter(Boolean).join(" "))}${r.flag && r.flag !== "normal" ? `, ${esc(r.flag)}` : ""}</span><span style="width:90px;color:${MUTED}">${day(r.at)}</span></div>`).join("")}</div>`) : "",
    s.observations.length ? section("Latest observations", list(s.observations.map(o => `${esc(o.label)}${o.at ? ` <span style="color:${MUTED}">${day(o.at)}</span>` : ""}`))) : "",
    s.visitSummary ? section(`Latest visit summary, ${day(s.visitSummary.at)}`, `<p style="margin:0">${esc(s.visitSummary.text)}</p>${s.visitSummary.whatChanged.length ? list(s.visitSummary.whatChanged.map(esc)) : ""}`) : "",
    s.discharge || s.followUps.length ? section(s.discharge ? "Discharge and follow-up" : "Follow-up", [
      s.discharge?.warningSigns.length ? `<div style="color:${MUTED}">Come back straight away if:</div>${list(s.discharge.warningSigns.map(esc))}` : "",
      s.followUps.length ? `<div style="color:${MUTED}">Visits booked:</div>${list(s.followUps.map(f => `${esc(f.title)}, ${day(f.date)}`))}` : "",
    ].join("")) : "",
    s.visits.length ? section("Recent record", `<div style="display:flex;flex-direction:column;gap:3px">${s.visits.map(v =>
      `<div style="display:flex;gap:12px"><span style="width:90px;flex-shrink:0;color:${MUTED}">${day(v.at)}</span><span style="flex:1">${esc(v.title)}${v.detail ? ` <span style="color:${MUTED}">${esc(v.detail)}</span>` : ""}</span></div>`).join("")}</div>`) : "",
    s.careTeam.length ? section("Care team", list(s.careTeam.map(d => `${esc(d.name)}, ${esc(d.specialty)} <span style="color:${MUTED}">${esc(d.room)}</span>`))) : "",
  ].join("");
  return `<div style="display:flex;flex-direction:column;font-family:${FONT};font-size:10.5px;line-height:1.5;color:${INK}">${body}</div>`;
}

const band = (html: string) => `<div style="display:flex;justify-content:space-between;width:100%;padding:0 68px;font-family:${FONT};font-size:8.5px;color:${MUTED}">${html}</div>`;
// Takumi margins are CSS px; A4 with 18 mm on every side, as the web's PDFs.
const mm = (n: number) => (n * 96) / 25.4;

// Google's Noto Sans slices leave out glyphs the record writes ("SpO₂", "⅓ tablet"): one more slice of just them, as the web's PDFs do.
const CLINICAL_GLYPHS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎½⅓⅔¼¾⅕⅙⅛°µμ±×÷≈≠≤≥←→↑↓↔";
type Fonts = Awaited<ReturnType<typeof import("@takumi-rs/helpers").googleFonts>>;
let fonts: Promise<Fonts> | undefined;
/**
 * Noto Sans, fetched once per Worker from Google Fonts as lazy slices (the renderer downloads only the ones the text
 * uses). Unreachable, the engine's own font still sets English and Malay and the next export tries again.
 */
function loadFonts() {
  fonts ??= import("@takumi-rs/helpers").then(h => Promise.all([
    h.googleFonts([{ name: "Noto Sans", weight: [400, 600, 700] }, "Noto Sans SC"]),
    h.googleFonts({ families: ["Noto Sans"], baseUrl: `https://fonts.googleapis.com/css2?text=${encodeURIComponent(CLINICAL_GLYPHS)}` }),
  ])).then(lists => lists.flat())
    .catch(error => { console.error("health summary fonts not loaded", error); fonts = undefined; return [] as Fonts; });
  return fonts;
}

/**
 * The PDF bytes. takumi (about 4 MB of WebAssembly) is imported on the first export, not at Worker start, as unpdf is
 * (./pdf). A glyph no font covers is drawn blank rather than failing the export.
 */
export async function renderHealthSummary(s: HealthSummary) {
  const [{ render }, fontList] = await Promise.all([import("takumi-pdf"), loadFonts()]);
  return render(healthSummaryHtml(s), {
    size: "a4", margin: mm(18), fonts: fontList, uncoveredText: "blank",
    metadata: { title: `Health summary: ${s.patient.name}`, authors: [s.hospital], creator: "Sona" },
    header: band(`<span>Health summary · ${esc(s.hospital)}</span><span>Generated ${day(s.generatedAt)}</span>`),
    footer: band(`<span>Prepared by ${esc(s.hospital)} with Sona</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>`),
  });
}

/** "health-summary-amelia-tan-2026-10-10.pdf" */
export const summaryFilename = (s: HealthSummary) =>
  `health-summary-${s.patient.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || s.patient.id}-${new Date(s.generatedAt.getTime() + 8 * 3600_000).toISOString().slice(0, 10)}.pdf`;
