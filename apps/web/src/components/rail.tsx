import type { ReactNode } from "react";

import "../styles/components.css";
import "../styles/primitives.css";

/** The aside beside the main column. `label` names the landmark. */
/** After a row is chosen, bring the rail's decision into view and put focus on its first action, so "Review" lands on what to do. */
export function revealRail(id: string) {
  requestAnimationFrame(() => {
    const rail = document.getElementById(id);
    rail?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    (rail?.querySelector<HTMLElement>(".insight-act:not(:disabled)") ?? rail?.querySelector<HTMLElement>("select:not(:disabled), button:not(:disabled), a[href]"))?.focus({ preventScroll: true });
  });
}

export function RightRail({ label, id, children }: { label: string; id?: string; children: ReactNode }) {
  return <aside className="rail" aria-label={label} id={id}>{children}</aside>;
}

/** Main column plus a rail; the rail drops below on narrow screens. Pass a `<RightRail>` as `rail`. */
export function WithRail({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="with-rail">
      <div className="with-rail-main">{children}</div>
      {rail}
    </div>
  );
}
