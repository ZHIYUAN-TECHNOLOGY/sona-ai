import type { ReactNode } from "react";

/** The page's title and its one-line lead (insight first: say what matters, not what the page is). */
export function PageHeader({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      {lead ? <p>{lead}</p> : null}
      {children}
    </header>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
