import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { riseIn } from "@/components/sona/motion";
import { Section } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette } from "@/components/sona/theme";
import { Action, Expand, Label, Notice, SourceLink, Surface } from "@/components/sona/ui";
import { getPrescriptionChecks, simulatedRegimen } from "@/features/encounter/clinical-state";
import { useEncounter } from "@/features/encounter/store";
import type { Encounter, FeatureProps, PrescriptionCheck, PrescriptionInputs, Regimen } from "@/features/encounter/types";
import { ClinicalChoice, ClinicalField } from "./controls";
import { Detail, DisclosureButton, Footnote, FormReveal, Hairline, Mark, Perforation, Seal, StatusLine, haptic, useLayoutSpring } from "./medication-parts";

const emptyInputs: PrescriptionInputs = { weightKg: "", liverDisease: "unknown", kidneyDisease: "unknown", alcoholRisk: "unknown", paracetamolAllergy: "unknown" };
const answers = [{ value: "unknown", label: "Not recorded" }, { value: "no", label: "No · explicitly recorded" }, { value: "yes", label: "Yes" }] as const;
const scenarios: { value: NonNullable<Encounter["prescriptionScenario"]>; label: string }[] = [
  { value: "standard", label: "Standard synthetic scenario" }, { value: "unknown-coverage", label: "Unknown interaction coverage" },
  { value: "unsupported", label: "Unsupported regimen" }, { value: "failed-prerequisite", label: "Failed prerequisite" }, { value: "creation-failure", label: "Creation service fails" },
];
/** Checks resolve down the list 30 ms apart (capped at 300 ms); the receipt rises in as they finish and its seal stamps. */
const STAGGER = 30, PULSE_STAGGER = 70;
const REGIMEN_NOTE = "Authored synthetic regimen, narrower than the NHS adult dose limits. It is not an NHS recommendation for this patient or a validated model decision. No dispensing or pharmacy transmission.";

function RegimenRows({ regimen }: { regimen: Regimen }) {
  return <View style={{ gap: 12 }}>
    <Detail label="Dose" value={`${regimen.dose} ${regimen.unit}`} />
    <Detail label="Route" value={regimen.route} />
    <Detail label="Frequency & limit" value={regimen.frequency} />
    <Detail label="Duration" value={regimen.duration} />
  </View>;
}

/**
 * The fixture prerequisites as a checklist. While a real check request runs, each mark pulses in
 * a slow wave (nothing is shown as passed before the result exists); when the result arrives the
 * marks resolve in sequence and blocked checks open their reason.
 */
function CheckList({ checks, checking, fresh }: { checks: PrescriptionCheck[]; checking: boolean; fresh: boolean }) {
  const layout = useLayoutSpring();
  return <View>
    {checks.map((check, index) => {
      const state = checking ? "pending" : check.status === "passed" ? "done" : "blocked";
      return <Animated.View key={check.id} layout={layout}>
        {index > 0 && <Hairline inset={38} />}
        <View accessible accessibilityLabel={`${check.label}. ${checking ? "Checking" : check.status === "passed" ? "Passed" : `Blocked. ${check.detail}`}`} style={{ flexDirection: "row", gap: 14, paddingVertical: 11 }}>
          <Mark state={state} delay={checking ? index * PULSE_STAGGER : fresh ? index * STAGGER : 0} />
          <View style={{ flex: 1, gap: 3, paddingTop: 2 }}>
            <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: state === "blocked" ? "600" : "500", color: checking ? palette.muted : palette.ink }}>{check.label}</Text>
            {state === "blocked" && <Expand><Text selectable style={{ fontSize: 14, lineHeight: 20, color: palette.muted }}>{check.detail}</Text></Expand>}
          </View>
        </View>
      </Animated.View>;
    })}
  </View>;
}

/**
 * Autonomous prescribing (synthetic) as generated sections: status and the regimen being
 * evaluated, the checks as staged progress, then (only when every check passed) an immutable
 * receipt as the answer's one feature surface. Evidence, audit and demo scenarios stay behind
 * disclosures. No approval gate; missing inputs, stale review and failed checks still block.
 */
export function PrescriptionPanel({ patient, result, onSource, onRequest, onOpen }: FeatureProps) {
  const { encounters, patient: activePatient, updateEncounter, cancel, startAmendment } = useEncounter();
  const reduced = useReduceMotionPreference();
  const layout = useLayoutSpring();
  const encounter = encounters[patient.id];
  const prescription = result ? result.prescription : encounter?.prescription;
  const [showInputs, setShowInputs] = useState(false);
  const [audit, setAudit] = useState(false);
  const [amending, setAmending] = useState(false);
  const [showScenarios, setShowScenarios] = useState(false);
  const amendment = encounter?.amendmentOperation;
  const amendmentPending = amendment !== undefined && ["queued-review", "reviewing", "queued-issue", "issuing"].includes(amendment.phase);
  const inputs = encounter?.prescriptionInputs ?? emptyInputs;
  const busy = encounter?.requests.some(request => request.status === "streaming") ?? false;
  const issuing = encounter?.requests.some(request => request.status === "streaming" && request.kind === "prescription") ?? false;
  const stale = prescription !== undefined && prescription.revision !== encounter?.revision;
  const checks = encounter ? getPrescriptionChecks(encounter, activePatient?.id === patient.id ? activePatient : patient) : [];
  const receiptChecks = prescription?.checks ?? [];
  const regimen = prescription?.regimen ?? simulatedRegimen;
  const created = prescription?.status === "created";
  const latestCreated = encounter?.cards.filter(card => card.prescription?.status === "created").at(-1)?.prescription;
  const canAmend = created && (!latestCreated || latestCreated.id === prescription?.id);
  const failed = prescription?.status === "failed";
  const updateInput = (change: Partial<PrescriptionInputs>) => updateEncounter(value => ({ ...value, prescriptionInputs: { ...(value.prescriptionInputs ?? emptyInputs), ...change } }), true);
  const amend = () => {
    if (!encounter?.prescriptionAmendment?.trim()) return;
    startAmendment(encounter.prescriptionAmendment.trim());
    setAmending(false);
  };

  // A result that arrives while this answer is on screen resolves its checks in sequence, then the
  // receipt lands with one haptic. Results already present at mount appear settled.
  const createdAt = prescription?.createdAt;
  const status = prescription?.status;
  const [seenAt, setSeenAt] = useState(createdAt);
  const fresh = createdAt !== undefined && createdAt !== seenAt;
  const settle = Math.min(checks.length * STAGGER, 300);
  const riseDelay = Math.max(0, settle - 60), stampDelay = settle + 60;
  useEffect(() => {
    if (!fresh) return;
    const timers = [
      setTimeout(() => haptic(status === "created" ? "success" : "warning"), status === "created" && !reduced ? stampDelay + 140 : 0),
      setTimeout(() => setSeenAt(createdAt), 1500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [fresh, createdAt, status, stampDelay, reduced]);

  // Blocking reasons already visible as blocked rows below are not repeated; stale or extra ones are.
  const blockedNow = new Set(checks.filter(check => check.status === "blocked").map(check => check.detail));
  const reasons = prescription?.reasons.filter(reason => stale || !blockedNow.has(reason)) ?? [];
  const passed = checks.filter(check => check.status === "passed").length;

  const title = issuing ? "Checking before simulated creation" : created ? "Simulated prescription created" : failed ? "Simulated creation failed" : prescription ? "Simulation blocked" : "Review the simulation inputs";
  const subtitle = issuing ? `Running the fixture checks for encounter revision ${encounter?.revision}. Nothing is created unless every check passes.`
    : created ? "Every fixture check passed, so it was created automatically. No clinician approval gate; simulation only."
    : failed ? "The checks passed, but no receipt was issued."
    : prescription ? "Nothing was created. Resolve what blocked it, then run the simulation again."
    : "Nothing has been created yet. It runs only when every check below passes.";

  return <LayoutAnimationConfig skipEntering>
    <View style={{ gap: 34 }}>
      <Animated.View layout={layout}>
        <Section title={title} subtitle={subtitle}>
          {stale && <Notice warning>Receipt revision {prescription.revision} is retained unchanged. The current encounter is revision {encounter?.revision}.</Notice>}
          {reasons.map((reason, index) => <StatusLine key={`${index}-${reason}`} state="blocked">{reason}</StatusLine>)}
          {prescription && !created && !failed && !reasons.length && <Footnote>The blocked checks are marked below.</Footnote>}
          {!created && <Surface style={{ padding: 18, gap: 14 }}>
            <View style={{ gap: 4 }}>
              <Label muted>Regimen being evaluated</Label>
              <Text selectable style={{ fontSize: 20, lineHeight: 26, fontWeight: "600", letterSpacing: -0.3, color: palette.ink }}>{regimen.medication} · {regimen.formulation}</Text>
            </View>
            <Detail label="Indication & provenance" value={regimen.indication} />
            <RegimenRows regimen={regimen} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 18 }}>
              <SourceLink label="Recorded patient context" onPress={() => onSource("history")} />
              <SourceLink label="NHS reference & fixture protocol" onPress={() => onSource(regimen.sourceId)} />
            </View>
            <Footnote>{REGIMEN_NOTE}</Footnote>
          </Surface>}
        </Section>
      </Animated.View>

      <Animated.View layout={layout}>
        <Section title="Explicit facts before action" subtitle={issuing ? "Checking each prerequisite against the current encounter…" : `${passed} of ${checks.length} fixture prerequisites satisfied. This count describes workflow checks, not clinical confidence.`}>
          <Surface feature={!created} layout={layout} style={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 18, gap: 12 }}>
            <CheckList checks={checks} checking={issuing} fresh={fresh} />
            <Animated.View layout={layout}><Hairline /></Animated.View>
            <Animated.View layout={layout}>
              <DisclosureButton label={showInputs ? "Hide eligibility inputs" : "Complete eligibility inputs"} open={showInputs} onToggle={() => setShowInputs(value => !value)} />
            </Animated.View>
            {showInputs && <FormReveal style={{ gap: 14 }}>
              <ClinicalField label="Weight in kg" value={inputs.weightKg} onChange={weightKg => updateInput({ weightKg })} keyboardType="decimal-pad" />
              {([["paracetamolAllergy", "Prior paracetamol allergy"], ["liverDisease", "Liver disease"], ["kidneyDisease", "Kidney disease"], ["alcoholRisk", "Alcohol dependence or binge drinking"]] as const).map(([key, label]) => <ClinicalChoice key={key} label={label} value={inputs[key]} options={[...answers]} onChange={answer => updateInput({ [key]: answer })} />)}
              <Action label="Load synthetic eligibility" secondary onPress={() => updateEncounter(value => ({ ...value, prescriptionInputs: { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" } }), true)} />
              <Footnote>Load assigns authored demo values: 62 kg and explicit negative risk answers. It does not collect history, confirm medicine identities or remove other blocking checks.</Footnote>
            </FormReveal>}
            <Animated.View layout={layout} style={{ gap: 8, paddingTop: 4 }}>
              <Action label={busy || amendmentPending ? "Simulation is working…" : failed ? "Retry simulated creation" : "Run prescribing simulation"} icon={busy || amendmentPending ? undefined : "doc.badge.plus"} disabled={busy || amendmentPending} onPress={() => onRequest("prescription")} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Action label="Reconcile & review medicines" secondary icon="pills" disabled={busy} onPress={() => onRequest("medication")} />
                {(busy || amendmentPending) && <Action label="Cancel current simulation step" secondary icon="stop.fill" onPress={cancel} />}
              </View>
            </Animated.View>
            {amendmentPending && <Notice>{amendment.phase === "queued-review" || amendment.phase === "reviewing" ? "Reviewing amended medication context…" : "Checking the amended simulation…"} This workflow continues when you leave this result.</Notice>}
            {amendment?.error && <Notice warning>{amendment.error}</Notice>}
            {amendment?.phase === "complete" && <Notice>Amendment workflow completed. Inspect the latest simulated prescription receipt.</Notice>}
            {amendment?.phase === "cancelled" && !amendment.error && <Notice>The amendment was cancelled. Its original receipt remains unchanged.</Notice>}
          </Surface>
        </Section>
      </Animated.View>

      {created && prescription && <Animated.View layout={layout} entering={fresh && !reduced ? riseIn({ delay: riseDelay, distance: 16, duration: 380 }) : undefined}>
        <Section title="Immutable receipt" subtitle="This version never changes. An amendment creates a new version and keeps this one.">
          <Surface feature layout={layout} style={{ padding: 20, gap: 16 }}>
            <View accessible accessibilityLabel={`Simulated prescription created. ${regimen.medication}, simulation only. Synthetic patient.`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Seal stampDelay={fresh ? stampDelay : undefined} />
              <View style={{ flex: 1, gap: 3 }}>
                <Label muted>Simulated prescription · synthetic</Label>
                <Text style={{ fontSize: 21, lineHeight: 26, fontWeight: "600", letterSpacing: -0.4, color: palette.ink }}>{regimen.medication} · simulation only</Text>
              </View>
            </View>
            <Perforation />
            <Detail label="Medication & formulation" value={`${regimen.medication} · ${regimen.formulation}`} />
            <Detail label="Indication & provenance" value={regimen.indication} />
            <RegimenRows regimen={regimen} />
            <Perforation />
            <Detail label="Synthetic patient" value={`${patient.name} · ${patient.id}`} />
            <Detail label="Created" value={`${new Date(prescription.createdAt).toLocaleString()} · encounter revision ${prescription.revision}`} />
            <Text selectable style={{ fontSize: 15, lineHeight: 21, fontWeight: "500", color: palette.ink }}>Automatically created after the fixture checks. No clinician approval was requested.</Text>
            <Footnote>{REGIMEN_NOTE}</Footnote>
            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 18 }}>
              <SourceLink label="Recorded patient context" onPress={() => onSource("history")} />
              <SourceLink label="NHS reference & fixture protocol" onPress={() => onSource(regimen.sourceId)} />
            </View>
            {prescription.supersedes && <Notice>This version supersedes an earlier simulation. Its original receipt remains in the encounter history.</Notice>}
            {!canAmend && <Notice>A newer created version exists. Inspect or amend the latest receipt in this encounter.</Notice>}
            <Animated.View layout={layout} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Action label={amending ? "Hide amendment form" : "Amend this simulation"} secondary icon="square.and.pencil" disabled={busy || amendmentPending || !canAmend} onPress={() => setAmending(value => !value)} />
              <Action label="Open consultation note" secondary onPress={() => onOpen("note")} />
            </Animated.View>
            {amending && canAmend && <FormReveal style={{ gap: 12 }}>
              <ClinicalField label="Amendment reason" value={encounter?.prescriptionAmendment ?? ""} onChange={prescriptionAmendment => updateEncounter(value => ({ ...value, prescriptionAmendment }))} multiline />
              <Footnote>Record the reason and update any eligibility or medication details above. Saving creates a new encounter revision, reruns review and attempts a new simulated prescription. The original receipt stays unchanged.</Footnote>
              <Action label="Save amendment & rerun checks" disabled={busy || !encounter?.prescriptionAmendment?.trim() || amendmentPending} onPress={amend} />
            </FormReveal>}
          </Surface>
        </Section>
      </Animated.View>}

      <Animated.View layout={layout}>
        <Section title="Behind this result" subtitle={prescription ? "Inspect its checks, evidence and version, or rehearse a blocked or failed action." : "Rehearse a blocked or failed action with the demo fixtures."}>
          {prescription && <DisclosureButton label={audit ? "Hide audit details" : "Show checks, evidence & version"} open={audit} onToggle={() => setAudit(value => !value)} />}
          {prescription && audit && <Expand style={{ gap: 12, paddingBottom: 6 }}>
            <Detail label="Operation" value={prescription.id} />
            <Detail label="Version" value={`Encounter revision ${prescription.revision}`} />
            <Detail label="Source version" value={regimen.sourceVersion} />
            {prescription.supersedes && <Detail label="Supersedes" value={prescription.supersedes} />}
            {receiptChecks.map(check => <View key={check.id} style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ paddingTop: 1 }}><Mark state={check.status === "passed" ? "done" : "blocked"} size={16} /></View>
              <View style={{ flex: 1 }}><Detail label={`${check.label} · ${check.status}`} value={check.detail} /></View>
            </View>)}
            {!!prescription.audit?.length && <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: "500", color: palette.muted }}>Audit trail</Text>
              {prescription.audit.map((entry, index) => <Text key={`${index}-${entry}`} selectable style={{ fontSize: 13, lineHeight: 19, color: palette.ink }}>{entry}</Text>)}
            </View>}
            {prescription.inputs && <Detail label="Captured inputs" value={`Weight: ${prescription.inputs.weightKg || "unknown"} kg. Paracetamol allergy: ${prescription.inputs.paracetamolAllergy}. Liver: ${prescription.inputs.liverDisease}. Kidney: ${prescription.inputs.kidneyDisease}. Alcohol risk: ${prescription.inputs.alcoholRisk}.`} />}
          </Expand>}
          <Animated.View layout={layout}>
            <DisclosureButton label={showScenarios ? "Hide scenarios" : "Choose simulation scenario"} open={showScenarios} onToggle={() => setShowScenarios(value => !value)} />
          </Animated.View>
          {showScenarios && <FormReveal style={{ gap: 10 }}>
            <ClinicalChoice label="Prescribing scenario" value={encounter?.prescriptionScenario ?? "standard"} options={scenarios} onChange={prescriptionScenario => updateEncounter(value => ({ ...value, prescriptionScenario }), true)} />
            <Footnote>Changing a scenario invalidates previous checks. Run medication review, then the simulation. Restore the standard scenario to recover.</Footnote>
          </FormReveal>}
        </Section>
      </Animated.View>
    </View>
  </LayoutAnimationConfig>;
}
