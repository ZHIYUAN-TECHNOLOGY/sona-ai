import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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

const NEXT = {
  done: { label: "See your discharge plan", step: "Keep following your plan until the next check-in.", to: "/care/discharge-plan" },
  soon: { label: "Message your care team", step: "Tell them anything else they should know.", to: "/care/messages" },
} as const;
const SAID = { fine: "Doing fine", worse: "Care team told", urgent: "Call the hospital now" } as const;

function Page() {
  const queryClient = useQueryClient();
  const list = useQuery(orpc.care.checkIns.list.queryOptions());
  const reply = useMutation(orpc.care.checkIns.reply.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.care.checkIns.list.key() }),
  }));

  const [open, setOpen] = useState<string>();

  const alone = (body: React.ReactNode, lead?: string) => <div className="check-ins"><PageHeader title="Check-ins" lead={lead} /><Card className="ci-alone">{body}</Card></div>;
  if (list.isPending) return alone(<EmptyState icon="clock" title="Getting your check-ins…" />);
  if (list.isError) return alone(<EmptyState icon="info" title="We could not get your check-ins" action={<Button onClick={() => { void list.refetch(); }}>Try again</Button>}>{list.error.message}</EmptyState>);
  if (!list.data.length) return alone(
    <EmptyState icon="check" title="No check-ins planned" action={<Button to="/care/discharge-plan" icon="clipboard">See your discharge plan</Button>}>
      They start after you leave hospital.
    </EmptyState>,
    "No check-ins planned yet.",
  );

  const current = currentCheckIn(list.data), next = nextCheckIn(list.data);
  // What the server said about the reply just sent: its label and any task it opened for the care team.
  const sent = reply.data?.replies.at(-1);
  const after = sent ? afterReply(sent.label, sent.task) : undefined;
  const urgent = after?.tone === "urgent";
  const panel = sent && after && after.tone !== "urgent" ? { sent, after, next: NEXT[after.tone] } : undefined;
  const lead = urgent ? "Call the hospital now."
    : current ? "Sona has a question for you today."
    : next ? `You are up to date. Next check-in: ${dayWords(next.dueAt)}.`
    : "You are up to date. No more check-ins are planned.";

  const timeline = (
    <ListCard title="Your check-ins">
      {list.data.map(c => {
        const answered = c.replies.length > 0, isOpen = open === c.id;
        const head = <>
          <span className="list-tile"><Icon name={answered ? "check" : c.id === current?.id ? "message" : "calendar"} size={20} /></span>
          <span className="list-text">
            <span className="list-title">Day {c.day}</span>
            <span className="list-caption">{dayWords(c.dueAt)}</span>
          </span>
          {c.id === current?.id ? <Chip tone="blue">Today</Chip> : <span className="ci-state">{answered ? "Answered" : "Planned"}</span>}
        </>;
        return <li key={c.id} className="ci-row">
          {answered
            ? <>
              <button type="button" className="list-row" aria-expanded={isOpen} aria-controls={`ci-${c.id}`} onClick={() => setOpen(o => o === c.id ? undefined : c.id)}>
                {head}<Icon name="chevron-down" size={18} className="list-chevron" />
              </button>
              {isOpen
                ? <div id={`ci-${c.id}`} className="ci-detail">
                  <p className="ci-muted">Sona asked: {c.message}</p>
                  {c.replies.map(r => <p key={r.id}>You said: “{r.text}” <span className={r.label === "urgent" ? "ci-said ci-said-urgent" : "ci-said"}>{SAID[r.label]}</span></p>)}
                </div>
                : null}
            </>
            : <div className="list-row">{head}</div>}
        </li>;
      })}
    </ListCard>
  );

  return (
    <div className="check-ins">
      <PageHeader title="Check-ins" lead={lead} />

      <div className="ci-cols">
        <div className="ci-main">
          {/* Red is for this one card only: the server judged the reply an emergency. */}
          {urgent && after
            ? <Card className="ci-urgent">
              <div role="alert">
                <h2 className="ci-urgent-title"><Icon name="phone" size={22} /> {after.title}</h2>
                <p>{after.text}</p>
              </div>
              <Button variant="danger" icon="phone" href="tel:999">Call 999</Button>
            </Card>
            : null}
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
              <h2 className="ci-question" role="status">{sent ? "Sent. Your care team sees your answer." : "You are up to date"}</h2>
              <p className="ci-muted">{next ? `Your next check-in comes on ${dayWords(next.dueAt)}.` : "Your care team has no more check-ins planned."}</p>
            </Card>}
          {panel ? timeline : null}
        </div>
        <div className="ci-rail">
          {panel
            ? <div role="status">
              <InsightCard
                label="What happens next"
                meta={panel.sent.source === "fixture" ? "Sample answer" : undefined}
                title={panel.after.title}
                lead={panel.after.text}
                evidence={[{ icon: "message", text: <>You said: “{panel.sent.text}”</> }]}
                next={panel.next}
              />
            </div>
            : timeline}
        </div>
      </div>
    </div>
  );
}
