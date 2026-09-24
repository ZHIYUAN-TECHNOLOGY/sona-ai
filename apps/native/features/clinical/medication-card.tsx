import { useState } from "react";
import { View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { IconRow } from "@/components/sona/sections";
import { Action, Expand, Notice, SourceLink, Surface } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { InteractionResults } from "./interaction-results";
import { Anchor, Takeaways, type Takeaway } from "@/components/sona/answer-kit";
import { MedicationEditor } from "./medication-editor";
import { AlertRow, DisclosureButton, Footnote, StatusLine, TextLink, useLayoutSpring } from "./medication-parts";

/**
 * Medication review, condensed: the confirm checklist, one allergy line with its source, one
 * interactions line (detail on demand), then the single feature surface with one primary action.
 * A labelled example of a sourced alert sits behind a small link at the end.
 */
export function MedicationCard({ patient, onSource, onRequest, onOpen }: FeatureProps) {
  const [previewAlert, setPreviewAlert] = useState(false);
  const { encounters } = useEncounter();
  const layout = useLayoutSpring();
  const encounter = encounters[patient.id];
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

    <Anchor id="interactions" title="Interactions"><Animated.View layout={layout} style={{ gap: 16 }}>
      <IconRow icon="allergens" title="Allergies" detail={patient.allergies ?? "Unknown — collect an allergy history"} sourceLabel="Original intake & allergy record" onSource={() => onSource("history")} />
      <InteractionResults patient={patient} onSource={onSource} onRequest={onRequest} />
    </Animated.View></Anchor>

    <Anchor id="prescribing" title="Prescribing"><Surface feature layout={layout} style={{ padding: 18, gap: 12 }}>
      <StatusLine state={confirmed ? "done" : "blocked"}>{confirmed ? "Identities confirmed for the simulation" : "Unconfirmed identities block the simulation"}</StatusLine>
      <StatusLine state={reviewing ? "pending" : reviewed ? "done" : "blocked"}>{reviewed ? "Review current for this revision" : "Review not current — run it before simulating"}</StatusLine>
      <Footnote>No validated interaction database is connected. This fixture can’t clear a medicine or show a combination is safe.</Footnote>
      <Action label="Run prescribing simulation" icon="doc.badge.plus" disabled={busy} onPress={() => onRequest("prescription")} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 20 }}>
        <TextLink label={reviewed ? "Review again" : "Run review"} disabled={busy} onPress={() => onRequest("medication")} />
        <TextLink label="Open note" onPress={() => onOpen("note")} />
        <SourceLink label="Coverage & limits" onPress={() => onSource("medication")} />
      </View>
    </Surface></Anchor>

    {patient.sources.some(source => source.id === "beta-reference") && <Animated.View layout={layout} style={{ gap: 4 }}>
      <DisclosureButton label="See an example" accessibilityLabel="See an example of a sourced interaction alert" open={previewAlert} onToggle={() => setPreviewAlert(current => !current)} />
      {previewAlert && <Expand style={{ gap: 12 }}>
        <Notice>Example only — not detected in this patient. No beta-blocker was added.</Notice>
        <AlertRow title="Albuterol + beta-blocker class" kind="Example · label warning" detail="Beta-blockers can reduce albuterol’s bronchodilator effect and may cause severe bronchospasm in people with asthma.">
          <SourceLink label="DailyMed · section 7.1" onPress={() => onSource("beta-reference")} />
        </AlertRow>
      </Expand>}
    </Animated.View>}
  </View></LayoutAnimationConfig>;
}
