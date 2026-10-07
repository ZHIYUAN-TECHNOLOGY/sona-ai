import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Icon, type IconName } from "./icon";
import { Anchor, type Target, type Tone } from "./primitives";
import "../styles/components.css";
import "../styles/data.css";

type Next = {
  label: string;
  /** The suggested step, in one line, beside the action. */
  step?: string;
  /** Shows the action as busy and stops a second press. */
  pending?: boolean;
} & ({ onAct: () => void } | (Target & ({ to: LinkProps["to"] } | { href: string })));

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
  /** Pill at the top left, e.g. "Sona insight". */
  label?: string;
  /** Small text at the top right, e.g. when it was last updated. */
  meta?: ReactNode;
  /** Heading; with one, `lead` reads as the paragraph under it. */
  title?: string;
  /** What the insight rests on, one row each. */
  evidence?: { icon?: IconName; text: ReactNode }[];
  /** Lays the card across the page: what stands, what it rests on, what to do. For the one insight that leads a page. */
  band?: boolean;
};

export function InsightCard({ lead, next, sources, tone = "info", children, label, meta, title, evidence, band }: Props) {
  return (
    <article className="insight" data-tone={tone} data-band={band || undefined}>
      {label || meta ? (
        <header className="insight-head">
          {label ? <span className="insight-label">{label}</span> : null}
          {meta ? <span className="insight-meta">{meta}</span> : null}
        </header>
      ) : null}
      {title ? <h3 className="insight-title">{title}</h3> : null}
      <p className={title ? "insight-body" : "insight-lead"}>{lead}</p>
      {evidence?.length ? (
        <ul className="insight-evidence">
          {evidence.map((e, i) => (
            <li key={i}>
              <Icon name={e.icon ?? "chevron-right"} size={18} />
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {children ? (
        <details className="insight-detail">
          <summary>Details</summary>
          {children}
        </details>
      ) : null}
      {next ? (
        <div className="insight-next">
          {next.step ? (
            <p className="insight-step">
              <span className="insight-overline">Suggested</span>
              {next.step}
            </p>
          ) : null}
          {"onAct" in next
            ? <button type="button" className="btn btn-primary insight-act" onClick={next.onAct} disabled={next.pending} aria-busy={next.pending || undefined} data-pending={next.pending || undefined}>{next.label}</button>
            : <Anchor className="btn btn-primary insight-act" to={next.to} search={next.search} params={next.params} href={next.href} aria-busy={next.pending || undefined} data-pending={next.pending || undefined}>{next.label}</Anchor>}
        </div>
      ) : null}
      {sources === undefined ? null : (
        <footer className="insight-foot">
          <Icon name="shield-check" size={16} />
          You decide · {sources} {sources === 1 ? "source" : "sources"}
        </footer>
      )}
    </article>
  );
}

/** Lays 2-4 insight cards in a row; they wrap on narrow screens. */
export function InsightRow({ children }: { children: ReactNode }) {
  return <div className="insight-row">{children}</div>;
}
