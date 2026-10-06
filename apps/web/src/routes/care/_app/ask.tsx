import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page";
import { Call } from "@/features/care-ask/call";
import { Listen } from "@/features/care-ask/listen";
import { authClient } from "@/lib/auth-client";
import { client } from "@/lib/orpc";
import { useSonaAsk } from "@/lib/sona";
import "@/styles/pages/care-ask.css";

export const Route = createFileRoute("/care/_app/ask")({ component: Page });

const SUGGESTED = ["When is my next visit?", "What medicines do I take today?", "What should I eat this week?", "Is it normal to feel tired?"];

type Answer = { answer?: string; source?: string; waking?: number; grounded?: boolean; careTeam?: { line?: string }; sources?: { title: string }[] };

/** This page's answer to the Sona bar and the chips: `care.ask`, with a Listen button. */
async function answer(question: string): Promise<ReactNode> {
  const res = (await client.care.ask({ question })) as Answer;
  if (!res.answer) throw new Error(res.waking ? `Sona is starting (about ${res.waking} min). Please try again then.` : "Sona can't answer right now. Please try again in a minute.");
  const spoken = res.careTeam?.line ? `${res.answer} ${res.careTeam.line}` : res.answer;
  return (
    <>
      <p>{res.answer}</p>
      {res.careTeam?.line ? <p>{res.careTeam.line}</p> : null}
      {res.source === "fixture" ? <p className="sona-turn-note">Sample answer.</p> : null}
      {res.grounded ? <p className="sona-turn-note">From your record.</p> : null}
      {res.sources?.length ? <p className="sona-turn-note">From: {res.sources.map(s => s.title).join(", ")}</p> : null}
      <Listen text={spoken} />
    </>
  );
}

function Page() {
  const ask = useSonaAsk(answer);
  // The Worker refuses a call whose path is not the signed-in account's own id.
  const userId = authClient.useSession().data?.user.id;
  return (
    <>
      {userId ? <Call instance={userId} /> : null}
      <PageHeader title="Ask Sona" lead="Ask anything. Type or speak in the bar below, or tap a question." />
      <ul className="ask-chips" aria-label="Suggested questions">
        {SUGGESTED.map(q => <li key={q}><button type="button" className="ask-chip" onClick={() => ask(q)}>{q}</button></li>)}
      </ul>
    </>
  );
}
