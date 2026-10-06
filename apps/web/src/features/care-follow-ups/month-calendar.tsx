import { useState } from "react";

import { Button, IconButton } from "@/components/primitives";

import { monthWords, weekdayWords, type Lang } from "./dates";

export type Mark = { label: string; tone: "done" | "soon" | "neutral" };

const pad = (n: number) => String(n).padStart(2, "0");
const LEGEND: [Mark["tone"], string][] = [["done", "Visit"], ["soon", "Waiting for the hospital"], ["neutral", "Past visit"]];

/** A month of visits, Monday first. `today` and the marks are keyed by Malaysian day ("2026-10-06"). */
export function MonthCalendar({ today, marks, open, lang }: { today: string; marks: Map<string, Mark[]>; open: Map<string, string[]>; lang: Lang }) {
  const [shift, setShift] = useState(0);
  const [picked, setPicked] = useState(today);
  const first = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + shift, 1));
  const year = first.getUTCFullYear(), month = first.getUTCMonth();
  const blanks = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const title = monthWords(year, month, lang);
  const pickedWords = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${picked}T00:00:00Z`));
  const onPicked = marks.get(picked), openPicked = open.get(picked);

  return (
    <section className="card fu-cal" aria-label={`Calendar, ${title}`}>
      <div>
      <header className="fu-cal-head">
        <h2 className="card-title" aria-live="polite">{title}</h2>
        <div className="fu-side">
          <IconButton icon="chevron-left" label="Previous month" onClick={() => setShift(s => s - 1)} />
          <IconButton icon="chevron-right" label="Next month" onClick={() => setShift(s => s + 1)} />
        </div>
      </header>
      <ol className="fu-cal-grid">
        {weekdayWords(lang).map(w => <li key={w} className="fu-cal-weekday" aria-hidden="true">{w}</li>)}
        {Array.from({ length: blanks }, (_, i) => <li key={`b${i}`} aria-hidden="true" />)}
        {Array.from({ length: days }, (_, i) => {
          const key = `${year}-${pad(month + 1)}-${pad(i + 1)}`, on = marks.get(key);
          return (
            <li key={key}>
              <button type="button" className="fu-cal-day" data-today={key === today || undefined}
                aria-current={key === today ? "date" : undefined} aria-pressed={key === picked} onClick={() => setPicked(key)}>
                <span>{i + 1}</span>
                {key === today ? <span className="sr-only"> today</span> : null}
                {on ? <span className="fu-cal-dot" data-tone={on[0]?.tone} aria-hidden="true" /> : null}
                {on ? <span className="sr-only">: {on.map(m => m.label).join(", ")}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
      <ul className="fu-legend" aria-label="Legend">
        {LEGEND.map(([tone, label]) => <li key={tone}><span className="fu-cal-dot" data-tone={tone} aria-hidden="true" />{label}</li>)}
      </ul>
      {shift ? <Button onClick={() => { setShift(0); setPicked(today); }}>Back to this month</Button> : null}
      </div>
      <div className="fu-cal-picked" aria-live="polite">
        <h3 className="fu-step">{pickedWords}</h3>
        {onPicked ? onPicked.map(m => <span key={m.label}>{m.label}</span>) : <span className="fu-muted">No visits on this day.</span>}
        {openPicked ? (
          <>
            <strong>Open times</strong>
            {openPicked.map(line => <span key={line}>{line}</span>)}
            <span className="fu-muted">Use "Book a visit" to ask for one.</span>
          </>
        ) : <span className="fu-muted">No open times on this day.</span>}
      </div>
    </section>
  );
}
