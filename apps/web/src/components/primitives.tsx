import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";

import "../styles/components.css";

export type Tone = "info" | "urgent" | "soon" | "done";

/** Initials on a neutral disc. Decorative: always show the name beside it. */
export function Avatar({ name }: { name: string }) {
  const words = name.trim().split(/\s+/);
  const initials = ((words[0]?.[0] ?? "") + (words.length > 1 ? (words.at(-1)?.[0] ?? "") : "")).toUpperCase();
  return <span className="avatar" aria-hidden="true">{initials || "?"}</span>;
}

/** A short status. Tone carries meaning: urgent red, soon amber, done green, info blue. */
export function Chip({ tone = "neutral", children }: { tone?: Tone | "neutral"; children: ReactNode }) {
  return <span className="chip" data-tone={tone}>{children}</span>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "danger";
  /** The action is under way: disabled and announced as busy. */
  pending?: boolean;
};

export function Button({ variant = "quiet", pending, disabled, className, type = "button", ...rest }: ButtonProps) {
  return <button {...rest} type={type} className={`btn btn-${variant}${className ? ` ${className}` : ""}`} disabled={disabled || pending} aria-busy={pending || undefined} />;
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

/** A plain surface with a line edge and an optional title. */
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title ? <h2 className="card-title">{title}</h2> : null}
      {children}
    </section>
  );
}
