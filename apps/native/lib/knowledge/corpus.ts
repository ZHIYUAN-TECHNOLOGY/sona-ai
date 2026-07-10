// On-device clinical reference corpus for the Knowledge tab. Small, curated, and
// bundled with the app — so "Ask the clinic" works fully offline (inside the moat: no
// query or note ever leaves the device). Reference/educational content, NOT a
// prescription; the UI labels it as such.
//
// This is the JS-first cut: retrieval is lexical today (lib/knowledge/retrieve → the
// same ranker as note search). The KnowledgeDoc shape is stable so an on-device
// embedding model (react-native-rag / MiniLM) can re-rank the same corpus later.

export type KnowledgeCategory =
  | "red-flags"
  | "referral"
  | "safety-net"
  | "condition"
  | "medication-safety"
  | "paediatric";

export interface KnowledgeDoc {
  id: string;
  title: string;
  /** 1-3 sentence clinical guidance. */
  text: string;
  category: KnowledgeCategory;
  /** Guideline family this reflects (e.g. "NICE CKS", "WHO", "MOH Malaysia CPG"). */
  source: string;
  /** Extra search terms (incl. common Malay terms). */
  keywords: string[];
}

/** Display metadata per category (label + SF Symbol for the browse view). */
export const CATEGORIES: { key: KnowledgeCategory; label: string; sf: string }[] = [
  { key: "red-flags", label: "Red flags", sf: "exclamationmark.triangle" },
  { key: "referral", label: "When to refer", sf: "arrow.up.forward" },
  { key: "safety-net", label: "Safety-netting", sf: "shield" },
  { key: "condition", label: "Conditions", sf: "stethoscope" },
  { key: "medication-safety", label: "Medication safety", sf: "pills" },
  { key: "paediatric", label: "Paediatrics", sf: "figure.and.child.holdinghands" },
];

// Populated from a verified curation pass (see lib/knowledge/corpus.data). Kept in a
// separate data module so this file stays the stable API surface.
export { CORPUS } from "./corpus.data";
