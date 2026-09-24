import { useEffect, useState } from "react";
import { View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { useReduceMotionPreference } from "@/components/sona/accessibility";
import { riseIn } from "@/components/sona/motion";
import { Anchor } from "@/components/sona/answer-kit";
import { Section } from "@/components/sona/sections";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Expand, Label, Notice, SourceLink, Surface } from "@/components/sona/ui";
import { getPrescriptionChecks, simulatedRegimen } from "@/features/encounter/clinical-state";
import { useEncounter } from "@/features/encounter/store";
import type { Encounter, FeatureProps, PrescriptionCheck, PrescriptionInputs, Regimen } from "@/features/encounter/types";
import { ClinicalChoice, ClinicalField } from "./controls";
import { Detail, DisclosureButton, Footnote, FormReveal, Hairline, Mark, Perforation, Seal, StatusLine, TextLink, haptic, useLayoutSpring } from "./medication-parts";

const emptyInputs: PrescriptionInputs = { weightKg: "", liverDisease: "unknown", kidneyDisease: "unknown", alcoholRisk: "unknown", paracetamolAllergy: "unknown" };
const answers = [{ value: "unknown", label: "Not recorded" }, { value: "no", label: "No · explicitly recorded" }, { value: "yes", label: "Yes" }] as const;
const scenarios: { value: NonNullable<Encounter["prescriptionScenario"]>; label: string }[] = [
  { value: "standard", label: "Standard synthetic scenario" }, { value: "unknown-coverage", label: "Unknown interaction coverage" },
  { value: "unsupported", label: "Unsupported regimen" }, { value: "failed-prerequisite", label: "Failed prerequisite" }, { value: "creation-failure", label: "Creation service fails" },
];
/** Checks resolve down the list 30 ms apart (capped at 300 ms); the receipt rises in as they finish and its seal stamps. */
const STAGGER = 30, PULSE_STAGGER = 70;
const REGIMEN_LINE = "Authored synthetic regimen, not an NHS recommendation. No dispensing.";
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
 * Autonomous prescribing (synthetic), condensed: status heading with the regimen in one line, the
 * checks as staged progress with one primary action, then (only when every check passed) an
 * immutable receipt as the answer's one feature surface. Evidence and audit share one disclosure;
 * the scenario picker and eligibility loader appear only with demo controls on. No approval gate;
 * missing inputs, stale review and failed checks still block.
 */
export function PrescriptionPanel({ patient, result, onSource, onRequest, onOpen }: FeatureProps) {
  const { encounters, patient: activePatient, updateEncounter, cancel, startAmendment, showDemoControls } = useEncounter();
  const reduced = useReduceMotionPreference();
  const layout = useLayoutSpring();
  const encounter = encounters[patient.id];
  const prescription = result ? result.prescription : encounter?.prescription;
  const [showInputs, setShowInputs] = useState(false);
  // The "Next step" bar asks for the eligibility form by stamping the encounter.
  const inputsOpen = encounter?.prescriptionInputsOpen;
  useEffect(() => { if (inputsOpen) setShowInputs(true); }, [inputsOpen]);
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
  const subtitle = issuing ? `Checking encounter revision ${encounter?.revision}. Nothing is created unless every check passes.`
    : created ? "Created automatically once every fixture check passed. Simulation only."
    : failed ? "The checks passed, but no receipt was issued."
    : prescription ? "Nothing was created. Resolve what blocked it, then run again."
    : "Nothing is created until every check below passes.";

  return <LayoutAnimationConfig skipEntering>
    <View style={{ gap: 28 }}>
      <Anchor id="result" title="Result"><Animated.View layout={layout}>
        <Section icon="cross.case" tone="blue" title={title} subtitle={subtitle}>
          {stale && <Notice warning>Receipt revision {prescription.revision} is retained unchanged. The current encounter is revision {encounter?.revision}.</Notice>}
          {reasons.map((reason, index) => <StatusLine key={`${index}-${reason}`} state="blocked">{reason}</StatusLine>)}
          {!created && <View style={{ gap: 4 }}>
            <Text selectable style={{ fontSize: 17, lineHeight: 23, fontWeight: "600", color: palette.ink }}>{regimen.medication} · {regimen.formulation}</Text>
            <Text selectable style={{ fontSize: 15, lineHeight: 21, color: palette.muted }}>{regimen.dose} {regimen.unit} · {regimen.route} · {regimen.frequency} · {regimen.duration}</Text>
          </View>}
          {!created && <Footnote>{REGIMEN_LINE}</Footnote>}
        </Section>
      </Animated.View></Anchor>

      <Anchor id="checks" title="Checks"><Animated.View layout={layout}>
        <Section icon="checklist" tone="teal" title="Checks before action" subtitle={issuing ? "Checking each prerequisite against the current encounter…" : `${passed} of ${checks.length} met · workflow checks, not clinical confidence`}>
          <Surface feature={!created} layout={layout} style={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 18, gap: 12 }}>
            <CheckList checks={checks} checking={issuing} fresh={fresh} />
            <Animated.View layout={layout}><Hairline /></Animated.View>
            <Animated.View layout={layout}>
              <DisclosureButton label="Eligibility inputs" open={showInputs} onToggle={() => setShowInputs(value => !value)} />
            </Animated.View>
            {showInputs && <FormReveal style={{ gap: 14 }}>
              <ClinicalField label="Weight in kg" value={inputs.weightKg} onChange={weightKg => updateInput({ weightKg })} keyboardType="decimal-pad" />
              {([["paracetamolAllergy", "Prior paracetamol allergy"], ["liverDisease", "Liver disease"], ["kidneyDisease", "Kidney disease"], ["alcoholRisk", "Alcohol dependence or binge drinking"]] as const).map(([key, label]) => <ClinicalChoice key={key} label={label} value={inputs[key]} options={[...answers]} onChange={answer => updateInput({ [key]: answer })} />)}
              {showDemoControls && <Action label="Load synthetic eligibility" secondary onPress={() => updateEncounter(value => ({ ...value, prescriptionInputs: { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" } }), true)} />}
              {showDemoControls && <Footnote>Fills 62 kg and explicit negatives only. It doesn’t collect history, confirm medicines or clear other checks.</Footnote>}
            </FormReveal>}
            <Animated.View layout={layout} style={{ gap: 4, paddingTop: 4 }}>
              <Action label={busy || amendmentPending ? "Simulation is working…" : failed ? "Retry simulated creation" : "Run prescribing simulation"} icon={busy || amendmentPending ? undefined : "doc.badge.plus"} disabled={busy || amendmentPending} onPress={() => onRequest("prescription")} />
              {busy || amendmentPending ? <Action label="Cancel current step" secondary icon="stop.fill" onPress={cancel} />
                : <TextLink label="Review medicines" onPress={() => onRequest("medication")} />}
            </Animated.View>
            {amendmentPending && <Notice>{amendment.phase === "queued-review" || amendment.phase === "reviewing" ? "Reviewing amended medication context…" : "Checking the amended simulation…"} This continues if you leave this result.</Notice>}
            {amendment?.error && <Notice warning>{amendment.error}</Notice>}
            {amendment?.phase === "complete" && <Notice>Amendment completed. See the latest receipt.</Notice>}
            {amendment?.phase === "cancelled" && !amendment.error && <Notice>Amendment cancelled. The original receipt is unchanged.</Notice>}
          </Surface>
        </Section>
      </Animated.View></Anchor>

      {created && prescription && <Anchor id="receipt" title="Receipt"><Animated.View layout={layout} entering={fresh && !reduced ? riseIn({ delay: riseDelay, distance: 16, duration: 380 }) : undefined}>
        <Section icon="checkmark.seal" tone="teal" title="Immutable receipt" subtitle="This version never changes; an amendment adds a new one.">
          <Surface feature layout={layout} style={{ padding: 20, gap: 16 }}>
            <View accessible accessibilityLabel={`Simulated prescription created. ${regimen.medication}, simulation only. Synthetic patient.`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Seal stampDelay={fresh ? stampDelay : undefined} />
              <View style={{ flex: 1, gap: 3 }}>
                <Label muted>Simulated prescription · synthetic</Label>
                <Text style={{ ...type.heading, color: palette.ink }}>{regimen.medication} · {regimen.formulation}</Text>
              </View>
            </View>
            <Perforation />
            <Detail label="Indication" value={regimen.indication} />
            <RegimenRows regimen={regimen} />
            <Perforation />
            <Detail label="Synthetic patient" value={`${patient.name} · ${patient.id}`} />
            <Detail label="Created" value={`${new Date(prescription.createdAt).toLocaleString()} · encounter revision ${prescription.revision}`} />
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
          </Surface>
        </Section>
      </Animated.View></Anchor>}

      <Animated.View layout={layout} style={{ gap: 4 }}>
        <DisclosureButton label="Evidence & audit" open={audit} onToggle={() => setAudit(value => !value)} />
        {audit && <Expand style={{ gap: 12, paddingBottom: 6 }}>
          <Detail label="Indication & provenance" value={regimen.indication} />
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
            <Text style={{ fontSize: 12, fontWeight: "500", color: palette.muted }}>Audit trail</Text>
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
