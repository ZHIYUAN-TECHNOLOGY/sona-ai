import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button, Field } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { KIND_ORDER, KINDS, parseReading, valueWords, withReading, type Kind, type NewReading, type ReadingList } from "./readings";

/** The one list every part of the page reads: the longest window the server keeps, cut down in the browser. */
export const listOptions = () => orpc.care.readings.list.queryOptions({ input: { days: 90 } });

/** Add a reading in place. It shows in the page at once and is taken back if the server refuses it. */
export function AddForm({ initialKind = "blood_pressure" }: { initialKind?: Kind }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState("");
  const bp = kind === "blood_pressure", { label, unit } = KINDS[kind];

  const add = useMutation(orpc.care.readings.add.mutationOptions({
    onMutate: async variables => {
      // The form only ever sends a parsed reading; the server's input type leaves `takenAt` loose.
      const input = variables as NewReading;
      const key = listOptions().queryKey;
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData(key);
      if (before) qc.setQueryData(key, withReading(before as ReadingList, input, `pending-${Date.now()}`, new Date()));
      return { before };
    },
    onError: (e, _input, ctx) => {
      if (ctx?.before) qc.setQueryData(listOptions().queryKey, ctx.before);
      // The server's own plain-words reason, under the field.
      setError(e.message || "We couldn't save that reading. Please try again.");
    },
    onSuccess: (_data, variables) => {
      const r = variables as NewReading;
      setValue(""); setValue2(""); setTime("");
      setSaved(`Saved. ${KINDS[r.kind].label} ${valueWords(KINDS[r.kind], r)}.`);
    },
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: orpc.care.readings.list.key() }),
      qc.invalidateQueries({ queryKey: orpc.care.visitPrep.get.key() }),
    ]),
  }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved("");
    const parsed = parseReading(kind, value, value2, time);
    if ("error" in parsed) return setError(parsed.error);
    setError(undefined);
    add.mutate(parsed.input);
  };
  const pick = (k: Kind) => { setKind(k); setError(undefined); setSaved(""); };

  return (
    <form className="card rd-form" id="rd-add" onSubmit={submit} aria-labelledby="rd-add-title">
      <h2 className="card-title" id="rd-add-title">Add a reading</h2>
      <div className="rd-kinds" role="group" aria-label="What did you measure?">
        {KIND_ORDER.map(k => (
          <button key={k} type="button" aria-pressed={k === kind} onClick={() => pick(k)}>{KINDS[k].label}</button>
        ))}
      </div>
      <div className="rd-inputs">
        <Field label={bp ? `Upper number (${unit})` : `${label} (${unit})`} error={error}>
          {c => <input {...c} className="rd-value" inputMode="decimal" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} placeholder={bp ? "120" : undefined} />}
        </Field>
        {bp ? (
          <Field label={`Lower number (${unit})`}>
            {c => <input {...c} inputMode="decimal" autoComplete="off" value={value2} onChange={e => setValue2(e.target.value)} placeholder="80" />}
          </Field>
        ) : null}
        <Field label="When (optional)" hint="Leave empty for now.">
          {c => <input {...c} type="datetime-local" value={time} onChange={e => setTime(e.target.value)} />}
        </Field>
      </div>
      <div className="rd-actions">
        <Button type="submit" variant="primary" pending={add.isPending}>Save reading</Button>
        <span role="status">{add.isPending ? "" : saved}</span>
      </div>
    </form>
  );
}
