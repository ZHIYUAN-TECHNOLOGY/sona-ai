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

/** Main column plus a rail; the rail stays in view while the main column scrolls, and drops below on a narrow page. Pass a `<RightRail>` as `rail`. */
/** `follow`: the rail scrolls with the page (a document such as a visit note), instead of staying in view with its own scroll (a list and its detail). */
/** `first`: on a narrow page the rail's first card leads the page instead of following it: pass it when that card is the page's insight or decision. `"rail"`: the whole rail leads. */
export function WithRail({ rail, follow, first, children }: { rail: ReactNode; follow?: boolean; first?: boolean | "rail"; children: ReactNode }) {
  return (
    <div className="with-rail" data-follow={follow || undefined} data-first={first === true ? "card" : first || undefined}>
      <div className="with-rail-main">{children}</div>
      <div className="with-rail-side">{rail}</div>
    </div>
  );
}
