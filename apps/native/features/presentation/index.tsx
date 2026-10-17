import { JSONUIProvider, Renderer, defineRegistry } from "@json-render/react-native";
import { medicineById } from "@/features/clinical/medicine-catalog";
import { MedicineThumb } from "@/features/clinical/medicine-thumb";
import { Component, createContext, use, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Notice } from "@/components/sona/ui";
import { BriefingCard, MedicationCard, PrescriptionCard, ReasoningCard } from "@/features/clinical";
import type { Capability, FeatureProps } from "@/features/encounter/types";
import { XrayCard } from "@/features/imaging";
import { NoteCard } from "@/features/scribe";
import { FollowupCard } from "@/features/tasks";
import { EvidenceCard } from "@/features/evidence";
import { clinicalCatalog, composeClinicalSpec, responseReference, validateClinicalSpec } from "./catalog";

const PresentationContext = createContext<{ featureProps: FeatureProps; kind: Capability } | null>(null);
const components = { briefing: BriefingCard, reasoning: ReasoningCard, xray: XrayCard, medication: MedicationCard, prescription: PrescriptionCard, followup: FollowupCard, note: NoteCard, evidence: EvidenceCard };

function VisibleFallback() {
  return <Notice warning>This response could not be displayed. Its saved context is retained; retry the request or open the encounter workflow.</Notice>;
}

// The package has a silent element boundary. Catch errors inside each of our registered leaves.
class VisibleBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <VisibleFallback /> : this.props.children; }
}

function ClinicalLeaf({ resultId, kind }: { resultId: string; kind: Capability }) {
  const context = use(PresentationContext);
  if (!context || context.kind !== kind || resultId !== responseReference(context.featureProps, kind)) return <VisibleFallback />;
  const Feature = components[kind];
  const authoritative = context.featureProps;
  const onSource = (id: string) => {
    authoritative.onSource(id); // App-owned feature links can show the explicit missing-source screen.
  };
  return <VisibleBoundary key={resultId}><Feature {...authoritative} onSource={onSource} /></VisibleBoundary>;
}

// Provenance is the one sources line under the answer (the source screen labels each one); a missing-context warning stays a real notice.
function ContextNotice({ noticeId }: { noticeId: "missing-context" | "snapshot-provenance" }) {
  if (noticeId === "missing-context") return <Notice warning>This encounter has missing history or medication information. Unknown details remain explicit in the response.</Notice>;
  return null;
}

function ValidatedSource({ sourceId }: { sourceId: string }) {
  const context = use(PresentationContext);
  const source = context?.featureProps.patient.sources.find(item => item.id === sourceId);
  if (!source || !context) return <VisibleFallback />;
  // A briefing's observations share this line instead of a second one under the vitals.
  const vitals = context.kind === "briefing" ? context.featureProps.patient.sources.find(item => item.id === "vitals") : undefined;
  const link = (id: string, label: string) => <Pressable accessibilityRole="link" accessibilityLabel={`Response source, ${label}`} hitSlop={10} onPress={() => {
    if (context.featureProps.patient.sources.some(item => item.id === id)) context.featureProps.onSource(id);
  }}><Text style={{ ...type.caption, color: palette.blue }}>{label} ↗</Text></Pressable>;
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
    <Text style={{ ...type.caption, color: palette.muted }}>{vitals ? "Sources" : "Source"} ·</Text>
    {link(sourceId, source.title)}
    {vitals && <><Text style={{ ...type.caption, color: palette.muted }}>·</Text>{link(vitals.id, "Observations")}</>}
  </View>;
}

const { registry } = defineRegistry(clinicalCatalog, {
  components: {
    ResponseColumn: ({ children }) => <View style={{ gap: 14 }}>{children}</View>,
    ClinicalBriefing: ({ props }) => <ClinicalLeaf kind="briefing" resultId={props.resultId} />,
    ClinicalReasoning: ({ props }) => <ClinicalLeaf kind="reasoning" resultId={props.resultId} />,
    ClinicalXray: ({ props }) => <ClinicalLeaf kind="xray" resultId={props.resultId} />,
    ClinicalMedication: ({ props }) => <ClinicalLeaf kind="medication" resultId={props.resultId} />,
    ClinicalPrescription: ({ props }) => <ClinicalLeaf kind="prescription" resultId={props.resultId} />,
    ClinicalFollowup: ({ props }) => <ClinicalLeaf kind="followup" resultId={props.resultId} />,
    ClinicalNote: ({ props }) => <ClinicalLeaf kind="note" resultId={props.resultId} />,
    ClinicalEvidence: ({ props }) => <ClinicalLeaf kind="evidence" resultId={props.resultId} />,
    ContextNotice: ({ props }) => <ContextNotice noticeId={props.noticeId} />,
    SourceAction: ({ props }) => <ValidatedSource sourceId={props.sourceId} />,
    MedicineThumb: ({ props }) => { const look = medicineById(props.medicineId); return look ? <MedicineThumb look={look} confirmed={props.confirmed} /> : null; },
  },
});

export function ClinicalResponseRenderer({ featureProps, kind, sections, loading }: { featureProps: FeatureProps; kind: Capability; sections?: number; loading: boolean }) {
  const spec = validateClinicalSpec(composeClinicalSpec(featureProps, kind, sections ?? featureProps.result?.sections ?? 3), featureProps, kind);
  if (!spec) return <VisibleFallback />;
  return <PresentationContext value={{ featureProps, kind }}>
    <JSONUIProvider initialState={{}}>
      <Renderer spec={spec} registry={registry} includeStandard={false} loading={loading} fallback={VisibleFallback} />
    </JSONUIProvider>
  </PresentationContext>;
}
