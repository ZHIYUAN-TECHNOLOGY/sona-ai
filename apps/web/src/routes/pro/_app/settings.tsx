import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page";
import { Avatar, Button, Card, Chip } from "@/components/primitives";
import { DemoClock } from "@/features/settings/demo-clock";
import { roleAreas } from "@/features/settings/rules";
import { Watches } from "@/features/settings/watches";
import { signOut } from "@/lib/session";
import "@/styles/pages/settings.css";

export const Route = createFileRoute("/pro/_app/settings")({ component: Page });

function Page() {
  const { me } = Route.useRouteContext();
  const areas = roleAreas(me.role);
  return (
    <>
      <PageHeader title="Settings" />
      <div className="settings">
        <Card title="Account">
          <div className="settings-account">
            <Avatar name={me.name} />
            <div>
              <p className="settings-lead">{me.name}</p>
              <p className="settings-muted">{me.email}</p>
            </div>
            <Chip>{me.label}</Chip>
          </div>
          <h3 className="settings-sub">What a {me.label.toLowerCase()} can and can't do</h3>
          <dl className="settings-areas">
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
          <p className="settings-muted">Everything else is open to every role. Your hospital sets your role.</p>
          <div className="settings-actions">
            <Button onClick={() => void signOut("pro")}>Sign out</Button>
          </div>
        </Card>
        <Watches role={me.role} />
        <DemoClock />
      </div>
    </>
  );
}
