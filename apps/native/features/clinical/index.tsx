import { View } from "react-native";
import { Notice, Reveal, SourceLink } from "@/components/sona/ui";
import { IconRow, Section } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { VitalsCard } from "./vitals-card";
import { TimelineCarousel, type TimelineItem } from "@/components/sona/timeline-carousel";
import { Pill } from "@/features/encounter/conversation";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { HistoryEditor } from "./history-editor";
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
  return <View style={{ gap: 34 }}>
    <Section title="Vitals">
      {patient.incomplete
        ? <Notice warning>Not recorded yet. Missing information is not a negative finding.</Notice>
        : <VitalsCard vitals={patient.vitals} allergy={patient.allergies} onSource={() => onSource("vitals")} />}
    </Section>
    {sections >= 2 && <Reveal><Section title="How it unfolded" subtitle={patient.incomplete ? "Only the intake so far." : "Swipe from background to today."}>
      {!!facts.length && <Text style={{ ...type.footnote, color: palette.muted }}>Original intake shown · newer history is below.</Text>}
      <TimelineCarousel items={timeline} />
      <SourceLink label="Timeline source" onPress={() => onSource("history")} />
    </Section></Reveal>}
    {sections >= 3 && <Reveal><Section title="History that matters">
      <View style={{ gap: 20 }}>
        <IconRow icon="cross.case" title="Medical" detail={patient.history.join(". ")} sourceLabel="Medical history source" onSource={() => onSource(sourceFor("medical"))} />
        <IconRow icon="figure.2.and.child.holdinghands" title="Family" detail={patient.family} sourceLabel="Family history source" onSource={() => onSource(sourceFor("family"))} />
        <IconRow icon="house" title="Social" detail={patient.social} sourceLabel="Social history source" onSource={() => onSource(sourceFor("social"))} />
        <IconRow icon="allergens" title="Allergies" detail={patient.allergies ?? "Not documented — history still needed"} sourceLabel="Allergy history source" onSource={() => onSource(sourceFor("allergy"))} />
      </View>
      <Notice warning>{patient.incomplete ? "Complete medicines, allergies and family/social history before any treatment simulation." : "Medicines and the reported allergy still need confirming."}</Notice>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pill label="Start the consultation" emoji="🎙️" onPress={() => onOpen("recording")} />
        <Pill label="Explore clinical questions" emoji="🔎" onPress={() => onRequest("reasoning")} />
      </View>
    </Section></Reveal>}
    {sections >= 3 && <HistoryEditor patient={patient} result={result} onSource={onSource} onRequest={onRequest} refresh="briefing" />}
  </View>;
}
