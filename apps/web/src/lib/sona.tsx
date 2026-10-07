import type { Reference } from "@sona-ai/domain/evidence";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { createContext, isValidElement, type ReactNode, type RefObject, use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Conversation, Notice, Response, RuleAnswer, Sources, Steps, Suggestions, Turn as Asked } from "@/components/ai";
import { Button } from "@/components/primitives";
import { FilmCard } from "@/features/evidence/film-card";
import { answerFilm, sampleLabel } from "@/features/evidence/thread";

import { client } from "./orpc";
import { type FreeAnswer, phaseOf, rowPatient, rulesAnswer, type SonaAnswer } from "./sona-answer";
import { PANEL_KEY, type PanelState, parsePanel } from "./sona-panel";

export type { SonaAnswer } from "./sona-answer";

type App = "pro" | "care";
/**
 * A page's own answer to a question from the Sona panel: a typed answer (`SonaAnswer`), plain text, or the page's own JSX.
 * `update` shows the answer so far while it is still coming (a streamed answer's steps). Throw to show an error.
 */
export type SonaHandler = (question: string, update: (answer: SonaAnswer) => void) => Promise<SonaAnswer | ReactNode>;
type Turn = { id: number; question: string; state: "pending" | "done" | "error"; answer?: SonaAnswer; error?: string };

type Ask = { ask: (question: string) => void; handler: RefObject<SonaHandler | null>; setPanel: (panel: PanelState) => void; setContext: (label?: string) => void };
type Thread = { turns: Turn[]; panel: PanelState; /** An answer arrived while the panel was closed. */ unseen: boolean; /** What the page said it is about (`useSonaContext`). */ context?: string };
const AskContext = createContext<Ask | null>(null);
const ThreadContext = createContext<Thread>({ turns: [], panel: "open", unseen: false });

const storedPanel = (): PanelState => { try { return parsePanel(localStorage.getItem(PANEL_KEY)); } catch { return "open"; } };

/**
 * What went wrong, in plain words. A server refusal written for people (it carries a `data.code`) and our own
 * errors are shown as they are; other server errors and network failures get one plain line.
 */
export function plain(e: unknown): string {
  const coded = e instanceof Error && (e as Error & { data?: { code?: string } }).data?.code;
  const ours = e instanceof Error && !(e instanceof TypeError) && !("code" in e);
  return coded || ours ? (e as Error).message : "That didn't go through. Check your connection and try again.";
}

const isAnswer = (value: unknown): value is SonaAnswer => typeof value === "object" && value !== null && !isValidElement(value) && "kind" in value;
const asAnswer = (value: SonaAnswer | ReactNode): SonaAnswer => (isAnswer(value) ? value : typeof value === "string" ? { kind: "text", text: value } : { kind: "node", node: value });

async function askCare(question: string): Promise<SonaAnswer> {
  const res = (await client.care.ask({ question })) as { answer?: string; careTeam?: { line?: string }; sources?: { title: string }[] };
  if (!res.answer) throw new Error("Sona can't answer right now. Please try again in a minute.");
  const text = [res.answer, res.careTeam?.line].filter(Boolean).join("\n\n");
  return { kind: "text", text, ...(res.sources?.length ? { note: `From: ${res.sources.map(source => source.title).join(", ")}` } : {}) };
}

/** The Sona panel's default in Sona Pro: the server reads the hospital's Today, Ward and Tasks itself (scope "web") and answers, by rule when the model is off. */
export async function askPro(question: string): Promise<SonaAnswer> {
  const res = (await client.ask.free({ scope: "web", question })) as FreeAnswer;
  const answer = rulesAnswer(res);
  if (!answer) throw new Error(res.waking ? `Sona is starting (about ${res.waking} min). Try again then.` : "Sona can't answer that here yet.");
  return answer;
}

export function SonaProvider({ app, children }: { app: App; children: ReactNode }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  // The panel's state (open, closed to the orb, full screen) is the reader's: kept per browser and across pages.
  const [panel, setPanelState] = useState(storedPanel);
  const [unseen, setUnseen] = useState(false);
  const [context, setContext] = useState<string>();
  const closed = useRef(panel === "closed");
  const handler = useRef<SonaHandler | null>(null);
  const page = useRef(0);
  const asked = useRef(0);

  // An answer belongs to the page it was asked on: a new page starts with an empty thread.
  const path = useRouterState({ select: state => state.location.pathname });
  const [shown, setShown] = useState(path);
  if (shown !== path) { setShown(path); setTurns([]); }
  useEffect(() => { page.current++; }, [path]);

  const setPanel = useCallback((next: PanelState) => {
    closed.current = next === "closed";
    setPanelState(next);
    if (next !== "closed") setUnseen(false);
    try { localStorage.setItem(PANEL_KEY, next); } catch { /* storage blocked: the choice lasts this visit */ }
  }, []);

  const ask = useCallback((question: string) => {
    const id = ++asked.current, from = page.current;
    const settle = (turn: Partial<Turn>) => { if (from === page.current) setTurns(all => all.map(t => (t.id === id ? { ...t, ...turn } : t))); };
    // A settled answer the reader cannot see (the panel is closed) puts a badge on the orb.
    const end = (turn: Partial<Turn>) => { settle(turn); if (from === page.current && closed.current) setUnseen(true); };
    // Asking again replaces a question that failed.
    setTurns(all => [...all.filter(t => t.state !== "error"), { id, question, state: "pending" }]);
    (handler.current ?? (app === "care" ? askCare : askPro))(question, answer => settle({ answer })).then(
      answer => end({ state: "done", answer: asAnswer(answer) }),
      e => end({ state: "error", error: plain(e) }),
    );
  }, [app]);

  const value = useMemo(() => ({ ask, handler, setPanel, setContext }), [ask, setPanel]);
  const thread = useMemo(() => ({ turns, panel, unseen, context }), [turns, panel, unseen, context]);
  return <AskContext value={value}><ThreadContext value={thread}>{children}</ThreadContext></AskContext>;
}

/**
 * In the Sona panel: `const ask = useSonaAsk()`. In a page: `useSonaAsk(handler)` makes the page answer what is
 * sent from the panel while it is mounted; without one the app's default answers (care.ask, ask.free).
 */
export function useSonaAsk(handler?: SonaHandler): (question: string) => void {
  const sona = use(AskContext);
  if (!sona) throw new Error("useSonaAsk needs a SonaProvider above it");
  const slot = sona.handler;
  useEffect(() => {
    if (!handler) return;
    slot.current = handler;
    return () => { if (slot.current === handler) slot.current = null; };
  }, [handler, slot]);
  return sona.ask;
}

/** For the Sona panel and the frame: the turns, the panel's state and how to change it, what the page is about, and `ask`. */
export function useSona() {
  return { ...use(ThreadContext), ...use(AskContext)! };
}

/** On a page about one thing: names it in the Sona panel's header ("X-ray · Amelia Tan") while the page is mounted. */
export function useSonaContext(label: string | undefined) {
  const { setContext } = use(AskContext)!;
  useEffect(() => {
    setContext(label);
    return () => setContext(undefined);
  }, [label, setContext]);
}

const paragraphs = (text: string) => text.split(/\n{2,}/).map((line, i) => <p key={i}>{line}</p>);

/** Who wrote an answer, for the caption under Sona's mark: "rules", the model, or what stood in for it. */
function byOf(answer?: SonaAnswer) {
  if (answer?.kind === "rules") return answer.by;
  if (answer?.kind === "evidence" && answer.turn.answer) return sampleLabel(answer.turn.answer) ?? answer.turn.answer.source;
  return undefined;
}

/** A visit's answer as it arrives: the steps, the film when it leads, the claims with citations, then sources and what to ask next. */
function EvidenceAnswer({ answer: { turn, encounterId }, ask }: { answer: Extract<SonaAnswer, { kind: "evidence" }>; ask: (q: string) => void }) {
  const done = turn.answer;
  const film = answerFilm(turn.references, encounterId);
  // On a patient's page, only that visit's films.
  const filmOf = (r: Reference) => (r.encounterId && (!encounterId || r.encounterId === encounterId) ? <FilmCard reference={r} encounterId={r.encounterId} /> : null);
  const next = <Suggestions items={done?.followUps ?? []} onPick={ask} />;
  const written = Boolean(turn.bottomLine || turn.claims.length);
  return (
    <>
      <Steps phase={phaseOf(turn)} sources={turn.references.length || undefined} />
      {film ? <FilmCard reference={film} encounterId={film.encounterId!} /> : null}
      {written ? (
        <Response bottomLine={turn.bottomLine} claims={turn.claims} references={turn.references}>
          {done ? <><Sources references={turn.references} image={filmOf} />{next}</> : null}
        </Response>
      ) : done?.general ? (
        <div className="sona-general"><p className="sona-note">General knowledge, not from the sources</p>{paragraphs(done.general)}{next}</div>
      ) : done ? <Notice kind="empty" action={next} /> : null}
    </>
  );
}

function Answer({ turn, ask }: { turn: Turn; ask: (q: string) => void }) {
  const navigate = useNavigate();
  const answer = turn.answer;
  if (turn.state === "error") return <Notice kind="error" action={<Button size="sm" icon="refresh" onClick={() => ask(turn.question)}>Try again</Button>}>{turn.error}</Notice>;
  if (!answer) return <Notice kind="thinking" />;
  if (answer.kind === "evidence") return <EvidenceAnswer answer={answer} ask={ask} />;
  if (answer.kind === "node") return answer.node;
  if (answer.kind === "text") return <div className="sona-text">{paragraphs(answer.text)}{answer.note ? <p className="sona-note">{answer.note}</p> : null}</div>;
  const open = (row: { op?: string }) => {
    const patientId = rowPatient(row);
    if (patientId) void navigate({ to: "/pro/patients/$patientId", params: { patientId } });
  };
  return <RuleAnswer lead={answer.lead} rows={answer.rows} heading={answer.heading} onOpen={open} />;
}

/** The page's turns as a thread that follows the newest: the Sona panel's body. Nothing until the first question. */
export function SonaTurns({ className }: { className?: string }) {
  const { turns } = use(ThreadContext);
  const { ask } = use(AskContext)!;
  if (!turns.length) return null;
  return (
    <Conversation className={className}>
      {turns.map(turn => (
        <Asked key={turn.id} question={turn.question} by={turn.state === "done" ? byOf(turn.answer) : undefined}>
          <Answer turn={turn} ask={ask} />
        </Asked>
      ))}
    </Conversation>
  );
}

/**
 * Sona Care's thread, in the page: each question with its answer, "thinking" or what went wrong. Nothing when empty.
 * The Ask page lays itself out around it (styles/pages/care-ask.css). The newest turn is brought into view.
 */
export function SonaThread() {
  const { turns } = use(ThreadContext);
  const newest = useRef<HTMLElement>(null);
  const last = turns.at(-1);
  useEffect(() => { newest.current?.scrollIntoView({ block: "nearest" }); }, [last?.id, last?.state]);
  return (
    <section className="sona-thread" aria-label="Sona's answers" aria-live="polite">
      {turns.map(turn => {
        const answer = turn.answer;
        return (
          <article key={turn.id} ref={turn === last ? newest : undefined} className="sona-turn" data-state={turn.state}>
            <h2 className="sona-turn-q">{turn.question}</h2>
            <div className="sona-turn-a" role={turn.state === "error" ? "alert" : undefined}>
              {turn.state === "error" ? <p>{turn.error}</p>
                : turn.state === "pending" || !answer ? <p className="sona-turn-note">Sona is thinking…</p>
                : answer.kind === "node" ? answer.node
                : answer.kind === "text" ? <>{paragraphs(answer.text)}{answer.note ? <p className="sona-turn-note">{answer.note}</p> : null}</>
                : <p>{answer.kind === "rules" ? answer.lead : answer.turn.bottomLine}</p>}
            </div>
          </article>
        );
      })}
    </section>
  );
}
