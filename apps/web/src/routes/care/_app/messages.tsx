import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { EmptyState, PageHeader } from "@/components/page";
import { Button } from "@/components/primitives";
import { WithRail } from "@/components/rail";
import { Composer } from "@/features/care-messages/composer";
import { stateOf, timeOf, type MessageState } from "@/features/care-messages/thread";
import { UrgentCard } from "@/features/care-messages/urgent-card";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-messages.css";

export const Route = createFileRoute("/care/_app/messages")({ component: Page });

const STATE: Record<MessageState, string> = { sending: "Sending…", sent: "Sent", seen: "Seen by care team", replied: "Replied" };

function Page() {
  // ponytail: polling (focus + 20 s) until a shared live-socket hook exists; then invalidate on its "messages" change.
  const thread = useQuery({ ...orpc.care.messages.list.queryOptions(), refetchInterval: 20_000, refetchOnWindowFocus: true });
  const me = useQuery(orpc.care.me.queryOptions());
  const list = thread.data;
  const end = useRef<HTMLDivElement>(null);
  const lastId = list?.at(-1)?.id;
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [lastId]);

  return (
    <>
      <PageHeader title="Messages" lead="Your care team usually replies within a few hours." />
      <WithRail rail={<UrgentCard hospital={me.data?.hospital} />}>
        <div className="cm-column">
          <div className="cm-thread" role="log" aria-label="Messages with your care team">
            {!list ? (
              thread.isError ? (
                <EmptyState>
                  We could not load your messages. {thread.error.message}{" "}
                  <Button onClick={() => void thread.refetch()}>Try again</Button>
                </EmptyState>
              ) : <EmptyState>Loading your messages…</EmptyState>
            ) : list.length === 0 ? (
              <EmptyState>Ask anything about your recovery. Your care team will reply here.</EmptyState>
            ) : list.map((m, i) => {
              const fromMe = m.from === "patient";
              const urgent = "rule" in m && m.rule === "call-999";
              return (
                <div key={m.id} className={`cm-bubble ${fromMe ? "cm-mine" : "cm-theirs"}${urgent ? " cm-999" : ""}`}>
                  {fromMe ? null : <p className="cm-who">{urgent ? "Sona" : "Care team"}</p>}
                  <p>{m.text}</p>
                  {m.attachment ? (
                    <p className="cm-attached">
                      Medicine photo: {[m.attachment.reading.name, m.attachment.reading.dose].filter(Boolean).join(" ")}
                      {m.attachment.decision ? (m.attachment.decision.status === "added" ? " · added to your list" : " · not added") : ""}
                    </p>
                  ) : null}
                  <p className="cm-meta">{fromMe ? `${STATE[stateOf(list, i)]} · ` : ""}{timeOf(m.createdAt)}</p>
                </div>
              );
            })}
            <div ref={end} />
          </div>
          <Composer />
        </div>
      </WithRail>
    </>
  );
}
