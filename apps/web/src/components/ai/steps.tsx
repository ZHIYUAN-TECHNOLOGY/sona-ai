import { Fragment, type ReactNode, useId, useState } from "react";

import { Icon } from "@/components/icon";

import { Shimmer } from "./conversation";
import { type Phase, stepsLine, stepsSummary } from "./summary";
import "@/styles/ai.css";

/**
 * How an answer is being made, on one line: "Searching the library · Reading 7 sources · Writing", the current step
 * shimmering. When `phase` reaches "done" it folds into "Read 7 sources in 4 s" (`seconds`, or the time it watched).
 * With `children` (what was searched or read) the line is a button that shows them; open while working, closed when done.
 */
export function Steps({ phase, sources, seconds, children }: { phase: Phase; sources?: number; seconds?: number; children?: ReactNode }) {
  const id = useId();
  const done = phase === "done";
  const [started] = useState(() => performance.now());
  const [took, setTook] = useState<number>();
  const [open, setOpen] = useState(!done);
  const [seen, setSeen] = useState(phase);
  if (seen !== phase) {
    setSeen(phase);
    if (done) { setOpen(false); setTook((performance.now() - started) / 1000); }
  }

  const line = done ? stepsSummary(sources, seconds ?? took) : stepsLine(phase, sources).map((step, i) => (
    <Fragment key={step.phase}>
      {i ? <span className="ai-steps-sep" aria-hidden="true">·</span> : null}
      <span className="ai-step" data-state={step.state}>{step.state === "current" ? <Shimmer>{step.label}</Shimmer> : step.label}</span>
    </Fragment>
  ));
  const head = (
    <>
      <Icon name={done ? "check" : "sparkle"} size={14} />
      <span className="ai-steps-line">{line}</span>
      {children ? <span className="ai-chevron"><Icon name="chevron-down" size={14} /></span> : null}
    </>
  );
  return (
    <div className="ai-steps" data-phase={phase}>
      {children ? (
        <button type="button" className="ai-steps-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>{head}</button>
      ) : <p className="ai-steps-head">{head}</p>}
      {children ? <div id={id} className="ai-steps-body" hidden={!open}>{children}</div> : null}
    </div>
  );
}
