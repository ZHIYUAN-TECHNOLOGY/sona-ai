import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from "react";

import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, ListCard, ListRow } from "@/components/primitives";
import { RightRail } from "@/components/rail";
import { CareMarked } from "@/components/marked";
import type { Chosen } from "../../../../../care/features/assistant/terms";
import { Call } from "@/features/care-ask/call";
import { browserLang } from "@/features/care-follow-ups/dates";
import { langOf } from "@/features/care-medicines/model";
import { Listen } from "@/features/care-ask/listen";
import { authClient } from "@/lib/auth-client";
import { client, orpc } from "@/lib/orpc";
import { useSonaAsk } from "@/lib/sona";
import type { Said, SonaAnswer } from "@/lib/sona-answer";
import "@/styles/pages/care-ask.css";

export const Route = createFileRoute("/care/_app/ask")({ component: Page });

// The same inputs the Follow-ups and Medicines pages use, so these reads share their cache.
const visitLang = browserLang();
const planLang = langOf(typeof navigator === "undefined" ? undefined : navigator.language);

const SUGGESTED = ["When is my next visit?", "What medicines do I take today?", "What should I eat this week?", "Is it normal to feel tired?"];

type Answer = { answer?: string; marks?: Chosen[]; source?: string; waking?: number; grounded?: boolean; careTeam?: { line?: string }; sources?: { title: string }[] };

// Behind VITE_CARE_CHAT_AGENT=1 only: her chat agent, which remembers the conversation (features/care-ask/chat-agent).
// Off, the build leaves it out entirely and the page asks care.ask as before.
const ChatAgentLink = import.meta.env.VITE_CARE_CHAT_AGENT === "1" ? lazy(() => import("@/features/care-ask/chat-agent")) : null;
type AgentAsk = (question: string) => Promise<Answer>;

/** Brings a settled answer above the floating Sona bar (the row has a scroll margin for the bar). */
const reveal = (el: HTMLElement | null) => { el?.scrollIntoView({ block: "nearest", behavior: "smooth" }); };

/** Asks the same question again, after Sona could not answer. */
function Failed({ question, line }: { question: string; line: string }) {
  const ask = useSonaAsk();
  return (
    <div className="ask-failed" role="alert" ref={reveal}>
      <p>{line}</p>
      <Button icon="refresh" className="ask-pill" onClick={() => ask(question)}>Try again</Button>
    </div>
  );
}

const focusBar = () => document.querySelector<HTMLInputElement>(".sona-bar-input")?.focus();

/** What the patient can do next with an answer: hear it, go deeper, or ask something else. */
function Next({ question, spoken }: { question: string; spoken: string }) {
  const ask = useSonaAsk();
  return (
    <div className="ask-next" ref={reveal}>
      <Listen text={spoken} />
      <Button className="ask-pill" onClick={() => ask(`Tell me more about this: ${question}`)}>Tell me more</Button>
      <Button className="ask-pill" icon="message" onClick={focusBar}>Ask a follow-up</Button>
    </div>
  );
}

/**
 * This page's answer to the Sona bar and the chips: `care.ask`, with the thread so far (`history`) so a follow-up is
 * read with it, or her chat agent behind its flag (it keeps the conversation itself). The answer carries its words
 * (`text`) for the next question's history. A failure is a plain line with "Try again".
 */
const answerWith = (get: (question: string, history: Said[]) => Promise<Answer>) => async (question: string, _update: unknown, history: Said[]): Promise<SonaAnswer | ReactNode> => {
  let res: Answer;
  try { res = await get(question, history); }
  catch { return <Failed question={question} line="Sona can't answer right now. Try again." />; }
  if (!res.answer) return <Failed question={question} line={res.waking ? `Sona is starting (about ${res.waking} min). Try again then.` : "Sona can't answer right now. Try again."} />;
  const spoken = res.careTeam?.line ? `${res.answer} ${res.careTeam.line}` : res.answer;
  return {
    kind: "node",
    text: spoken,
    node: (
      <>
        {res.source === "fixture" ? <Chip tone="neutral">Sample answer</Chip> : null}
        {/* Keeps the answer's own line breaks: a numbered list stays a list. */}
        <p className="ask-answer"><CareMarked text={res.answer} chosen={res.marks} /></p>
        {res.careTeam?.line ? <p><CareMarked text={res.careTeam.line} /></p> : null}
        {res.grounded ? <p className="sona-turn-note">From your record.</p> : null}
        {res.sources?.length ? <p className="sona-turn-note">From: {res.sources.map(s => s.title).join(", ")}</p> : null}
        <Next question={question} spoken={spoken} />
      </>
    ),
  };
};
const answer = answerWith((question, history) => client.care.ask({ question, history }) as Promise<Answer>);
// The agent's own line (no model, or it is starting) reads as care.ask's fixture: "Try again".
const fromAgent = (ask: AgentAsk) => answerWith(question => ask(question).then(a => a.source === "model" ? a : { ...a, answer: "" }));

function Body({ call }: { call?: Parameters<Parameters<typeof Call>[0]["children"]>[0] }) {
  const user = authClient.useSession().data?.user.id;
  const [agentAsk, setAgentAsk] = useState<AgentAsk>();
  const onAsk = useCallback((a?: AgentAsk) => setAgentAsk(() => a), []);
  const ask = useSonaAsk(useMemo(() => agentAsk ? fromAgent(agentAsk) : answer, [agentAsk]));
  // Two independent reads, started together; the suggestions become personal only when they have real data.
  const visits = useQuery(orpc.care.followUps.queryOptions({ input: { lang: visitLang } }));
  const plan = useQuery(orpc.care.discharge.queryOptions({ input: { lang: planLang } }));
  const visitToday = visits.data?.some(v => v.inDays === 0) ?? false;
  const hasMedicines = plan.data?.status === "discharged" && Object.values(plan.data.medicines).some(group => group.length > 0);
  const suggested = [
    ...(visitToday ? ["What should I bring to my visit today?"] : []),
    ...(hasMedicines ? ["When is my next dose?"] : []),
    ...SUGGESTED,
  ].slice(0, 6);
  return (
    <div className="ask-page" data-call={call?.open ? "on" : "off"}>
      {ChatAgentLink && user ? <Suspense fallback={null}><ChatAgentLink user={user} onAsk={onAsk} /></Suspense> : null}
      <PageHeader title="Ask Sona" lead="Ask anything. Type below, or talk to Sona." actions={call?.open ? undefined : call?.button} />
      {call?.open ? call.stage : null}
      <Card className="ask-welcome">
        <EmptyState icon="sparkle" title="What would you like to know?">
          <p>Sona can answer questions about your health, your care and everyday life. Tap one to ask it now.</p>
          <ul className="ask-chips" aria-label="Suggested questions">
            {suggested.map(q => <li key={q}><button type="button" className="ask-chip" onClick={() => ask(q)}>{q}</button></li>)}
          </ul>
        </EmptyState>
      </Card>
      <RightRail label="More from Sona">
        {call?.open ? call.transcript : null}
        <div className="ask-more">
          <ListCard title="Things people ask">
            {suggested.map(q => <ListRow key={q} icon="message" title={q} onClick={() => ask(q)} />)}
          </ListCard>
        </div>
      </RightRail>
    </div>
  );
}

function Page() {
  // The Worker refuses a call whose path is not the signed-in account's own id.
  const userId = authClient.useSession().data?.user.id;
  return userId ? <Call instance={userId}>{call => <Body call={call} />}</Call> : <Body />;
}
