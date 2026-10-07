import { Children, type ReactNode, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icon";
import "@/styles/ai.css";

const NEAR = 48; // px from the bottom that still counts as "at the newest turn"
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A thread that scrolls by itself: it follows the newest turn as it grows, stops following when the reader scrolls up
 * (a "Jump to latest" pill appears), and follows again on a new turn. Give it a height (flex: 1, min-height: 0, or a
 * max-height); it is a `role="log"`, so screen readers hear new turns.
 */
export function Conversation({ label = "Sona's answers", className, children }: { label?: string; className?: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [away, setAway] = useState(false);
  const turns = Children.count(children);

  const toLatest = (smooth: boolean) => {
    const el = scroller.current;
    following.current = true;
    setAway(false);
    el?.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduced() ? "smooth" : "auto" });
  };

  // An answer that grows (streamed claims, a film loading) keeps the bottom in view while the reader is there.
  useEffect(() => {
    const el = scroller.current!;
    const follow = new ResizeObserver(() => { if (following.current) el.scrollTop = el.scrollHeight; });
    follow.observe(content.current!);
    return () => follow.disconnect();
  }, []);
  // A new question always brings the thread back to the newest turn.
  useEffect(() => { toLatest(false); }, [turns]);

  const onScroll = () => {
    const el = scroller.current!;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
    setAway(!following.current);
  };

  return (
    <div className={`ai-conversation${className ? ` ${className}` : ""}`}>
      <div ref={scroller} className="ai-conversation-scroll" onScroll={onScroll}>
        <div ref={content} className="ai-conversation-content" role="log" aria-label={label}>{children}</div>
      </div>
      {away ? (
        <button type="button" className="ai-latest" onClick={() => toLatest(true)}>
          <Icon name="chevron-down" size={14} />Jump to latest
        </button>
      ) : null}
    </div>
  );
}

/** Sona's mark beside an answer: a small blue disc with the sparkle. Decorative. */
export function SonaMark() {
  return <span className="ai-mark" aria-hidden="true"><Icon name="sparkle" size={12} /></span>;
}

/**
 * One question and its answer. The question is a compact bubble on the right; Sona's answer sits on the left with no
 * bubble, under Sona's mark and a quiet caption (`by`: the model's name, or "rules"). The answer column carries
 * `data-ai-answer`, which inline citations use to find the turn's Sources.
 */
export function Turn({ question, by, children }: { question: ReactNode; by?: string; children?: ReactNode }) {
  return (
    <article className="ai-turn">
      <h3 className="ai-question"><span className="visually-hidden">You asked: </span>{question}</h3>
      <div className="ai-answer" data-ai-answer="">
        <p className="ai-answer-head"><SonaMark />Sona{by ? <span className="ai-by"> · {by}</span> : null}</p>
        <div className="ai-answer-body">{children}</div>
      </div>
    </article>
  );
}

/** Text with a light sweeping across it while `active`; plain text at rest and under Reduce Motion. */
export function Shimmer({ active = true, children }: { active?: boolean; children: ReactNode }) {
  return <span className="ai-shimmer" data-active={active || undefined}>{children}</span>;
}

const NOTICE = {
  thinking: "Sona is thinking",
  error: "That didn't go through. Check your connection and try again.",
  empty: "The sources don't answer this directly. Try asking it another way, or start from one of these.",
};

/**
 * A turn's state when there is no answer to show: `thinking` (a shimmering line), `error` (a plain line, with a retry
 * in `action`) or `empty` (a helpful line, with Suggestions in `action`). `children` replaces the default line.
 */
export function Notice({ kind, children, action }: { kind: "thinking" | "error" | "empty"; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ai-notice" data-kind={kind} role={kind === "error" ? "alert" : "status"}>
      {kind === "thinking" ? <p><Shimmer>{children ?? NOTICE.thinking}</Shimmer></p> : (
        <p>{kind === "error" ? <Icon name="alert" size={16} /> : <Icon name="info" size={16} />}<span>{children ?? NOTICE[kind]}</span></p>
      )}
      {action ? <div className="ai-notice-action">{action}</div> : null}
    </div>
  );
}

/**
 * Follow-up questions as a row of chips that scrolls sideways; tapping one asks it. Nothing when there are none.
 * A mouse has no sideways wheel, so the row also scrolls with the ordinary wheel while it can, shows arrows at an edge
 * that hides chips, and fades that edge.
 */
export function Suggestions({ items, onPick, label = "Ask next" }: { items: string[]; onPick: (question: string) => void; label?: string }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    // A vertical wheel moves the row while it has room that way; at its end the page scrolls as usual.
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const room = e.deltaY > 0 ? el.scrollWidth - el.clientWidth - el.scrollLeft : el.scrollLeft;
      if (room <= 1) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { seen.disconnect(); el.removeEventListener("scroll", measure); el.removeEventListener("wheel", wheel); };
  }, [items]);
  if (!items.length) return null;
  const page = (by: 1 | -1) => row.current?.scrollBy({ left: by * row.current.clientWidth * 0.8, behavior: reduced() ? "auto" : "smooth" });
  return (
    <div className="ai-suggestions-wrap" data-left={edges.left || undefined} data-right={edges.right || undefined}>
      <div ref={row} className="ai-suggestions" role="group" aria-label={label}>
        {items.map(q => (
          <button key={q} type="button" className="ai-suggestion" onClick={() => onPick(q)}>
            <span>{q}</span><Icon name="arrow-up-right" size={14} />
          </button>
        ))}
      </div>
      {edges.left && <button type="button" className="ai-suggestions-arrow" data-side="left" aria-label="Earlier suggestions" tabIndex={-1} onClick={() => page(-1)}><Icon name="chevron-left" size={16} /></button>}
      {edges.right && <button type="button" className="ai-suggestions-arrow" data-side="right" aria-label="More suggestions" tabIndex={-1} onClick={() => page(1)}><Icon name="chevron-right" size={16} /></button>}
    </div>
  );
}
