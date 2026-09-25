import { useState } from "react";
import { View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { IconRow } from "@/components/sona/sections";
import { SourceRef, SourceScope, SourcesPill } from "@/components/sona/sources";
import { Action, Expand, Label, Notice, Surface } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { InteractionResults } from "./interaction-results";
import { Anchor, Takeaways, type Takeaway } from "@/components/sona/answer-kit";
import { MedicationEditor } from "./medication-editor";
import { PrescribeCard } from "./prescribe-card";
import { AlertRow, DisclosureButton, Footnote, StatusLine, TextLink, useLayoutSpring } from "./medication-parts";

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
  const confirmed = Boolean(encounter?.medicationEntries?.length && encounter.medicationEntries.every(entry => entry.confirmed && entry.ingredient.trim() && entry.formulation.trim()));
  const busy = encounter?.requests.some(request => request.status === "streaming") ?? false;
  const reviewing = encounter?.requests.some(request => request.status === "streaming" && request.kind === "medication") ?? false;

  const entries = encounter?.medicationEntries ?? [];
  const confirmedCount = entries.filter(entry => entry.confirmed).length;
  const takeaways: Takeaway[] = [
    confirmed ? { tone: "good", text: "All medicine identities are confirmed" } : { tone: "caution", text: `${confirmedCount} of ${entries.length || patient.medicines.length} medicines confirmed; the rest block the simulation` },
    { tone: "caution", text: patient.allergies ? `${patient.allergies.split(" — ")[0]} allergy still needs confirming` : "Allergy history is unknown" },
    { tone: "info", text: "No validated interaction database is connected" },
  ];
  return <LayoutAnimationConfig skipEntering><View style={{ gap: 20 }}>
    <Takeaways items={takeaways} />
    <Anchor id="medicines" title="Medicines"><Animated.View layout={layout}>
      <MedicationEditor patient={patient} onRequest={onRequest} />
    </Animated.View></Anchor>

    <Anchor id="interactions" title="Interactions" icon="arrow.triangle.branch" tone="amber"><Animated.View layout={layout} style={{ gap: 16 }}>
      <IconRow icon="allergens" title="Allergies" detail={patient.allergies ?? "Unknown — collect an allergy history"} sourceLabel="Original intake & allergy record" sourceKind="record" onSource={() => onSource("history")} />
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
