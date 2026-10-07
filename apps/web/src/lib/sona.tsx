import { useRouterState } from "@tanstack/react-router";
import { createContext, type ReactNode, type RefObject, use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { client } from "./orpc";

type App = "pro" | "care";
/** A page's own answer to a question from the Sona bar: any JSX, shown in the page's thread. Throw to show an error. */
export type SonaHandler = (question: string) => Promise<ReactNode>;
type Turn = { id: number; question: string; state: "pending" | "done" | "error"; answer?: ReactNode };

const AskContext = createContext<{ ask: (question: string) => void; handler: RefObject<SonaHandler | null> } | null>(null);
const ThreadContext = createContext<Turn[]>([]);

/**
 * What went wrong, in plain words. A server refusal written for people (it carries a `data.code`) and our own
 * errors are shown as they are; other server errors and network failures get one plain line.
 */
export function plain(e: unknown): string {
  const coded = e instanceof Error && (e as Error & { data?: { code?: string } }).data?.code;
  const ours = e instanceof Error && !(e instanceof TypeError) && !("code" in e);
  return coded || ours ? (e as Error).message : "That didn't go through. Check your connection and try again.";
}

const lines = (items: string[]) => (items.length ? <ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul> : null);

async function askCare(question: string): Promise<ReactNode> {
  const res = (await client.care.ask({ question })) as { answer?: string; careTeam?: { line?: string }; sources?: { title: string }[] };
  if (!res.answer) throw new Error("Sona can't answer right now. Please try again in a minute.");
  return (
    <>
      <p>{res.answer}</p>
      {res.careTeam?.line ? <p>{res.careTeam.line}</p> : null}
      {res.sources?.length ? <p className="sona-turn-note">From: {res.sources.map(source => source.title).join(", ")}</p> : null}
    </>
  );
}

// ponytail: the ask spec's plain text only (lead, rows, review). Its actions are op strings the page owns, so rows show
// as plain rows; a page that wants them registers its own handler with useSonaAsk. The server reads the hospital's
// Today, Ward and Tasks itself (scope "web") and always answers, by rule when the model is off.
async function askPro(question: string): Promise<ReactNode> {
  const res = (await client.ask.free({ scope: "web", question })) as {
    waking?: number;
    spec?: { root: string; elements: Record<string, { type: string; props: Record<string, unknown>; children?: string[] }> };
  };
  const parts = (res.spec?.elements[res.spec.root]?.children ?? []).map(id => res.spec!.elements[id]);
  const body = parts.map((part, i) => {
    if (part?.type === "AskLead") return <p key={i}>{String(part.props.text)}</p>;
    if (part?.type === "AskRows") return <div key={i}>{lines((part.props.rows as { title: string; detail: string }[]).map(row => (row.detail ? `${row.title}: ${row.detail}` : row.title)))}</div>;
    if (part?.type === "AskReview") return <div key={i}><p>{String(part.props.title)}</p>{lines(part.props.items as string[])}</div>;
    return null;
  });
  if (!body.some(Boolean)) throw new Error(res.waking ? `Sona is starting (about ${res.waking} min). Try again then.` : "Sona can't answer that here yet.");
  return body;
}

export function SonaProvider({ app, children }: { app: App; children: ReactNode }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const handler = useRef<SonaHandler | null>(null);
  const page = useRef(0);

  // An answer belongs to the page it was asked on: a new page starts with an empty thread.
  const path = useRouterState({ select: state => state.location.pathname });
  const [shown, setShown] = useState(path);
  if (shown !== path) { setShown(path); setTurns([]); }
  useEffect(() => { page.current++; }, [path]);

  const ask = useCallback((question: string) => {
    const id = Date.now(), from = page.current;
    const settle = (turn: Partial<Turn>) => { if (from === page.current) setTurns(all => all.map(t => (t.id === id ? { ...t, ...turn } : t))); };
    setTurns(all => [...all, { id, question, state: "pending" }]);
    (handler.current ?? (app === "care" ? askCare : askPro))(question).then(
      answer => settle({ state: "done", answer }),
      e => settle({ state: "error", answer: plain(e) }),
    );
  }, [app]);

  const value = useMemo(() => ({ ask, handler }), [ask]);
  return <AskContext value={value}><ThreadContext value={turns}>{children}</ThreadContext></AskContext>;
}

/**
 * In the Sona bar: `const ask = useSonaAsk()`. In a page: `useSonaAsk(handler)` makes the page answer what is
 * sent from the bar while it is mounted; without one the app's default answers (care.ask, ask.free).
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

/** Whether a question is still waiting on its answer, for the bar to say so where the click was. */
export const useSonaThinking = () => use(ThreadContext).some(turn => turn.state === "pending");

/**
 * The thread, in the page: each question with its answer, "thinking" or what went wrong. Nothing when empty. The bar is
 * pinned under a page that scrolls, so the newest turn is brought into view when asked and again when answered.
 */
export function SonaAnswers() {
  const turns = use(ThreadContext);
  const newest = useRef<HTMLElement>(null);
  const last = turns.at(-1);
  useEffect(() => { newest.current?.scrollIntoView({ block: "nearest" }); }, [last?.id, last?.state]);
  return (
    <section className="sona-thread" aria-label="Sona's answers" aria-live="polite">
      {turns.map(turn => (
        <article key={turn.id} ref={turn === last ? newest : undefined} className="sona-turn" data-state={turn.state}>
          <h2 className="sona-turn-q">{turn.question}</h2>
          <div className="sona-turn-a" role={turn.state === "error" ? "alert" : undefined}>
            {turn.state === "pending" ? <p className="sona-turn-note">Sona is thinking…</p> : turn.answer}
          </div>
        </article>
      ))}
    </section>
  );
}
