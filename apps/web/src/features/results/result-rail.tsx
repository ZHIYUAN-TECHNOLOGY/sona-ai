import { LineChart } from "@/components/charts";
import { Button, Card, Chip } from "@/components/primitives";
import { RightRail } from "@/components/rail";

import { isNormal, seriesFor } from "./triage";
import type { ResultRow } from "./types";

export const when = (d: Date | string) =>
  new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const valueOf = (r: ResultRow) => (r.unit ? `${r.value} ${r.unit}` : r.value);

export function FlagChip({ row }: { row: ResultRow }) {
  if (row.critical) return <Chip tone="urgent">{row.flag}</Chip>;
  if (!row.flag) return <Chip>Not flagged</Chip>;
  return isNormal(row.flag) ? <Chip tone="done">{row.flag}</Chip> : <Chip tone="soon">{row.flag}</Chip>;
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

export function ResultRail({ row, rows, allowed, pending, error, onAcknowledge }: Props) {
  const series = seriesFor(rows, row);
  return (
    <RightRail label="Selected result">
      <Card title={row.patientName}>
        <dl className="results-values">
          <dt>Test</dt><dd>{row.test}</dd>
          <dt>Value</dt><dd className="results-value" data-critical={row.critical || undefined}>{valueOf(row)}</dd>
          <dt>Flag</dt><dd><FlagChip row={row} /></dd>
          <dt>Received</dt><dd>{when(row.receivedAt)}</dd>
        </dl>
        {series.length > 1 ? <LineChart points={series} label={`${row.test} for ${row.patientName}`} unit={row.unit ?? undefined} height={160} /> : null}
      </Card>
      <Card title={row.critical ? "Why this is urgent" : "Why this is flagged this way"}>
        <p>{row.why ?? derived(row)}</p>
        {row.why ? null : <p className="results-note">Derived from the flag. No call-now rule gave a reason for this result.</p>}
      </Card>
      <Card title="Your decision">
        {row.acknowledgedAt ? (
          <p><Chip tone="done">Acknowledged</Chip> {row.acknowledgedByName ?? "A doctor"}, {when(row.acknowledgedAt)}</p>
        ) : allowed ? (
          <>
            <Button variant={row.critical ? "danger" : "primary"} pending={pending} onClick={() => onAcknowledge(row)}>
              {isNormal(row.flag) ? "Acknowledge normal" : "Acknowledge"}
            </Button>
            <p className="results-note">Records you as the doctor who saw this result.</p>
          </>
        ) : (
          <p className="results-note">Only a doctor can acknowledge a result. Tell the doctor on call{row.critical ? " now" : ""}.</p>
        )}
        {error ? <p className="results-error" role="alert">Not acknowledged: {error}</p> : null}
      </Card>
    </RightRail>
  );
}
