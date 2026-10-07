import { defaultMedications, parseRegimen } from "@sona-ai/domain/prescribing";
import type { MedicationEntry, Patient } from "@sona-ai/domain/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button, Card, Chip, Field, ListRow } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { entryProblem, NO_REGIMEN, REGIMEN, type RegimenDraft, regimenOf } from "./medicine-entry";
import { refusal, type VisitPatient } from "./visit";

export type MedicineState = { medicationEntries?: MedicationEntry[]; proposedMedicine?: string; reviewInvalidated?: boolean; medicationCheckedRevision?: number };

const isConflict = (error: unknown) => (error as { code?: string } | null)?.code === "CONFLICT";

/** The visit's medicines and the proposed order, entered here; every save is an edit at the revision last read. */
export function Medicines({ encounterId, revision, state, patient, canEdit }: { encounterId: string; revision: number; state: MedicineState; patient: VisitPatient; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = orpc.encounter.get.key({ input: { encounterId } });
  const [entry, setEntry] = useState<MedicationEntry>();
  const [regimen, setRegimen] = useState<RegimenDraft>();
  const [problem, setProblem] = useState<string>();
  const options = {
    onSuccess: (snapshot: unknown) => { queryClient.setQueryData(queryKey, snapshot as never); setEntry(undefined); setRegimen(undefined); },
    // Refused as stale or otherwise: read the visit again so the next attempt carries the current revision.
    onError: () => queryClient.invalidateQueries({ queryKey }),
  };
  const edit = useMutation(orpc.encounter.edit.mutationOptions(options));
  const record = useMutation(orpc.encounter.recordReview.mutationOptions(options));

  // Until the visit has its own list, it starts from the medicines on the patient's record, as on the phone.
  const entries: MedicationEntry[] = state.medicationEntries ?? defaultMedications(patient as Patient);
  const proposed = state.proposedMedicine;
  const failed = edit.error ?? record.error;
  const saveEntries = (medicationEntries: MedicationEntry[]) => { record.reset(); edit.mutate({ encounterId, expectedRevision: revision, medicationEntries }); };
  const saveProposed = (proposedMedicine: string) => { record.reset(); edit.mutate({ encounterId, expectedRevision: revision, proposedMedicine }); };
  const open = (next: { entry?: MedicationEntry; regimen?: RegimenDraft }) => { setProblem(undefined); setEntry(next.entry); setRegimen(next.regimen); };

  const submitEntry = (e: MedicationEntry) => {
    const bad = entryProblem(e);
    setProblem(bad);
    if (bad) return;
    const clean = { ...e, name: e.name.trim(), ingredient: e.ingredient.trim(), formulation: e.formulation.trim() };
    saveEntries(entries.some(x => x.id === e.id) ? entries.map(x => (x.id === e.id ? clean : x)) : [...entries, clean]);
  };
  const submitRegimen = (draft: RegimenDraft) => {
    const line = regimenOf(draft);
    setProblem(line ? undefined : "Fill in every part. The strength starts with a number, such as 500 mg tablets, and the dose is a number.");
    if (line) saveProposed(line);
  };

  return (
    <Card title="Medicines on this visit">
      {state.reviewInvalidated ? <p role="status" className="visit-refused">The visit was edited after its last medication review. Review it again before ordering.</p> : null}
      {entries.length ? null : <p className="visit-muted">No medicines are recorded for this visit.</p>}
      <ul className="list visit-med-list">
      {entries.map(e => (
        <ListRow key={e.id} icon="pill" title={e.name}
          caption={[e.ingredient || "ingredient not set", e.formulation || "form not set", e.change].filter(Boolean).join(" · ")}
          trailing={
            <span className="visit-row-actions">
              {e.confirmed ? <Chip tone="done">Confirmed</Chip> : <Chip tone="amber">Not confirmed</Chip>}
              {canEdit ? <Button size="sm" onClick={() => open({ entry: e })}>Edit</Button> : null}
              {canEdit ? <Button size="sm" aria-label={`Remove ${e.name}`} pending={edit.isPending} onClick={() => saveEntries(entries.filter(x => x.id !== e.id))}>Remove</Button> : null}
            </span>
          } />
      ))}

      <ListRow icon="pill" title={proposed || "No medicine proposed yet"} caption="Proposed order"
        trailing={canEdit ? (
          <span className="visit-row-actions">
            <Button size="sm" onClick={() => open({ regimen: parseRegimen(proposed) ?? NO_REGIMEN })}>{proposed ? "Change" : "Propose a medicine"}</Button>
            {proposed ? <Button size="sm" aria-label="Remove the proposed medicine" pending={edit.isPending} onClick={() => saveProposed("")}>Remove</Button> : null}
          </span>
        ) : undefined} />
      </ul>

      {entry ? (
        <form className="visit-med-form" onSubmit={ev => { ev.preventDefault(); submitEntry(entry); }}>
          <Field label="Medicine name">{c => <input {...c} required value={entry.name} onChange={ev => setEntry({ ...entry, name: ev.target.value })} />}</Field>
          <Field label="Active ingredient">{c => <input {...c} value={entry.ingredient} onChange={ev => setEntry({ ...entry, ingredient: ev.target.value })} />}</Field>
          <Field label="Form" hint="Tablet, syrup, inhaler…">{c => <input {...c} value={entry.formulation} onChange={ev => setEntry({ ...entry, formulation: ev.target.value })} />}</Field>
          <label className="visit-check"><input type="checkbox" checked={entry.confirmed} onChange={ev => setEntry({ ...entry, confirmed: ev.target.checked })} /> I confirmed this medicine with the patient or the record</label>
          <div className="visit-actions">
            <Button type="submit" size="sm" variant="primary" pending={edit.isPending}>Save medicine</Button>
            <Button size="sm" onClick={() => open({})}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {regimen ? (
        <form className="visit-med-form" onSubmit={ev => { ev.preventDefault(); submitRegimen(regimen); }}>
          {REGIMEN.map(([key, label, example]) => (
            <Field key={key} label={label}>{c => <input {...c} required placeholder={example} value={regimen[key]} onChange={ev => setRegimen({ ...regimen, [key]: ev.target.value })} />}</Field>
          ))}
          <div className="visit-actions">
            <Button type="submit" size="sm" variant="primary" pending={edit.isPending}>Save proposed medicine</Button>
            <Button size="sm" onClick={() => open({})}>Cancel</Button>
          </div>
        </form>
      ) : null}

      {problem ? <p role="alert" className="visit-refused">{problem}</p> : null}
      {failed ? (
        <p role="alert" className="visit-refused">
          {isConflict(failed) ? "Someone else changed this visit, so your change was not saved. The visit has been reloaded: check it, then make your change again." : refusal(failed).message}
        </p>
      ) : null}

      {canEdit && !entry && !regimen ? (
        <div className="visit-actions">
          <Button size="sm" onClick={() => open({ entry: { id: `web-${crypto.randomUUID()}`, name: "", ingredient: "", formulation: "", confirmed: false, change: "new" } })}>Add a medicine</Button>
          <Button size="sm" pending={record.isPending} disabled={state.medicationCheckedRevision === revision && !state.reviewInvalidated}
            onClick={() => { edit.reset(); record.mutate({ encounterId, expectedRevision: revision }); }}>
            {state.medicationCheckedRevision === revision && !state.reviewInvalidated ? "Medication review recorded" : "Record medication review"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
