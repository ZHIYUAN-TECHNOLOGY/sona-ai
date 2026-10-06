import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";

import { EmptyState } from "@/components/page";
import { Button, Card, Chip, Field, Skeleton } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

import { refusal, toLines, toRows } from "./visit";

/** The structured note, edited section by section; a scribe draft sits beside it until the doctor takes it or leaves it. */
export function Note({ encounterId, canWrite, canDraft, actions }: { encounterId: string; canWrite: boolean; canDraft: boolean; actions?: HTMLElement | null }) {
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

  if (note.isPending) return <Card title="Clinical note"><div className="visit-section"><Skeleton height={72} /><Skeleton height={72} /></div></Card>;
  if (note.isError) return <EmptyState>{refusal(note.error).message}</EmptyState>;

  const rows = toRows(note.data.sentences);
  const dirty = rows.some(r => edits[r.id] !== undefined && edits[r.id] !== r.text);
  const sections = draft.data?.sections as Record<string, string> | undefined;
  const lines = toLines(transcript);
  const waiting = rows.filter(r => { const p = sections?.[r.id]?.trim(); return p && p !== (edits[r.id] ?? r.text); }).length;
  // The scribe's state in one line: idle, drafting, drafted, failed.
  const scribe = draft.isPending ? "Drafting the note from the transcript…"
    : draft.isError ? "The draft failed. The saved note is unchanged."
    : draft.data ? `${draft.data.source === "fixture" ? "Sample draft" : "Drafted"} · ${waiting} ${waiting === 1 ? "section waits" : "sections wait"} for your review`
    : "No draft yet";
  const saveButton = (
    <Button variant="primary" icon="check" disabled={!dirty} pending={save.isPending}
      onClick={() => save.mutate({ encounterId, expectedRevision: note.data.revision, sentences: rows.map(r => ({ id: r.id, text: edits[r.id] ?? r.text })).filter(s => s.text.trim()) })}>
      Save the note
    </Button>
  );

  return (
    <div className="visit-note">
      <Card title="Clinical note">
        <p className="visit-status" role="status">
          <span className="visit-muted">{note.data.revision ? `Revision ${note.data.revision}` : "Not written yet"} · {scribe}</span>
          {dirty ? <Chip tone="amber">Unsaved changes</Chip> : null}
        </p>
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
                  <p><Chip tone="blue" icon="sparkle">Sona draft</Chip> {proposed}</p>
                  <Button size="sm" icon="check" onClick={() => setEdits(prev => ({ ...prev, [row.id]: proposed }))}>Use this draft</Button>
                </div>
              ) : null}
            </div>
          );
        })}
        {canWrite ? (
          <>
            {actions ? createPortal(saveButton, actions) : <div className="visit-actions">{saveButton}</div>}
            {save.isError ? <div role="alert" className="visit-refused">{refusal(save.error).message}</div> : null}
          </>
        ) : <p className="visit-muted">Only a doctor can write the note. You are reading the saved one.</p>}
      </Card>

      {canDraft ? (
        <Card title="Ambient scribe">
          <Field label="Consultation transcript" hint="Paste what was said, one line per turn. Start a line with Doctor: or Patient: if you know who spoke. Recording is on the phone app for now.">
            {control => <textarea {...control} rows={5} value={transcript} onChange={e => setTranscript(e.target.value)} />}
          </Field>
          <div className="visit-actions">
            <Button icon="sparkle" disabled={!lines.length} pending={draft.isPending} onClick={() => draft.mutate({ encounterId, lines })}>Draft the note</Button>
            {draft.isError ? <span role="alert" className="visit-refused">{refusal(draft.error).message}</span> : null}
            <span className="visit-muted" role="status">
              {scribe}{draft.data?.dropped ? ` · ${draft.data.dropped} statements dropped by the checks` : ""}
              {draft.data ? ". Nothing changes until you use a draft and save." : ""}
            </span>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
