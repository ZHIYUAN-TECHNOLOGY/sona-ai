import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";
import { Avatar, Button, Card } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/care-team.css";

export const Route = createFileRoute("/care/_app/care-team")({ component: Page });

/** Up to three plain topics from a doctor's search tags, without near repeats ("breath", "breathing") or words the role already says. */
function topics(tags: string[], specialty: string) {
  const role = specialty.toLowerCase();
  const kept: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag && !role.includes(tag) && !kept.some(k => tag.startsWith(k) || k.startsWith(tag))) kept.push(tag);
  }
  return kept.slice(0, 3);
}

const urgent = (
  <section className="ct-urgent" aria-labelledby="ct-urgent-title">
    <h2 id="ct-urgent-title">In an emergency</h2>
    <p>If you faint or have chest pain, call 999. Messages are not for emergencies.</p>
    <Button variant="danger" href="tel:999">Call 999 now</Button>
  </section>
);

function Page() {
  const doctors = useQuery(orpc.care.doctors.list.queryOptions());
  const me = useQuery(orpc.care.me.queryOptions());
  const team = doctors.data?.filter(d => d.careTeam);
  const hospital = me.data?.hospital;

  const count = team?.length
    ? `${team.length} ${team.length === 1 ? "doctor looks" : "doctors look"} after you`
    : "The people looking after you";
  const lead = hospital ? `${count} at ${hospital}.` : `${count}.`;

  return (
    <>
      <PageHeader
        title="Care team"
        lead={lead}
        actions={<Button variant="primary" to="/care/messages">Message your care team</Button>}
      />
      <WithRail
        rail={
          <RightRail label="How to reach us">
            {urgent}
            <Card title="How to reach us">
              {hospital ? <p className="ct-hospital">{hospital}</p> : null}
              <p className="ct-note">Write to your care team in Messages. One message reaches the whole team.</p>
            </Card>
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
                      <p className="ct-role">{d.specialty} doctor</p>
                    </div>
                  </div>
                  <p className="ct-about">{d.about}</p>
                  {topics(d.tags, d.specialty).length ? (
                    <div className="ct-ask">
                      <h3>Ask about</h3>
                      <ul>{topics(d.tags, d.specialty).map(t => <li key={t}>{t}</li>)}</ul>
                    </div>
                  ) : null}
                  <p className="ct-foot">
                    Find them in {d.room}.{d.languages.length ? ` Speaks ${d.languages.join(", ")}.` : ""}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </WithRail>
    </>
  );
}
