import { useState } from "react";
import { Linking, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { riseIn } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { SourceRef } from "@/components/sona/sources";
import { Action, Expand, Icon, Notice, Surface } from "@/components/sona/ui";
import { defaultMedications } from "@/features/encounter/clinical-state";
import { patients as baselinePatients } from "@/features/encounter/fixtures";
import { useEncounter } from "@/features/encounter/store";
import type { FeatureProps } from "@/features/encounter/types";
import { betaBlockerAlert, interactionSource, lookupInteractionPairs, type InteractionPair } from "./interaction-lookup";
import { AlertRow, DisclosureButton, Footnote, Hairline, Mark, PairGlyph, Press, useLayoutSpring } from "./medication-parts";

const statusLabel: Record<InteractionPair["status"], string> = { alert: "Label-backed class alert", unresolved: "Ingredient unresolved", uncovered: "Coverage unavailable" };

/**
 * The entered combinations as one line: the sourced alert when there is one, otherwise a count of
 * pairs with no conclusion. Pair rows and the reason behind each "no conclusion" open on demand.
 * A changed list or encounter shows as unchecked; no pair is presented as evaluated until review.
 * Fixture loaders appear only with demo controls on.
 */
export function InteractionResults({ patient, onSource }: Pick<FeatureProps, "patient" | "onSource" | "onRequest">) {
  const { encounters, updateEncounter, showDemoControls } = useEncounter();
  const layout = useLayoutSpring();
  const reduced = useReduceMotionPreference();
  const encounter = encounters[patient.id];
  const [sourceFailed, setSourceFailed] = useState(false);
  const [details, setDetails] = useState(false);
  const [fixtures, setFixtures] = useState(false);
  const baseline = baselinePatients.find(value => value.id === patient.id) ?? patient;
  const current = encounter?.medicationCheckedRevision === encounter?.revision && encounter?.medicationCheckedRevision !== undefined;
  const busy = encounter?.requests.some(request => request.status === "streaming") ?? false;
  const reviewing = encounter?.requests.some(request => request.status === "streaming" && request.kind === "medication") ?? false;
  const pairs = lookupInteractionPairs(encounter?.medicationEntries ?? defaultMedications(baseline), encounter?.proposedMedicine ?? "Paracetamol");
  const alerts = pairs.filter(pair => pair.status === "alert");
  const quiet = pairs.filter(pair => pair.status !== "alert");
  const unresolved = quiet.some(pair => pair.status === "unresolved");
  const reasons = [...new Map(quiet.map(pair => [pair.detail, pair.status])).entries()];
  const summary = `${quiet.length} ${quiet.length === 1 ? "pair" : "pairs"} without a conclusion${unresolved ? " · confirm ingredients first" : ""}`;
  const openSource = () => {
    if (patient.sources.some(source => source.id === interactionSource.id)) onSource(interactionSource.id);
    else void Linking.openURL(interactionSource.url).catch(() => setSourceFailed(true));
  };

  return <Animated.View layout={layout} style={{ gap: 10 }}>
    {!current ? <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
      <View style={{ width: 24, alignItems: "center" }}><Mark state={reviewing ? "pending" : "open"} size={20} /></View>
      <Text selectable style={{ ...type.callout, flex: 1, color: palette.ink }}>{reviewing ? "Checking combinations…" : "Interactions not checked since the list changed"}</Text>
    </View>
    : !pairs.length ? <Footnote>No medication pair to evaluate.</Footnote>
    : <Animated.View layout={layout} entering={reduced ? FadeIn.duration(150) : riseIn({ distance: 8, duration: 280 })} style={{ gap: 10 }}>
      {alerts.map(pair => <AlertRow key={pair.id} title={`${pair.left} + ${pair.right}`} kind={statusLabel.alert} detail={pair.detail}>
        <Text selectable style={{ ...type.subhead, color: palette.muted }}>{betaBlockerAlert.qualifiers}</Text>
        <SourceRef id={interactionSource.id} label={interactionSource.title} kind="reference" onPress={openSource} />
      </AlertRow>)}
      {quiet.length > 0 && <Press onPress={() => setDetails(value => !value)} expanded={details} accessibilityLabel={`${summary}. ${details ? "Hide" : "Show"} pairs`} style={{ flexDirection: "row", gap: 14, alignItems: "center", minHeight: 44 }}>
        <View style={{ width: 24, alignItems: "center" }}><PairGlyph status={unresolved ? "unresolved" : "uncovered"} /></View>
        <Text style={{ ...type.callout, flex: 1, color: palette.ink }}>{summary}</Text>
        <Animated.View style={{ transform: [{ rotate: details ? "180deg" : "0deg" }], transitionProperty: "transform", transitionDuration: 200 }}><Icon name="chevron.down" size={12} color={palette.blue} /></Animated.View>
      </Press>}
      {details && <Expand style={{ gap: 10 }}>
        <Surface style={{ paddingVertical: 4 }}>
          {quiet.map((pair, index) => <View key={pair.id}>
            {index > 0 && <Hairline inset={58} />}
            <View accessible accessibilityLabel={`${pair.left} plus ${pair.right}. ${statusLabel[pair.status]}`} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingVertical: 12 }}>
              <PairGlyph status={pair.status} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text selectable style={{ ...type.callout, color: palette.ink }}>{pair.left} <Text style={{ color: palette.muted }}>+</Text> {pair.right}</Text>
                <Text style={{ ...type.caption, fontWeight: "600", color: palette.muted }}>{statusLabel[pair.status]}</Text>
              </View>
            </View>
          </View>)}
        </Surface>
        {reasons.map(([detail, status]) => <Footnote key={detail}>{statusLabel[status]}: {detail}</Footnote>)}
      </Expand>}
    </Animated.View>}
    {sourceFailed && <Notice warning>The reference page could not be opened. The citation remains DailyMed, Albuterol HFA, section 7.1.</Notice>}

    {showDemoControls && <Animated.View layout={layout} style={{ gap: 4 }}>
      <DisclosureButton label="Fixture controls" open={fixtures} onToggle={() => setFixtures(value => !value)} />
      {fixtures && <Expand style={{ gap: 8 }}>
        <Footnote>Replaces the list with confirmed albuterol and propranolol, keeps paracetamol proposed, and invalidates the review.</Footnote>
        <Action label="Load interaction example" secondary disabled={busy} onPress={() => updateEncounter(value => ({ ...value, medicationEntries: [
          { id: "medicine-0", name: "Albuterol · loaded interaction fixture", ingredient: "albuterol", formulation: "inhaler", confirmed: true },
          { id: "medicine-1", name: "Propranolol · loaded interaction fixture", ingredient: "propranolol", formulation: "tablet", confirmed: true },
        ], proposedMedicine: "Paracetamol", medicationDraft: undefined }), true)} />
        <Action label="Restore reported medicines" secondary disabled={busy} onPress={() => updateEncounter(value => ({ ...value, medicationEntries: defaultMedications(baseline), proposedMedicine: "Paracetamol", medicationDraft: undefined }), true)} />
      </Expand>}
    </Animated.View>}
  </Animated.View>;
}
