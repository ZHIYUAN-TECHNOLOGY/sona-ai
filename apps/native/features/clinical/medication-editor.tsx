import { View } from "react-native";
import Animated from "react-native-reanimated";
import { Section } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette } from "@/components/sona/theme";
import { Action, Surface } from "@/components/sona/ui";
import { defaultMedications } from "@/features/encounter/clinical-state";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps, MedicationEntry } from "@/features/encounter/types";
import { ClinicalField } from "./controls";
import { Footnote, FormReveal, Hairline, Press, useLayoutSpring } from "./medication-parts";
import { resolveMedicine } from "./medicine-catalog";
import { MedicineThumb } from "./medicine-thumb";

/**
 * Reconciliation checklist: one row per reported medicine with its confirmation state. Tapping a
 * row opens its identity form in place (one at a time); saving a correction revises the
 * encounter, which invalidates earlier medication checks. The proposed ingredient closes the list.
 * Review itself is requested from the next-step surface below.
 */
export function MedicationEditor({ patient }: Pick<FeatureProps, "patient" | "onRequest">) {
  const { encounters, updateEncounter } = useEncounter();
  const layout = useLayoutSpring();
  const encounter = encounters[patient.id];
  const entries = encounter?.medicationEntries ?? defaultMedications(patient);
  const draft = encounter?.medicationDraft;
  const proposed = encounter?.proposedMedicineDraft ?? encounter?.proposedMedicine ?? "Paracetamol";
  const editProposed = encounter?.proposedMedicineDraft !== undefined;
  const confirmed = entries.filter(entry => entry.confirmed).length;
  const editDraft = (change: Partial<MedicationEntry>) => updateEncounter(value => ({ ...value, medicationDraft: value.medicationDraft ? { ...value.medicationDraft, ...change, confirmed: false } : undefined }));
  const row = { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 13 } as const;

  return <Section icon="pills" tone="blue" title="Confirm what’s being taken" subtitle={`${confirmed} of ${entries.length} confirmed · unknown entries stay unresolved`}>
    <Surface layout={layout} style={{ paddingVertical: 4 }}>
      {entries.map((entry, index) => {
        const editing = draft?.id === entry.id;
        const identity = `${entry.ingredient || "Ingredient unknown"} · ${entry.formulation || "Formulation unknown"}`;
        const state = editing ? "Editing this medicine" : entry.confirmed ? "Confirmed in simulation" : "Needs confirmation";
        return <Animated.View key={entry.id} layout={layout}>
          {index > 0 && <Hairline inset={74} />}
          <Press disabled={Boolean(draft)} onPress={() => updateEncounter(value => ({ ...value, medicationDraft: { ...entry } }))}
            accessibilityLabel={`${entry.name}. ${identity}. ${state}`} accessibilityHint={draft ? undefined : entry.confirmed ? "Correct this medicine" : "Confirm ingredient and formulation"} style={[row, draft && !editing && { opacity: 0.5 }]}>
            <MedicineThumb look={resolveMedicine(entry.ingredient, entry.formulation)} confirmed={entry.confirmed} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: "500", color: palette.ink }}>{entry.name}</Text>
              <Text style={{ fontSize: 14, lineHeight: 19, color: palette.muted }}>{identity}</Text>
            </View>
            {!draft && <Text style={{ fontSize: 14, fontWeight: "500", color: palette.blue }}>{entry.confirmed ? "Correct" : "Confirm"}</Text>}
          </Press>
          {editing && draft && <FormReveal style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
            <ClinicalField label="Recorded medicine name" value={draft.name} onChange={name => editDraft({ name })} />
            <ClinicalField label="Active ingredient" value={draft.ingredient} onChange={ingredient => editDraft({ ingredient })} />
            <ClinicalField label="Formulation" value={draft.formulation} onChange={formulation => editDraft({ formulation })} />
            <Action label="Save confirmed identity" disabled={!draft.name.trim() || !draft.ingredient.trim() || !draft.formulation.trim()} onPress={() => updateEncounter(value => ({ ...value, medicationEntries: (value.medicationEntries ?? entries).map(item => item.id === draft.id ? { ...draft, name: draft.name.trim(), ingredient: draft.ingredient.trim(), formulation: draft.formulation.trim(), confirmed: true } : item), medicationDraft: undefined }), true)} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Action label="Keep unresolved" secondary onPress={() => updateEncounter(value => ({ ...value, medicationEntries: (value.medicationEntries ?? entries).map(item => item.id === draft.id ? { ...draft, confirmed: false } : item), medicationDraft: undefined }), true)} />
              <Action label="Discard edit" secondary onPress={() => updateEncounter(value => ({ ...value, medicationDraft: undefined }))} />
            </View>
          </FormReveal>}
        </Animated.View>;
      })}

      <Animated.View layout={layout}>
        <Hairline />
        <Press disabled={editProposed} onPress={() => updateEncounter(value => ({ ...value, proposedMedicineDraft: value.proposedMedicine ?? "Paracetamol" }))}
          accessibilityLabel={`Proposed medicine, ${encounter?.proposedMedicine ?? "Paracetamol"}`} accessibilityHint={editProposed ? undefined : "Change proposed medicine"} style={row}>
          <MedicineThumb look={resolveMedicine(encounter?.proposedMedicine ?? "Paracetamol", "tablet")} confirmed badge={false} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 12, lineHeight: 17, fontWeight: "600", color: palette.muted }}>Proposed medicine</Text>
            <Text style={{ fontSize: 16, lineHeight: 22, fontWeight: "500", color: palette.ink }}>{encounter?.proposedMedicine ?? "Paracetamol"}</Text>
          </View>
          {!editProposed && <Text style={{ fontSize: 14, fontWeight: "500", color: palette.blue }}>Change</Text>}
        </Press>
        {editProposed && <FormReveal style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
          <ClinicalField label="Proposed medication" value={proposed} onChange={proposedMedicineDraft => updateEncounter(value => ({ ...value, proposedMedicineDraft }))} />
          <Action label="Save proposed medicine" disabled={!proposed.trim()} onPress={() => updateEncounter(value => ({ ...value, proposedMedicine: proposed.trim(), proposedMedicineDraft: undefined }), true)} />
          <Action label="Cancel" secondary onPress={() => updateEncounter(value => ({ ...value, proposedMedicineDraft: undefined }))} />
        </FormReveal>}
      </Animated.View>
    </Surface>
    <Animated.View layout={layout}>
      <Footnote>A correction invalidates earlier checks. Only the authored paracetamol scenario has simulated coverage. Thumbnails show the dosage form, not a specific brand.</Footnote>
    </Animated.View>
  </Section>;
}
