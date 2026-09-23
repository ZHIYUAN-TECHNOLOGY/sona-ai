import { useState } from "react";
import { View } from "react-native";
import { Action, Body, Card, Label, Notice, SourceLink } from "@/components/sona/ui";
import { getPrescriptionChecks, simulatedRegimen } from "@/features/encounter/clinical-state";
import { useEncounter } from "@/features/encounter/store";
import type { Encounter, FeatureProps, PrescriptionInputs, Regimen } from "@/features/encounter/types";
import { ClinicalChoice, ClinicalField } from "./controls";

const emptyInputs: PrescriptionInputs = { weightKg: "", liverDisease: "unknown", kidneyDisease: "unknown", alcoholRisk: "unknown", paracetamolAllergy: "unknown" };
const answers = [{ value: "unknown", label: "Not recorded" }, { value: "no", label: "No · explicitly recorded" }, { value: "yes", label: "Yes" }] as const;
const scenarios: { value: NonNullable<Encounter["prescriptionScenario"]>; label: string }[] = [
  { value: "standard", label: "Standard synthetic scenario" }, { value: "unknown-coverage", label: "Unknown interaction coverage" },
  { value: "unsupported", label: "Unsupported regimen" }, { value: "failed-prerequisite", label: "Failed prerequisite" }, { value: "creation-failure", label: "Creation service fails" },
];

function Detail({ label, value }: { label: string; value: string }) { return <View style={{ gap: 5 }}><Label muted>{label}</Label><Body>{value}</Body></View>; }
function RegimenDetails({ regimen }: { regimen: Regimen }) {
  return <View style={{ gap: 12 }}><Detail label="Medication & formulation" value={`${regimen.medication} · ${regimen.formulation}`} /><Detail label="Dose" value={`${regimen.dose} ${regimen.unit}`} /><Detail label="Route" value={regimen.route} /><Detail label="Frequency & limit" value={regimen.frequency} /><Detail label="Duration" value={regimen.duration} /></View>;
}

export function PrescriptionPanel({ patient, result, onSource, onRequest, onOpen }: FeatureProps) {
  const { encounters, patient: activePatient, updateEncounter, cancel, startAmendment } = useEncounter();
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
  return <View style={{ gap: 14 }}>
    <Card label="Autonomous prescribing · synthetic" title={issuing ? "Checking before simulated creation" : created ? "Simulated prescription created" : failed ? "Simulated creation failed" : prescription ? "Simulation blocked" : "Review the simulation inputs"}>
      <Notice>Authored synthetic regimen, narrower than the NHS adult dose limits. It is not an NHS recommendation for this patient or a validated model decision. No dispensing or pharmacy transmission.</Notice>
      <Detail label="Indication & provenance" value={regimen.indication} />
      <SourceLink label="Recorded patient context" onPress={() => onSource("history")} />
      <RegimenDetails regimen={regimen} />
      <SourceLink label="NHS reference & fixture protocol" onPress={() => onSource(regimen.sourceId)} />
      {stale && <Notice warning>Receipt revision {prescription.revision} is retained unchanged. The current encounter is revision {encounter?.revision}.</Notice>}
      {prescription?.reasons.map((reason, index) => <Notice warning key={`${index}-${reason}`}>{reason}</Notice>)}
    </Card>
    <Card label="Current eligibility" title="Explicit facts before action">
      <Body muted>{checks.filter(check => check.status === "passed").length} of {checks.length} fixture prerequisites satisfied. This count describes workflow checks, not clinical confidence.</Body>
      {checks.filter(check => check.status === "blocked").map(check => <View key={check.id} style={{ gap: 4 }}><Label muted>{check.label}</Label><Body>{check.detail}</Body></View>)}
      <Action label={showInputs ? "Hide eligibility inputs" : "Complete eligibility inputs"} secondary onPress={() => setShowInputs(value => !value)} />
      {showInputs && <View style={{ gap: 14 }}>
        <ClinicalField label="Weight in kg" value={inputs.weightKg} onChange={weightKg => updateInput({ weightKg })} keyboardType="decimal-pad" />
        {([ ["paracetamolAllergy", "Prior paracetamol allergy"], ["liverDisease", "Liver disease"], ["kidneyDisease", "Kidney disease"], ["alcoholRisk", "Alcohol dependence or binge drinking"] ] as const).map(([key, label]) => <ClinicalChoice key={key} label={label} value={inputs[key]} options={[...answers]} onChange={answer => updateInput({ [key]: answer })} />)}
        <Action label="Load synthetic eligibility" secondary onPress={() => updateEncounter(value => ({ ...value, prescriptionInputs: { weightKg: "62", liverDisease: "no", kidneyDisease: "no", alcoholRisk: "no", paracetamolAllergy: "no" } }), true)} />
        <Body muted>Load assigns authored demo values: 62 kg and explicit negative risk answers. It does not collect history, confirm medicine identities or remove other blocking checks.</Body>
      </View>}
      <Action label="Reconcile medicine identities" secondary icon="pills" disabled={busy} onPress={() => onRequest("medication")} />
      <Action label="Run current medication review" secondary icon="arrow.clockwise" disabled={busy} onPress={() => onRequest("medication")} />
      <Action label={busy || amendmentPending ? "Simulation is working…" : failed ? "Retry simulated creation" : "Run prescribing simulation"} disabled={busy || amendmentPending} onPress={() => onRequest("prescription")} />
      {(busy || amendmentPending) && <Action label="Cancel current simulation step" secondary onPress={cancel} />}
      {amendmentPending && <Notice>{amendment.phase === "queued-review" || amendment.phase === "reviewing" ? "Reviewing amended medication context…" : "Checking the amended simulation…"} This workflow continues when you leave this result.</Notice>}
      {amendment?.error && <Notice warning>{amendment.error}</Notice>}
      {amendment?.phase === "complete" && <Notice>Amendment workflow completed. Inspect the latest simulated prescription receipt.</Notice>}
      {amendment?.phase === "cancelled" && !amendment.error && <Notice>The amendment was cancelled. Its original receipt remains unchanged.</Notice>}
    </Card>
    {created && prescription && <Card label="Immutable receipt" title={`${regimen.medication} · simulation only`}>
      <Detail label="Synthetic patient" value={`${patient.name} · ${patient.id}`} /><Detail label="Created" value={new Date(prescription.createdAt).toLocaleString()} />
      <Body>Automatically created after the fixture checks. No clinician approval was requested.</Body>
      {prescription.supersedes && <Notice>This version supersedes an earlier simulation. Its original receipt remains in the encounter history.</Notice>}
      {!canAmend && <Notice>A newer created version exists. Inspect or amend the latest receipt in this encounter.</Notice>}
      <Action label={amending ? "Hide amendment form" : "Amend this simulation"} secondary icon="square.and.pencil" disabled={busy || amendmentPending || !canAmend} onPress={() => setAmending(value => !value)} />
      {amending && canAmend && <View style={{ gap: 12 }}><ClinicalField label="Amendment reason" value={encounter?.prescriptionAmendment ?? ""} onChange={prescriptionAmendment => updateEncounter(value => ({ ...value, prescriptionAmendment }))} multiline /><Body muted>Record the reason and update any eligibility or medication details above. Saving creates a new encounter revision, reruns review and attempts a new simulated prescription. The original receipt stays unchanged.</Body><Action label="Save amendment & rerun checks" disabled={busy || !encounter?.prescriptionAmendment?.trim() || amendmentPending} onPress={amend} /></View>}
      <Action label="Open consultation note" secondary onPress={() => onOpen("note")} />
    </Card>}
    {prescription && <Card label="Evidence & audit" title="Inspect this result">
      <Action label={audit ? "Hide audit details" : "Show checks, evidence & version"} secondary onPress={() => setAudit(value => !value)} />
      {audit && <View style={{ gap: 12 }}><Detail label="Operation" value={prescription.id} /><Detail label="Version" value={`Encounter revision ${prescription.revision}`} /><Detail label="Source version" value={regimen.sourceVersion} />{prescription.supersedes && <Detail label="Supersedes" value={prescription.supersedes} />}{receiptChecks.map(check => <Detail key={check.id} label={`${check.label} · ${check.status}`} value={check.detail} />)}{prescription.audit?.map((entry, index) => <Body key={`${index}-${entry}`}>{entry}</Body>)}{prescription.inputs && <><Label muted>Captured inputs</Label><Body>Weight: {prescription.inputs.weightKg || "unknown"} kg. Paracetamol allergy: {prescription.inputs.paracetamolAllergy}. Liver: {prescription.inputs.liverDisease}. Kidney: {prescription.inputs.kidneyDisease}. Alcohol risk: {prescription.inputs.alcoholRisk}.</Body></>}</View>}
    </Card>}
    <Card label="Demo fixture controls" title="Rehearse a blocked or failed action"><Action label={showScenarios ? "Hide scenarios" : "Choose simulation scenario"} secondary onPress={() => setShowScenarios(value => !value)} />{showScenarios && <><ClinicalChoice label="Prescribing scenario" value={encounter?.prescriptionScenario ?? "standard"} options={scenarios} onChange={prescriptionScenario => updateEncounter(value => ({ ...value, prescriptionScenario }), true)} /><Body muted>Changing a scenario invalidates previous checks. Run medication review, then the simulation. Restore the standard scenario to recover.</Body></>}</Card>
  </View>;
}
