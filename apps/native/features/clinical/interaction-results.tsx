import { useState } from "react";
import { Linking, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { riseIn } from "@/components/sona/motion";
import { Section } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette } from "@/components/sona/theme";
import { Action, Expand, Notice, SourceLink, Surface } from "@/components/sona/ui";
import { defaultMedications } from "@/features/encounter/clinical-state";
import { patients as baselinePatients } from "@/features/encounter/fixtures";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { betaBlockerAlert, interactionSource, lookupInteractionPairs, type InteractionPair } from "./interaction-lookup";
import { AlertRow, DisclosureButton, Footnote, Hairline, Mark, PairGlyph, useLayoutSpring } from "./medication-parts";

const statusLabel: Record<InteractionPair["status"], string> = { alert: "Label-backed class alert", unresolved: "Ingredient unresolved", uncovered: "Coverage unavailable" };

/**
 * Current entered combinations as calm rows: sourced alerts first with their label text and
 * citation, then pairs with no conclusion. Each distinct reason for "no conclusion" is stated once
 * under the list. A changed list or encounter asks for a recheck before any pair is shown as evaluated.
 */
export function InteractionResults({ patient, onSource, onRequest }: Pick<FeatureProps, "patient" | "onSource" | "onRequest">) {
  const { encounters, updateEncounter } = useEncounter();
  const layout = useLayoutSpring();
  const reduced = useReduceMotionPreference();
  const encounter = encounters[patient.id];
  const [sourceFailed, setSourceFailed] = useState(false);
  const [fixtures, setFixtures] = useState(false);
  const baseline = baselinePatients.find(value => value.id === patient.id) ?? patient;
  const current = encounter?.medicationCheckedRevision === encounter?.revision && encounter?.medicationCheckedRevision !== undefined;
  const busy = encounter?.requests.some(request => request.status === "streaming") ?? false;
  const reviewing = encounter?.requests.some(request => request.status === "streaming" && request.kind === "medication") ?? false;
  const pairs = lookupInteractionPairs(encounter?.medicationEntries ?? defaultMedications(baseline), encounter?.proposedMedicine ?? "Paracetamol");
  const alerts = pairs.filter(pair => pair.status === "alert");
  const quiet = pairs.filter(pair => pair.status !== "alert");
  const reasons = [...new Map(quiet.map(pair => [pair.detail, pair.status])).entries()];
  const openSource = () => {
    if (patient.sources.some(source => source.id === interactionSource.id)) onSource(interactionSource.id);
    else void Linking.openURL(interactionSource.url).catch(() => setSourceFailed(true));
  };

  return <Section title={!current ? "Recheck the changed medicines" : alerts.length ? "Sourced class interaction found" : "No covered interaction result"}
    subtitle="Entered medicines and the proposed ingredient against one DailyMed class-interaction rule. Uncovered pairs stay unresolved; no comprehensive database is connected.">
    {!current ? <Surface layout={layout} style={{ padding: 18, gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
        <View style={{ paddingTop: 1 }}><Mark state={reviewing ? "pending" : "open"} size={20} /></View>
        <Text selectable style={{ flex: 1, fontSize: 15, lineHeight: 21, color: palette.ink }}>The medicine list or encounter changed. Run review before treating these combinations as evaluated.</Text>
      </View>
      <Action label="Check entered combinations" icon="arrow.clockwise" disabled={busy} onPress={() => onRequest("medication")} />
    </Surface>
    : pairs.length ? <Animated.View layout={layout} entering={reduced ? FadeIn.duration(150) : riseIn({ distance: 8, duration: 280 })} style={{ gap: 12 }}>
      {alerts.map(pair => <AlertRow key={pair.id} title={`${pair.left} + ${pair.right}`} kind={statusLabel.alert} detail={pair.detail}>
        <Text selectable style={{ fontSize: 14, lineHeight: 20, color: palette.muted }}>{betaBlockerAlert.qualifiers}</Text>
        <SourceLink label={interactionSource.title} onPress={openSource} />
      </AlertRow>)}
      {quiet.length > 0 && <Surface style={{ paddingVertical: 4 }}>
        {quiet.map((pair, index) => <View key={pair.id}>
          {index > 0 && <Hairline inset={58} />}
          <View accessible accessibilityLabel={`${pair.left} plus ${pair.right}. ${statusLabel[pair.status]}`} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12 }}>
            <PairGlyph status={pair.status} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text selectable style={{ fontSize: 15, lineHeight: 21, color: palette.ink }}>{pair.left} <Text style={{ color: palette.muted }}>+</Text> {pair.right}</Text>
              <Text style={{ fontSize: 12, fontWeight: "600", color: palette.muted }}>{statusLabel[pair.status]}</Text>
            </View>
          </View>
        </View>)}
      </Surface>}
      {reasons.map(([detail, status]) => <Footnote key={detail}>{statusLabel[status]}: {detail}</Footnote>)}
    </Animated.View>
    : <Footnote>No medication pair is available to evaluate.</Footnote>}
    {sourceFailed && <Notice warning>The reference page could not be opened. The citation remains DailyMed, Albuterol HFA, section 7.1.</Notice>}

    <Animated.View layout={layout} style={{ gap: 4 }}>
      <DisclosureButton label={fixtures ? "Hide fixture controls" : "Explicit fixture controls"} open={fixtures} onToggle={() => setFixtures(value => !value)} />
      {fixtures && <Expand style={{ gap: 10 }}>
        <Footnote>Loading the example replaces the current reported list with confirmed albuterol and propranolol fixture entries. It keeps paracetamol as the proposed ingredient and invalidates the review.</Footnote>
        <View style={{ gap: 8, paddingTop: 2 }}>
          <Action label="Load interaction example · replace medicines" secondary disabled={busy} onPress={() => updateEncounter(value => ({ ...value, medicationEntries: [
            { id: "medicine-0", name: "Albuterol · loaded interaction fixture", ingredient: "albuterol", formulation: "inhaler", confirmed: true },
            { id: "medicine-1", name: "Propranolol · loaded interaction fixture", ingredient: "propranolol", formulation: "tablet", confirmed: true },
          ], proposedMedicine: "Paracetamol", medicationDraft: undefined }), true)} />
          <Action label="Restore baseline reported medicines" secondary disabled={busy} onPress={() => updateEncounter(value => ({ ...value, medicationEntries: defaultMedications(baseline), proposedMedicine: "Paracetamol", medicationDraft: undefined }), true)} />
        </View>
      </Expand>}
    </Animated.View>
  </Section>;
}
