import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";
import { Button, Chip } from "@/components/primitives";
import { afterReply, currentCheckIn, dayWords, nextCheckIn } from "@/features/care-plan/model";
import { ReplyForm } from "@/features/care-plan/reply";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-plan.css";

export const Route = createFileRoute("/care/_app/check-ins")({ component: Page });

const LABEL = { fine: ["done", "Doing fine"], worse: ["soon", "Care team told"], urgent: ["urgent", "Call the hospital now"] } as const;

function Page() {
  const queryClient = useQueryClient();
  const list = useQuery(orpc.care.checkIns.list.queryOptions());
  const reply = useMutation(orpc.care.checkIns.reply.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.care.checkIns.list.key() }),
  }));

  const header = <PageHeader title="Check-ins" lead="Your care team asks how you are after you go home." />;
  if (list.isPending) return <>{header}<EmptyState>Getting your check-ins…</EmptyState></>;
  if (list.isError) return <>{header}<EmptyState>We could not get your check-ins. {list.error.message} <Button onClick={() => { void list.refetch(); }}>Try again</Button></EmptyState></>;
  if (!list.data.length) return <>{header}<EmptyState>No check-ins yet. They start after you go home.</EmptyState></>;

  const current = currentCheckIn(list.data), next = nextCheckIn(list.data);
  // What the server said about the reply just sent: its label and any task it opened for the care team.
  const sent = reply.data?.replies.at(-1);
  const after = sent && afterReply(sent.label, sent.task);
  const past = list.data.filter(c => c.replies.length).reverse();

  return (
    <div className="care-plan">
      {header}
      {after && <section className={`plan-lead plan-lead-${after.tone}`} role="status">
        <p className="plan-kicker">What happens next</p>
        <h2>{after.title}</h2>
        <p>{after.text}</p>
        <p className="plan-muted">You said: “{sent.text}”</p>
      </section>}

      {current
        ? <section className="plan-lead plan-lead-soon">
          <p className="plan-kicker">Day {current.day} check-in <Chip tone="soon">Waiting for you</Chip></p>
          <h2>{current.message}</h2>
          <ReplyForm
            key={current.id}
            lang={current.language}
            pending={reply.isPending}
            error={reply.isError ? `Your reply was not sent. ${reply.error.message}` : undefined}
            onSend={text => reply.mutate({ checkInId: current.id, text })}
          />
        </section>
        : !after && <section className="plan-lead plan-lead-done">
          <p className="plan-kicker">Nothing to answer now</p>
          <h2>You are up to date</h2>
          <p>{next ? `Your next check-in comes on ${dayWords(next.dueAt)}.` : "Your care team has no more check-ins planned."}</p>
        </section>}

      <section className="plan-section">
        <h2>Past check-ins</h2>
        {!past.length && <p>Your replies will show here.</p>}
        <ul className="plan-list">
          {past.map(c => <li key={c.id}>
            <strong>Day {c.day} · {dayWords(c.dueAt)}</strong>
            <span className="plan-muted">{c.message}</span>
            {c.replies.map(r => <span key={r.id}>You said: “{r.text}” <Chip tone={LABEL[r.label][0]}>{LABEL[r.label][1]}</Chip></span>)}
          </li>)}
        </ul>
      </section>
    </div>
  );
}
