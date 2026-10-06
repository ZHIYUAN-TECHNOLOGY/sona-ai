import { can } from "@sona-ai/api/roles";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page";
import { Avatar, Button } from "@/components/primitives";
import { DemoClock } from "@/features/settings/demo-clock";
import { roleAreas } from "@/features/settings/rules";
import { Section } from "@/features/settings/section";
import { Watches } from "@/features/settings/watches";
import { signOut } from "@/lib/session";
import "@/styles/pages/settings.css";

export const Route = createFileRoute("/pro/_app/settings")({ component: Page });

function Page() {
  const { me } = Route.useRouteContext();
  const areas = roleAreas(me.role);
  return (
    <>
      <PageHeader title="Settings" lead="Your account, the questions Sona watches for you, and the demo hospital's clock." />
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
          ) : null}
          <p className="settings-muted">Everything not listed is open to every role.</p>
        </Section>
        {can(me.role, "watches.list") ? <Watches role={me.role} /> : null}
        <DemoClock />
      </div>
    </>
  );
}
