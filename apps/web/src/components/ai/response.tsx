import type { Mark } from "@sona-ai/domain/answer-parts";
import type { Claim, Reference } from "@sona-ai/domain/evidence";
import { type PointerEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Icon, type IconName } from "@/components/icon";
import { Marked } from "@/components/marked";

import { plural, sourceKinds } from "./summary";
import "@/styles/ai.css";

const KIND_ICON: Record<Reference["kind"], IconName> = { study: "file", library: "book", image: "image", record: "user" };
const KIND_LABEL: Record<Reference["kind"], string> = { study: "Studies", library: "Library", image: "Images", record: "Patient record" };
const meta = (r: Reference) => [r.from, r.year, r.design].filter(Boolean).join(" · ");
const GAP = 8;

/**
 * The default for a citation click: open the Sources in the same answer (the nearest `[data-ai-answer]`, which Turn
 * sets), then bring source `n` into view, focus it and flash it.
 */
function showSource(from: HTMLElement, n: number) {
  const scope = from.closest("[data-ai-answer]") ?? document;
  scope.querySelector<HTMLButtonElement>("[data-sources-toggle][aria-expanded='false']")?.click();
  requestAnimationFrame(() => {
    const row = scope.querySelector<HTMLElement>(`[data-source="${n}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    row.focus({ preventScroll: true });
    row.removeAttribute("data-flash");
    void row.offsetWidth; // restart the flash on a second click
    row.setAttribute("data-flash", "");
  });
}

/**
 * A citation chip, "1". Hover (after a beat) or focus shows the source in a card: kind, title, from · year · design, two
 * lines of it. Click calls `onSelect(n)`, or by default opens the answer's Sources at that source.
 */
export function InlineCitation({ n, reference, onSelect }: { n: number; reference?: Reference; onSelect?: (n: number) => void }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  const later = (next: boolean, ms: number) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(next), ms); };
  const now = (next: boolean) => { clearTimeout(timer.current); setOpen(next); };
  useEffect(() => () => clearTimeout(timer.current), []);

  // The card lives in the top layer (a popover), so no scrolling thread or panel clips it; it sits above the chip,
  // or below when there is no room, and stays inside the window. Scrolling closes it.
  useLayoutEffect(() => {
    const el = card.current, at = button.current;
    if (!open || !el || !at) return;
    el.showPopover();
    const r = at.getBoundingClientRect();
    const left = Math.min(Math.max(GAP, r.left + r.width / 2 - el.offsetWidth / 2), innerWidth - el.offsetWidth - GAP);
    const above = r.top - el.offsetHeight - GAP >= GAP;
    el.style.left = `${left}px`;
    el.style.top = `${above ? r.top - el.offsetHeight - GAP : r.bottom + GAP}px`;
    el.dataset.side = above ? "top" : "bottom";
    const close = () => setOpen(false);
    addEventListener("scroll", close, { capture: true, once: true });
    return () => { removeEventListener("scroll", close, { capture: true }); if (el.matches(":popover-open")) el.hidePopover(); };
  }, [open]);

  const hover = reference ? {
    onPointerEnter: (e: PointerEvent) => { if (e.pointerType === "mouse") later(true, open ? 0 : 200); },
    onPointerLeave: (e: PointerEvent) => { if (e.pointerType === "mouse") later(false, 120); },
  } : {};
  return (
    <>
      <button ref={button} type="button" className="ai-cite" aria-label={`Source ${n}`} aria-describedby={reference ? id : undefined}
        onClick={e => (onSelect ? onSelect(n) : showSource(e.currentTarget, n))} onFocus={() => reference && now(true)} onBlur={() => now(false)}
        onKeyDown={e => { if (e.key === "Escape" && open) { e.stopPropagation(); now(false); } }} {...hover}>{n}</button>
      {reference ? (
        <div ref={card} id={id} popover="manual" role="tooltip" className="ai-cite-card" {...hover}>
          <span className="ai-kind" data-kind={reference.kind}><Icon name={KIND_ICON[reference.kind]} size={14} /></span>
          <span className="ai-cite-text">
            <span className="ai-source-title">{reference.title}</span>
            <span className="ai-meta">{meta(reference)}</span>
            <span className="ai-excerpt">{reference.text}</span>
          </span>
        </div>
      ) : null}
    </>
  );
}

/**
 * An answer's text: the bottom line in bold, then its claims as a tight list, each with its citation chips. Claims
 * that arrive later (streaming) fade in. `onCite` replaces the default citation click (open the Sources at it).
 * `marks`: the words the model chose to colour, when it sent them (`partsOf`); else the word lists colour.
 * `children` follow the claims (Sources, Suggestions).
 */
export function Response({ bottomLine, claims, references = [], onCite, marks, children }: { bottomLine?: string; claims: Claim[]; references?: Reference[]; onCite?: (n: number) => void; marks?: Mark[]; children?: ReactNode }) {
  const byN = new Map(references.map(r => [r.n, r]));
  return (
    <div className="ai-response">
      {bottomLine ? <p className="ai-bottom-line"><Marked text={bottomLine} marks={marks} /></p> : null}
      {claims.length ? (
        <ul className="ai-claims">
          {claims.map((c, i) => (
            <li key={i}><Marked text={c.text} marks={marks} /><span className="ai-cites">{c.cites.map(n => <InlineCitation key={n} n={n} reference={byN.get(n)} onSelect={onCite} />)}</span></li>
          ))}
        </ul>
      ) : null}
      {children}
    </div>
  );
}

/**
 * The sources behind an answer, folded into one row ("Used 7 sources" with a badge per kind) that opens to the list:
 * number, title (linked out when it has a URL, e.g. PubMed), from · year · design, two lines of it. An image source
 * shows `image(reference)` in its thumbnail slot (the film), or a placeholder. Each row is `[data-source="n"]`. With
 * `onSelect` the title opens the source in place (e.g. an Artifact panel, which carries the outward link) instead.
 */
export function Sources({ references, defaultOpen = false, image, label, onSelect }: { references: Reference[]; defaultOpen?: boolean; image?: (reference: Reference) => ReactNode; label?: string; onSelect?: (n: number) => void }) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  if (!references.length) return null;
  return (
    <div className="ai-sources">
      <button type="button" className="ai-sources-head" data-sources-toggle="" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        <span className="ai-kinds">
          {sourceKinds(references).map(kind => <span key={kind} className="ai-kind" data-kind={kind} title={KIND_LABEL[kind]}><Icon name={KIND_ICON[kind]} size={12} /></span>)}
        </span>
        <span>{label ?? `Used ${plural(references.length, "source")}`}</span>
        <span className="ai-chevron"><Icon name="chevron-down" size={14} /></span>
      </button>
      <ol id={id} className="ai-source-list" hidden={!open}>
        {references.map(r => (
          <li key={r.n} className="ai-source" data-source={r.n} tabIndex={-1}>
            <span className="ai-source-n"><span className="visually-hidden">Source </span>{r.n}</span>
            <span className="ai-source-text">
              {onSelect ? (
                <button type="button" className="ai-source-title" onClick={() => onSelect(r.n)}>{r.title}</button>
              ) : r.url ? (
                <a className="ai-source-title" href={r.url} target="_blank" rel="noreferrer">{r.title}<Icon name="external" size={12} /><span className="visually-hidden"> (opens in a new tab)</span></a>
              ) : <span className="ai-source-title">{r.title}</span>}
              <span className="ai-meta">{meta(r)}</span>
              <span className="ai-excerpt">{r.text}</span>
            </span>
            {r.kind === "image" ? <span className="ai-source-thumb">{image?.(r) ?? <Icon name="image" size={20} />}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
