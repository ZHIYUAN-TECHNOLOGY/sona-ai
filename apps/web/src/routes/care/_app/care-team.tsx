import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";
import { Anchor, Avatar, Button, Card, Chip, DetailList } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-team.css";

export const Route = createFileRoute("/care/_app/care-team")({ component: Page });

function Page() {
  const doctors = useQuery(orpc.care.doctors.list.queryOptions());
  const me = useQuery(orpc.care.me.queryOptions());
  const team = doctors.data?.filter(d => d.careTeam);
  const hospital = me.data?.hospital;

  return (
    <>
      <PageHeader
        title="Care team"
        lead={hospital ? `The people looking after you at ${hospital}.` : "The people looking after you."}
        actions={<Button variant="primary" to="/care/messages">Message your care team</Button>}
      />
      <WithRail
        rail={
          <RightRail label="How to reach us">
            <Card title="How to reach us">
              {hospital ? <DetailList items={[{ label: "Hospital", value: hospital }]} /> : null}
              <p className="ct-note">Write to your care team in Messages. They reply within a few hours.</p>
            </Card>
            <section className="ct-urgent" aria-labelledby="ct-urgent-title">
              <h2 id="ct-urgent-title">In an emergency</h2>
              <p>If you faint or have chest pain, call 999. Messages are not for emergencies.</p>
              <Button variant="danger" href="tel:999">Call 999 now</Button>
            </section>
          </RightRail>
        }
      >
        {!team ? (
          doctors.isError ? (
            <EmptyState title="We could not load your care team" action={<Button onClick={() => void doctors.refetch()}>Try again</Button>}>
              {doctors.error.message}
            </EmptyState>
          ) : <EmptyState>Loading your care team…</EmptyState>
        ) : team.length === 0 ? (
          <EmptyState title="No one is listed yet">You can still write to the ward in Messages.</EmptyState>
        ) : (
          <ul className="ct-grid">
            {team.map(d => (
              <li key={d.id}>
                <Card className="ct-person">
                  <div className="ct-who">
                    <Avatar name={d.name} size="lg" />
                    <div>
                      <h2 className="ct-name">{d.name}</h2>
                      <p className="ct-role">{d.specialty} · {d.room}</p>
                    </div>
                  </div>
                  <p className="ct-about">{d.about}</p>
                  {d.tags.length ? (
                    <ul className="ct-tags" aria-label="Ask about">
                      {d.tags.map(t => <li key={t}><Chip>{t}</Chip></li>)}
                    </ul>
                  ) : null}
                  {d.languages.length ? <p className="ct-role">Speaks {d.languages.join(", ")}</p> : null}
                  <Anchor className="link ct-action" to="/care/messages" aria-label={`Message ${d.name}`}>Message</Anchor>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </WithRail>
    </>
  );
}
