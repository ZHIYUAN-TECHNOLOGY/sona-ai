import { useQuery } from "@tanstack/react-query";

import { Button, Card, Chip } from "@/components/primitives";
import { refusal } from "@/features/visit/visit";
import { orpc } from "@/lib/orpc";

/** The one question the page asks: possibilities, never a diagnosis. */
const QUESTION = "What clinical possibilities should I consider for this visit? For each one, say what supports it, what argues against it and what is still missing.";

/** Sample answers say so; a waking model is named in plain words. */
export function originLine(origin: { source: string; waking?: number }) {
  if (origin.source !== "fixture") return undefined;
  return origin.waking === undefined ? "This is a sample answer, not a model's reasoning." : "The reasoning model is waking up, so this is a sample answer. Try again in a moment.";
}

/** Clinical reasoning on request: a model call only when the doctor asks, kept for the session per record revision. */
export function Reasoning({ encounterId, allowed }: { encounterId: string; allowed: boolean }) {
  const revision = useQuery({ ...orpc.encounter.get.queryOptions({ input: { encounterId } }), enabled: allowed, select: e => e.revision }).data;
  const answer = useQuery({
    queryKey: ["visit-tools", "reasoning", encounterId, revision],
    queryFn: () => orpc.encounter.reasoning.call({ encounterId, question: QUESTION }),
    enabled: false, staleTime: Infinity, gcTime: Infinity, retry: false,
  });
  if (!allowed) return <Card title="Clinical reasoning"><p className="visit-muted">Only doctors can ask Sona for clinical reasoning.</p></Card>;
  const think = <Button variant="secondary" icon="sparkle" pending={answer.isFetching} disabled={revision === undefined} onClick={() => void answer.refetch()}>{answer.data || answer.isError ? "Think again" : "Think it through"}</Button>;
  if (!answer.data) {
    return (
      <Card title="Clinical reasoning">
        <p className="visit-muted">{answer.isFetching ? "Sona is reading the record…" : "Possibilities to consider, with what supports each, what argues against it and what is missing."}</p>
        {answer.isError && !answer.isFetching ? <p className="visit-refused" role="alert">{refusal(answer.error).message}</p> : null}
        <div className="visit-actions">{think}</div>
      </Card>
    );
  }
  const origin = originLine(answer.data);
  const sources = answer.data.sourceIds;
  return (
    <Card title="Possibilities to consider">
      {origin ? <p className="vt-origin"><Chip tone="amber">Sample</Chip> {origin}</p> : null}
      {answer.data.withheld ? <p className="visit-refused">Sona held back part of this answer. Check the record yourself.</p> : null}
      <p className="vt-answer">{answer.data.answer}</p>
      {sources.length ? <ul className="vt-sources" aria-label="Sources">{sources.map(id => <li key={id}>{id}</li>)}</ul> : null}
      <p className="vt-footer">You decide · {sources.length} {sources.length === 1 ? "source" : "sources"}</p>
      <div className="visit-actions">{think}</div>
    </Card>
  );
}
