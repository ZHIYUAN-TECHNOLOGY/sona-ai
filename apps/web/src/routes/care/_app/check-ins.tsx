import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type React from "react";

import { Icon } from "@/components/icon";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, ListCard } from "@/components/primitives";
import { afterReply, currentCheckIn, dayWords, nextCheckIn } from "@/features/care-plan/model";
import { ReplyForm } from "@/features/care-plan/reply";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-check-ins.css";

export const Route = createFileRoute("/care/_app/check-ins")({ component: Page });

const LEAD = "Sona checks how you are after you leave hospital.";
const SAID = { fine: "Doing fine", worse: "Care team told", urgent: "Call the hospital now" } as const;

function Page() {
  const queryClient = useQueryClient();
  const list = useQuery(orpc.care.checkIns.list.queryOptions());
  const reply = useMutation(orpc.care.checkIns.reply.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.care.checkIns.list.key() }),
  }));

  const alone = (body: React.ReactNode) => <div className="check-ins"><PageHeader title="Check-ins" lead={LEAD} /><Card className="ci-alone">{body}</Card></div>;
  if (list.isPending) return alone(<EmptyState icon="clock" title="Getting your check-ins…" />);
  if (list.isError) return alone(<EmptyState icon="info" title="We could not get your check-ins" action={<Button onClick={() => { void list.refetch(); }}>Try again</Button>}>{list.error.message}</EmptyState>);
  if (!list.data.length) return alone(
    <EmptyState icon="check" title="No check-ins planned" action={<Button to="/care/discharge-plan" icon="clipboard">See your discharge plan</Button>}>
      They start after you leave hospital.
    </EmptyState>,
  );

  const current = currentCheckIn(list.data), next = nextCheckIn(list.data);
  // What the server said about the reply just sent: its label and any task it opened for the care team.
  const sent = reply.data?.replies.at(-1);
  const after = sent && afterReply(sent.label, sent.task);

  return (
    <div className="check-ins">
      <PageHeader
        title="Check-ins"
        lead={LEAD}
        actions={current ? <Button variant="primary" href="#today">Answer today’s check-in</Button> : undefined}
      />

      {/* Red is for this one line only: the server judged the reply an emergency. */}
      {after?.tone === "urgent" && <Card className="ci-urgent">
        <p role="alert"><Icon name="phone" size={22} /> <strong>{after.title}.</strong> {after.text}</p>
      </Card>}

      <div className={after && after.tone !== "urgent" ? "ci-top ci-top-two" : "ci-top"}>
        <div id="today" className="ci-anchor">
          {current
            ? <Card className="ci-hero">
              <div className="ci-over"><Chip tone="blue">Waiting for you</Chip><span>Day {current.day} · {dayWords(current.dueAt)}</span></div>
              <h2 className="ci-question">{current.message}</h2>
              <ReplyForm
                key={current.id}
                lang={current.language}
                pending={reply.isPending}
                error={reply.isError ? `Your answer was not sent. ${reply.error.message}` : undefined}
                onSend={text => reply.mutate({ checkInId: current.id, text })}
              />
            </Card>
            : <Card className="ci-hero">
              <div className="ci-over"><Chip tone="green" icon="check">Nothing to answer now</Chip></div>
              <h2 className="ci-question">You are up to date</h2>
              <p className="ci-muted">{next ? `Your next check-in comes on ${dayWords(next.dueAt)}.` : "Your care team has no more check-ins planned."}</p>
            </Card>}
        </div>
        {after && after.tone !== "urgent" && <div role="status">
          <InsightCard
            label="What happens next"
            title={after.title}
            lead={after.text}
            evidence={[{ icon: "message", text: <>You said: “{sent.text}”</> }]}
          />
        </div>}
      </div>

      <ListCard title="Your check-ins">
        {list.data.map(c => {
          const answered = c.replies.length > 0;
          const head = <>
            <span className="list-tile"><Icon name={answered ? "check" : c.id === current?.id ? "message" : "calendar"} size={20} /></span>
            <span className="list-text">
              <span className="list-title">Day {c.day}</span>
              <span className="list-caption">{dayWords(c.dueAt)}</span>
            </span>
            {c.id === current?.id ? <Chip tone="blue">Today</Chip> : <span className="ci-state">{answered ? "Answered" : "Planned"}</span>}
          </>;
          return <li key={c.id}>
            {answered
              ? <details className="ci-row">
                <summary className="list-row">{head}<Icon name="chevron-down" size={18} className="list-chevron" /></summary>
                <div className="ci-detail">
                  <p className="ci-muted">Sona asked: {c.message}</p>
                  {c.replies.map(r => <p key={r.id}>You said: “{r.text}” <span className={r.label === "urgent" ? "ci-said ci-said-urgent" : "ci-said"}>{SAID[r.label]}</span></p>)}
                </div>
              </details>
              : <div className="list-row">{head}</div>}
          </li>;
        })}
      </ListCard>
    </div>
  );
}
