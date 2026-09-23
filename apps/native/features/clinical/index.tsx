import { View } from "react-native";
import { Notice, Reveal, SourceLink } from "@/components/sona/ui";
import { GlanceTile, IconRow, Section, Shelf } from "@/components/sona/sections";
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
  const glyphs: Record<string, string> = { "SpO₂": "🫁", Temp: "🌡️", Pulse: "🫀" };
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
    <Section title="At a glance" subtitle={patient.incomplete ? "Observations haven’t been recorded yet." : "Recorded observations · 22 Sep, 09:26"}>
      {patient.incomplete
        ? <Notice warning>Onset, observations and background history are missing. Missing information is not a negative finding.</Notice>
        : <Shelf>
          {patient.vitals.map(vital => <GlanceTile key={vital.label} value={vital.value} label={vital.label} caption="Synthetic observation" glyph={glyphs[vital.label]} />)}
          <GlanceTile value={patient.allergies ? patient.allergies.split(" — ")[0]! : "Unknown"} label="Allergy" caption={patient.allergies ? "Reported rash · to confirm" : "History still needed"} glyph="⚠️" />
        </Shelf>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 18 }}>
        {!patient.incomplete && <SourceLink label="Recorded observations · 22 Sep, 09:26" onPress={() => onSource("vitals")} />}
        <SourceLink label="Presenting history source" onPress={() => onSource(sourceFor("presenting"))} />
      </View>
    </Section>
    {sections >= 2 && <Reveal><Section title="How it unfolded" subtitle={patient.incomplete ? "Only the intake is on record so far." : "Swipe through the original intake, from background to today."}>
      {!!facts.length && <Notice>New history has been recorded. This timeline preserves the original intake; updated facts appear in the current context below.</Notice>}
      <TimelineCarousel items={timeline} />
      <SourceLink label="Timeline source" onPress={() => onSource("history")} />
    </Section></Reveal>}
    {sections >= 3 && <Reveal><Section title="History that matters" subtitle="The whole-patient context behind this visit.">
      <View style={{ gap: 20 }}>
        <IconRow icon="cross.case" title="Medical" detail={patient.history.join(". ")} sourceLabel="Medical history source" onSource={() => onSource(sourceFor("medical"))} />
        <IconRow icon="figure.2.and.child.holdinghands" title="Family" detail={patient.family} sourceLabel="Family history source" onSource={() => onSource(sourceFor("family"))} />
        <IconRow icon="house" title="Social" detail={patient.social} sourceLabel="Social history source" onSource={() => onSource(sourceFor("social"))} />
        <IconRow icon="allergens" title="Allergies" detail={patient.allergies ?? "Not documented — history still needed"} sourceLabel="Allergy history source" onSource={() => onSource(sourceFor("allergy"))} />
      </View>
      <Notice warning>{patient.incomplete ? "Complete the medication, allergy and family/social history before using this encounter in a treatment simulation." : "Medication reconciliation and the reported allergy details still need confirmation. This summary contains synthetic record facts."}</Notice>
      <SourceLink label="History provenance" onPress={() => onSource("history")} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pill label="Start the consultation" emoji="🎙️" onPress={() => onOpen("recording")} />
        <Pill label="Explore clinical questions" emoji="🔎" onPress={() => onRequest("reasoning")} />
      </View>
    </Section></Reveal>}
    {sections >= 3 && <HistoryEditor patient={patient} result={result} onSource={onSource} onRequest={onRequest} refresh="briefing" />}
  </View>;
}
