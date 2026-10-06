import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Button, Chip } from "@/components/primitives";
import { orpc } from "@/lib/orpc";

/** "What this result means": a model call, so it runs only when the patient presses the button.
    The answer stays in the query cache for the session, one per result. */
export function Explain({ resultId, lang }: { resultId: string; lang: "en" | "ms" | "zh" }) {
  const q = useQuery({
    ...orpc.care.results.explain.queryOptions({ input: { resultId, lang } }),
    enabled: false, staleTime: Infinity, gcTime: Infinity, retry: false,
  });
  const ask = () => { void q.refetch(); };
  const said = q.data;

  return (
    <div className="res-explain" aria-live="polite">
      {said ? (
        <>
          {said.source === "fixture" ? <Chip tone="soon">Sample answer</Chip> : null}
          <p className="res-answer">{said.text}</p>
          {said.waking === undefined ? null : (
            <p className="res-note">
              Sona is starting. It takes about {said.waking} min. This is a sample answer for now.{" "}
              <Button pending={q.isFetching} onClick={ask}>Try again</Button>
            </p>
          )}
        </>
      ) : (
        <>
          <Button variant="primary" pending={q.isFetching} onClick={ask}>What this result means</Button>
          {q.isFetching ? <p className="res-muted">Sona is reading your result…</p> : null}
          {q.isError && !q.isFetching ? <p className="res-note">Sona can't explain this result right now. Please try again in a minute.</p> : null}
        </>
      )}
      <p className="res-ask"><Link to="/care/ask">Ask about this result</Link></p>
    </div>
  );
}
