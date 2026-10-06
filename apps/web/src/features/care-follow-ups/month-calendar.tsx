import { useState } from "react";

import { Button } from "@/components/primitives";

import { monthWords, weekdayWords, type Lang } from "./dates";

export type Mark = { label: string; tone: "done" | "soon" | "neutral" };

const pad = (n: number) => String(n).padStart(2, "0");

/** A month of visits, Monday first. `today` and the marks are keyed by Malaysian day ("2026-10-06"). */
export function MonthCalendar({ today, marks, lang }: { today: string; marks: Map<string, Mark[]>; lang: Lang }) {
  const [shift, setShift] = useState(0);
  const first = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + shift, 1));
  const year = first.getUTCFullYear(), month = first.getUTCMonth();
  const blanks = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const title = monthWords(year, month, lang);

  return (
    <section className="card fu-cal" aria-label={`Calendar, ${title}`}>
      <header className="fu-cal-head">
        <Button aria-label="Previous month" onClick={() => setShift(s => s - 1)}>‹</Button>
        <h2 className="fu-cal-title" aria-live="polite">{title}</h2>
        <Button aria-label="Next month" onClick={() => setShift(s => s + 1)}>›</Button>
      </header>
      <ol className="fu-cal-grid">
        {weekdayWords(lang).map(w => <li key={w} className="fu-cal-weekday" aria-hidden="true">{w}</li>)}
        {Array.from({ length: blanks }, (_, i) => <li key={`b${i}`} aria-hidden="true" />)}
        {Array.from({ length: days }, (_, i) => {
          const key = `${year}-${pad(month + 1)}-${pad(i + 1)}`, on = marks.get(key);
          return (
            <li key={key} className="fu-cal-day" data-today={key === today || undefined} data-tone={on?.[0]?.tone}
              aria-current={key === today ? "date" : undefined} title={on?.map(m => m.label).join("\n")}>
              <span>{i + 1}</span>
              {key === today ? <span className="sr-only"> today</span> : null}
              {on ? <span className="fu-cal-dot" aria-hidden="true" /> : null}
              {on ? <span className="sr-only">: {on.map(m => m.label).join(", ")}</span> : null}
            </li>
          );
        })}
      </ol>
      {shift ? <Button onClick={() => setShift(0)}>Back to this month</Button> : null}
    </section>
  );
}
