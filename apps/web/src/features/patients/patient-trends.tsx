import { useQuery } from "@tanstack/react-query";

import { LineChart } from "@/components/charts";
import { Card, ListCard, ListRow } from "@/components/primitives";
import { FlagChip, valueOf, when } from "@/features/results/result-rail";
import { byTriage } from "@/features/results/triage";
import { formatNumber } from "@/lib/format";
import { orpc } from "@/lib/orpc";

import { allSeries, chartPoints, latestOf, type Series } from "./trends";

// The stat row, the main chart and the lab charts read the same query; TanStack Query sends it once. Only mounted for clinical-read roles.
export const useTrends = (patientId: string, enabled = true) => useQuery({ ...orpc.patients.trends.queryOptions({ input: { patientId } }), select: allSeries, enabled });

const valueWithUnit = (s: Series) => `${formatNumber(latestOf(s).value)}${s.unit ? ` ${s.unit}` : ""}`;

/** One chart per lab test with at least two values; a single value is shown as a value. */
export function LabCharts({ patientId }: { patientId: string }) {
  const { data, isPending, error } = useTrends(patientId);
  const labs = data?.filter((s) => s.lab) ?? [];
  return (
    <Card title="12-month labs">
      {isPending ? (
        <p className="pt-muted">Loading…</p>
      ) : error ? (
        <p className="pt-muted">Could not be loaded: {error.message}</p>
      ) : !labs.length ? (
        <p className="pt-muted">No lab values with a number in the last 12 months.</p>
      ) : (
        <div className="pt-labs">
          {labs.map((s) => (
            <section key={`${s.name}${s.unit}`}>
              <h3>{s.name}</h3>
              {s.points.length > 1 ? (
                <LineChart points={chartPoints(s)} label={`${s.name} over the last 12 months`} unit={s.unit ?? undefined} height={160} />
              ) : (
                <p>
                  <strong>{valueWithUnit(s)}</strong> <span className="pt-muted">· one value, {when(latestOf(s).at)}</span>
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

/** The patient's own results, most urgent first, as a way into the results page. `limit` keeps the overview column short. */
export function PatientResults({ patientId, limit }: { patientId: string; limit?: number }) {
  const { data, isPending, error } = useQuery(orpc.results.list.queryOptions({ input: { patientId } }));
  const rows = data ? [...data].sort(byTriage) : [];
  return (
    <ListCard title="Results" action={{ to: "/pro/results", label: rows.length > (limit ?? rows.length) ? `All ${rows.length} results` : "Open results" }}>
      {isPending ? (
        <p className="pt-muted po-note">Loading…</p>
      ) : error ? (
        <p className="pt-muted po-note">Could not be loaded: {error.message}</p>
      ) : !rows.length ? (
        <p className="pt-muted po-note">No results on record.</p>
      ) : (
        rows.slice(0, limit).map((r) => (
          <ListRow
            key={r.id}
            icon="flask"
            title={<>{r.test} <span className="pt-muted">{valueOf(r)}</span></>}
            caption={`${when(r.receivedAt)} · ${r.acknowledgedAt ? "Acknowledged" : "Waiting for a doctor"}`}
            trailing={<FlagChip row={r} />}
          />
        ))
      )}
    </ListCard>
  );
}
