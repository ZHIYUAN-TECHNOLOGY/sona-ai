import { useState } from "react";
import { View } from "react-native";
import { Action, Body, Card, Icon, Label, Notice, SourceLink } from "@/components/sona/ui";
import { palette } from "@/components/sona/theme";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { InteractionResults } from "./interaction-results";
import { MedicationEditor } from "./medication-editor";

function Fact({ label, value }: { label: string; value: string }) {
  return <View style={{ gap: 5 }}><Label muted>{label}</Label><Body>{value}</Body></View>;
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
