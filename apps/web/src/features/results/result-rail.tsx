import { Avatar } from "@/components/avatar";
import { LineChart } from "@/components/charts";
import { InsightCard } from "@/components/insight-card";
import { Button, Card, Chip } from "@/components/primitives";
import { RightRail } from "@/components/rail";
import { isFlagged, isNormal, seriesFor } from "./triage";
import type { ResultRow } from "./types";

export const when = (d: Date | string) =>
  new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const valueOf = (r: ResultRow) => (r.unit ? `${r.value} ${r.unit}` : r.value);

/** Abnormal is the only flag that earns a chip; calm states are plain text. */
export function FlagCell({ row }: { row: ResultRow }) {
  if (isFlagged(row.flag)) return <Chip tone={row.critical ? "urgent" : "soon"}>{row.flag}</Chip>;
  return <span className={row.flag ? undefined : "results-muted"}>{row.flag ?? "Not flagged"}</span>;
}

/** The name the patient page's trends import. */
export const FlagChip = FlagCell;

/** Suggested from the lab's flag and the call-now rules; the clinician decides. */
export function PriorityCell({ row }: { row: ResultRow }) {
  if (row.critical) return <Chip tone="red" variant="solid">Critical</Chip>;
  if (isFlagged(row.flag)) return <Chip tone="soon">Review</Chip>;
  return <span className="results-muted">Routine</span>;
}

/** Used only when the row carries no `why`: the flag is then the only reasoning there is, so this line restates it and nothing more. */
function derived(r: ResultRow) {
  if (r.critical) return `Flagged "${r.flag}" when it arrived. A doctor must see it now.`;
  if (r.flag) return `Flagged "${r.flag}" when it arrived.`;
  return "This result arrived without a flag. Nobody has judged it yet.";
}

type Props = {
  row: ResultRow;
  rows: ResultRow[];
  /** False when the signed-in role cannot acknowledge. */
  allowed: boolean;
  pending: boolean;
  error?: string;
  onAcknowledge: (row: ResultRow) => void;
};

/** Why a result is flagged, what it rests on, and Acknowledge: the decision on a result. `band` lays it across a page. */
export function ResultInsight({ row, rows, allowed, pending, onAcknowledge, band }: Omit<Props, "error"> & { band?: boolean }) {
  const series = seriesFor(rows, row);
  const earlier = series.length > 1 ? series[series.length - 2] : undefined;
  const unit = row.unit ? ` ${row.unit}` : "";
  const evidence = [
    { icon: "flask" as const, text: `${row.patientName} · ${row.test} ${valueOf(row)}, ${row.why ? `flagged ${row.flag}` : row.flag ? `flagged ${row.flag} by the lab` : "no flag from the lab"}` },
    ...(earlier ? [{ icon: "activity" as const, text: `${series.length} values on record; the one before was ${earlier.y}${unit} on ${earlier.x}` }] : []),
    ...(row.acknowledgedAt
      ? [{ icon: "check" as const, text: `Acknowledged by ${row.acknowledgedByName ?? "a doctor"}, ${when(row.acknowledgedAt)}` }]
      : allowed ? [] : [{ icon: "user" as const, text: `Only a doctor can acknowledge. Tell the doctor on call${row.critical ? " now" : ""}.` }]),
  ];
  return (
    <InsightCard
      band={band}
      label="Why this is flagged"
      tone={row.critical ? "urgent" : isFlagged(row.flag) ? "soon" : "info"}
      title={row.critical ? "Must not be missed" : isFlagged(row.flag) ? "Needs review" : isNormal(row.flag) ? "Routine" : "Not judged yet"}
      lead={row.why ?? derived(row)}
      meta={!row.why ? "From the lab flag" : row.critical ? "Call-now rule" : "Usual adult range"}
      evidence={evidence}
      sources={evidence.length}
      next={!row.acknowledgedAt && allowed && !pending
        ? { label: isNormal(row.flag) ? "Acknowledge normal" : "Acknowledge", step: "Records you as the doctor who saw this result.", onAct: () => onAcknowledge(row) }
        : undefined}
    />
  );
}

export function ResultRail({ row, rows, allowed, pending, error, onAcknowledge }: Props) {
  const series = seriesFor(rows, row);
  return (
    <RightRail label="Selected result" id="result-rail">
      <ResultInsight row={row} rows={rows} allowed={allowed} pending={pending} onAcknowledge={onAcknowledge} />
      <Card>
        <div className="results-detail-head">
          <Avatar name={row.patientName} />
          <div>
            <h2 className="results-detail-title">{row.patientName} · {row.test}</h2>
            <p className="results-muted">
              <span className="results-value" data-critical={row.critical || undefined}>{valueOf(row)}</span> · received {when(row.receivedAt)}
            </p>
            <div className="results-detail-chip"><PriorityCell row={row} /></div>
          </div>
        </div>
        {series.length > 1
          ? <LineChart points={series} label={`${row.test} for ${row.patientName}`} unit={row.unit ?? undefined} height={160} />
          : <p className="results-muted">No earlier {row.test} value for this patient, so there is no trend to show.</p>}
        <div className="results-detail-actions">
          <Button icon="arrow-right" to="/pro/patients/$patientId" params={{ patientId: row.patientId }}>Open patient</Button>
          {pending ? <span className="results-muted" role="status">Acknowledging…</span> : null}
        </div>
        {error ? <p className="results-error" role="alert">Not acknowledged: {error}</p> : null}
      </Card>
    </RightRail>
  );
}
