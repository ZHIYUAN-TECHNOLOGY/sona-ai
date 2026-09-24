import { defineCatalog, type Spec } from "@json-render/core";
import { schema } from "@json-render/react-native/schema";
import { z } from "zod";
import { medicineIds } from "@/features/clinical/medicine-catalog";
import type { Capability, FeatureProps } from "@/features/encounter/types";

const reference = z.string().min(1).max(256);
const resultReference = z.object({ resultId: reference }).strict();
const fixtureEnvelope = z.object({
  root: reference,
  elements: z.record(z.string(), z.object({ type: reference, props: z.record(z.string(), z.unknown()), children: z.array(reference) }).strict()),
}).strict();

export const clinicalCatalog = defineCatalog(schema, {
  actions: {},
  components: {
    ResponseColumn: { props: z.object({}).strict(), slots: ["default"], description: "Vertical clinical response composition." },
    ClinicalBriefing: { props: resultReference, description: "Existing patient briefing from authoritative encounter context." },
    ClinicalReasoning: { props: resultReference, description: "Existing evidence-linked clinical reasoning result." },
    ClinicalXray: { props: resultReference, description: "Existing teaching-image analysis result." },
    ClinicalMedication: { props: resultReference, description: "Existing medication review with its coverage notices." },
    ClinicalPrescription: { props: resultReference, description: "Existing synthetic prescription workflow and checked status." },
    ClinicalFollowup: { props: resultReference, description: "Existing follow-up proposal and task actions." },
    ClinicalNote: { props: resultReference, description: "Existing draft consultation note." },
    ContextNotice: { props: z.object({ noticeId: z.enum(["missing-context", "snapshot-provenance"]) }).strict(), description: "App-owned context or provenance notice." },
    SourceAction: { props: z.object({ sourceId: reference }).strict(), description: "Open a source that belongs to this response's patient snapshot." },
    MedicineThumb: { props: z.object({ medicineId: z.enum(medicineIds), confirmed: z.boolean() }).strict(), description: "Illustrative dosage-form thumbnail. Name a catalogue medicine; the app draws it (never supply an image)." },
  },
});

export const clinicalComponentNames = {
  briefing: "ClinicalBriefing", reasoning: "ClinicalReasoning", xray: "ClinicalXray", medication: "ClinicalMedication",
  prescription: "ClinicalPrescription", followup: "ClinicalFollowup", note: "ClinicalNote",
} as const satisfies Record<Capability, string>;

export function responseReference(props: FeatureProps, kind: Capability): string {
  return props.result?.id ?? `${props.patient.encounterId}-${kind}`;
}

/** Full, renderable fixture snapshots. A future inference adapter can supply the same format. */
export function composeClinicalSpec(props: FeatureProps, kind: Capability, sections = 3): Spec {
  const phase = Number.isFinite(sections) ? Math.min(3, Math.max(1, Math.floor(sections))) : 3;
  const responseId = responseReference(props, kind);
  const rootId = `${responseId}-composition`;
  const clinicalId = `${responseId}-clinical`;
  const noticeId = `${responseId}-context`;
  const sourceNodeId = `${responseId}-source`;
  const sourcePreference: Record<Capability, string> = { briefing: "history", reasoning: "history", xray: "xray", medication: "medication", prescription: "paracetamol-reference", followup: "history", note: "consultation" };
  const source = props.patient.sources.find(item => item.id === sourcePreference[kind]) ?? props.patient.sources.find(item => item.id === "history");
  const children: string[] = [];
  const elements: Spec["elements"] = {};
  const addClinical = () => {
    children.push(clinicalId);
    elements[clinicalId] = { type: clinicalComponentNames[kind], props: { resultId: responseId }, children: [] };
  };
  const addNotice = () => {
    children.push(noticeId);
    elements[noticeId] = { type: "ContextNotice", props: { noticeId: props.patient.incomplete ? "missing-context" : "snapshot-provenance" }, children: [] };
  };
  // Missing context leads the incomplete fixture. The fuller fixture leads with its result.
  if (props.patient.incomplete) { addNotice(); if (phase >= 2) addClinical(); }
  else { addClinical(); if (phase >= 2) addNotice(); }
  if (phase >= 3 && source) {
    children.push(sourceNodeId);
    elements[sourceNodeId] = { type: "SourceAction", props: { sourceId: source.id }, children: [] };
  }
  elements[rootId] = { type: "ResponseColumn", props: {}, children };
  return { root: rootId, elements };
}

/** Catalogue syntax plus app-owned identity/source constraints; neither implies clinical validity. */
export function validateClinicalSpec(spec: unknown, props: FeatureProps, kind: Capability): Spec | null {
  if (!fixtureEnvelope.safeParse(spec).success) return null;
  const parsed = clinicalCatalog.validate(spec);
  if (!parsed.success || !parsed.data) return null;
  const value = parsed.data as Spec;
  const root = value.elements[value.root];
  if (!root || root.type !== "ResponseColumn" || value.root !== `${responseReference(props, kind)}-composition` || Object.keys(value.elements).length > 4) return null;
  if (props.result && (props.result.patientId !== props.patient.id || props.result.encounterId !== props.patient.encounterId || props.result.kind !== kind)) return null;
  const children = root.children ?? [];
  if (!children.length || new Set(children).size !== children.length || children.includes(value.root) || children.length !== Object.keys(value.elements).length - 1) return null;
  for (const id of children) {
    const node = value.elements[id];
    if (!node || (node.children?.length ?? 0) > 0 || node.on || node.visible || node.repeat) return null;
    if (node.type === "SourceAction") {
      if (!props.patient.sources.some(source => source.id === node.props.sourceId)) return null;
    } else if (node.type === "ContextNotice") {
      if (node.props.noticeId !== (props.patient.incomplete ? "missing-context" : "snapshot-provenance")) return null;
    } else if (node.type !== clinicalComponentNames[kind] || node.props.resultId !== responseReference(props, kind)) return null;
  }
  // Keep the intentionally small fixture grammar: one notice, one clinical result, one source.
  const types = children.map(id => value.elements[id]!.type);
  if (new Set(types).size !== types.length || root.on || root.visible || root.repeat) return null;
  if (props.patient.incomplete ? !types.includes("ContextNotice") : !types.includes(clinicalComponentNames[kind])) return null;
  return value;
}
