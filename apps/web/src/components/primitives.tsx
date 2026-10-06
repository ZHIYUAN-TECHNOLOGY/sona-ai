import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";

import { Avatar } from "./avatar";
import { Icon, type IconName } from "./icon";
import "../styles/components.css";
import "../styles/primitives.css";

export { Avatar };

/** Tone carries meaning: urgent/red must-not-miss, soon/amber, done/green, info/blue the next step. */
export type Tone = "info" | "urgent" | "soon" | "done";
export type ChipTone = Tone | "neutral" | "blue" | "amber" | "red" | "green" | "ink";

/** Where a control goes: a router path (`to`, with optional `search`/`params`) or a plain `href`. */
export type Target = { to?: LinkProps["to"]; search?: LinkProps["search"]; params?: LinkProps["params"]; href?: string };
export type CornerAction = Target & { label: string };

/** A router Link for `to`, an <a> for `href`. */
export function Anchor({ to, search, params, href, ...rest }: Target & { className?: string; children?: ReactNode; [attr: `aria-${string}` | `data-${string}`]: string | boolean | undefined }) {
  if (to) return <Link to={to} search={search as never} params={params as never} {...rest} />;
  return <a href={href} {...rest} />;
}

/** A short status. `soft` wash (default), `solid` fill or `outline`. */
export function Chip({ tone = "neutral", variant = "soft", icon, children }: { tone?: ChipTone; variant?: "soft" | "solid" | "outline"; icon?: IconName; children: ReactNode }) {
  return (
    <span className="chip" data-tone={tone} data-variant={variant}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & Target & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "sm" | "md" | "lg";
  /** Leading icon. */
  icon?: IconName;
  /** The action is under way: disabled and announced as busy. */
  pending?: boolean;
};

/** Pill button. Renders a link when given `to` or `href`. */
export function Button({ variant = "quiet", size = "md", icon, pending, disabled, className, type = "button", to, search, params, href, children, ...rest }: ButtonProps) {
  const cls = `btn btn-${variant}${className ? ` ${className}` : ""}`;
  const off = disabled || pending;
  const body = (
    <>
      {pending ? <span className="btn-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} /> : null}
      {children}
    </>
  );
  if (to || href) return <Anchor to={off ? undefined : to} search={search} params={params} href={off ? undefined : href} className={cls} data-size={size} aria-disabled={off || undefined} aria-label={rest["aria-label"]}>{body}</Anchor>;
  return <button {...rest} type={type} data-size={size} className={cls} disabled={off} aria-busy={pending || undefined}>{body}</button>;
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & Target & { icon: IconName; label: string; variant?: "outline" | "ink" | "quiet"; size?: "sm" | "md"; pending?: boolean };

/** Round icon-only button; `label` is its accessible name. Renders a link when given `to` or `href`. */
export function IconButton({ icon, label, variant = "outline", size = "md", pending, disabled, className, type = "button", to, search, params, href, ...rest }: IconButtonProps) {
  const cls = `icon-btn icon-btn-${variant}${className ? ` ${className}` : ""}`;
  const glyph = <Icon name={icon} size={size === "sm" ? 16 : 20} />;
  if (to || href) return <Anchor to={to} search={search} params={params} href={href} className={cls} data-size={size} aria-label={label}>{glyph}</Anchor>;
  return <button {...rest} type={type} className={cls} data-size={size} aria-label={label} title={label} disabled={disabled || pending} aria-busy={pending || undefined}>{glyph}</button>;
}

type Control = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

/** Label above, hint and error below. Spread the given props on the control:
    `<Field label="Name">{(c) => <input {...c} />}</Field>` */
export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: ReactNode; children: (control: Control) => ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? true : undefined })}
      {hint ? <p id={hintId} className="field-hint">{hint}</p> : null}
      {error ? <p id={errorId} className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}

/** Pill search input. `label` is its accessible name and default placeholder. */
export function SearchField({ label, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  return (
    <label className={`search-field${className ? ` ${className}` : ""}`}>
      <Icon name="search" size={18} />
      <input placeholder={label} {...rest} type="search" aria-label={label} />
    </label>
  );
}

/** A white surface with an optional title and a corner action link. */
export function Card({ title, action, className, children }: { title?: string; action?: CornerAction; className?: string; children: ReactNode }) {
  const { label, ...target } = action ?? { label: "" };
  return (
    <section className={`card${className ? ` ${className}` : ""}`}>
      {title || action ? (
        <div className="card-head">
          {title ? <h2 className="card-title">{title}</h2> : <span />}
          {action ? <Anchor {...target} className="card-action">{label}</Anchor> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

type StatCardProps = {
  title: string;
  value: ReactNode;
  unit?: string;
  caption?: ReactNode;
  /** Overline chip text and its tone. */
  chip?: ReactNode;
  tone?: ChipTone;
  /** Corner arrow link; `label` is its accessible name. */
  action?: CornerAction;
  /** The one highlighted stat in a row: soft blue gradient. */
  feature?: boolean;
  /** 0 to 1: draws a progress arc. */
  progress?: number;
};

export function StatCard({ title, value, unit, caption, chip, tone = "neutral", action, feature, progress }: StatCardProps) {
  const done = progress === undefined ? undefined : Math.min(1, Math.max(0, progress)) * 100;
  const { label, ...target } = action ?? { label: "" };
  return (
    <section className="stat" data-feature={feature || undefined}>
      {chip || action ? (
        <div className="stat-head">
          {chip ? <Chip tone={tone}>{chip}</Chip> : <span />}
          {action ? <IconButton icon="arrow-up-right" label={label} size="sm" {...target} /> : null}
        </div>
      ) : null}
      <h3 className="stat-title" title={title}>{title}</h3>
      <div className="stat-body">
        <p className="stat-value"><span>{value}</span>{unit ? <span className="stat-unit" title={typeof unit === "string" ? unit : undefined}>{unit}</span> : null}</p>
        {done === undefined ? null : (
          <svg className="stat-arc" viewBox="0 0 100 56" role="img" aria-label={`${Math.round(done)}%`}>
            <path d="M8 50 A42 42 0 0 1 92 50" pathLength={100} />
            <path d="M8 50 A42 42 0 0 1 92 50" pathLength={100} strokeDasharray={`${done} 100`} data-done />
          </svg>
        )}
      </div>
      {caption ? <p className="stat-caption">{caption}</p> : null}
    </section>
  );
}

/** A row of stat cards; wraps on narrow widths. */
/** A 40px grey icon tile: the leading of a `ListRow` or a table cell for a file or document. */
export function FileTile({ icon = "file" }: { icon?: IconName }) {
  return <span className="list-tile"><Icon name={icon} size={20} /></span>;
}

/** Label/value rows for a rail card: muted label column, value column, hairline dividers. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="detail-list">
      {items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
    </dl>
  );
}

/** Overline heading for a section of a document card. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h4 className="section-label">{children}</h4>;
}

/** Native select in `SearchField`'s look. `label` is its accessible name. */
export function Select({ label, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <select className={`select${className ? ` ${className}` : ""}`} aria-label={label} {...rest}>{children}</select>;
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="stat-row">{children}</div>;
}

export type TabItem<T extends string = string> = { id: T; label: ReactNode; count?: number };

/** The tab a key press moves to, or undefined when the key is not a tab key. */
export function tabForKey<T extends string>(ids: T[], current: T, key: string): T | undefined {
  const i = ids.indexOf(current);
  if (key === "ArrowRight") return ids[(i + 1) % ids.length];
  if (key === "ArrowLeft") return ids[(i - 1 + ids.length) % ids.length];
  if (key === "Home") return ids[0];
  if (key === "End") return ids.at(-1);
  return undefined;
}

/** Controlled text tabs. Arrow keys, Home and End move and select. `label` names the tablist. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = tabForKey(tabs.map((tab) => tab.id), value, event.key);
    if (next === undefined) return;
    event.preventDefault();
    onChange(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" className="tab" data-tab={tab.id} aria-selected={tab.id === value} tabIndex={tab.id === value ? 0 : -1} onClick={() => onChange(tab.id)}>
          {tab.label}
          {tab.count === undefined ? null : <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A card holding a side list of `<ListRow>`s. */
export function ListCard({ title, action, children }: { title?: string; action?: CornerAction; children: ReactNode }) {
  return <Card title={title} action={action} className="list-card"><ul className="list">{children}</ul></Card>;
}

type ListRowProps = Target & {
  title: ReactNode;
  caption?: ReactNode;
  /** Leading: a person's name for an avatar, an icon tile, or any node. */
  avatar?: string;
  icon?: IconName;
  leading?: ReactNode;
  /** Trailing chip or text; a chevron shows instead when the row is a link or button. */
  trailing?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
};

export function ListRow({ title, caption, avatar, icon, leading, trailing, onClick, selected, disabled, ...target }: ListRowProps) {
  const linked = Boolean(target.to || target.href);
  const body = (
    <>
      {leading ?? (avatar ? <Avatar name={avatar} size="md" /> : icon ? <span className="list-tile"><Icon name={icon} size={20} /></span> : null)}
      <span className="list-text">
        <span className="list-title">{title}</span>
        {caption ? <span className="list-caption">{caption}</span> : null}
      </span>
      {trailing ?? (linked || onClick ? <Icon name="chevron-right" size={18} className="list-chevron" /> : null)}
    </>
  );
  return (
    <li>
      {linked ? <Anchor {...target} className="list-row" aria-current={selected ? "page" : undefined}>{body}</Anchor>
        : onClick ? <button type="button" className="list-row" onClick={onClick} disabled={disabled} aria-pressed={selected}>{body}</button>
        : <div className="list-row">{body}</div>}
    </li>
  );
}

/** Loading placeholder. Hidden from assistive tech: put `aria-busy` on the region it fills. */
export function Skeleton({ width = "100%", height = 16, round }: { width?: number | string; height?: number | string; round?: boolean }) {
  return <span className="skeleton" aria-hidden="true" style={{ width, height, borderRadius: round ? "50%" : undefined }} />;
}

/** The rows a page shows: `[from, to]`, 1-based and inclusive; `[0, 0]` when empty. */
export function pageRange(page: number, pageSize: number, total: number): [number, number] {
  return total === 0 ? [0, 0] : [(page - 1) * pageSize + 1, Math.min(page * pageSize, total)];
}

/** Round previous/next with "Showing X of Y". `page` is 1-based. */
export function Pager({ page, pageSize, total, onPage, noun }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; noun?: string }) {
  const [from, to] = pageRange(page, pageSize, total);
  return (
    <nav className="pager" aria-label="Pages">
      <p className="pager-count" aria-live="polite">Showing {from === to ? to : `${from}–${to}`} of {total}{noun ? ` ${noun}` : ""}</p>
      <IconButton icon="chevron-left" label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} />
      <IconButton icon="chevron-right" label="Next page" disabled={to >= total} onClick={() => onPage(page + 1)} />
    </nav>
  );
}
