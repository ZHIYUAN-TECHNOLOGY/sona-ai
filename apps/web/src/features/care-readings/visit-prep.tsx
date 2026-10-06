import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button, Field } from "@/components/primitives";
import { browserLang, whenWords } from "@/features/care-follow-ups/dates";
import { client, orpc } from "@/lib/orpc";
import "@/styles/pages/care-readings.css";

type Prep = Awaited<ReturnType<typeof client.care.visitPrep.get>>;
const lang = browserLang();

/** Questions and readings to share before the next visit. Draws nothing when no visit is booked. */
export function VisitPrep() {
  const prep = useQuery(orpc.care.visitPrep.get.queryOptions());
  if (!prep.data?.appointment) return null;
  // Keyed by the visit, so the fields start from what was saved for it.
  return <PrepForm key={prep.data.appointment.id} prep={prep.data} />;
}

function PrepForm({ prep }: { prep: Prep }) {
  const qc = useQueryClient();
  const [questions, setQuestions] = useState(() => [0, 1, 2].map(i => prep.questions[i] ?? ""));
  const [share, setShare] = useState(prep.shareReadings);
  const save = useMutation(orpc.care.visitPrep.save.mutationOptions({
    onSuccess: data => qc.setQueryData(orpc.care.visitPrep.get.queryOptions().queryKey, data),
  }));
  const noVisit = (save.error as { data?: { code?: string } } | null)?.data?.code === "NO_VISIT";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ questions: questions.map(q => q.trim()).filter(Boolean), shareReadings: share });
  };

  return (
    <form className="card rd-prep" onSubmit={submit} aria-labelledby="rd-prep-title">
      <h2 className="card-title" id="rd-prep-title">Get ready for your visit</h2>
      <p className="rd-calm">{whenWords(new Date(prep.appointment!.startsAt), lang)}. Ask up to three questions. Your doctor reads them before you arrive.</p>
      {questions.map((q, i) => (
        <Field key={i} label={`Question ${i + 1}`}>
          {c => <input {...c} maxLength={200} value={q} onChange={e => setQuestions(qs => qs.map((old, j) => (j === i ? e.target.value : old)))} />}
        </Field>
      ))}
      <label className="rd-switch">
        <input type="checkbox" role="switch" checked={share} onChange={e => setShare(e.target.checked)} />
        Share my last 7 days of readings
      </label>
      <div className="rd-actions">
        <Button type="submit" variant="primary" pending={save.isPending}>Save for my visit</Button>
        <span role="status">{save.isSuccess ? "Saved." : ""}</span>
      </div>
      {save.isError ? <p className="field-error" role="alert">{noVisit ? "Book a visit first" : save.error.message || "We couldn't save that. Please try again."}</p> : null}
      <section className="rd-sees" aria-labelledby="rd-sees-title">
        <h3 id="rd-sees-title">What the doctor will see</h3>
        {prep.doctorWillSee
          ? <p className="rd-sees-text">{prep.doctorWillSee}</p>
          : <p className="rd-calm">Nothing yet. Save to see exactly what your doctor will read.</p>}
      </section>
    </form>
  );
}
