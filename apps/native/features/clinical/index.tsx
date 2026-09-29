import type { ReactNode } from "react";
import { View } from "react-native";
import { AnswerDeck, Takeaways, type Takeaway } from "@/components/sona/answer-kit";
import { MarkedText } from "@/components/sona/marked-text";
import { Drafting, SampleLabel } from "@/components/sona/model-answer";
import { SourceScope, SourcesPill } from "@/components/sona/sources";
import { useLiveBriefing } from "@/features/live/model-sync";
import { Chip, Notice, SourceLink, Surface } from "@/components/sona/ui";
import { IconRow } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { VitalsCard } from "./vitals-card";
import type { TimelineItem } from "@/components/sona/timeline-carousel";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { HistoryEditor } from "./history-editor";
import { defaultMedications } from "@/features/encounter/clinical-state";
import { emphasise } from "@/features/encounter/emphasis";
export { PrescriptionPanel as PrescriptionCard } from "./prescription-panel";
export { ReasoningCard } from "./reasoning-card";
export { MedicationCard } from "./medication-card";

export function BriefingCard({ patient, result, onSource, onOpen, onRequest }: FeatureProps) {
  const { encounters } = useEncounter();
  const facts = (encounters[patient.id]?.historyFacts ?? []).filter(fact => !result || fact.revision <= result.revision);
  const sourceFor = (category: string) => facts.findLast(fact => fact.category === category)?.id ?? "history";
  const sections = result?.sections ?? 3;
  const timeline: TimelineItem[] = patient.incomplete ? [
    { id: "onset", label: "Onset", icon: "questionmark", glyph: "❔", title: "Not documented", meta: "Gap in the history", body: "When the breathlessness began, and how it has changed, is not yet recorded." },
    { id: "intake", label: "22 Sep", icon: "stethoscope", glyph: "🩺", title: "Intake", meta: "This encounter · 09:45", body: "Breathlessness on exertion recorded. Onset and previous course have not been documented." },
  ] : [
    { id: "background", label: "Childhood", icon: "lungs", glyph: "🫁", title: "Asthma", meta: "Background · intake", body: "Asthma since childhood, according to the fictional intake." },
    { id: "cough", label: "5 days ago", icon: "wind", glyph: "😮‍💨", title: "Cough begins", meta: "Patient report", body: "The patient reports that the cough began five days before intake." },
    { id: "fever", label: "Yesterday", icon: "thermometer.medium", glyph: "🌡️", title: "Fever starts", meta: "Patient report", body: "Fever started the day before intake, according to the patient." },
    { id: "today", label: "Today", icon: "stethoscope", glyph: "🩺", title: "Respiratory review", meta: "22 Sep · this encounter", body: "Respiratory review with recorded observations." },
  ];
  const takeaways: Takeaway[] = patient.incomplete
    ? [{ tone: "caution", text: "Onset, observations and background are missing" }, { tone: "info", text: "Breathlessness on exertion is the only recorded complaint" }, { tone: "caution", text: "Medicines and allergies are unknown" }]
    : [{ tone: "caution", text: `Temperature ${patient.vitals.find(v => v.label === "Temp")?.value ?? ""} is the only raised vital` }, { tone: "caution", text: `${patient.allergies?.split(" — ")[0] ?? "Allergy"} allergy still needs confirming` }];
  // Each page gathers its sources into one pill at the bottom instead of links under every row.
  const card = (children: ReactNode) => <SourceScope>{sources => <Surface style={{ padding: 16, gap: 14 }}>{children}{sources.length > 0 && <View style={{ alignItems: "flex-end" }}><SourcesPill sources={sources} /></View>}</Surface>}</SourceScope>;
  // Live mode: the digest is the server's briefing of this patient's record (allergy and gaps stay amber); authored otherwise.
  const server = useLiveBriefing(patient.encounterId);
  // The callout holds only what the headline doesn't already say, coloured only where abnormal.
  const digest: Takeaway[] = (server.data ? server.data.lines.map((text): Takeaway => ({ tone: /allerg|incomplete|missing/i.test(text) ? "caution" : "info", text })) : takeaways)
    .filter(item => !patient.complaint.includes(item.text)).map(item => ({ ...item, text: emphasise(item.text, patient) }));
  // The suggested next step sits under the headline with its action, rather than as a last page.
  const unconfirmed = (encounters[patient.id]?.medicationEntries ?? defaultMedications(patient)).some(m => !m.confirmed);
  const next = patient.incomplete ? { text: "Complete medicines, allergies and history before any treatment.", label: "Start consultation", go: () => onOpen("recording") }
    : unconfirmed ? { text: "Confirm medicines and the allergy, then start the consultation.", label: "Confirm", go: () => onRequest("medication") }
    : { text: "Medicines confirmed. Start the consultation.", label: "Start consultation", go: () => onOpen("recording") };
  // Next step, digest, then the detail as swipeable pages (briefing is a glance before the visit).
  return <View style={{ gap: 20 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4 }}>
      <Text style={{ flex: 1, ...type.subhead, color: palette.ink }}><Text style={{ fontWeight: "600", color: palette.blue }}>Next · </Text>{next.text}</Text>
      <Chip label={next.label} filled accessibilityLabel={`${next.label}. ${next.text}`} onPress={next.go} />
    </View>
    {server.loading ? <Surface feature style={{ padding: 16 }}><Drafting label="Reading the record…" /></Surface> : <View style={{ gap: 6 }}>
      {digest.length > 0 && <Takeaways items={digest} />}
      <View style={{ paddingHorizontal: 4 }}>
        <SampleLabel source={server.data?.source} what="briefing" />
        {server.error && <Text style={{ ...type.caption, color: palette.red }}>{server.error} · showing the authored briefing</Text>}
      </View>
    </View>}
    {sections >= 2 && <AnswerDeck pages={[
      { title: "Vitals", content: patient.incomplete ? card(<Notice warning>Not recorded yet. Missing information is not a negative finding.</Notice>) : <VitalsCard vitals={patient.vitals} allergy={patient.allergies} /> },
      { title: "Timeline", content: card(<>
        {timeline.map(item => <View key={item.id} style={{ flexDirection: "row", gap: 12 }}>
          <Text style={{ width: 78, ...type.footnote, color: palette.muted }}>{item.label}</Text>
          <View style={{ flex: 1, gap: 2 }}><MarkedText text={item.title} style={{ ...type.callout, fontWeight: "600", color: palette.ink }} /><Text style={{ ...type.footnote, color: palette.muted }}>{item.meta}</Text></View>
        </View>)}
        {!!facts.length && <Text style={{ ...type.footnote, color: palette.muted }}>Original intake shown · newer history is below.</Text>}
        <SourceLink label="Timeline source" onPress={() => onSource("history")} />
      </>) },
      { title: "History", content: card(<>
        <IconRow icon="cross.case" title="Medical" detail={patient.history.join(". ")} sourceLabel="Medical history source" onSource={() => onSource(sourceFor("medical"))} />
        <IconRow icon="figure.2.and.child.holdinghands" title="Family" detail={patient.family} sourceLabel="Family history source" onSource={() => onSource(sourceFor("family"))} />
        <IconRow icon="house" title="Social" detail={patient.social} sourceLabel="Social history source" onSource={() => onSource(sourceFor("social"))} />
      </>) },
    ]} />}
    {sections >= 3 && <HistoryEditor patient={patient} result={result} onSource={onSource} onRequest={onRequest} refresh="briefing" />}
  </View>;
}
