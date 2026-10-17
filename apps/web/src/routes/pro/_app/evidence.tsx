import { can } from "@sona-ai/api/roles";
import { partsOf } from "@sona-ai/domain/answer-parts";
import type { Reference } from "@sona-ai/domain/evidence";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { Artifact, Composer, Conversation, InlineCitation, Notice, Response, SonaMark, Sources, Steps, Suggestions, Turn as AnswerTurn } from "@/components/ai";
import { plural } from "@/components/ai/summary";
import { Icon } from "@/components/icon";
import { Marked } from "@/components/marked";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Chip } from "@/components/primitives";
import { askVisit } from "@/features/evidence/ask";
import { FilmCard } from "@/features/evidence/film-card";
import { type Turn, answerBy, apply, leadFilm, newTurn, phaseOf, sampleLabel, threadOf } from "@/features/evidence/thread";
import "@/styles/pages/evidence.css";

export const Route = createFileRoute("/pro/_app/evidence")({ component: Page });

// This page has no patient open, so its examples name the condition, never "this patient".
const EXAMPLES = ["CURB-65 of 2: admit or treat at home?", "Antibiotic for pyelonephritis in pregnancy?", "When to repeat a chest X-ray after pneumonia?"];
type Picked = { turn: string; n: number };
const wide = () => matchMedia("(min-width: 860px)").matches;

function Page() {
  const { me } = Route.useRouteContext();
  const mayAsk = can(me.role, "evidence.stream");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [reading, setReading] = useState(false);
  const latest = useRef(turns);
  const busy = useRef(false);
  useEffect(() => { latest.current = turns; }, [turns]);
  const pick = useCallback((next: Picked) => { setPicked(next); setReading(true); }, []);

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
    setReading(false);
    try {
      await askVisit(undefined, question, event => {
        change(t => apply(t, event));
        // An answer that rests on a patient's X-ray: on a wide screen the film opens beside it once written, before the clinician asks.
        if (event.type === "answer" && wide()) { const n = leadFilm(event.answer.references, [...event.answer.claims, ...event.answer.patientPoints ?? []]); if (n) pick({ turn: id, n }); }
      }, thread);
      return true;
    } catch {
      change(t => ({ ...t, failed: "Sona could not answer just now. Nothing was saved from this question." }));
      return false;
    } finally {
      busy.current = false;
    }
  }, [pick]);

  if (!mayAsk)
    return (
      <>
        <PageHeader title="Evidence" />
        <EmptyState icon="shield-check" title="Your role cannot ask for evidence">Doctors and nurses can ask Sona what the studies and the hospital library say.</EmptyState>
      </>
    );

  const busyNow = turns.some(t => !t.answer && !t.failed);
  const source = turns.find(t => t.id === picked?.turn);
  const ref = source?.references.find(r => r.n === picked?.n);
  return (
    <div className="ev-page" data-reading={reading && ref ? "" : undefined}>
      <PageHeader title="Evidence" />
      {turns.length === 0 ? (
        <div className="ev-start">
          <SonaMark />
          <h2>Ask a clinical question</h2>
          <p>Sona answers from PubMed and the hospital library, every claim with its source. You decide.</p>
          <Suggestions items={EXAMPLES} onPick={q => void ask(q)} label="Example questions" />
        </div>
      ) : (
        <Conversation label="Evidence answers" className="ev-conversation" busy={busyNow}>
          {turns.map((turn, i) => (
            <TurnView key={turn.id} turn={turn} last={i === turns.length - 1 && !busyNow} picked={reading && picked?.turn === turn.id ? picked.n : undefined}
              onPick={n => pick({ turn: turn.id, n })} onAsk={q => void ask(q)} />
          ))}
        </Conversation>
      )}
      <div className="ai-composer-dock"><Composer app="pro" onSend={q => void ask(q)} busy={busyNow} placeholder="Ask a clinical question" /></div>
      <Artifact open={reading && !!ref} onClose={() => setReading(false)} title={ref?.title ?? "Source"}
        subtitle={ref && [`Source ${ref.n}`, ref.from, ref.year].filter(Boolean).join(" · ")}
        actions={ref?.url && <a className="ev-pubmed" href={ref.url} target="_blank" rel="noreferrer">Open on PubMed<Icon name="external" size={12} /></a>}>
        {ref && source && <Reading turn={source} reference={ref} />}
      </Artifact>
    </div>
  );
}

function TurnView({ turn, last, picked, onPick, onAsk }: { turn: Turn; last: boolean; picked?: number; onPick: (n: number) => void; onAsk: (question: string) => void }) {
  const { answer, references } = turn;
  const label = answer && sampleLabel(answer);
  const points = answer?.patientPoints ?? [];
  const byN = new Map(references.map(r => [r.n, r]));
  const film = (r: Reference) => r.encounterId ? <FilmCard reference={r} encounterId={r.encounterId} picked={picked === r.n} onPick={() => onPick(r.n)} /> : null;
  const asked = answer?.claims.length ? answer.followUps : [];
  // The words the model coloured, once the answer carries them; until then the word lists colour.
  const { marks } = partsOf(answer);
  return (
    <AnswerTurn question={turn.question} by={answer && !label ? answerBy(answer) : undefined}>
      {turn.failed ? (
        <Notice kind="error" action={<Button size="sm" icon="refresh" onClick={() => onAsk(turn.question)}>Try again</Button>}>{turn.failed}</Notice>
      ) : (
        <>
          <Steps phase={phaseOf(turn)} sources={references.length || undefined} />
          {label && <span className="ev-label"><Chip tone="soon">{label}</Chip></span>}
          {(answer || turn.bottomLine || turn.claims.length > 0) && (
            <Response bottomLine={turn.bottomLine} claims={turn.claims} references={references} onCite={onPick} marks={marks}>
              {points.length > 0 && (
                <section className="ev-points" aria-label="For this patient">
                  <h4>For this patient</h4>
                  <ul>
                    {points.map((p, i) => (
                      <li key={i}><Marked text={p.text} marks={marks} /><span className="ai-cites">{p.cites.map(n => <InlineCitation key={n} n={n} reference={byN.get(n)} onSelect={onPick} />)}</span>
                        <span className="ev-fact">From the record: “{p.fact}”</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {answer && answer.claims.length === 0 && (
                <Notice kind="empty" action={last ? <Suggestions items={answer.followUps.length ? answer.followUps : EXAMPLES} onPick={onAsk} /> : undefined}>
                  {answer.general ? <>The sources did not answer this. General knowledge, not from the sources: <Marked text={answer.general} marks={marks} /></> : "The sources did not answer this question."}
                </Notice>
              )}
              {answer && "cutShort" in answer && answer.cutShort && <p className="ev-note">The answer was cut short. Ask again for the rest.</p>}
              {answer?.pubmed === "unavailable" && <p className="ev-note">PubMed could not be reached, so no studies were read.</p>}
              {answer && <Sources references={references} image={film} onSelect={onPick} label={`Used ${plural(references.length, "source")} · You decide`} />}
              {last && <Suggestions items={asked} onPick={onAsk} />}
            </Response>
          )}
        </>
      )}
    </AnswerTurn>
  );
}

/** The picked source, to read before deciding: its design (how strong it is), the text, and the claims it was cited for. */
function Reading({ turn, reference: r }: { turn: Turn; reference: Reference }) {
  if (r.kind === "image" && r.encounterId) return <FilmCard reference={r} encounterId={r.encounterId} picked />;
  const cited = turn.claims.filter(c => c.cites.includes(r.n));
  return (
    <div className="ev-reading">
      <Chip>{r.design}</Chip>
      <section>
        <h3>{r.kind === "study" ? "From the study" : r.kind === "record" ? "From the patient's record" : `From the library${r.section ? ` · ${r.section}` : ""}`}</h3>
        <p>{r.text}</p>
      </section>
      {cited.length > 0 && (
        <section>
          <h3>Cited for</h3>
          <ul>
            {cited.map((c, i) => {
              const quote = c.quotes?.find(q => q.n === r.n);
              return <li key={i}>{c.text}{quote && <blockquote>“{quote.text}”</blockquote>}</li>;
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
