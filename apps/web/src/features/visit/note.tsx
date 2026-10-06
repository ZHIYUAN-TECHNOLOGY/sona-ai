import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EmptyState } from "@/components/page";
import { Button, Card, Chip, Field } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { refusal, toLines, toRows } from "./visit";

/** The structured note, edited section by section; a scribe draft sits beside it until the doctor takes it or leaves it. */
export function Note({ encounterId, canWrite, canDraft }: { encounterId: string; canWrite: boolean; canDraft: boolean }) {
  const queryClient = useQueryClient();
  const note = useQuery(orpc.note.get.queryOptions({ input: { encounterId } }));
  // Only what the doctor has typed; everything else is read from the saved note.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [transcript, setTranscript] = useState("");
  const draft = useMutation(orpc.note.draft.mutationOptions());
  const save = useMutation(orpc.note.save.mutationOptions({
    onSuccess: saved => {
      queryClient.setQueryData(orpc.note.get.key({ input: { encounterId } }), saved);
      void queryClient.invalidateQueries({ queryKey: orpc.note.get.key({ input: { encounterId } }) });
      setEdits({});
    },
  }));

  if (note.isPending) return <EmptyState>Loading the note…</EmptyState>;
  if (note.isError) return <EmptyState>{refusal(note.error).message}</EmptyState>;

  const rows = toRows(note.data.sentences);
  const dirty = rows.some(r => edits[r.id] !== undefined && edits[r.id] !== r.text);
  const sections = draft.data?.sections as Record<string, string> | undefined;
  const lines = toLines(transcript);

  return (
    <div className="visit-note">
      <Card title={note.data.revision ? `Note · revision ${note.data.revision}` : "Note · not written yet"}>
        {rows.map(row => {
          const proposed = sections?.[row.id]?.trim();
          const text = edits[row.id] ?? row.text;
          return (
            <div className="visit-section" key={row.id}>
              <Field label={row.label}>
                {control => (
                  <textarea {...control} rows={3} value={text} readOnly={!canWrite}
                    onChange={e => setEdits(prev => ({ ...prev, [row.id]: e.target.value }))} />
                )}
              </Field>
              {proposed && proposed !== text ? (
                <div className="visit-proposal">
                  <p><Chip tone="info">Draft</Chip> {proposed}</p>
                  <Button onClick={() => setEdits(prev => ({ ...prev, [row.id]: proposed }))}>Use this draft</Button>
                </div>
              ) : null}
            </div>
          );
        })}
        {canWrite ? (
          <div className="visit-actions">
            <Button variant="primary" disabled={!dirty} pending={save.isPending}
              onClick={() => save.mutate({ encounterId, expectedRevision: note.data.revision, sentences: rows.map(r => ({ id: r.id, text: edits[r.id] ?? r.text })).filter(s => s.text.trim()) })}>
              Save the note
            </Button>
            {dirty ? <span className="visit-muted">Unsaved changes</span> : null}
            {save.isError ? <span role="alert" className="visit-refused">{refusal(save.error).message}</span> : null}
          </div>
        ) : <p className="visit-muted">Only a doctor can write the note. You are reading the saved one.</p>}
      </Card>

      {canDraft ? (
        <Card title="Draft from the consultation">
          <Field label="Consultation transcript" hint="Paste what was said, one line per turn. Start a line with Doctor: or Patient: if you know who spoke. Recording is on the phone app for now.">
            {control => <textarea {...control} rows={5} value={transcript} onChange={e => setTranscript(e.target.value)} />}
          </Field>
          <div className="visit-actions">
            <Button disabled={!lines.length} pending={draft.isPending} onClick={() => draft.mutate({ encounterId, lines })}>Draft the note</Button>
            {draft.isError ? <span role="alert" className="visit-refused">{refusal(draft.error).message}</span> : null}
            {draft.data ? (
              <span className="visit-muted">
                {draft.data.source === "fixture" ? "Sample draft: the words as captured, no model read them. " : ""}
                {draft.data.dropped ? `${draft.data.dropped} statements were dropped by the checks. ` : ""}
                The draft sits beside each section. Nothing changes until you use it and save.
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
