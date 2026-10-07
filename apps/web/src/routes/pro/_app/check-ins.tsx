import { can } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DataTable, PersonCell, RowAction, TableToolbar, type Column } from "@/components/data-table";
import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Chip, SearchField, StatCard, StatRow, Tabs } from "@/components/primitives";
import { revealRail, WithRail } from "@/components/rail";
import { CheckInRail } from "@/features/check-ins/check-in-rail";
import { dischargedOn, LABEL, toRows, type Row, type Tab } from "@/features/check-ins/rows";
import { countOf, formatNumber } from "@/lib/format";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/check-ins.css";

export const Route = createFileRoute("/pro/_app/check-ins")({ component: Page });

const STATE = { action: "Needs action", waiting: "Waiting for reply", done: "Done" } as const;

function Page() {
  const { me } = Route.useRouteContext();
  const allowed = can(me.role, "checkIns.list");
  const list = useQuery(orpc.checkIns.list.queryOptions({ input: {}, enabled: allowed, staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: true }));
  // The check-in list carries patient IDs only; names come from the patient list, fetched alongside.
  const patients = useQuery(orpc.patients.list.queryOptions({ enabled: allowed }));
  const [tab, setTab] = useState<Tab>("action");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();

  const rows = useMemo(() => toRows(list.data ?? [], new Map(patients.data?.map(p => [p.id, p.name]))), [list.data, patients.data]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => r.state === tab && (!q || `${r.patientName} ${r.reply?.text ?? ""}`.toLowerCase().includes(q)));
  }, [rows, tab, query]);
  const selected = shown.find(r => r.id === selectedId) ?? shown[0];

  if (!allowed) return <><PageHeader title="Check-ins" /><EmptyState icon="alert" title="Check-ins are not open to your role">Ask a doctor or nurse on the care team.</EmptyState></>;
  if (list.isError) {
    return (
      <>
        <PageHeader title="Check-ins" />
        <EmptyState title="Check-ins could not be shown" icon="alert" action={<Button onClick={() => list.refetch()}>Try again</Button>}>{list.error.message}</EmptyState>
      </>
    );
  }
  if (list.isSuccess && !rows.length) return <><PageHeader title="Check-ins" /><EmptyState>No check-ins yet. They start when a patient is discharged.</EmptyState></>;

  const open = (r: Row) => r.state === "action";
  const red = rows.filter(r => open(r) && r.reply?.label === "urgent");
  const worse = rows.filter(r => open(r) && r.reply?.label === "worse");
  const waiting = rows.filter(r => r.state === "waiting");
  const fine = rows.filter(r => r.state === "done" && r.reply?.label === "fine");
  // Below 1080px the rail sits under the table: a chosen row brings it into view.
  const choose = (id: string) => { setSelectedId(id); revealRail("check-in-rail"); };
  const pick = (r: Row) => { setQuery(""); setTab(r.state); choose(r.id); };
  const pickTab = (t: Tab) => { setTab(t); setSelectedId(undefined); };

  const columns: Column<Row>[] = [
    { key: "patient", header: "Patient", cell: r => <PersonCell name={r.patientName} detail={`Discharged ${dischargedOn(r).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`} /> },
    { key: "day", header: "Check-in", cell: r => `Day ${r.day}` },
    { key: "reply", header: "Reply", cell: r => r.reply ? <span className="cell-clamp" title={r.reply.text}>{r.reply.text}</span> : <span className="check-ins-muted">No reply yet</span> },
    { key: "class", header: "Sona read it as", cell: r => r.reply ? <Chip tone={LABEL[r.reply.label].tone}>{LABEL[r.reply.label].text}</Chip> : null },
  ];

  return (
    <>
      <PageHeader
        title="Check-ins"
        subtitle={list.isPending ? "Loading check-ins…" : red.length + worse.length
          ? `${countOf(red.length + worse.length, "reply", "replies")} need${red.length + worse.length === 1 ? "s" : ""} the care team · ${formatNumber(waiting.length)} waiting for a reply`
          : "No reply is waiting for the care team"}
      />
      <StatRow>
        <StatCard title="Need a clinician now" value={red.length} tone={red.length ? "urgent" : "neutral"} chip={red.length ? "Red flag" : undefined} feature />
        <StatCard title="Worse" value={worse.length} tone={worse.length ? "soon" : "neutral"} />
        <StatCard title="Sent, no reply yet" value={waiting.length} />
        <StatCard title="Answered and fine" value={fine.length} tone="done" />
      </StatRow>
      <InsightRow>
        {red[0] ? (
          <InsightCard tone="urgent" label="Sona insight" lead={`${countOf(red.length, "red-flag reply", "red-flag replies")}. ${red[0].patientName} was told to call 999 if this is an emergency.`}
            next={{ label: "Open", step: `Call back or book in ${red[0].patientName}`, onAct: () => pick(red[0]!) }} />
        ) : null}
        {worse[0] ? (
          <InsightCard tone="soon" label="Sona insight" lead={`${formatNumber(worse.length)} of ${countOf(rows.length, "check-in")} came back worse.`}
            next={{ label: "Review", step: `Start with ${worse[0].patientName}, day ${worse[0].day}`, onAct: () => pick(worse[0]!) }} />
        ) : null}
        {waiting[0] ? (
          <InsightCard tone="info" label="Sona insight" lead={`${countOf(waiting.length, "check-in")} sent with no reply yet. Sona asks again once.`}
            next={{ label: "See", step: `Longest wait: ${waiting.at(-1)!.patientName}`, onAct: () => pick(waiting.at(-1)!) }} />
        ) : null}
      </InsightRow>
      <WithRail rail={selected ? <CheckInRail key={selected.id} row={selected} role={me.role} /> : null}>
        <DataTable
          columns={columns} rows={shown} rowKey={r => r.id} selectedKey={selected?.id} loading={list.isPending}
          onRowOpen={r => choose(r.id)}
          rowAction={r => <RowAction onClick={() => choose(r.id)}>{r.state === "action" ? "Review" : "Open"}</RowAction>}
          toolbar={(
            <TableToolbar end={<SearchField label="Search check-ins" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} />}>
              <Tabs
                label="Check-ins by state" value={tab} onChange={pickTab}
                tabs={(["action", "waiting", "done"] as const).map(id => ({ id, label: STATE[id], count: rows.filter(r => r.state === id).length }))}
              />
            </TableToolbar>
          )}
          empty={query ? "No check-in matches this search." : tab === "action" ? "No reply needs the care team." : tab === "waiting" ? "Every check-in sent has a reply." : "No check-in is done yet."}
        />
      </WithRail>
    </>
  );
}
