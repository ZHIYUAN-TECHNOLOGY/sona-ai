// Dev only: Sona's answer kit (components/ai) in every state, with Sona content. Rendered by the dev gallery.
import type { Claim, Reference } from "@sona-ai/domain/evidence";
import { useEffect, useState } from "react";

import { Artifact, Conversation, Notice, type Phase, Response, RuleAnswer, type RuleRow, Sources, Steps, Suggestions, Turn } from "@/components/ai";
import { ImageLoader } from "@/components/image-loader";
import { Button, Card, Tabs } from "@/components/primitives";
import { SonaOrb, SonaOrbMark } from "@/components/sona-orb";
import { FilmStage } from "@/features/imaging/film-stage";
import { LOADER_COPY, type LoaderState } from "@/lib/image-loader";
import { BLOOM_MS, type OrbState } from "@/lib/sona-orb";
import "@/styles/film.css";

// A real chest X-ray (CC BY, apps/native/features/imaging/assets/PROVENANCE.md) and a drawn page for the loader.
const XRAY = new URL("../../../native/features/imaging/assets/normal-pa-chest.jpg", import.meta.url).href;
const PAGE = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#fff"/><g fill="#c9ced6">${Array.from({ length: 16 }, (_, i) => `<rect x="28" y="${48 + i * 20}" width="${i % 5 === 4 ? 140 : 244}" height="7" rx="3"/>`).join("")}</g><rect x="28" y="22" width="150" height="12" rx="4" fill="#59616b"/></svg>`)}`;
const LOADER_STATES: { id: LoaderState | "upload"; label: string }[] = [
  { id: "loading", label: "Loading" }, { id: "upload", label: "Sending" }, { id: "ready", label: "Ready (reveal)" }, { id: "reading", label: "Reading" }, { id: "failed", label: "Failed" },
];

/** The image loader in each state, on the film's dark ground and on the page; pick Ready after Loading to see the reveal. */
function LoaderGallery() {
  const [pick, setPick] = useState<LoaderState | "upload">("loading");
  const state: LoaderState = pick === "upload" ? "loading" : pick;
  const src = state === "ready" || state === "reading" ? XRAY : undefined;
  return (
    <Card title="Image loader">
      <Tabs label="Loader state" value={pick} onChange={setPick} tabs={LOADER_STATES} />
      <div className="pro" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24, padding: 24, borderRadius: 16, background: "var(--canvas)" }}>
        <div style={{ width: 88 }}><ImageLoader className="film-thumb" src={src} state={state} alt="Chest X-ray" /></div>
        <div style={{ width: 200 }}><ImageLoader className="film-thumb" src={src} state={state} alt="Chest X-ray" messages={pick === "upload" ? LOADER_COPY.upload : undefined} /></div>
        <div className="xr-stage" style={{ flex: "1 1 320px", minHeight: 360 }}>
          {src ? <img src={XRAY} alt="Chest X-ray" style={{ maxHeight: 320, borderRadius: 10 }} /> : null}
          <ImageLoader fill state={state} messages={pick === "upload" ? LOADER_COPY.upload : undefined} />
        </div>
        <div style={{ width: 200 }}><ImageLoader className="film-thumb" tone="paper" src={src && PAGE} state={state} alt="A scanned page" /></div>
      </div>
    </Card>
  );
}

const SCAN_STATES: { id: "reading" | "read"; label: string }[] = [{ id: "reading", label: "Reading" }, { id: "read", label: "Read (settle)" }];
// A box as a model's finding carries one (0-1000, [y0, x0, y1, x1]); demo data, to see the settle bring it up.
const SCAN_MARKS = [{ id: "demo-heart", status: "open", location: { box: [450, 330, 780, 760] } }];

/** Sona Vision's scan on the real film, as /pro/xray and the film panel show it; Read plays the settle, Reading again restarts it. */
function FilmScanGallery() {
  const [pick, setPick] = useState<"reading" | "read">("reading");
  const [zoom, setZoom] = useState(1);
  return (
    <Card title="Film scan">
      <Tabs label="Read state" value={pick} onChange={setPick} tabs={SCAN_STATES} />
      <div className="pro"><FilmStage src={XRAY} alt="Chest X-ray" findings={pick === "read" ? SCAN_MARKS : []} zoom={zoom} setZoom={setZoom} reading={pick === "reading"} /></div>
    </Card>
  );
}

const LONG_Q = "Amelia Tan, 67, bed 4B-12, admitted overnight with right lower lobe community-acquired pneumonia: what is her CURB-65, does she need to stay in, and when can she switch to oral antibiotics if her fever settles?";
const REFS: Reference[] = [
  { n: 1, id: "pmid:31573350", kind: "study", design: "Guideline", year: 2019, from: "Am J Respir Crit Care Med", title: "ATS/IDSA adult community-acquired pneumonia guideline", text: "Recommends a validated severity score, alongside clinical judgement, to decide where a patient with pneumonia is treated.", url: "https://pubmed.ncbi.nlm.nih.gov/31573350/", pmid: "31573350" },
  { n: 2, id: "pmid:12728155", kind: "study", design: "Study", year: 2003, from: "Thorax", title: "Defining pneumonia severity on presentation to hospital (CURB-65)", text: "Thirty-day mortality rose with each point of confusion, urea, respiratory rate, blood pressure and age 65 or over: low at 0 to 1, intermediate at 2, high at 3 or more.", url: "https://pubmed.ncbi.nlm.nih.gov/12728155/", pmid: "12728155" },
  { n: 3, id: "lib:pneumonia-pathway", kind: "library", design: "Library", year: 2025, from: "Ward 4B pathway", title: "Adult pneumonia pathway", text: "CURB-65 of 2: short inpatient stay or hospital-supervised outpatient care. Review the switch to oral antibiotics at 48 hours once afebrile and eating." },
  { n: 4, id: "img:enc-demo", kind: "image", design: "Imaging", year: 2026, from: "Radiology", title: "Chest X-ray, Amelia Tan, 5 Oct", text: "Right lower lobe consolidation. No effusion. Heart size normal.", encounterId: "enc-demo" },
];
const BOTTOM = "CURB-65 is 2 (urea 8.1, age 67): moderate risk, so a short admission is reasonable.";
const CLAIMS: Claim[] = [
  { text: "She scores 2: urea above 7 mmol/L and age 65 or over; she is not confused, her breathing is 22 a minute and her pressure 128/76.", cites: [2] },
  { text: "A score of 2 marks intermediate 30-day mortality, where the guideline supports care in hospital alongside clinical judgement.", cites: [2, 1] },
  { text: "The ward pathway suggests a short stay, with the switch to oral antibiotics reviewed at 48 hours.", cites: [3] },
  { text: "Her chest X-ray shows right lower lobe consolidation with no effusion.", cites: [4] },
];
const NEXT = ["When can she switch to oral antibiotics?", "What should I repeat before discharge?", "Does she need steroids?"];
const ROWS: RuleRow[] = [
  { id: "1", title: "Amelia Tan · 4B-12", detail: "Potassium 6.1 at 06:00, not acknowledged", tone: "urgent", op: "open:patient/amelia" },
  { id: "2", title: "Lim Wei Jie · 4B-3", detail: "Discharge blocked: waiting on transport since 08:30", tone: "soon", op: "open:patient/lim" },
  { id: "3", title: "Siti Aminah · 4B-7", detail: "Discharged at 09:40, summary sent", tone: "good" },
  { id: "4", title: "Rahul Nair · 4B-9", detail: "Stable, next observations at 12:00", tone: "calm", op: "open:patient/rahul" },
];
const PHASES: Phase[] = ["search", "read", "write", "done"];

/** A stand-in film for the thumbnail slot and the panel; the X-ray agent puts the real FilmCard here. */
function DemoFilm({ big }: { big?: boolean }) {
  return <span aria-hidden="true" style={{ display: "block", width: "100%", height: big ? undefined : "100%", aspectRatio: big ? "1" : undefined, borderRadius: big ? 12 : undefined, background: "radial-gradient(40% 55% at 33% 50%, #9aa3ad, transparent 70%), radial-gradient(40% 55% at 67% 50%, #8c96a1, transparent 70%), radial-gradient(60% 30% at 70% 72%, #c9ced4, transparent 70%), #15181c" }} />;
}

type OrbDemo = OrbState | "press";
const ORB_STATES: OrbDemo[] = ["rest", "hover", "thinking", "answered", "press"];

/** The Sona orb in each state; Answered plays the bloom once, then rests with the dot, as in the corner. */
function OrbGallery() {
  const [state, setState] = useState<OrbDemo>("rest");
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (state !== "answered") return;
    const id = setTimeout(() => setSettled(true), BLOOM_MS);
    return () => clearTimeout(id);
  }, [state]);
  const shown: OrbState = state === "press" ? "hover" : state === "answered" && settled ? "rest" : state;
  return (
    <Card title="Sona orb">
      <Tabs label="Orb state" value={state} onChange={setState} tabs={ORB_STATES.map(s => ({ id: s, label: s[0]!.toUpperCase() + s.slice(1) }))} />
      <div className="pro" style={{ display: "flex", alignItems: "center", gap: 32, padding: 32, borderRadius: 16, background: "var(--canvas)" }}>
        <span className="sona-orb" data-state={state} style={{ position: "relative", right: "auto", bottom: "auto" }}>
          <SonaOrb app="pro" state={shown} />
          {state === "answered" && settled ? <span className="sona-orb-badge" aria-hidden="true" /> : null}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}><SonaOrbMark />Sona</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}><SonaOrbMark app="care" />Sona Care</span>
      </div>
    </Card>
  );
}

export function AiGallery({ worst }: { worst?: boolean }) {
  const [look, setLook] = useState<"pro" | "care">("pro");
  const [phase, setPhase] = useState<Phase>("read");
  const [film, setFilm] = useState(false);
  const live = phase === "search" ? [] : phase === "read" ? [] : phase === "write" ? CLAIMS.slice(0, 2) : CLAIMS;
  const image = () => (
    <button type="button" onClick={() => setFilm(true)} aria-label="Open the chest X-ray" style={{ display: "block", width: "100%", height: "100%", padding: 0, border: 0, cursor: "zoom-in" }}><DemoFilm /></button>
  );
  const searched = <p style={{ margin: 0 }}>Searched PubMed for “CURB-65 admission community-acquired pneumonia” and the hospital library for “pneumonia pathway”; found Amelia Tan's chest X-ray.</p>;

  return (
    <>
    <OrbGallery />
    <LoaderGallery />
    <FilmScanGallery />
    <Card title="Sona answer kit">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <Tabs label="Look" value={look} onChange={setLook} tabs={[{ id: "pro", label: "Pro glass" }, { id: "care", label: "Light" }]} />
        <Tabs label="Live answer step" value={phase} onChange={setPhase} tabs={PHASES.map(p => ({ id: p, label: p[0]!.toUpperCase() + p.slice(1) }))} />
      </div>
      <div className={look} style={{ minHeight: 0, borderRadius: 16, background: "var(--canvas)" }}>
        <Conversation className="ai-gallery-thread">
          <Turn question={worst ? "Who on 4B needs me first this morning, before the 11:00 consultant ward round and the bed meeting?" : "Who needs me first today?"} by="rules">
            <RuleAnswer lead="Two patients need you before the 11:00 round." rows={worst ? ROWS.map(r => ({ ...r, title: `${r.title} · Christopher Alexander Montgomery III bin Abdullah` })) : ROWS} noun={["patient", "patients"]} onOpen={() => undefined} />
            <Suggestions items={["Open Amelia Tan", "Acknowledge the potassium", "Call transport for Lim Wei Jie"]} onPick={() => undefined} />
          </Turn>
          <Turn question={worst ? LONG_Q : "What's Amelia Tan's CURB-65, and does she need to stay in?"} by="Sona Med">
            <Steps phase="done" sources={REFS.length} seconds={4.2}>{searched}</Steps>
            <Response bottomLine={BOTTOM} claims={CLAIMS} references={REFS}>
              <Sources references={REFS} image={image} />
              <Suggestions items={NEXT} onPick={() => undefined} />
            </Response>
          </Turn>
          <Turn question="Is she safe for an oral switch?" by="rules">
            <Notice kind="error" action={<Button size="sm" icon="refresh">Try again</Button>}>Sona's model is starting. Ask again in about a minute.</Notice>
          </Turn>
          <Turn question="Does vitamin C shorten pneumonia in older adults?" by="Sona Med">
            <Notice kind="empty" action={<Suggestions items={["What shortens recovery from pneumonia?", "Which supplements are safe with her antibiotics?"]} onPick={() => undefined} />} />
          </Turn>
          <Turn question="Should she stay in, or go home on oral antibiotics?" by={phase === "done" ? "Sona Med" : undefined}>
            <Steps phase={phase} sources={phase === "search" ? undefined : REFS.length}>{phase === "search" ? null : searched}</Steps>
            {phase === "search" ? <Notice kind="thinking">Looking through PubMed and the hospital library</Notice> : null}
            {live.length || phase === "done" ? (
              <Response bottomLine={BOTTOM} claims={live} references={REFS}>
                {phase === "done" ? <><Sources references={REFS} image={image} /><Suggestions items={NEXT} onPick={() => undefined} /></> : null}
              </Response>
            ) : null}
          </Turn>
        </Conversation>
      </div>
      <style>{".ai-gallery-thread { height: 640px; } @media (max-width: 520px) { .ai-gallery-thread { height: 560px; } }"}</style>
    </Card>
    {/* Outside the card: a glass card's backdrop filter would hold the fixed panel inside it. */}
    <div className={look} style={{ display: "contents" }}>
      <Artifact open={film} onClose={() => setFilm(false)} title="Chest X-ray, Amelia Tan" subtitle="5 Oct · Radiology · source 4" actions={<Button size="sm" icon="external">Open in X-ray</Button>}>
        <DemoFilm big />
        <p style={{ margin: "16px 0 0" }}>Right lower lobe consolidation. No effusion. Heart size normal.</p>
      </Artifact>
    </div>
    </>
  );
}
