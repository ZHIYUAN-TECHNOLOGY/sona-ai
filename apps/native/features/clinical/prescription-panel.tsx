import { useState } from "react";
import { View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { Anchor } from "@/components/sona/answer-kit";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Expand, Notice, SourceLink, Surface } from "@/components/sona/ui";
import { getPrescriptionChecks, simulatedRegimen } from "@/features/encounter/clinical-state";
import { useEncounter } from "@/features/encounter/store";
import type { Encounter, FeatureProps, Regimen } from "@/features/encounter/types";
import { ClinicalChoice, ClinicalField } from "./controls";
import { PrescribeCard } from "./prescribe-card";
import { Detail, DisclosureButton, Footnote, FormReveal, Mark, TextLink, useLayoutSpring } from "./medication-parts";

const scenarios: { value: NonNullable<Encounter["prescriptionScenario"]>; label: string }[] = [
  { value: "standard", label: "Standard synthetic scenario" }, { value: "unknown-coverage", label: "Unknown interaction coverage" },
  { value: "unsupported", label: "Unsupported regimen" }, { value: "failed-prerequisite", label: "Failed prerequisite" }, { value: "creation-failure", label: "Creation service fails" },
];
const REGIMEN_LINE = "Authored regimen, not an NHS recommendation. No dispensing.";
const REGIMEN_NOTE = "Authored regimen, narrower than the NHS adult dose limits. It is not an NHS recommendation for this patient or a validated model decision. No dispensing or pharmacy transmission.";

function RegimenRows({ regimen }: { regimen: Regimen }) {
  return <View style={{ gap: 12 }}>
    <Detail label="Dose" value={`${regimen.dose} ${regimen.unit}`} />
    <Detail label="Route" value={regimen.route} />
    <Detail label="Frequency & limit" value={regimen.frequency} />
    <Detail label="Duration" value={regimen.duration} />
  </View>;
}

/**
 * Autonomous prescribing (synthetic), condensed: status heading with the regimen in one line, the
 * checks as staged progress with one primary action, and (only when every check passed) the card's
 * one receipt and seal, then Amend. Evidence, audit and the full regimen share one disclosure;
 * the scenario picker and eligibility loader appear only with demo controls on. No approval gate;
 * missing inputs, stale review and failed checks still block.
 */
export function PrescriptionPanel({ patient, result, onSource, onRequest, onOpen }: FeatureProps) {
  const { encounters, patient: activePatient, updateEncounter, cancel, startAmendment, showDemoControls } = useEncounter();
  const layout = useLayoutSpring();
  const encounter = encounters[patient.id];
  // The latest answer is live: it follows the encounter as the card runs checks in place.
  const live = !result || encounter?.cards.at(-1)?.id === result.id;
  const prescription = live ? encounter?.prescription : result?.prescription;
  const [audit, setAudit] = useState(false);
  const [amending, setAmending] = useState(false);
  const [showScenarios, setShowScenarios] = useState(false);
  const amendment = encounter?.amendmentOperation;
  const amendmentPending = amendment !== undefined && ["queued-review", "reviewing", "queued-issue", "issuing"].includes(amendment.phase);
  const busy = encounter?.requests.some(request => request.status === "streaming") ?? false;
  const checks = encounter ? getPrescriptionChecks(encounter, activePatient?.id === patient.id ? activePatient : patient) : [];
  const receiptChecks = prescription?.checks ?? [];
  const regimen = prescription?.regimen ?? simulatedRegimen;
  const created = prescription?.status === "created";
  const latestCreated = encounter?.cards.filter(card => card.prescription?.status === "created").at(-1)?.prescription;
  const canAmend = created && (!latestCreated || latestCreated.id === prescription?.id);
  const failed = prescription?.status === "failed";
  const amend = () => {
    if (!encounter?.prescriptionAmendment?.trim()) return;
    startAmendment(encounter.prescriptionAmendment.trim());
    setAmending(false);
  };

  return <LayoutAnimationConfig skipEntering>
    <View style={{ gap: 28 }}>
      {live ? <Anchor id="prescribing" title="Prescribe"><PrescribeCard patient={activePatient?.id === patient.id ? activePatient : patient} /></Anchor>
        : <Anchor id="prescribing" title="Prescribe"><Surface layout={layout} style={{ padding: 16, gap: 8 }}>
          {/* An earlier run, kept as it was: what it decided and why, in two lines. The live card is on the latest answer. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Mark state={created ? "done" : "blocked"} size={22} />
            <Text style={{ flex: 1, ...type.headline, color: palette.ink }}>{created ? "Prescribed · simulation" : failed ? "Creation failed" : "Blocked"} · {regimen.medication}</Text>
          </View>
          <Text style={{ ...type.footnote, color: palette.muted }}>{receiptChecks.filter(c => c.status === "passed").length} of {receiptChecks.length || checks.length} checks met at revision {prescription?.revision ?? "–"}{!created && receiptChecks.some(c => c.status === "blocked") ? ` · blocked by ${receiptChecks.filter(c => c.status === "blocked").map(c => c.label.toLowerCase()).join(", ")}` : ""}.</Text>
          <Text style={{ ...type.caption, color: palette.muted }}>Earlier run, kept unchanged. The latest answer has the live card.</Text>
        </Surface></Anchor>}

      {/* The card above holds the one receipt and seal; after it, only what can follow a receipt: amend it or open the note. */}
      {created && prescription && <Animated.View layout={layout} style={{ gap: 12 }}>
        <Footnote>No clinician approval was requested. {REGIMEN_LINE}</Footnote>
        {prescription.supersedes && <Footnote>Supersedes an earlier simulation, whose receipt stays in the encounter history.</Footnote>}
        {!canAmend && <Notice>A newer version exists. Amend the latest receipt instead.</Notice>}
        <Animated.View layout={layout} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 20, rowGap: 4 }}>
          <Action label={amending ? "Hide amendment" : "Amend"} secondary icon="square.and.pencil" disabled={busy || amendmentPending || !canAmend} onPress={() => setAmending(value => !value)} />
          <TextLink label="Open note" onPress={() => onOpen("note")} />
        </Animated.View>
        {amending && canAmend && <FormReveal style={{ gap: 12 }}>
          <ClinicalField label="Amendment reason" value={encounter?.prescriptionAmendment ?? ""} onChange={prescriptionAmendment => updateEncounter(value => ({ ...value, prescriptionAmendment }))} multiline />
          <Footnote>Saving creates a new revision, reruns review and attempts a new simulation. This receipt stays unchanged.</Footnote>
          <Action label="Save amendment & rerun checks" disabled={busy || !encounter?.prescriptionAmendment?.trim() || amendmentPending} onPress={amend} />
        </FormReveal>}
      </Animated.View>}

      <Animated.View layout={layout} style={{ gap: 4 }}>
        <DisclosureButton label="Evidence & audit" open={audit} onToggle={() => setAudit(value => !value)} />
        {audit && <Expand style={{ gap: 12, paddingBottom: 6 }}>
          <Detail label="Indication & provenance" value={regimen.indication} />
          <RegimenRows regimen={regimen} />
          {created && prescription && <Detail label="Created" value={`${new Date(prescription.createdAt).toLocaleString()} · ${patient.name} · ${patient.id}`} />}
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 18 }}>
            <SourceLink label="Recorded patient context" onPress={() => onSource("history")} />
            <SourceLink label="NHS reference & fixture protocol" onPress={() => onSource(regimen.sourceId)} />
          </View>
          <Footnote>{REGIMEN_NOTE}</Footnote>
          <Detail label="Source version" value={regimen.sourceVersion} />
          {prescription && <Detail label="Operation" value={prescription.id} />}
          {prescription && <Detail label="Version" value={`Encounter revision ${prescription.revision}`} />}
          {prescription?.supersedes && <Detail label="Supersedes" value={prescription.supersedes} />}
          {receiptChecks.map(check => <View key={check.id} style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ paddingTop: 1 }}><Mark state={check.status === "passed" ? "done" : "blocked"} size={16} /></View>
            <View style={{ flex: 1 }}><Detail label={`${check.label} · ${check.status}`} value={check.detail} /></View>
          </View>)}
          {!!prescription?.audit?.length && <View style={{ gap: 6 }}>
            <Text style={{ ...type.caption, fontWeight: "500", color: palette.muted }}>Audit trail</Text>
            {prescription.audit.map((entry, index) => <Text key={`${index}-${entry}`} selectable style={{ fontSize: 13, lineHeight: 19, color: palette.ink }}>{entry}</Text>)}
          </View>}
          {prescription?.inputs && <Detail label="Captured inputs" value={`Weight: ${prescription.inputs.weightKg || "unknown"} kg. Paracetamol allergy: ${prescription.inputs.paracetamolAllergy}. Liver: ${prescription.inputs.liverDisease}. Kidney: ${prescription.inputs.kidneyDisease}. Alcohol risk: ${prescription.inputs.alcoholRisk}.`} />}
        </Expand>}
        {showDemoControls && <DisclosureButton label="Demo scenario" open={showScenarios} onToggle={() => setShowScenarios(value => !value)} />}
        {showDemoControls && showScenarios && <FormReveal style={{ gap: 10 }}>
          <ClinicalChoice label="Prescribing scenario" value={encounter?.prescriptionScenario ?? "standard"} options={scenarios} onChange={prescriptionScenario => updateEncounter(value => ({ ...value, prescriptionScenario }), true)} />
          <Footnote>Changing it invalidates previous checks. Rerun review, then the simulation; restore Standard to recover.</Footnote>
        </FormReveal>}
      </Animated.View>
    </View>
  </LayoutAnimationConfig>;
}
