import { ORPCError } from "@orpc/client";

import { fixture } from "./fixture";
import { nameOf } from "./pro-ward";

// /pro/xray. Findings are unique per (encounter, kind) and kind is nodule, cardiomegaly or effusion, so a visit holds at most
// three; their label, zone and the draft read's lines are unbounded text. xray.upload answers the same key xray.read
// does, so an image chosen in the browser shows with the finding boxes drawn on it.
const KEY = "h-ukm/xray/e-0/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
const now = Date.UTC(2026, 9, 7, 1, 0);

const READ = [
  "Ill-defined 14 mm opacity projected over the right upper zone, partly obscured by the anterior end of the right first rib; a nodule cannot be excluded and comparison with any prior imaging is advised.",
  "Cardiothoracic ratio about 0.58 on this PA film, suggesting cardiomegaly.",
  "Blunting of the left costophrenic angle consistent with a small pleural effusion.",
  "No pneumothorax.",
  "Degenerative change in the thoracic spine.",
  "Sternotomy wires and mediastinal clips from previous cardiac surgery, intact.",
  "Nasogastric tube tip below the diaphragm, in the stomach.",
];
const finding = (kind: "nodule" | "cardiomegaly" | "effusion", over: object = {}) => ({
  id: `f-${kind}`, hospitalId: "h-ukm", patientId: "p-0", encounterId: "e-0", imageKey: KEY, kind, ruleId: `rule-${kind}`, status: "open" as const,
  source: "medgemma-4b", taskId: null, dueAt: null, createdAt: new Date(now), patientName: nameOf(0), owner: null, intervalDays: 90, overdue: false, validated: false as const,
  ...{
    nodule: { label: "Solid pulmonary nodule, right upper zone, partly obscured by the first rib", sizeMm: 14, riskBand: "high" as const, location: { x: 0.3, y: 0.25, zone: "Right upper zone, posterior segment, behind the anterior end of the first rib", box: [180, 220, 330, 380] as [number, number, number, number] }, action: "Repeat CT thorax with contrast at 3 months, compared with today's film" },
    cardiomegaly: { label: "Cardiomegaly", sizeMm: null, riskBand: "intermediate" as const, location: { x: 0.5, y: 0.6, zone: "Heart", box: [450, 330, 780, 760] as [number, number, number, number] }, action: "Echocardiogram at the cardiology clinic" },
    effusion: { label: "Small left pleural effusion", sizeMm: null, riskBand: "low" as const, location: { x: 0.8, y: 0.8, zone: "Left costophrenic angle" }, action: "Repeat chest X-ray at 6 weeks" },
  }[kind],
  ...over,
});

export default [
  fixture("xray.read", {
    // Only the first patient's visit has a film; any other answers NOT_FOUND as the router does.
    worst: ({ encounterId }) => {
      if (encounterId !== "e-0") throw new ORPCError("NOT_FOUND", { message: `No X-ray uploaded for ${encounterId}` });
      return { key: KEY, findings: READ, validated: false, source: "model", model: "medgemma-4b" };
    },
    empty: ({ encounterId }) => { throw new ORPCError("NOT_FOUND", { message: `No X-ray uploaded for ${encounterId}` }); },
    one: { key: KEY, findings: [READ[3]!], validated: false, source: "model", model: "medgemma-4b" },
  }),
  fixture("xray.upload", { worst: { key: KEY } }),
  fixture("findings.list", {
    worst: ({ encounterId }) => encounterId !== "e-0" ? [] : [finding("nodule"), finding("cardiomegaly", { status: "tracked", taskId: "t-1", dueAt: new Date(Date.now() + 90 * 86_400_000) }), finding("effusion")],
    empty: [],
    one: [finding("nodule")],
  }),
  fixture("findings.status", {
    worst: ({ encounterId }) => encounterId !== "e-0" ? null : { source: "model", model: "google/medgemma-4b-it-cxr-finetune-2026-09-30", readAt: new Date(now), imageKey: KEY, found: 3 },
    empty: null,
    one: { source: "fixture", readAt: new Date(now), imageKey: KEY, found: 1 },
  }),
];
