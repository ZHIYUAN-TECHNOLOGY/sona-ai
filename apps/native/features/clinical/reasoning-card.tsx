import { View } from "react-native";
import { Action, Body, Card, Label, Notice, SourceLink } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { EvidenceCard } from "./controls";
import { HistoryEditor } from "./history-editor";

function Fact({ label, value }: { label: string; value: string }) {
  return <View style={{ gap: 5 }}><Label muted>{label}</Label><Body>{value}</Body></View>;
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
    <Card feature label="Next step" title="Bring the assessment into the note">
      <Body muted>{patient.incomplete ? "Capture the missing history before adding an assessment." : "Record examination findings and your assessment alongside the captured history. Keep patient facts distinct from these exploratory possibilities."}</Body>
      <Action label="Open consultation note" icon="square.and.pencil" secondary onPress={() => onOpen("note")} />
    </Card>
  </View>;
}
