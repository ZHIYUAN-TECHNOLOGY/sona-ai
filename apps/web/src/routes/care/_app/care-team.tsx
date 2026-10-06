import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";
import { Avatar, Button } from "@/components/primitives";
import { WithRail } from "@/components/rail";
import { UrgentCard } from "@/features/care-messages/urgent-card";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-messages.css";

export const Route = createFileRoute("/care/_app/care-team")({ component: Page });

function Page() {
  const doctors = useQuery(orpc.care.doctors.list.queryOptions());
  const me = useQuery(orpc.care.me.queryOptions());
  const team = doctors.data?.filter(d => d.careTeam);

  return (
    <>
      <PageHeader title="Care team" lead="The people looking after you. Send a message and they will reply." />
      <WithRail rail={<UrgentCard hospital={me.data?.hospital} />}>
        {!team ? (
          doctors.isError ? (
            <EmptyState>
              We could not load your care team. {doctors.error.message}{" "}
              <Button onClick={() => void doctors.refetch()}>Try again</Button>
            </EmptyState>
          ) : <EmptyState>Loading your care team…</EmptyState>
        ) : team.length === 0 ? (
          <EmptyState>
            No one is listed yet. You can still write to the ward.{" "}
            <Link className="btn btn-primary" to="/care/messages">Message the care team</Link>
          </EmptyState>
        ) : (
          <ul className="cm-team">
            {team.map(d => (
              <li key={d.id} className="cm-member">
                <Avatar name={d.name} />
                <div className="cm-member-text">
                  <h2>{d.name}</h2>
                  <p className="cm-role">Your {d.specialty.toLowerCase()} doctor · {d.room}</p>
                  <p>{d.about}</p>
                  {d.tags.length ? <p className="cm-about">Ask about: {d.tags.join(", ")}.</p> : null}
                  {d.languages.length ? <p className="cm-about">Speaks {d.languages.join(", ")}.</p> : null}
                </div>
                <Link className="btn btn-primary" to="/care/messages" aria-label={`Message ${d.name}`}>Message</Link>
              </li>
            ))}
          </ul>
        )}
      </WithRail>
    </>
  );
}
