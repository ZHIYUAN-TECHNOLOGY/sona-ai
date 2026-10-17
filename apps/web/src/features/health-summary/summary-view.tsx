import { InsightCard } from "@/components/insight-card";
import { Card, Chip, ListCard, ListRow, Signal } from "@/components/primitives";
import { countOf } from "@/lib/format";
import type { orpc } from "@/lib/orpc";
import "@/styles/pages/health-summary.css";

/** The server's health summary (routers/health-summary): the same object its PDF renders, so the page and the file agree. */
export type HealthSummary = Awaited<ReturnType<typeof orpc.patients.summaryData.call>>;

/** "10 Oct 2026": the day in Malaysia, as the PDF writes it. */
const day = (at: Date | string) => new Date(at).toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", year: "numeric" });
const flagged = (flag: string | null) => Boolean(flag && flag !== "normal");
/** A word in Sona Care's answer colours (components/marked.tsx), picked by the field it sits in, not by the words. */
const ink = (on: boolean | undefined, mark: "medicine" | "dose" | "warning", text: string) => on ? <span className="care-mark" data-mark={mark}>{text}</span> : text;

/**
 * A health summary on screen, in the PDF's order. Insight first: the key problems with the allergy (red), the medicines
 * and the next visit (blue) as one card; then the record as cards and lists. A section with nothing in it is left out.
 * The page's own header carries the download, so the card suggests no second action. With `marks` (Sona Care) each
 * field takes its colour from its type: a medicine's name blue, its dose and times violet, warning signs red.
 */
export function HealthSummaryView({ s, marks }: { s: HealthSummary; marks?: boolean }) {
  const current = s.medicines.filter(m => m.change !== "stopped"), stopped = s.medicines.length - current.length, next = s.followUps[0];
  return (
    <div className="hs">
      <InsightCard band label="Health summary" meta={`Generated ${day(s.generatedAt)}`} title={s.problems}
        lead={s.discharge ? `Went home on ${day(s.discharge.at)}.` : "In hospital now."}
        evidence={[
          { icon: "alert", text: s.allergies ? <Signal tone="urgent">Allergy: {s.allergies}</Signal> : "No allergy recorded" },
          { icon: "pill", text: current.length ? `${countOf(current.length, "current medicine")}${stopped ? `, ${stopped} stopped` : ""}` : "No medicines recorded" },
          { icon: "calendar", text: next ? <Signal tone="info">Next visit: {next.title}, {day(next.date)}</Signal> : "No visit booked" },
        ]} />
      <Card title="Problems and history">
        <dl className="hs-history">
          <div><dt>Came in with</dt><dd>{s.complaint || "Not recorded."}</dd></div>
          <div><dt>Medical history</dt><dd>{s.history.join(", ") || "None recorded."}</dd></div>
          {s.family ? <div><dt>Family history</dt><dd>{s.family}</dd></div> : null}
          {s.social ? <div><dt>Social history</dt><dd>{s.social}</dd></div> : null}
        </dl>
      </Card>
      <div className="hs-pair">
        {s.medicines.length ? (
          <ListCard title="Medicines">
            {s.medicines.map((m, i) => <ListRow key={`${i}${m.name}`} wrap icon="pill" title={ink(marks && m.change !== "stopped", "medicine", m.name)}
              caption={m.detail ? ink(marks && m.change !== "stopped", "dose", m.detail) : undefined}
              trailing={m.change === "unchanged" ? undefined : <Chip tone={m.change === "stopped" ? "soon" : "info"}>{m.change}</Chip>} />)}
          </ListCard>
        ) : null}
        {s.results.length ? (
          <ListCard title="Recent results">
            {s.results.map((r, i) => <ListRow key={`${i}${r.test}`} wrap icon="flask" title={r.test} caption={`${[r.value, r.unit].filter(Boolean).join(" ")} · ${day(r.at)}`}
              trailing={flagged(r.flag) ? <Chip tone={r.flag === "pending" ? "soon" : "urgent"}>{r.flag}</Chip> : undefined} />)}
          </ListCard>
        ) : null}
        {s.observations.length ? (
          <ListCard title="Latest observations">
            {s.observations.map((o, i) => <ListRow key={`${i}${o.label}`} wrap icon="activity" title={o.label} caption={o.at ? day(o.at) : undefined} />)}
          </ListCard>
        ) : null}
        {s.discharge || s.followUps.length ? (
          <ListCard title={s.discharge ? "Discharge and follow-up" : "Follow-up"}>
            {s.followUps.map((f, i) => <ListRow key={`v${i}`} wrap icon="calendar" title={f.title} caption={day(f.date)} />)}
            {s.discharge?.warningSigns.map((w, i) => <ListRow key={`w${i}`} wrap icon="alert" title={ink(marks, "warning", w)} caption={i ? undefined : "Come back straight away if"} />)}
          </ListCard>
        ) : null}
      </div>
      {s.visitSummary ? (
        <Card title={`Latest visit summary, ${day(s.visitSummary.at)}`}>
          <p className="hs-text">{s.visitSummary.text}</p>
          {s.visitSummary.whatChanged.length ? <ul className="hs-list">{s.visitSummary.whatChanged.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
        </Card>
      ) : null}
      {s.visits.length ? (
        <Card title="Recent record">
          <ol className="hs-timeline">{s.visits.map((v, i) => <li key={i}><time>{day(v.at)}</time><span>{v.title}{v.detail ? <small>{v.detail}</small> : null}</span></li>)}</ol>
        </Card>
      ) : null}
      {s.careTeam.length ? (
        <ListCard title="Care team">{s.careTeam.map(d => <ListRow key={d.name} icon="users" title={d.name} caption={`${d.specialty} · ${d.room}`} />)}</ListCard>
      ) : null}
    </div>
  );
}
