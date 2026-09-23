import { useState } from "react";
import { Linking, View } from "react-native";
import { Action, Body, Card, Label, Notice, SourceLink } from "@/components/sona/ui";
import { defaultMedications } from "@/features/encounter/clinical-state";
import { patients as baselinePatients } from "@/features/encounter/fixtures";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { betaBlockerAlert, interactionSource, lookupInteractionPairs } from "./interaction-lookup";

export function InteractionResults({ patient, onSource, onRequest }: Pick<FeatureProps, "patient" | "onSource" | "onRequest">) {
  const { encounters, updateEncounter } = useEncounter();
  const encounter = encounters[patient.id];
  const [sourceFailed, setSourceFailed] = useState(false);
  const baseline = baselinePatients.find(value => value.id === patient.id) ?? patient;
  const current = encounter?.medicationCheckedRevision === encounter?.revision && encounter?.medicationCheckedRevision !== undefined;
  const busy = encounter?.requests.some(request => request.status === "streaming") ?? false;
  const pairs = lookupInteractionPairs(encounter?.medicationEntries ?? defaultMedications(baseline), encounter?.proposedMedicine ?? "Paracetamol");
  const alerts = pairs.filter(pair => pair.status === "alert");
  return <Card label="Current entered combinations" title={!current ? "Recheck the changed medicines" : alerts.length ? "Sourced class interaction found" : "No covered interaction result"}>
    <Body muted>Evaluates the entered medicines and proposed ingredient against one DailyMed class-interaction rule. Uncovered pairs remain unresolved; no comprehensive database is connected.</Body>
    {!current ? <><Notice>The medicine list or encounter changed. Run review before treating these combinations as evaluated.</Notice><Action label="Check entered combinations" disabled={busy} onPress={() => onRequest("medication")} /></> : pairs.length ? pairs.map(pair => <View key={pair.id} style={{ gap: 9, paddingVertical: 10 }}>
      <Label muted>{pair.status === "alert" ? "Label-backed class alert" : pair.status === "unresolved" ? "Ingredient unresolved" : "Coverage unavailable"}</Label><Body>{pair.left} + {pair.right}</Body>
      {pair.status === "alert" ? <><Notice warning>{pair.detail}</Notice><Body muted>{betaBlockerAlert.qualifiers}</Body><SourceLink label={interactionSource.title} onPress={() => {
        if (patient.sources.some(source => source.id === interactionSource.id)) onSource(interactionSource.id);
        else void Linking.openURL(interactionSource.url).catch(() => setSourceFailed(true));
      }} /></> : <Body muted>{pair.detail}</Body>}
    </View>) : <Notice>No medication pair is available to evaluate.</Notice>}
    {sourceFailed && <Notice warning>The reference page could not be opened. The citation remains DailyMed, Albuterol HFA, section 7.1.</Notice>}
    <Label muted>Explicit fixture controls</Label>
    <Body muted>Loading the example replaces the current reported list with confirmed albuterol and propranolol fixture entries. It keeps paracetamol as the proposed ingredient and invalidates the review.</Body>
    <Action label="Load interaction example · replace medicines" secondary disabled={busy} onPress={() => updateEncounter(value => ({ ...value, medicationEntries: [
      { id: "medicine-0", name: "Albuterol · loaded interaction fixture", ingredient: "albuterol", formulation: "inhaler", confirmed: true },
      { id: "medicine-1", name: "Propranolol · loaded interaction fixture", ingredient: "propranolol", formulation: "tablet", confirmed: true },
    ], proposedMedicine: "Paracetamol", medicationDraft: undefined }), true)} />
    <Action label="Restore baseline reported medicines" secondary disabled={busy} onPress={() => updateEncounter(value => ({ ...value, medicationEntries: defaultMedications(baseline), proposedMedicine: "Paracetamol", medicationDraft: undefined }), true)} />
  </Card>;
}
