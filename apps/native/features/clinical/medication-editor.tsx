import { useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { Section } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Surface } from "@/components/sona/ui";
import { defaultMedications, parseRegimen, regimenLine } from "@/features/encounter/clinical-state";
import { useEncounterSelect } from "@/features/encounter/store";
import type { FeatureProps, MedicationEntry, Patient } from "@/features/encounter/types";
import { useEncounterEdit } from "@/features/live/sync";
import { ClinicalField } from "./controls";
import { Footnote, FormReveal, Hairline, Press, useLayoutSpring } from "./medication-parts";
import { resolveMedicine } from "./medicine-catalog";
import { MedicineThumb } from "./medicine-thumb";

/**
 * The regimen the clinician proposes for this patient, entered field by field; nothing is filled in for them. Saving writes
 * the visit's one proposed line (regimenLine): a new revision, so the review and the dose rule run on exactly what was entered.
 * Shown where it is needed: under the proposed row here, and inside the prescribe card's "Bounded regimen" blocker.
 */
export function RegimenForm({ patient, onCancel }: { patient: Patient; onCancel?: () => void }) {
  const proposedMedicine = useEncounterSelect(s => s.encounters[patient.id]?.proposedMedicine);
  const edit = useEncounterEdit(patient);
  const [draft, setDraft] = useState(() => {
    const line = proposedMedicine, saved = parseRegimen(line);
    // A bare medicine name saved before regimens were entered keeps its name; the rest is still to enter.
    return saved ? { medication: saved.medication, strength: saved.formulation, dose: saved.dose, route: saved.route, hours: saved.frequency.match(/\d+/)?.[0] ?? "", days: saved.duration.match(/\d+/)?.[0] ?? "" }
      : { medication: line?.includes("·") ? "" : line ?? "", strength: "", dose: "", route: "", hours: "", days: "" };
  });
  if (!edit.allowed) return <Footnote>Needs a doctor to enter the regimen.</Footnote>;
  // "·" separates the saved line's parts, so it is kept out of them; the number fields take digits only.
  const text = (key: "medication" | "strength" | "route") => (value: string) => setDraft(d => ({ ...d, [key]: value.replace(/·/g, "") }));
  const digits = (key: "dose" | "hours" | "days") => (value: string) => setDraft(d => ({ ...d, [key]: value.replace(/[^0-9]/g, "") }));
  const complete = Object.values(draft).every(value => value.trim());
  const save = () => {
    const proposedMedicine = regimenLine({ medication: draft.medication, formulation: draft.strength, dose: draft.dose, unit: "mg", route: draft.route, frequency: `Every ${draft.hours} hours`, duration: `${draft.days} ${draft.days === "1" ? "day" : "days"}` });
    edit.save({ proposedMedicine }, value => ({ ...value, proposedMedicine, proposedMedicineDraft: undefined }));
  };
  return <View style={{ gap: 12 }}>
    <ClinicalField label="Medicine" value={draft.medication} onChange={text("medication")} />
    <ClinicalField label="Strength and form" value={draft.strength} onChange={text("strength")} />
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ flex: 1 }}><ClinicalField label="Dose (mg)" value={draft.dose} onChange={digits("dose")} keyboardType="number-pad" /></View>
      <View style={{ flex: 1 }}><ClinicalField label="Route" value={draft.route} onChange={text("route")} /></View>
    </View>
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ flex: 1 }}><ClinicalField label="Hours between doses" value={draft.hours} onChange={digits("hours")} keyboardType="number-pad" /></View>
      <View style={{ flex: 1 }}><ClinicalField label="Days" value={draft.days} onChange={digits("days")} keyboardType="number-pad" /></View>
    </View>
    <Action label={edit.saving ? "Saving…" : "Save regimen"} disabled={edit.saving || !complete} onPress={save} />
    {onCancel && <Action label="Cancel" secondary onPress={onCancel} />}
    {edit.error && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber }}>{edit.error}</Text>}
  </View>;
}

/**
 * Reconciliation checklist: one row per reported medicine with its confirmation state. Tapping a
 * row opens its identity form in place (one at a time); saving a correction revises the
 * encounter, which invalidates earlier medication checks. The proposed regimen closes the list:
 * empty until the clinician enters it. Review itself is requested from the next-step surface below.
 */
export function MedicationEditor({ patient }: Pick<FeatureProps, "patient" | "onRequest">) {
  const encounter = useEncounterSelect(s => s.encounters[patient.id]), updateEncounter = useEncounterSelect(s => s.updateEncounter);
  const layout = useLayoutSpring();
  const entries: MedicationEntry[] = encounter?.medicationEntries ?? defaultMedications(patient);
  const draft = encounter?.medicationDraft;
  const regimen = parseRegimen(encounter?.proposedMedicine);
  const editProposed = encounter?.proposedMedicineDraft !== undefined;
  const confirmed = entries.filter(entry => entry.confirmed).length;
  const editDraft = (change: Partial<MedicationEntry>) => updateEncounter(value => ({ ...value, medicationDraft: value.medicationDraft ? { ...value.medicationDraft, ...change, confirmed: false } : undefined }));
  // Live: each confirmation or correction is saved to the server as it happens (see useEncounterEdit).
  const edit = useEncounterEdit(patient);
  const saveEntry = (entry: MedicationEntry) => {
    const replace = (list: MedicationEntry[]) => list.map(item => item.id === entry.id ? entry : item);
    edit.save({ medicationEntries: replace(entries) }, value => ({ ...value, medicationEntries: replace(value.medicationEntries ?? entries), medicationDraft: undefined }));
  };
  const row = { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 13 } as const;

  return <Section icon="pills" tone="blue" title="Confirm what’s being taken" subtitle={`${confirmed} of ${entries.length} confirmed · unknown entries stay unresolved`}>
    <Surface layout={layout} style={{ paddingVertical: 4 }}>
      {entries.map((entry, index) => {
        const editing = draft?.id === entry.id;
        const identity = `${entry.ingredient || "Ingredient unknown"} · ${entry.formulation || "Formulation unknown"}`;
        const state = editing ? "Editing this medicine" : entry.confirmed ? "Confirmed" : "Needs confirmation";
        return <Animated.View key={entry.id} layout={layout}>
          {index > 0 && <Hairline inset={74} />}
          <Press disabled={Boolean(draft) || !edit.allowed} onPress={() => updateEncounter(value => ({ ...value, medicationDraft: { ...entry } }))}
            accessibilityLabel={`${entry.name}. ${identity}. ${state}`} accessibilityHint={draft || !edit.allowed ? undefined : entry.confirmed ? "Correct this medicine" : "Confirm ingredient and formulation"} style={[row, draft && !editing && { opacity: 0.5 }]}>
            <MedicineThumb look={resolveMedicine(entry.ingredient, entry.formulation)} confirmed={entry.confirmed} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.body, lineHeight: 22, fontWeight: "500", color: palette.ink }}>{entry.name}</Text>
              <Text style={{ ...type.subhead, lineHeight: 19, color: palette.muted }}>{identity}</Text>
              {/* A proposal from a scanned handwritten note waits here until the doctor confirms it. */}
              {entry.change && !entry.confirmed && <Text style={{ ...type.footnote, fontWeight: "600", color: entry.change === "new" ? palette.blue : entry.change === "changed" ? palette.amber : palette.muted }}>{entry.change === "new" ? "New" : entry.change === "changed" ? "Changed" : "Stopped"} · from a scanned note</Text>}
            </View>
            {!draft && edit.allowed && <Text style={{ ...type.subhead, fontWeight: "500", color: palette.blue }}>{entry.confirmed ? "Correct" : "Confirm"}</Text>}
          </Press>
          {editing && draft && <FormReveal style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
            <ClinicalField label="Recorded medicine name" value={draft.name} onChange={name => editDraft({ name })} />
            <ClinicalField label="Active ingredient" value={draft.ingredient} onChange={ingredient => editDraft({ ingredient })} />
            <ClinicalField label="Formulation" value={draft.formulation} onChange={formulation => editDraft({ formulation })} />
            <Action label="Save confirmed identity" disabled={edit.saving || !draft.name.trim() || !draft.ingredient.trim() || !draft.formulation.trim()} onPress={() => saveEntry({ ...draft, name: draft.name.trim(), ingredient: draft.ingredient.trim(), formulation: draft.formulation.trim(), confirmed: true })} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Action label="Keep unresolved" secondary disabled={edit.saving} onPress={() => saveEntry({ ...draft, confirmed: false })} />
              <Action label="Discard edit" secondary onPress={() => updateEncounter(value => ({ ...value, medicationDraft: undefined }))} />
            </View>
          </FormReveal>}
        </Animated.View>;
      })}

      <Animated.View layout={layout}>
        <Hairline />
        <Press disabled={editProposed || !edit.allowed} onPress={() => updateEncounter(value => ({ ...value, proposedMedicineDraft: value.proposedMedicine ?? "" }))}
          accessibilityLabel={`Proposed regimen, ${encounter?.proposedMedicine?.trim() || "not entered yet"}`} accessibilityHint={editProposed || !edit.allowed ? undefined : regimen ? "Change the proposed regimen" : "Enter the proposed regimen"} style={row}>
          <MedicineThumb look={resolveMedicine(regimen?.medication ?? "", regimen?.formulation ?? "")} confirmed badge={false} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.caption, lineHeight: 17, fontWeight: "600", color: palette.muted }}>Proposed regimen</Text>
            <Text style={{ ...type.body, lineHeight: 22, fontWeight: "500", color: palette.ink }}>{regimen ? `${regimen.medication} · ${regimen.formulation}` : encounter?.proposedMedicine?.trim() || "Not entered yet"}</Text>
            {regimen && <Text style={{ ...type.subhead, lineHeight: 19, color: palette.muted }}>{regimen.dose} {regimen.unit} · {regimen.route} · {regimen.frequency} · {regimen.duration}</Text>}
          </View>
          {!editProposed && edit.allowed && <Text style={{ ...type.subhead, fontWeight: "500", color: palette.blue }}>{regimen ? "Change" : "Enter"}</Text>}
        </Press>
        {editProposed && <FormReveal style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <RegimenForm patient={patient} onCancel={() => updateEncounter(value => ({ ...value, proposedMedicineDraft: undefined }))} />
        </FormReveal>}
      </Animated.View>
    </Surface>
    <Animated.View layout={layout} style={{ gap: 6 }}>
      {edit.error && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber }}>{edit.error}</Text>}
      <Footnote>A correction invalidates earlier checks. The dose rules cover adult paracetamol tablets only; any other regimen is blocked, never guessed. Thumbnails show the dosage form, not a specific brand.</Footnote>
    </Animated.View>
  </Section>;
}
