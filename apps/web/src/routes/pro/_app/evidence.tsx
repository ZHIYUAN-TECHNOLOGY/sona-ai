import { can } from "@sona-ai/api/roles";
import { FOLLOW_UPS } from "@sona-ai/domain/evidence";
import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, Skeleton } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { type StreamEvent, type Turn, apply, newTurn, sampleLabel, threadOf } from "@/features/evidence/thread";
import { client } from "@/lib/orpc";
import { useSonaAsk } from "@/lib/sona";
import "@/styles/pages/evidence.css";

export const Route = createFileRoute("/pro/_app/evidence")({ component: Page });

// The phone app's rehearsed question and its first two follow-ups.
const EXAMPLES = ["Steroids for this patient with community-acquired pneumonia?", ...FOLLOW_UPS.slice(0, 2).map(f => f.question)];
type Picked = { turn: string; n: number };

function Page() {
  const { me } = Route.useRouteContext();
  const mayAsk = can(me.role, "evidence.stream");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const latest = useRef(turns);
  const busy = useRef(false);
  useEffect(() => { latest.current = turns; }, [turns]);

  // One model call per question, only when the clinician asks. Returns false when it was not asked or failed.
  const ask = useCallback(async (asked: string) => {
    const question = asked.trim().slice(0, 500);
    if (!question || busy.current) return false;
    busy.current = true;
    const id = crypto.randomUUID();
    const thread = threadOf(latest.current);
    const change = (next: (turn: Turn) => Turn) => setTurns(all => all.map(t => (t.id === id ? next(t) : t)));
    // A retry replaces the failed turn instead of leaving it above the new one.
    setTurns(all => [...all.filter(t => !t.failed), newTurn(id, question)]);
    setPicked(null);
    try {
      for await (const event of await client.evidence.stream({ question, thread })) change(t => apply(t, event as StreamEvent));
      return true;
    } catch {
      change(t => ({ ...t, failed: "Sona could not answer just now. Nothing was saved from this question." }));
      return false;
    } finally {
      busy.current = false;
    }
  }, []);

  // The bottom Sona bar asks the same thread.
  useSonaAsk(useCallback(async (question: string) => {
    if (!mayAsk) return "Your role cannot ask for evidence. A doctor or nurse can.";
    return (await ask(question)) ? "Answered in the thread on this page." : "Not asked: Sona is still on the last question, or it failed. See the thread.";
  }, [ask, mayAsk]));

  useEffect(() => {
    if (picked) document.getElementById(`ev-source-${picked.turn}-${picked.n}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [picked]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
    setDraft("");
  };
  const reading = turns.some(t => !t.answer && !t.failed);
  // The rail shows the sources of the turn being reviewed: the one last chosen, else the newest with sources.
  const shown = turns.find(t => t.id === picked?.turn) ?? turns.findLast(t => t.references.length > 0);

  if (!mayAsk)
    return (
      <>
        <PageHeader title="Evidence" />
        <EmptyState icon="shield-check" title="Your role cannot ask for evidence">Doctors and nurses can ask Sona what the studies and the hospital library say.</EmptyState>
      </>
    );

  return (
    <>
      <PageHeader title="Evidence" lead="Ask a clinical question. Sona answers from studies and the hospital library, each claim with its source." />
      <form className="ev-ask" onSubmit={submit}>
        <input aria-label="Ask a clinical question" placeholder="Ask a clinical question" maxLength={500} value={draft} onChange={e => setDraft(e.target.value)} />
        <Button type="submit" variant="primary" icon="search" pending={reading} disabled={!draft.trim()}>Ask</Button>
      </form>
      {turns.length === 0 ? (
        <EmptyState icon="book" title="No questions yet">
          Try one of these, or ask your own.
          <span className="ev-chips">{EXAMPLES.map(q => <Button key={q} size="sm" variant="secondary" onClick={() => void ask(q)}>{q}</Button>)}</span>
        </EmptyState>
      ) : (
        <WithRail rail={<RightRail label="Sources">{shown && <Sources turn={shown} picked={picked} onPick={setPicked} />}</RightRail>}>
          <div className="ev-thread" aria-live="polite">
            {turns.map((turn, i) => <TurnCard key={turn.id} turn={turn} picked={picked} onPick={setPicked} onAsk={ask} last={i === turns.length - 1 && !reading} />)}
          </div>
        </WithRail>
      )}
    </>
  );
}

type Pick = { picked: Picked | null; onPick: (picked: Picked) => void };

function TurnCard({ turn, picked, onPick, onAsk, last }: Pick & { turn: Turn; onAsk: (question: string) => void; last: boolean }) {
  const { answer } = turn;
  const mine = picked?.turn === turn.id ? picked.n : undefined;
  const label = answer && sampleLabel(answer);
  return (
    <Card>
      <h2 className="ev-question">{turn.question}</h2>
      {label && <Chip tone="soon">{label}</Chip>}
      {turn.bottomLine && <p className="ev-bottom">{turn.bottomLine}</p>}
      <ol className="ev-claims">
        {turn.claims.map((claim, i) => (
          <li key={i} className="ev-claim" data-cited={mine !== undefined && claim.cites.includes(mine)}>
            {claim.text}
            {claim.cites.map(n => (
              <button key={n} type="button" className="ev-mark" aria-pressed={mine === n} aria-label={`Source ${n}`} onClick={() => onPick({ turn: turn.id, n })}>{n}</button>
            ))}
          </li>
        ))}
      </ol>
      {turn.failed ? (
        <EmptyState icon="alert" title="No answer" action={<Button icon="refresh" onClick={() => onAsk(turn.question)}>Try again</Button>}>{turn.failed}</EmptyState>
      ) : !answer ? (
        <div className="ev-reading" role="status">
          {turn.step}
          <Skeleton height={14} width="80%" />
          <Skeleton height={14} width="55%" />
        </div>
      ) : (
        <>
          {answer.claims.length === 0 && <p className="ev-note">The sources did not answer this question.</p>}
          {answer.claims.length === 0 && answer.general && <p className="ev-note">General knowledge, not from the sources: {answer.general}</p>}
          {"cutShort" in answer && answer.cutShort && <p className="ev-note">The answer was cut short. Ask again for the rest.</p>}
          {answer.pubmed === "unavailable" && <p className="ev-note">PubMed could not be reached, so no studies were read.</p>}
          {last && answer.followUps.length > 0 && (
            <div className="ev-chips">{answer.followUps.map(q => <Button key={q} size="sm" variant="secondary" onClick={() => onAsk(q)}>{q}</Button>)}</div>
          )}
        </>
      )}
    </Card>
  );
}

function Sources({ turn, picked, onPick }: Pick & { turn: Turn }) {
  const n = turn.references.length;
  return (
    <Card title="Sources">
      {n === 0 ? (
        <p className="ev-note">{turn.answer ? "No sources were found for this question." : "Sources appear here once Sona has found them."}</p>
      ) : (
        <ol className="ev-sources">
          {turn.references.map(ref => (
            <li key={ref.n} id={`ev-source-${turn.id}-${ref.n}`} className="ev-source" data-picked={picked?.turn === turn.id && picked.n === ref.n}>
              <button type="button" aria-pressed={picked?.turn === turn.id && picked.n === ref.n} onClick={() => onPick({ turn: turn.id, n: ref.n })}>
                <span className="ev-source-meta">{ref.n} · {ref.design} · {ref.year}</span>
                <span className="ev-source-title">{ref.title}</span>
                <span className="ev-source-text">{ref.text}</span>
              </button>
              {ref.url && <a href={ref.url} target="_blank" rel="noreferrer">Open on PubMed</a>}
            </li>
          ))}
        </ol>
      )}
      <p className="ev-decide">You decide · {n} {n === 1 ? "source" : "sources"}</p>
    </Card>
  );
}
