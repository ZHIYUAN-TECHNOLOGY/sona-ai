import { View } from "react-native";
import { Action, Body, Card, Label, Notice } from "@/components/sona/ui";
import { defaultMedications } from "@/features/encounter/clinical-state";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { ClinicalField } from "./controls";

export function MedicationEditor({ patient, onRequest }: Pick<FeatureProps, "patient" | "onRequest">) {
  const { encounters, updateEncounter } = useEncounter();
  const encounter = encounters[patient.id];
  const entries = encounter?.medicationEntries ?? defaultMedications(patient);
  const draft = encounter?.medicationDraft;
  const proposed = encounter?.proposedMedicineDraft ?? encounter?.proposedMedicine ?? "Paracetamol";
  const editProposed = encounter?.proposedMedicineDraft !== undefined;
  const busy = encounter?.requests.some(request => request.status === "streaming") ?? false;
  return <Card label="Current reconciliation" title="Confirm what is being taken">
    <Body muted>Confirm ingredients and formulations from the synthetic record. Names are editable; unknown entries remain unresolved.</Body>
    {entries.map(entry => <View key={entry.id} style={{ gap: 8, paddingVertical: 9 }}>
      <Label muted>{entry.confirmed ? "Confirmed in simulation" : "Needs confirmation"}</Label>
      <Body>{entry.name}</Body><Body muted>{entry.ingredient || "Ingredient unknown"} · {entry.formulation || "Formulation unknown"}</Body>
      <Action label={draft?.id === entry.id ? "Editing this medicine" : entry.confirmed ? "Correct this medicine" : "Confirm ingredient & formulation"} secondary disabled={Boolean(draft)} onPress={() => updateEncounter(value => ({ ...value, medicationDraft: { ...entry } }))} />
    </View>)}
    {draft && <View style={{ gap: 14 }}>
      <ClinicalField label="Recorded medicine name" value={draft.name} onChange={name => updateEncounter(value => ({ ...value, medicationDraft: value.medicationDraft ? { ...value.medicationDraft, name, confirmed: false } : undefined }))} />
      <ClinicalField label="Active ingredient" value={draft.ingredient} onChange={ingredient => updateEncounter(value => ({ ...value, medicationDraft: value.medicationDraft ? { ...value.medicationDraft, ingredient, confirmed: false } : undefined }))} />
      <ClinicalField label="Formulation" value={draft.formulation} onChange={formulation => updateEncounter(value => ({ ...value, medicationDraft: value.medicationDraft ? { ...value.medicationDraft, formulation, confirmed: false } : undefined }))} />
      <Action label="Save confirmed identity" disabled={!draft.name.trim() || !draft.ingredient.trim() || !draft.formulation.trim()} onPress={() => updateEncounter(value => ({ ...value, medicationEntries: (value.medicationEntries ?? entries).map(entry => entry.id === draft.id ? { ...draft, name: draft.name.trim(), ingredient: draft.ingredient.trim(), formulation: draft.formulation.trim(), confirmed: true } : entry), medicationDraft: undefined }), true)} />
      <Action label="Keep unresolved" secondary onPress={() => updateEncounter(value => ({ ...value, medicationEntries: (value.medicationEntries ?? entries).map(entry => entry.id === draft.id ? { ...draft, confirmed: false } : entry), medicationDraft: undefined }), true)} />
      <Action label="Discard medicine edit" secondary onPress={() => updateEncounter(value => ({ ...value, medicationDraft: undefined }))} />
    </View>}
    <Label>Proposed medicine</Label><Body>{encounter?.proposedMedicine ?? "Paracetamol"}</Body>
    {editProposed ? <><ClinicalField label="Proposed medication" value={proposed} onChange={proposedMedicineDraft => updateEncounter(value => ({ ...value, proposedMedicineDraft }))} /><Action label="Save proposed medicine" disabled={!proposed.trim()} onPress={() => updateEncounter(value => ({ ...value, proposedMedicine: proposed.trim(), proposedMedicineDraft: undefined }), true)} /><Action label="Cancel proposed change" secondary onPress={() => updateEncounter(value => ({ ...value, proposedMedicineDraft: undefined }))} /></> : <Action label="Change proposed medicine" secondary onPress={() => updateEncounter(value => ({ ...value, proposedMedicineDraft: value.proposedMedicine ?? "Paracetamol" }))} />}
    <Notice>Saving a correction invalidates earlier medication checks. The authored paracetamol scenario has bounded simulated coverage; other combinations may remain unsupported.</Notice>
    <Action label="Review current medication context" icon="arrow.clockwise" disabled={busy || Boolean(draft)} onPress={() => onRequest("medication")} />
  </Card>;
}
