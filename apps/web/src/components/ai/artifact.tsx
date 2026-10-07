import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { IconButton } from "@/components/primitives";
import "@/styles/ai.css";

/**
 * A panel for something an answer opened (the X-ray film, a PDF): slides in from the right on a wide screen and covers
 * the screen under 860 px. Title, optional subtitle, `actions` beside the close button, `children` as the body. Focus
 * moves to the title on open and back on close; Escape closes. Render it outside any transformed parent (it is fixed).
 */
export function Artifact({ open, title, subtitle, actions, onClose, children }: { open: boolean; title: string; subtitle?: ReactNode; actions?: ReactNode; onClose: () => void; children?: ReactNode }) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const back = useRef<Element | null>(null);
  // Stays mounted through the slide out, then unmounts.
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);

  useEffect(() => {
    if (open) { back.current = document.activeElement; heading.current?.focus(); return; }
    if (back.current instanceof HTMLElement) back.current.focus();
    back.current = null;
  }, [open]);

  if (!shown) return null;
  // ponytail: no focus trap under 860 px, where the sheet covers the page; add one if keyboard users get lost behind it.
  return (
    <aside className="ai-artifact" role="dialog" aria-labelledby={id} data-open={open || undefined} inert={!open}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      onTransitionEnd={e => { if (!open && e.target === e.currentTarget && e.propertyName === "translate") setShown(false); }}>
      <header className="ai-artifact-head">
        <div className="ai-artifact-titles">
          <h2 id={id} ref={heading} tabIndex={-1}>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="ai-artifact-actions">{actions}</div> : null}
        <IconButton icon="x" label="Close" variant="quiet" size="sm" onClick={onClose} />
      </header>
      <div className="ai-artifact-body">{children}</div>
    </aside>
  );
}
