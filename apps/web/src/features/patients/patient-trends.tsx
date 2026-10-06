import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { LineChart } from "@/components/charts";
import { Card, Chip } from "@/components/primitives";
import { FlagChip, valueOf, when } from "@/features/results/result-rail";
import { byTriage, isFlagged } from "@/features/results/triage";
import { orpc } from "@/lib/orpc";

import { allSeries, chartPoints, direction, latestOf, type Series, topSeries } from "./trends";

// Both trend blocks read the same query; TanStack Query sends it once. Only mounted for clinical-read roles.
const useTrends = (patientId: string) => useQuery({ ...orpc.patients.trends.queryOptions({ input: { patientId } }), select: allSeries });

const valueWithUnit = (s: Series) => `${latestOf(s).value}${s.unit ? ` ${s.unit}` : ""}`;

/** Up to three cards for the series that matter most. Renders nothing while loading or when there is nothing to chart. */
export function TrendCards({ patientId }: { patientId: string }) {
  const { data } = useTrends(patientId);
  const top = data ? topSeries(data) : [];
  if (!top.length) return null;
  return (
    <section className="pt-trends" aria-label="Trends">
      {top.map((s) => {
        const flag = s.lab ? latestOf(s).flag : null;
        return (
          <Card key={`${s.lab}${s.name}${s.unit}`} title={s.name}>
            <p className="pt-trend-value">
              <strong>{valueWithUnit(s)}</strong> {isFlagged(flag) ? <Chip tone={flag?.startsWith("critical") ? "urgent" : "soon"}>{flag}</Chip> : null}
            </p>
            <p className="pt-muted">
              {direction(s)} · {when(latestOf(s).at)}
            </p>
            {s.points.length > 1 ? <LineChart points={chartPoints(s)} label={`${s.name} over the last 12 months`} unit={s.unit ?? undefined} height={120} /> : null}
          </Card>
        );
      })}
    </section>
  );
}

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

const SHOWN = 5;

/** The patient's own results, most urgent first, as a way into the results page. */
export function PatientResults({ patientId }: { patientId: string }) {
  const { data, isPending, error } = useQuery(orpc.results.list.queryOptions({ input: { patientId } }));
  const rows = data ? [...data].sort(byTriage) : [];
  return (
    <Card title="Results">
      {isPending ? (
        <p className="pt-muted">Loading…</p>
      ) : error ? (
        <p className="pt-muted">Could not be loaded: {error.message}</p>
      ) : !rows.length ? (
        <p className="pt-muted">No results on record.</p>
      ) : (
        <>
          <ul className="pt-list">
            {rows.slice(0, SHOWN).map((r) => (
              <li key={r.id}>
                {r.test}: {valueOf(r)} <FlagChip row={r} />
                <small>
                  {when(r.receivedAt)} · {r.acknowledgedAt ? "Acknowledged" : "Waiting for a doctor"}
                </small>
              </li>
            ))}
          </ul>
          <Link to="/pro/results" className="pt-more">
            {rows.length > SHOWN ? `All ${rows.length} results` : "Open results"}
          </Link>
        </>
      )}
    </Card>
  );
}
