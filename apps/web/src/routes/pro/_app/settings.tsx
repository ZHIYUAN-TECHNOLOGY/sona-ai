import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page";
import { Avatar, Button, Signal } from "@/components/primitives";
import { DemoClock } from "@/features/settings/demo-clock";
import { offsetText, roleAreas } from "@/features/settings/rules";
import { Section } from "@/features/settings/section";
import { Watches } from "@/features/settings/watches";
import { orpc } from "@/lib/orpc";
import { signOut } from "@/lib/session";
import "@/styles/pages/settings.css";

export const Route = createFileRoute("/pro/_app/settings")({ component: Page });

function Page() {
  const { me } = Route.useRouteContext();
  const areas = roleAreas(me.role);
  const mayWatch = can(me.role, "watches.list");
  // The same queries the cards below read, so the lead costs no extra request.
  const watches = useQuery(orpc.watches.list.queryOptions({ enabled: mayWatch })).data;
  const clock = useQuery(orpc.demo.status.queryOptions({ refetchInterval: 60_000 })).data;
  const lead = !watches && !clock ? "Your account, your watches and the demo hospital's clock." : (
    <>
      {watches ? `${watches.length} ${watches.length === 1 ? "watch" : "watches"} running` : null}
      {watches && clock ? " · " : null}
      {clock ? (clock.offsetMs ? <Signal tone="soon">demo clock {offsetText(clock.offsetMs)}</Signal> : "demo clock on real time") : null}
    </>
  );
  return (
    <>
      <PageHeader title="Settings" lead={lead} />
      <div className="settings">
        <Section title="Account" description="Who you are signed in as. Your hospital sets your role.">
          <div className="settings-account">
            <Avatar name={me.name} size="lg" />
            <div>
              <p className="settings-name">{me.name}</p>
              <p className="settings-muted">{[me.label, me.email].filter(Boolean).join(" · ")}</p>
            </div>
            <Button variant="secondary" onClick={() => void signOut("pro")}>Sign out</Button>
          </div>
          {areas.length ? (
            <details className="settings-more">
            <summary>What your role can do <span className="settings-muted">· {areas.length} areas</span></summary>
            <dl className="settings-rows">
              {areas.map(({ area, can, cannot }) => (
                <div key={area}>
                  <dt>{area}</dt>
                  <dd>
                    {can.length ? <span>Can {can.join(", ")}.</span> : null}
                    {cannot.length ? <span className="settings-muted"> Can't {cannot.join(", ")}.</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="settings-muted">Everything not listed is open to every role.</p>
            </details>
          ) : null}
        </Section>
        {mayWatch ? <Watches role={me.role} /> : null}
        <DemoClock />
      </div>
    </>
  );
}
