import { useState } from "react";
import { View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { IconRow, Section } from "@/components/sona/sections";
import { Action, Expand, Notice, SourceLink, Surface } from "@/components/sona/ui";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { InteractionResults } from "./interaction-results";
import { MedicationEditor } from "./medication-editor";
import { AlertRow, Detail, DisclosureButton, StatusLine, useLayoutSpring } from "./medication-parts";

/**
 * Medication review as generated sections: the reconciliation checklist and allergy record, the
 * current combinations, then one feature surface that says what still blocks a clinical check and
 * offers the next step. A labelled example of a sourced alert sits at the end, closed by default.
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

  return <LayoutAnimationConfig skipEntering><View style={{ gap: 34 }}>
    <Animated.View layout={layout} style={{ gap: 20 }}>
      <MedicationEditor patient={patient} onRequest={onRequest} />
      <View style={{ gap: 2 }}>
        <IconRow icon="allergens" title="Allergy record" detail={patient.allergies ?? "Unknown — collect an allergy history"} />
        <View style={{ paddingLeft: 38 }}><SourceLink label="Original intake & allergy record" onPress={() => onSource("history")} /></View>
      </View>
    </Animated.View>

    <Animated.View layout={layout}>
      <InteractionResults patient={patient} onSource={onSource} onRequest={onRequest} />
    </Animated.View>

    <Animated.View layout={layout}>
      <Section title="Unable to complete a clinical check" subtitle="No validated drug-interaction database is connected. This fixture cannot clear a medicine or establish that a combination is safe.">
        <Surface feature style={{ padding: 18, gap: 14 }}>
          <StatusLine state={confirmed ? "done" : "blocked"}>{confirmed ? "Medication identities are confirmed for the simulation. Clinical interaction coverage remains unvalidated." : "One or more medication identities remain unconfirmed. Resolve each ingredient and formulation in the checklist above."}</StatusLine>
          <StatusLine state={reviewing ? "pending" : reviewed ? "done" : "blocked"}>{reviewed ? "Medication review recorded for the current encounter. Bounded fixture checks are available for the authored prescribing simulation; this is not clinical interaction clearance." : "Review is not current for this encounter revision. Run the review again before the prescribing simulation."}</StatusLine>
          <SourceLink label="Medication coverage & limits" onPress={() => onSource("medication")} />
          <Action label="Run prescribing simulation" icon="doc.badge.plus" disabled={busy} onPress={() => onRequest("prescription")} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Action label={reviewed ? "Run review again" : "Run medication review"} icon="arrow.clockwise" secondary disabled={busy} onPress={() => onRequest("medication")} />
            <Action label="Open consultation note" icon="square.and.pencil" secondary onPress={() => onOpen("note")} />
          </View>
        </Surface>
      </Section>
    </Animated.View>

    {patient.sources.some(source => source.id === "beta-reference") && <Animated.View layout={layout}>
      <Section title="See how a sourced alert appears" subtitle="A labelled example, kept apart from this patient’s results.">
        <DisclosureButton label={previewAlert ? "Hide interaction example" : "Preview an interaction alert"} open={previewAlert} onToggle={() => setPreviewAlert(current => !current)} />
        {previewAlert && <Expand style={{ gap: 12 }}>
          <Notice>Example combination — not detected in this patient. No beta-blocker has been added to the medication list.</Notice>
          <AlertRow title="Albuterol + beta-blocker class" kind="Example · label warning" detail="Beta-blockers can reduce albuterol’s bronchodilator effect and may cause severe bronchospasm in people with asthma.">
            <Detail label="Why the alert appears" value="The beta-blocker class can oppose the airway effects of a beta-agonist. The source describes a class interaction, not an evaluated combination for this patient." />
            <SourceLink label="DailyMed · section 7.1" onPress={() => onSource("beta-reference")} />
          </AlertRow>
        </Expand>}
      </Section>
    </Animated.View>}
  </View></LayoutAnimationConfig>;
}
