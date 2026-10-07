// Dev only: every shared component with Demo, Worst case, Empty, One and 1,000 rows props (`?data=`).
// Loaded by routes/pro/_app/dev-gallery.tsx behind import.meta.env.DEV; not in the nav.
import { useLocation } from "@tanstack/react-router";
import { useState } from "react";

import { BarChart, BarList, LineChart, SegmentBar, Sparkline } from "@/components/charts";
import { type Column, DataTable, PersonCell, RowAction, TableToolbar, TextCell, ValueCell } from "@/components/data-table";
import { InsightCard } from "@/components/insight-card";
import { EmptyState, PageHeader, PatientStrip } from "@/components/page";
import { Avatar, Button, Card, Chip, DetailList, ListCard, ListRow, Pager, Select, Skeleton, StatCard, StatRow, Status, Tabs } from "@/components/primitives";

import { rows } from "./worst-case/fixture";

type Mode = "demo" | "worst" | "empty" | "one" | "huge";
const LONG = "Christopher Alexander Montgomery III bin Abdullah Zainal Abidin Wiśniewska-Kowalczyk Ólafsson";
const EMAIL = "bartholomew.fitzgerald@northwind-industries-holdings.example.com";
const NAMES = ["Aleksandra Wiśniewska-Kowalczyk", "Jo", "Đặng Thị Ngọc Hân", "王秀英", "🦊 Fox", "Christopher Alexander Montgomery III", "Siti Nur Aisyah binti Mohd Khairuddin", ""];
type Person = { id: string; name: string; email: string; ward: string; potassium: number; note: string };

const people = (mode: Mode): Person[] => {
  if (mode === "empty") return [];
  if (mode === "demo") return [{ id: "1", name: "Amelia Tan", email: "amelia@example.com", ward: "4B-12", potassium: 4.1, note: "Stable" }, { id: "2", name: "Lim Wei Jie", email: "wj@example.com", ward: "4B-3", potassium: 5.2, note: "Repeat at 4 pm" }];
  const n = mode === "one" ? 1 : mode === "huge" ? 1000 : NAMES.length;
  return rows(n, i => ({
    id: String(i), name: NAMES[i % NAMES.length]!, email: i % 3 === 0 ? EMAIL : "a@b.co", ward: i % 2 ? "4B-12" : "Cardiothoracic ICU, Bed 12A (isolation)",
    potassium: [6.8, 1284, 0, -3.5, 0.30000000000000004][i % 5]!, note: "Potassium 6.8 mmol/L at 06:00, repeat sent; on spironolactone and ramipril, both held since Tuesday pending renal review",
  }));
};

export default function Gallery() {
  const raw = useLocation({ select: l => new URLSearchParams(l.searchStr).get("data") });
  const mode: Mode = raw === "worst" || raw === "empty" || raw === "one" || raw === "huge" ? raw : "demo";
  const demo = mode === "demo", worst = mode === "worst" || mode === "huge";
  const list = people(mode);
  const count = { demo: 12, worst: 1284, empty: 0, one: 1, huge: 1000 }[mode];
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const points = mode === "empty" ? [] : mode === "one" ? [{ x: "Mon", y: 4.1 }] : mode === "huge" ? rows(1000, i => ({ x: `D${i + 1}`, y: 3.5 + Math.sin(i / 9) * 2 })) : demo ? rows(7, i => ({ x: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]!, y: 4 + (i % 3) * 0.4 })) : rows(9, i => ({ x: "Wed 30 Sep", y: i % 2 ? 12345 : 12345 }));
  const columns: Column<Person>[] = [
    { key: "name", header: "Patient", cell: p => <PersonCell name={p.name} detail={p.email} />, sort: (a, b) => a.name.localeCompare(b.name) },
    { key: "ward", header: "Bed", cell: p => <TextCell>{p.ward}</TextCell> },
    { key: "k", header: "Potassium", align: "right", cell: p => <ValueCell value={p.potassium} unit="mmol/L" /> },
    { key: "note", header: "Note", cell: p => <TextCell>{p.note}</TextCell> },
  ];
  const title = demo ? "Amelia Tan" : mode === "one" ? "Jo" : LONG;
  return (
    <>
      <PageHeader title={title} lead={demo ? "3 visits today" : "Benachrichtigungseinstellungen für Stationsübergaben, Entlassungsplanung und Medikamentenabgleich"}
        breadcrumb={[{ label: "Patients", to: "/pro/patients" }, { label: title }]} status={worst ? "Updated 12 days ago" : "Now"} actions={<Button variant="primary">{worst ? "Paramètres de confidentialité et de sécurité" : "Open"}</Button>} />
      <PatientStrip name={title} meta={worst ? `MRN 9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f · ${EMAIL}` : "F · 54 · 4B-12"}
        tabs={<Tabs label="Sections" value={tab} onChange={setTab} tabs={[{ id: "all", label: "All", count }, { id: "results", label: worst ? "Laboratory results awaiting acknowledgement" : "Results", count: worst ? 1000000 : 1 }]} />}
        chips={<><Chip tone="red">{worst ? "Critical potassium, not acknowledged" : "Critical"}</Chip><Chip tone="amber">Allergy</Chip></>} />
      <StatRow>
        <StatCard title={worst ? "Unacknowledged critical laboratory results" : "Results"} value={count} caption={worst ? "Across 14 wards and 3 day-care units since Monday morning" : "Today"} chip={worst ? "Needs review now" : undefined} tone="red" action={{ label: "Open", to: "/pro/results" }} />
        <StatCard title="Bed occupancy" value={mode === "empty" ? "None" : worst ? 12345678.9 : 0.94} unit="%" progress={worst ? 1.42 : mode === "empty" ? 0 : 0.94} />
        <StatCard title="Average stay" value={worst ? "Not recorded yet" : "3.1"} unit={worst ? "days per admission" : "days"} feature />
        <StatCard title="Open tasks" value={count} onSelect={() => undefined} selected />
      </StatRow>
      <InsightCard lead={worst ? `${LONG} has a potassium of 6.8 mmol/L, up from 5.2 yesterday, while still on spironolactone; ${EMAIL} asked for a call back.` : "Potassium is high for one patient."}
        evidence={mode === "empty" ? [] : rows(mode === "one" ? 1 : worst ? 6 : 2, i => ({ icon: "flask" as const, text: i ? `Result ${i}: https://example.com/workspaces/ukm/patients/9f8e7d6c5b4a/results?tab=chemistry&filter=unacknowledged` : "K 6.8 mmol/L at 06:00" }))}
        next={{ label: worst ? "Hold spironolactone and repeat potassium" : "Hold dose", step: worst ? "Repeat the potassium within 4 hours and review the ECG before the evening ward round" : "Repeat at 4 pm", onAct: () => undefined }} sources={count} />
      <Card title={worst ? "Patients waiting on a decision from the admitting consultant" : "Patients"} action={{ label: "See all", to: "/pro/patients" }}>
        <DataTable columns={columns} rows={list.slice(0, mode === "huge" ? 1000 : 20)} rowKey={p => p.id} selectedKey="0" onRowOpen={() => undefined} rowAction={() => <RowAction onClick={() => undefined}>{worst ? "Acknowledge result" : "Open"}</RowAction>}
          toolbar={<TableToolbar end={<Select label="Ward"><option>{worst ? "Cardiothoracic and Vascular Surgery ICU" : "All wards"}</option></Select>}>{worst ? "Showing patients admitted under any consultant" : "All"}</TableToolbar>}
          empty="No patients are waiting on you" count={`${list.length} patients`} footer={<Pager page={page} pageSize={20} total={list.length} onPage={setPage} noun={["patient", "patients"]} />} />
      </Card>
      <ListCard title="Messages" action={{ label: "Open inbox", to: "/pro/messages" }}>
        {list.slice(0, 8).map(p => <ListRow key={p.id} avatar={p.name} title={p.name || p.email} caption={p.note} trailing={worst ? <Chip tone="amber">Invitation expired 12 days ago</Chip> : undefined} onClick={() => undefined} />)}
        {list.length === 0 ? <EmptyState icon="inbox" title="No messages">{worst ? "" : "Nothing is waiting"}</EmptyState> : null}
      </ListCard>
      <Card title="Details">
        <DetailList items={[{ label: "Email", value: demo ? "amelia@example.com" : EMAIL }, { label: worst ? "Next of kin (emergency contact, relationship)" : "Next of kin", value: worst ? "Nur Hidayah binti Abdul Rahman (daughter) · +60 12-345 6789" : "—" }, { label: "Status", value: <Status tone="soon">{worst ? "Waiting for guarantee letter from insurer" : "Waiting"}</Status> }]} />
      </Card>
      <Card title="Avatars and loading">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{NAMES.map(n => <Avatar key={n} name={n} />)}<Avatar name="J" size="sm" /><Avatar name={LONG} size="lg" /><Skeleton width={120} /><Skeleton width={40} height={40} round /></div>
      </Card>
      <EmptyState icon="inbox" title={worst ? "Nobody on the Cardiothoracic and Vascular Surgery ward is waiting on a decision from you right now" : "Nothing needs you"} action={<Button>{worst ? "Paramètres de confidentialité" : "Refresh"}</Button>}>
        {worst ? "When a result comes back, a patient writes in, or a nurse flags a blocker, it lands here first, ranked by what needs you soonest." : "Nothing is waiting."}
      </EmptyState>
      <Card title="Charts">
        <LineChart label="Potassium" unit="mmol/L" points={points} goal={{ value: 5 }} band={{ low: 3.5, high: 5 }} />
        <BarChart label="Admissions" points={points.slice(0, mode === "huge" ? 1000 : 12)} showValues={!worst || mode === "worst"} />
        <Sparkline label="Trend" values={points.map(p => p.y)} />
        <SegmentBar label="Beds" segments={mode === "empty" ? [] : [{ label: worst ? "Blocked, waiting for transport or guarantee letter" : "Blocked", value: count, tone: "amber" }, { label: "Free", value: mode === "one" ? 0 : 3, tone: "green" }, { label: "Occupied", value: worst ? 1000000 : 9, tone: "blue" }]} />
        <BarList label="Delays" unit="days" rows={mode === "empty" ? [] : rows(mode === "one" ? 1 : 4, i => ({ label: worst ? "Waiting for guarantee letter from Great Eastern Takaful Berhad" : `Ward ${i}`, value: [1284, 1, 0, 12][i]! }))} />
      </Card>
    </>
  );
}
