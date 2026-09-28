import { useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { Text } from "@/components/sona/text";
import { IconRow, Section } from "@/components/sona/sections";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { palette } from "@/components/sona/theme";
import { SourceRef, type SourceKind } from "@/components/sona/sources";
import { Action, Body, Card, glass, Notice, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps, HistoryFact, Patient } from "@/features/encounter/types";
import { Anchor, Takeaways, type Takeaway } from "@/components/sona/answer-kit";
import { HistoryEditor } from "./history-editor";
import { Caption, Disclosure } from "./reasoning-parts";
import { Arrive, Drafting, SampleLabel } from "@/components/sona/model-answer";
import { useLiveReasoning } from "@/features/live/model-sync";

type Evidence = { context: string; supports: string; conflicts: string; needed: string };
type Possibility = { id: string; icon: string; title: string; summary: string; evidence: Evidence; sources: { label: string; id: string; kind: SourceKind }[]; xray?: boolean };

/** Same four slots, same order, for every possibility, so they compare row by row. */
const EVIDENCE: [keyof Evidence, string, string][] = [
  ["context", "text.quote", "Recorded context"], ["supports", "plus.circle", "Supports"],
  ["conflicts", "minus.circle", "Conflicts"], ["needed", "circle.dashed", "Still needed"],
];

function possibilities(patient: Patient, presentingSource: string, medicalSource: string): Possibility[] {
  const coughAndFever = /cough/i.test(patient.complaint) && /fever/i.test(patient.complaint);
  return [
    { id: "pneumonia", icon: "lungs", title: "Pneumonia considered", summary: "Explore the cause of the respiratory symptoms alongside the recorded history.", xray: true, evidence: {
      context: patient.complaint,
      supports: coughAndFever ? "Cough and fever overlap with symptoms the NHS describes." : "The presenting history has changed. The original cough-and-fever rationale needs reassessment.",
      conflicts: "No specific contradictory finding is documented. Missing findings don’t rule this in or out.",
      needed: "Chest examination and relevant imaging findings. The history alone doesn’t establish pneumonia.",
    }, sources: [{ label: "Patient history", id: presentingSource, kind: "record" }, { label: "NHS · pneumonia background", id: "pneumonia-reference", kind: "reference" }] },
    { id: "asthma", icon: "wind", title: "Asthma contribution", summary: "Weigh the recorded asthma without assuming it explains this episode.", evidence: {
      context: patient.history.join(". "),
      supports: "Cough can occur with asthma, but other conditions cause it too. Reported inhaler use needs reconciliation.",
      conflicts: "No specific contradictory finding is documented. The record doesn’t establish that asthma explains this episode.",
      needed: "Current symptom control, reliever frequency, airflow assessment and examination. Wheeze hasn’t been documented.",
    }, sources: [{ label: "Medical history used", id: medicalSource, kind: "record" }, { label: "NHLBI · asthma symptoms", id: "asthma-reference", kind: "reference" }] },
  ];
}

const GAPS: { title: string; detail: string; categories: HistoryFact["category"][] }[] = [
  { title: "Presenting history", detail: "Clarify onset, duration, progression and associated symptoms.", categories: ["presenting"] },
  { title: "Observations", detail: "No observations or examination have been documented.", categories: [] },
  { title: "Background", detail: "Medical history, medicines, allergies and family/social history remain incomplete.", categories: ["medical", "family", "social", "allergy"] },
];

/**
 * One gap to collect (after Finma's setup checklist): rows rise in 70 ms apart; a dashed ring
 * means nothing is documented yet. A recorded history update for that area fills the ring with a
 * dot that pops in (0.6 → 1). It never becomes a tick: an update doesn't close the gap.
 */
function GapRow({ title, detail, updates, index, reduced }: { title: string; detail: string; updates: number; index: number; reduced: boolean }) {
  const recorded = `${updates} history ${updates === 1 ? "update" : "updates"} recorded`;
  return <Animated.View accessible accessibilityLabel={`${title}. ${detail} ${updates ? recorded : "Not yet documented"}.`} entering={reduced ? undefined : riseIn({ delay: 70 * index, distance: 10, duration: 320 })}
    style={{ flexDirection: "row", gap: 14, paddingVertical: 14, borderTopWidth: index ? 1 : 0, borderColor: glass.hairline }}>
    <View style={{ width: 22, height: 22, marginTop: 1, borderRadius: 11, borderWidth: 1.5, borderStyle: updates ? "solid" : "dashed", borderColor: updates ? palette.blue : palette.muted, alignItems: "center", justifyContent: "center" }}>
      {updates > 0 && <Animated.View entering={reduced ? undefined : riseIn({ delay: 70 * index + 220, distance: 0, scale: 0.6, duration: 380 })} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: palette.blue }} />}
    </View>
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: "600", color: palette.ink }}>{title}</Text>
      <Text selectable style={{ fontSize: 15, lineHeight: 21, color: palette.muted }}>{detail}</Text>
      {updates > 0 && <Text style={{ fontSize: 13, lineHeight: 18, color: palette.blue }}>{recorded}</Text>}
    </View>
  </Animated.View>;
}

export function ReasoningCard({ patient, result, onSource, onOpen, onRequest }: FeatureProps) {
  const { encounters } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const layout = reducedMotion ? undefined : LAYOUT;
  const [open, setOpen] = useState<string[]>([]);
  const facts = (encounters[patient.id]?.historyFacts ?? []).filter(fact => !result || fact.revision <= result.revision);
  const presentingSource = facts.findLast(fact => fact.category === "presenting")?.id ?? "history";
  const medicalSource = facts.findLast(fact => fact.category === "medical")?.id ?? "history";
  const toggle = (id: string) => setOpen(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
  // One quiet provenance line replaces the section subtitle, the complaint quote and the sources caption.
  const provenance = patient.incomplete
    ? "An authored clinical example, not a model diagnosis. Missing findings don’t rule anything in or out."
    : "Unranked. An authored clinical example, not a model diagnosis. Sources give background, not confirmation.";
  const takeaways: Takeaway[] = patient.incomplete
    ? [{ tone: "caution", text: "Not enough history yet to weigh possibilities" }, { tone: "info", text: "Collect onset, observations and background first" }, { tone: "caution", text: "Allergy and medicines are unknown" }]
    : [{ tone: "info", text: "Two unranked possibilities: pneumonia and an asthma contribution" }, { tone: "caution", text: "Chest examination and imaging are still needed" }, { tone: "good", text: "Long history of asthma; current control needs review" }];
  // Live mode: the server answers the question asked, above the authored possibilities it does not replace.
  const question = encounters[patient.id]?.requests.find(r => r.id === result?.requestId)?.prompt || "What could explain these symptoms?";
  const server = useLiveReasoning(patient.encounterId, result?.requestId, question);
  return <View style={{ gap: 20 }}>
    {server.live && <Surface feature style={{ padding: 16, gap: 10 }}>
      {server.loading ? <Drafting label="Weighing the record…" /> : server.data ? <>
        <Arrive><Text selectable style={{ fontSize: 16, lineHeight: 24, color: palette.ink }}>{server.data.answer}</Text></Arrive>
        <Arrive index={1}><SampleLabel source={server.data.source} /></Arrive>
      </> : <Text style={{ fontSize: 13, lineHeight: 18, color: palette.red }}>{server.error}</Text>}
    </Surface>}
    <Takeaways items={takeaways} />
    <Anchor id="possibilities" title={patient.incomplete ? "Gaps" : "Possibilities"}>
    <Section icon={patient.incomplete ? "checklist" : "lightbulb"} tone={patient.incomplete ? "amber" : "violet"} title={patient.incomplete ? "What to collect first" : "Possibilities to explore"}>
      {!patient.incomplete && <Surface layout={layout} style={{ paddingHorizontal: 16 }}>
        {possibilities(patient, presentingSource, medicalSource).map((item, index) => <Disclosure key={item.id} first={index === 0} icon={item.icon} title={item.title} detail={item.summary}
          open={open.includes(item.id)} onToggle={() => toggle(item.id)} accessibilityHint="Shows what supports it, what conflicts and what is still needed">
          {EVIDENCE.map(([key, icon, label], row) => <Animated.View key={key} entering={reducedMotion ? undefined : riseIn({ delay: 60 + 40 * row, distance: 6, duration: 260 })} style={{ paddingLeft: 6 }}>
            <IconRow icon={icon} title={label} detail={item.evidence[key]} />
          </Animated.View>)}
          {item.xray && <Action label="Review the X-ray attachment" icon="photo" secondary onPress={() => onRequest("xray")} />}
        </Disclosure>)}
        {/* Registered outside the disclosures so the section's sources pill counts them while collapsed. */}
        {possibilities(patient, presentingSource, medicalSource).flatMap(item => item.sources).map(source => <SourceRef key={source.label} id={source.label} label={source.label} kind={source.kind} onPress={() => onSource(source.id)} />)}
      </Surface>}
      {patient.incomplete && <Surface style={{ paddingHorizontal: 16 }}>
        {GAPS.map((gap, index) => <GapRow key={gap.title} title={gap.title} detail={gap.detail} index={index} reduced={reducedMotion} updates={facts.filter(fact => gap.categories.includes(fact.category)).length} />)}
      </Surface>}
      <Animated.View layout={layout} style={{ gap: 2 }}>
        <Caption>{provenance}</Caption>
        {patient.incomplete && <View style={{ paddingLeft: 22 }}><SourceRef label="Patient context used" kind="record" onPress={() => onSource(presentingSource)} /></View>}
      </Animated.View>
      {patient.incomplete && <Notice warning>A ranked differential and treatment suggestions are unavailable in this fixture.</Notice>}
    </Section>
    </Anchor>
    <Anchor id="history" title="History" icon="person.text.rectangle" tone="teal"><HistoryEditor patient={patient} result={result} onSource={onSource} onRequest={onRequest} refresh="reasoning" /></Anchor>
    <Anchor id="next" title="Next"><Animated.View layout={layout}>
      <Card feature label="Next step" title={patient.incomplete ? "Start with the missing history" : "Bring the assessment into the note"}>
        {!patient.incomplete && <Body muted>Add examination findings and your assessment. Keep patient facts distinct from these possibilities.</Body>}
        {patient.incomplete && <Action label="Capture the missing history" icon="waveform" onPress={() => onOpen("recording")} />}
        <Action label="Open consultation note" icon="square.and.pencil" secondary={patient.incomplete} onPress={() => onOpen("note")} />
      </Card>
    </Animated.View></Anchor>
  </View>;
}
