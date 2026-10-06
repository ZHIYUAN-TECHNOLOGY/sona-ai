import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button, type Tone } from "./primitives";
import "../styles/components.css";

type Next = { label: string } & ({ onAct: () => void } | { to: LinkProps["to"] });

type Props = {
  /** One line that says where things stand. */
  lead: string;
  /** The one suggested next step. */
  next?: Next;
  /** How many sources the insight draws on. */
  sources?: number;
  tone?: Tone;
  /** Detail on demand, behind a disclosure. */
  children?: ReactNode;
};

export function InsightCard({ lead, next, sources, tone = "info", children }: Props) {
  return (
    <article className="insight glass halftone" data-tone={tone}>
      <p className="insight-lead">{lead}</p>
      {children ? (
        <details className="insight-detail">
          <summary>Details</summary>
          {children}
        </details>
      ) : null}
      {next ? (
        "to" in next
          ? <Link className="btn btn-primary" to={next.to}>{next.label}</Link>
          : <Button variant="primary" onClick={next.onAct}>{next.label}</Button>
      ) : null}
      {sources === undefined ? null : (
        <footer className="insight-foot">You decide · {sources} {sources === 1 ? "source" : "sources"}</footer>
      )}
    </article>
  );
}

/** Lays 2-4 insight cards in a row; they wrap on narrow screens. */
export function InsightRow({ children }: { children: ReactNode }) {
  return <div className="insight-row">{children}</div>;
}
