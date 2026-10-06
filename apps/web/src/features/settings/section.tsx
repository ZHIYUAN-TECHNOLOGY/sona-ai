import type { ReactNode } from "react";

import { Card } from "@/components/primitives";

/** One settings card: a title, one muted line saying what it is for, an optional chip, then its rows. */
export function Section({ title, description, aside, children }: { title: string; description: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <Card className="settings-card">
      <header className="settings-head">
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="settings-muted">{description}</p>
        </div>
        {aside}
      </header>
      {children}
    </Card>
  );
}
