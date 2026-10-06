import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { Avatar } from "@/components/avatar";
import { Icon } from "@/components/icon";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { Composer } from "@/features/care-messages/composer";
import { clockOf, dayOf, leadOf, statusOf } from "@/features/care-messages/thread";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-messages.css";

export const Route = createFileRoute("/care/_app/messages")({ component: Page });

function Page() {
  // ponytail: polling (focus + 20 s) until a shared live-socket hook exists; then invalidate on its "messages" change.
  const thread = useQuery({ ...orpc.care.messages.list.queryOptions(), refetchInterval: 20_000, refetchOnWindowFocus: true });
  const me = useQuery(orpc.care.me.queryOptions());
  const list = thread.data;
  const scroller = useRef<HTMLOListElement>(null);
  const lastId = list?.at(-1)?.id;
  // The newest message stays in view; only the thread scrolls, never the page.
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [lastId]);

  return (
    <>
      <PageHeader title="Messages" lead={list ? leadOf(list) : "Write to your care team. They reply here."} />
      <WithRail rail={<BeforeYouWrite />}>
        <Card className="cm-card">
          <header className="cm-head">
            <Avatar name="Care team" size="md" />
            <div>
              <h2 className="cm-head-title">Your care team</h2>
              {me.data?.hospital ? <p className="cm-head-sub">{me.data.hospital}</p> : null}
            </div>
          </header>
          {!list ? (
            <div className="cm-thread">
              {thread.isError ? (
                <EmptyState>
                  We could not load your messages. {thread.error.message}{" "}
                  <Button onClick={() => void thread.refetch()}>Try again</Button>
                </EmptyState>
              ) : <EmptyState>Loading your messages…</EmptyState>}
            </div>
          ) : list.length === 0 ? (
            <div className="cm-thread"><EmptyState icon="send" title="No messages yet">Your messages and your care team's replies will appear here. Write your first one in the box below.</EmptyState></div>
          ) : (
            <ol ref={scroller} className="cm-thread" role="log" aria-label="Messages with your care team" tabIndex={0}>
              {list.map((m, i) => {
                const fromMe = m.from === "patient";
                const urgent = "rule" in m && m.rule === "call-999";
                const day = dayOf(m.createdAt);
                const who = fromMe ? "You" : urgent ? "Sona · automatic safety reply" : "Care team";
                return (
                  <li key={m.id} className={`cm-item ${fromMe ? "cm-mine" : "cm-theirs"}`}>
                    {i === 0 || dayOf(list[i - 1]!.createdAt) !== day ? <p className="cm-day"><span>{day}</span></p> : null}
                    <div className={`cm-bubble${urgent ? " cm-999" : ""}`} role={urgent ? "alert" : undefined}>
                      {urgent ? <Icon name="alert" size={24} /> : null}
                      <div>
                        <p>{m.text}</p>
                        {m.attachment ? (
                          <p className="cm-attached">
                            <Icon name="image" size={18} />
                            Medicine photo: {[m.attachment.reading.name, m.attachment.reading.dose].filter(Boolean).join(" ")}
                            {m.attachment.decision ? (m.attachment.decision.status === "added" ? " · added to your list" : " · not added") : ""}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <p className="cm-meta">{who} · <time dateTime={new Date(m.createdAt).toISOString()}>{clockOf(m.createdAt)}</time></p>
                  </li>
                );
              })}
            </ol>
          )}
          <Composer status={list ? statusOf(list) : null} />
        </Card>
      </WithRail>
    </>
  );
}

/** What messages are for, and what to do instead when it cannot wait. The call button is the rail's only red. */
function BeforeYouWrite() {
  return (
    <RightRail label="Before you write">
      <Card title="Before you write">
        <ul className="cm-tips">
          <li>Messages are for questions about your recovery, medicines and visits.</li>
          <li>Your care team reads every message and replies here.</li>
        </ul>
        <div className="cm-now">
          <Icon name="alert" size={24} />
          <div>
            <p className="cm-now-title">For anything urgent, call now.</p>
            <p>Chest pain, fainting or trouble breathing cannot wait for a reply.</p>
            <Button href="tel:999" variant="danger" icon="phone">Call 999</Button>
          </div>
        </div>
        <div className="cm-quick">
          <p>For a quick question, ask Sona.</p>
          <Button to="/care/ask">Ask Sona</Button>
        </div>
      </Card>
    </RightRail>
  );
}
