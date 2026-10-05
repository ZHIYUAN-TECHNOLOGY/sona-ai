import { useState } from "react";
import { View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { Anchor } from "@/components/sona/answer-kit";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Expand, Notice, SourceLink, Surface } from "@/components/sona/ui";
import { getPrescriptionChecks, regimenOf } from "@/features/encounter/clinical-state";
import { receiptWords } from "@/features/encounter/next-steps";
import { useEncounterSelect } from "@/features/encounter/store";
import { sameShallow } from "@/features/live/keep-same";
import type { Encounter, FeatureProps, Regimen } from "@/features/encounter/types";
import { useLive } from "@/features/live";
import { ClinicalChoice, ClinicalField } from "./controls";
import { PrescribeCard } from "./prescribe-card";
import { Detail, DisclosureButton, Footnote, FormReveal, Mark, TextLink, useLayoutSpring } from "./medication-parts";

const scenarios: { value: NonNullable<Encounter["prescriptionScenario"]>; label: string }[] = [
  { value: "standard", label: "Standard synthetic scenario" }, { value: "unknown-coverage", label: "Unknown interaction coverage" },
  { value: "unsupported", label: "Unsupported regimen" }, { value: "failed-prerequisite", label: "Failed prerequisite" }, { value: "creation-failure", label: "Creation service fails" },
];
const REGIMEN_LINE = "The regimen is the one entered on this visit, checked against the NHS adult dose limits. Nothing was sent to a pharmacy or dispensed.";
const REGIMEN_NOTE = "The clinician entered this regimen; Sona's rules checked it against the NHS adult dose limits. It is not an NHS recommendation for this patient or a model's decision. Nothing is sent to a pharmacy or dispensed.";

function RegimenRows({ regimen }: { regimen: Regimen }) {
  return <View style={{ gap: 12 }}>
    <Detail label="Dose" value={`${regimen.dose} ${regimen.unit}`} />
    <Detail label="Route" value={regimen.route} />
    <Detail label="Frequency & limit" value={regimen.frequency} />
    <Detail label="Duration" value={regimen.duration} />
  </View>;
}

/**
 * Prescribing, condensed: status heading with the entered regimen in one line, the checks as staged
 * progress with one primary action, and (only when every check passed) the card's one receipt and
 * seal, then Amend. Evidence, audit and the full regimen share one disclosure; the scenario picker
 * and eligibility loader appear only with demo controls on. The doctor's Prescribe is the only
 * approval; missing inputs, stale review and failed checks still block.
 */
export function PrescriptionPanel({ patient, result, onSource, onRequest, onOpen }: FeatureProps) {
  const { patient: activePatient, updateEncounter, startAmendment, showDemoControls } = useEncounterSelect(s => ({ patient: s.patient, updateEncounter: s.updateEncounter, startAmendment: s.startAmendment, showDemoControls: s.showDemoControls }), sameShallow);
  const encounter = useEncounterSelect(s => s.encounters[patient.id]);
  const layout = useLayoutSpring();
  const words = receiptWords(useLive().on);
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
  const created = prescription?.status === "created";
  // A receipt or an earlier run shows the regimen it held; the live card before a receipt shows what is entered on the visit now (nothing, until the clinician enters it).
  const regimen = created || !live ? prescription?.regimen : encounter && regimenOf(encounter, activePatient?.id === patient.id ? activePatient : patient);
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
            <Text style={{ flex: 1, ...type.headline, color: palette.ink }}>{created ? words.title : failed ? "Not saved" : "Blocked"}{regimen ? ` · ${regimen.medication}` : ""}</Text>
          </View>
          <Text style={{ ...type.footnote, color: palette.muted }}>{receiptChecks.filter(c => c.status === "passed").length} of {receiptChecks.length || checks.length} checks met at revision {prescription?.revision ?? "–"}{!created && receiptChecks.some(c => c.status === "blocked") ? ` · blocked by ${receiptChecks.filter(c => c.status === "blocked").map(c => c.label.toLowerCase()).join(", ")}` : ""}.</Text>
          <Text style={{ ...type.caption, color: palette.muted }}>Earlier run, kept unchanged. The latest answer has the live card.</Text>
        </Surface></Anchor>}

      {/* The card above holds the one receipt and seal; after it, only what can follow a receipt: amend it or open the note. */}
      {created && prescription && <Animated.View layout={layout} style={{ gap: 12 }}>
        <Footnote>{REGIMEN_LINE}</Footnote>
        {prescription.supersedes && <Footnote>Supersedes an earlier prescription, whose receipt stays in the encounter history.</Footnote>}
        {!canAmend && <Notice>A newer version exists. Amend the latest receipt instead.</Notice>}
        <Animated.View layout={layout} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 20, rowGap: 4 }}>
          <Action label={amending ? "Hide amendment" : "Amend"} secondary icon="square.and.pencil" disabled={busy || amendmentPending || !canAmend} onPress={() => setAmending(value => !value)} />
          <TextLink label="Open note" onPress={() => onOpen("note")} />
        </Animated.View>
        {amending && canAmend && <FormReveal style={{ gap: 12 }}>
          <ClinicalField label="Amendment reason" value={encounter?.prescriptionAmendment ?? ""} onChange={prescriptionAmendment => updateEncounter(value => ({ ...value, prescriptionAmendment }))} multiline />
          <Footnote>Saving creates a new revision, reruns the review and the checks, then records a new prescription. This receipt stays unchanged.</Footnote>
          <Action label="Save amendment & rerun checks" disabled={busy || !encounter?.prescriptionAmendment?.trim() || amendmentPending} onPress={amend} />
        </FormReveal>}
      </Animated.View>}

      <Animated.View layout={layout} style={{ gap: 4 }}>
        <DisclosureButton label="Evidence & audit" open={audit} onToggle={() => setAudit(value => !value)} />
        {audit && <Expand style={{ gap: 12, paddingBottom: 6 }}>
          {regimen ? <><Detail label="Indication" value={regimen.indication} /><RegimenRows regimen={regimen} /></> : <Footnote>No regimen entered yet.</Footnote>}
          {created && prescription && <Detail label="Created" value={`${new Date(prescription.createdAt).toLocaleString()} · ${patient.name} · ${patient.id}`} />}
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 18 }}>
            <SourceLink label="Recorded patient context" onPress={() => onSource("history")} />
            {!!regimen?.sourceId && <SourceLink label="NHS dose reference" onPress={() => onSource(regimen.sourceId)} />}
          </View>
          {regimen && <Footnote>{REGIMEN_NOTE}</Footnote>}
          {regimen && <Detail label="Dose limits from" value={regimen.sourceVersion} />}
          {prescription && <Detail label="Operation" value={prescription.id} />}
          {prescription && <Detail label="Version" value={`Encounter revision ${prescription.revision}`} />}
          {prescription?.supersedes && <Detail label="Supersedes" value={prescription.supersedes} />}
          {receiptChecks.map(check => <View key={check.id} style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ paddingTop: 1 }}><Mark state={check.status === "passed" ? "done" : "blocked"} size={16} /></View>
            <View style={{ flex: 1 }}><Detail label={`${check.label} · ${check.status}`} value={check.detail} /></View>
          </View>)}
          {!!prescription?.audit?.length && <View style={{ gap: 6 }}>
            <Text style={{ ...type.caption, fontWeight: "500", color: palette.muted }}>Audit trail</Text>
            {prescription.audit.map((entry, index) => <Text key={`${index}-${entry}`} selectable style={{ ...type.footnote, lineHeight: 19, color: palette.ink }}>{entry}</Text>)}
          </View>}
          {prescription?.inputs && <Detail label="Captured inputs" value={`Weight: ${prescription.inputs.weightKg || "unknown"} kg. Paracetamol allergy: ${prescription.inputs.paracetamolAllergy}. Liver: ${prescription.inputs.liverDisease}. Kidney: ${prescription.inputs.kidneyDisease}. Alcohol risk: ${prescription.inputs.alcoholRisk}.`} />}
        </Expand>}
        {showDemoControls && <DisclosureButton label="Demo scenario" open={showScenarios} onToggle={() => setShowScenarios(value => !value)} />}
        {showDemoControls && showScenarios && <FormReveal style={{ gap: 10 }}>
          <ClinicalChoice label="Prescribing scenario" value={encounter?.prescriptionScenario ?? "standard"} options={scenarios} onChange={prescriptionScenario => updateEncounter(value => ({ ...value, prescriptionScenario }), true)} />
          <Footnote>Changing it invalidates previous checks. Rerun review, then prescribe; restore Standard to recover.</Footnote>
        </FormReveal>}
      </Animated.View>
    </View>
  </LayoutAnimationConfig>;
}
