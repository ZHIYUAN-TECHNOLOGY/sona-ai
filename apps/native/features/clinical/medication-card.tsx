import { useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { IconRow } from "@/components/sona/sections";
import { SourceRef, SourceScope, SourcesPill } from "@/components/sona/sources";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Expand, Label, Notice, Surface } from "@/components/sona/ui";
import { allergyConfirmation, allergyLine, confirmedAllergy } from "@/features/day/counts";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { useLive } from "@/features/live";
import { useEncounterEdit } from "@/features/live/sync";
import { InteractionResults } from "./interaction-results";
import { Anchor, Takeaways, type Takeaway } from "@/components/sona/answer-kit";
import { medicinesConfirmed } from "@/features/encounter/lead";
import { MedicationEditor } from "./medication-editor";
import { PrescribeCard } from "./prescribe-card";
import { AlertRow, DisclosureButton, Footnote, haptic, StatusLine, TextLink, useLayoutSpring } from "./medication-parts";

/**
 * Medication review, condensed: the confirm checklist, one allergy line with its source, one
 * interactions line (detail on demand), then the single feature surface with one primary action.
 * A labelled example of a sourced alert sits behind a small link at the end.
 */
export function MedicationCard({ patient, result, onSource, onRequest, onOpen }: FeatureProps) {
  const [previewAlert, setPreviewAlert] = useState(false);
  const { encounters } = useEncounter();
  const layout = useLayoutSpring();
  const encounter = encounters[patient.id];
  const live = !result || encounter?.cards.at(-1)?.id === result.id;
  const reviewed = encounter?.medicationCheckedRevision === encounter?.revision && encounter?.medicationCheckedRevision !== undefined;
  const busy = encounter?.requests.some(request => request.status === "streaming") ?? false;
  const reviewing = encounter?.requests.some(request => request.status === "streaming" && request.kind === "medication") ?? false;

  const entries = encounter?.medicationEntries ?? [];
  // The same count the answer's lead gives (lead.ts), so the two can't disagree.
  const { confirmed: confirmedCount, all: confirmed } = medicinesConfirmed(entries);
  const total = entries.length || patient.medicines.length, left = total - confirmedCount;
  const allergy = confirmedAllergy(encounter);
  const takeaways: Takeaway[] = [
    confirmed ? { tone: "good", text: "All medicine identities are confirmed" } : { tone: "caution", text: total ? `${left} ${left === 1 ? "medicine" : "medicines"} to confirm before prescribing` : "No medicines are recorded yet" },
    allergy ? { tone: "info", text: `Allergy confirmed: ${allergy.value}` } : { tone: "caution", text: patient.allergies ? `${patient.allergies.split(" — ")[0]} allergy still needs confirming` : "Allergy history is unknown" },
    { tone: "info", text: "No validated interaction database is connected" },
  ];
  return <LayoutAnimationConfig skipEntering><View style={{ gap: 20 }}>
    <Takeaways items={takeaways} />
    <Anchor id="medicines" title="Medicines"><Animated.View layout={layout}>
      <MedicationEditor patient={patient} onRequest={onRequest} />
    </Animated.View></Anchor>

    <Anchor id="interactions" title="Interactions" icon="arrow.triangle.branch" tone="amber"><Animated.View layout={layout} style={{ gap: 16 }}>
      <AllergyRow patient={patient} onSource={onSource} />
      <InteractionResults patient={patient} onSource={onSource} onRequest={onRequest} />
    </Animated.View></Anchor>

    <Anchor id="prescribing" title="Prescribing" icon="doc.badge.plus" tone="teal"><Animated.View layout={layout} style={{ gap: 10 }}>
      {/* The latest answer carries the live prescribe card; earlier ones keep a one-line summary. */}
      {live ? <PrescribeCard patient={patient} /> : <StatusLine state={confirmed ? "done" : "blocked"}>{confirmed ? "Identities confirmed for the simulation" : "Unconfirmed identities block the simulation"}</StatusLine>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 20 }}>
        <TextLink label="Open note" onPress={() => onOpen("note")} />
        <SourceRef label="Coverage & limits" kind="fixture" onPress={() => onSource("medication")} />
      </View>
    </Animated.View></Anchor>

    {patient.sources.some(source => source.id === "beta-reference") && <Animated.View layout={layout} style={{ gap: 4 }}>
      <DisclosureButton label="See an example" accessibilityLabel="See an example of a sourced interaction alert" open={previewAlert} onToggle={() => setPreviewAlert(current => !current)} />
      {previewAlert && <Expand style={{ gap: 12 }}>
        <Notice>Example only — not detected in this patient. No beta-blocker was added.</Notice>
        {/* The example's citation gathers into its own pill above the alert's top right, like a section's. */}
        <SourceScope>{sources => <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 4 }}><Label muted>Example alert</Label><SourcesPill sources={sources} /></View>
          <AlertRow title="Albuterol + beta-blocker class" kind="Example · label warning" detail="Beta-blockers can reduce albuterol’s bronchodilator effect and may cause severe bronchospasm in people with asthma.">
            <SourceRef label="DailyMed · Albuterol HFA" detail="Section 7.1 · beta-blockers" kind="reference" onPress={() => onSource("beta-reference")} />
          </AlertRow>
        </View>}</SourceScope>
      </Expand>}
    </Animated.View>}
  </View></LayoutAnimationConfig>;
}

/**
 * The allergy with Confirm right on its row. Confirming is the history edit a correction makes (saved to the server
 * in live mode), so its receipt replaces the button and the flag leaves Today and Patients.
 */
function AllergyRow({ patient, onSource }: Pick<FeatureProps, "patient" | "onSource">) {
  const { encounters } = useEncounter();
  const { user } = useLive();
  const edit = useEncounterEdit(patient);
  const encounter = encounters[patient.id];
  const confirmed = confirmedAllergy(encounter);
  const confirm = () => {
    if (!encounter) return;
    const fact = allergyConfirmation(patient, encounter.revision + 1, user?.name ?? "the doctor");
    edit.save({ historyFacts: [...encounter.historyFacts ?? [], fact] }, value => ({ ...value, historyFacts: [...value.historyFacts ?? [], fact] }),
      () => { haptic("success"); AccessibilityInfo.announceForAccessibility(allergyLine(fact)); });
  };
  const action = confirmed ? <Text selectable accessibilityLiveRegion="polite" style={{ ...type.subhead, fontWeight: "600", color: palette.green }}>{allergyLine(confirmed)}</Text>
    : patient.allergies && edit.allowed ? <TextLink label={edit.saving ? "Confirming…" : "Confirm allergy"} disabled={edit.saving} onPress={confirm} /> : undefined;
  return <View style={{ gap: 6 }}>
    <IconRow icon="allergens" title="Allergies" detail={confirmed?.value ?? patient.allergies ?? "Unknown — collect an allergy history"} sourceLabel="Original intake & allergy record" sourceKind="record" onSource={() => onSource("history")} />
    {/* Under the row's text: past its 24 pt icon and 14 pt gap. */}
    {(action || edit.error) && <View style={{ paddingLeft: 38 }}>
      {action}
      {edit.error && <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.amber }}>{edit.error}</Text>}
    </View>}
  </View>;
}
