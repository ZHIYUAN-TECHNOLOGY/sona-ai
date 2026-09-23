import { Text } from "@/components/sona/text";
import { useState } from "react";
import { View } from "react-native";
import { Action, Body, Card, Icon, Label, Notice, Reveal, SourceLink } from "@/components/sona/ui";
import { GlanceTile, IconRow, Section, Shelf } from "@/components/sona/sections";
import { TimelineCarousel, type TimelineItem } from "@/components/sona/timeline-carousel";
import { Pill } from "@/features/encounter/conversation";
import { palette } from "@/components/sona/theme";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { EvidenceCard } from "./controls";
import { HistoryEditor } from "./history-editor";
import { MedicationEditor } from "./medication-editor";
import { InteractionResults } from "./interaction-results";
export { PrescriptionPanel as PrescriptionCard } from "./prescription-panel";

function Fact({ label, value }: { label: string; value: string }) {
  return <View style={{ gap: 5 }}><Label muted>{label}</Label><Body>{value}</Body></View>;
}

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

export function ReasoningCard({ patient, result, onSource, onOpen, onRequest }: FeatureProps) {
  const { encounters } = useEncounter();
  const facts = (encounters[patient.id]?.historyFacts ?? []).filter(fact => !result || fact.revision <= result.revision);
  const presentingSource = facts.findLast(fact => fact.category === "presenting")?.id ?? "history";
  const medicalSource = facts.findLast(fact => fact.category === "medical")?.id ?? "history";
  return <View style={{ gap: 14 }}>
    <Card label="Clinical reasoning" title={patient.incomplete ? "More context is needed" : "Possibilities to explore"}>
      <Body>{patient.complaint}</Body>
      <Notice>Authored clinical example, not a model diagnosis. Possibilities are unranked; source material provides background, not confirmation for this fictional patient.</Notice>
      <SourceLink label="Patient context used" onPress={() => onSource(presentingSource)} />
      {!!facts.length && <Notice>Updated context includes {facts.length} recorded history {facts.length === 1 ? "change" : "changes"}. The evidence sections below use this result's saved patient context.</Notice>}
    </Card>
    {patient.incomplete ? <Card label="Information gaps" title="Build the clinical picture">
      <Fact label="Presenting history" value="Clarify onset, duration, progression and associated symptoms." />
      <Fact label="Observations" value="No observations or examination have been documented." />
      <Fact label="Background" value="Medical history, medicines, allergies and family/social history remain incomplete." />
      <Notice warning>A ranked differential and treatment suggestions are unavailable in this fixture.</Notice>
      <Action label="Capture the missing history" icon="waveform" onPress={() => onOpen("recording")} />
    </Card> : <>
      <EvidenceCard title="Pneumonia considered" summary="Explore the cause of respiratory symptoms alongside the recorded history." rows={[
        { label: "Recorded context", text: patient.complaint },
        { label: "Supporting context", text: /cough/i.test(patient.complaint) && /fever/i.test(patient.complaint) ? "Cough and fever overlap with symptoms described by the NHS." : "The presenting history has changed. The original cough-and-fever rationale needs reassessment." },
        { label: "Conflicting evidence", text: "No specific contradictory finding is documented. Missing findings do not rule this possibility in or out." },
        { label: "Still needed", text: "Chest examination and relevant imaging findings. The available history does not establish pneumonia." },
      ]}>
        <SourceLink label="Patient history" onPress={() => onSource(presentingSource)} />
        <SourceLink label="NHS · pneumonia background" onPress={() => onSource("pneumonia-reference")} />
        <Action label="Review the X-ray attachment" icon="photo" secondary onPress={() => onRequest("xray")} />
      </EvidenceCard>
      <EvidenceCard title="Asthma contribution" summary="Consider the recorded asthma history without assuming it explains the current episode." rows={[
        { label: "Recorded medical context", text: patient.history.join(". ") },
        { label: "Supporting context", text: "Cough can occur with asthma, but other conditions can also cause it. Reported inhaler use needs reconciliation." },
        { label: "Conflicting evidence", text: "No specific contradictory finding is documented. The record does not establish that asthma explains this episode." },
        { label: "Still needed", text: "Current symptom control, reliever frequency, airflow assessment and examination findings. Wheeze has not been documented." },
      ]}>
        <SourceLink label="Medical history used" onPress={() => onSource(medicalSource)} />
        <SourceLink label="NHLBI · asthma symptoms" onPress={() => onSource("asthma-reference")} />
      </EvidenceCard>
    </>}
    <HistoryEditor patient={patient} result={result} onSource={onSource} onRequest={onRequest} refresh="reasoning" />
    <Card label="Next step" title="Bring the assessment into the note">
      <Body muted>{patient.incomplete ? "Capture the missing history before adding an assessment." : "Record examination findings and your assessment alongside the captured history. Keep patient facts distinct from these exploratory possibilities."}</Body>
      <Action label="Open consultation note" icon="square.and.pencil" secondary onPress={() => onOpen("note")} />
    </Card>
  </View>;
}

export function MedicationCard({ patient, onSource, onRequest, onOpen }: FeatureProps) {
  const [previewAlert, setPreviewAlert] = useState(false);
  const { encounters } = useEncounter();
  const encounter = encounters[patient.id];
  const reviewed = encounter?.medicationCheckedRevision === encounter?.revision && encounter?.medicationCheckedRevision !== undefined;
  const confirmed = Boolean(encounter?.medicationEntries?.length && encounter.medicationEntries.every(entry => entry.confirmed && entry.ingredient.trim() && entry.formulation.trim()));
  const busy = encounter?.requests.some(request => request.status === "streaming") ?? false;
  return <View style={{ gap: 14 }}>
    <Card label="Medication review" title="Reconcile before interpreting" footer={<SourceLink label="Medication coverage & limits" onPress={() => onSource("medication")} />}>
      <Label muted>Patient-reported medicines</Label>
      {patient.medicines.map((medicine, index) => <View key={`${medicine}-${index}`} style={{ flexDirection: "row", gap: 10, paddingVertical: 9, borderBottomWidth: index === patient.medicines.length - 1 ? 0 : 1, borderColor: palette.line }}><Icon name="pills" color={palette.blue} size={20} /><View style={{ flex: 1 }}><Body>{medicine}</Body></View></View>)}
      <Fact label="Allergy record" value={patient.allergies ?? "Unknown — collect an allergy history"} />
      <SourceLink label="Original intake & allergy record" onPress={() => onSource("history")} />
    </Card>
    <MedicationEditor patient={patient} onRequest={onRequest} />
    <InteractionResults patient={patient} onSource={onSource} onRequest={onRequest} />
    <Card label="Interaction coverage" title="Unable to complete a clinical check">
      <Notice warning>{!confirmed ? "One or more medication identities remain unconfirmed. Resolve each ingredient and formulation in the reconciliation form." : "Medication identities are confirmed for the simulation. Clinical interaction coverage remains unvalidated."}</Notice>
      <Body>No validated drug-interaction database is connected. This fixture cannot clear a medicine or establish that a combination is safe.</Body>
      <Fact label="Simulation workflow" value={reviewed ? "Medication-review step recorded for the current encounter. Bounded fixture checks are available for the authored prescribing simulation; this is not clinical interaction clearance." : "Review is not current for this encounter revision. Run the review again before the prescribing simulation."} />
      <Action label={reviewed ? "Run review again" : "Run medication review"} icon="arrow.clockwise" secondary disabled={busy} onPress={() => onRequest("medication")} />
      <Action label="Open consultation note" icon="square.and.pencil" secondary onPress={() => onOpen("note")} />
      <Action label="Run prescribing simulation" icon="doc.badge.plus" disabled={busy} onPress={() => onRequest("prescription")} />
    </Card>
    {patient.sources.some(source => source.id === "beta-reference") && <Card label="Interaction example" title="See how a sourced alert appears">
      <Action label={previewAlert ? "Hide interaction example" : "Preview an interaction alert"} icon={previewAlert ? "chevron.up" : "chevron.down"} secondary onPress={() => setPreviewAlert(current => !current)} />
      {previewAlert && <>
        <Notice>Example combination — not detected in this patient. No beta-blocker has been added to the medication list.</Notice>
        <Fact label="Example pair" value="Albuterol + beta-blocker class" />
        <Fact label="Label warning" value="Beta-blockers can reduce albuterol’s bronchodilator effect and may cause severe bronchospasm in people with asthma." />
        <Fact label="Why the alert appears" value="The beta-blocker class can oppose the airway effects of a beta-agonist. The source describes a class interaction, not an evaluated combination for this patient." />
        <SourceLink label="DailyMed · section 7.1" onPress={() => onSource("beta-reference")} />
      </>}
    </Card>}
  </View>;
}
