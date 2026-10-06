import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Avatar } from "./avatar";
import { Icon, type IconName } from "./icon";
import "../styles/components.css";
import "../styles/primitives.css";

export type Crumb = { label: string; to?: LinkProps["to"] };

type PageHeaderProps = {
  title: string;
  /** One line under the title (insight first: say what matters, not what the page is). `subtitle` is the same slot. */
  lead?: ReactNode;
  subtitle?: ReactNode;
  breadcrumb?: Crumb[];
  /** Quiet text beside the title, such as when the data was last updated. */
  status?: ReactNode;
  /** Buttons at the right. */
  actions?: ReactNode;
  children?: ReactNode;
};

export function PageHeader({ title, lead, subtitle, breadcrumb, status, actions, children }: PageHeaderProps) {
  const sub = subtitle ?? lead;
  return (
    <header className="page-header">
      {breadcrumb?.length ? (
        <nav className="crumbs" aria-label="Breadcrumb">
          <ol>
            {breadcrumb.map((crumb) => (
              <li key={crumb.label}>{crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}</li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="page-header-row">
        <h1>{title}</h1>
        {status ? <span className="page-status">{status}</span> : null}
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
      {sub ? <p>{sub}</p> : null}
      {children}
    </header>
  );
}

/** Nothing to show. Say why and, when there is one, offer the next step as `action`. */
export function EmptyState({ title, icon, action, children }: { title?: string; icon?: IconName; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon ? <span className="empty-icon"><Icon name={icon} size={22} /></span> : null}
      {title ? <p className="empty-title">{title}</p> : null}
      {children}
      {action}
    </div>
  );
}

/** Who the page is about: avatar, name and meta line; optional tabs in the middle, chips at the right. */
export function PatientStrip({ name, meta, tabs, chips }: { name: string; meta?: ReactNode; tabs?: ReactNode; chips?: ReactNode }) {
  return (
    <section className="patient-strip" aria-label={name}>
      <Avatar name={name} size="lg" />
      <div className="patient-strip-text">
        <h2>{name}</h2>
        {meta ? <p>{meta}</p> : null}
      </div>
      {tabs ? <div className="patient-strip-tabs">{tabs}</div> : null}
      {chips ? <div className="patient-strip-chips">{chips}</div> : null}
    </section>
  );
}
