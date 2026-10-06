import type { ReactNode } from "react";

import "../styles/components.css";

/** The aside beside the main column. `label` names the landmark. */
export function RightRail({ label, children }: { label: string; children: ReactNode }) {
  return <aside className="rail" aria-label={label}>{children}</aside>;
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
