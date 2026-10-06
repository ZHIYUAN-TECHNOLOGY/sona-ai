import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { DataTable, type Column } from "@/components/data-table";
import { InsightCard, InsightRow } from "@/components/insight-card";
import { PageHeader } from "@/components/page";
import { Button, Chip, Field } from "@/components/primitives";
import { filterTasks, isOverdue, Loaded, today, type TaskFilter } from "@/features/ward/state";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/ward.css";

export const Route = createFileRoute("/pro/_app/tasks")({ component: Page });

const FILTERS: TaskFilter[] = ["mine", "all", "overdue"];

function Page() {
  const { me } = Route.useRouteContext();
  const mayComplete = can(me.role, "tasks.complete"), mayCreate = can(me.role, "tasks.create"), mayUpdate = can(me.role, "tasks.update");
  const queryClient = useQueryClient();
  const list = useQuery(orpc.tasks.list.queryOptions());
  const refresh = { onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.tasks.list.key() }) };
  const complete = useMutation(orpc.tasks.complete.mutationOptions(refresh));
  const update = useMutation(orpc.tasks.update.mutationOptions(refresh));
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const create = useMutation(orpc.tasks.create.mutationOptions({
    onSuccess: () => { setRequestId(crypto.randomUUID()); return refresh.onSuccess(); },
  }));

  type Task = NonNullable<typeof list.data>[number];
  const on = today();
  const all = list.data ?? [];
  const open = all.filter(t => !t.completed), overdue = all.filter(t => isOverdue(t, on));
  const mine = open.filter(t => t.owner === me.name);
  // A task belongs to a visit; the visits this hospital already has tasks on are the ones a new task can join.
  const visits = [...new Set(all.flatMap(t => t.encounterId ?? []))];
  const shown = { ...list, data: list.data && filterTasks(list.data, filter, me.name, on) };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    const due = String(f.get("due") ?? "");
    create.mutate({ encounterId: String(f.get("encounterId")), title: String(f.get("title")), owner: String(f.get("owner")), ...(due ? { due } : {}), requestId }, { onSuccess: () => form.reset() });
  };

  const columns: Column<Task>[] = [
    { key: "task", header: "Task", cell: t => t.title, sort: (a, b) => a.title.localeCompare(b.title) },
    { key: "visit", header: "Visit", cell: t => t.encounterId ?? <span className="ward-muted">Ward</span> },
    {
      key: "owner", header: "Owner", sort: (a, b) => a.owner.localeCompare(b.owner),
      // Uncontrolled and keyed on the saved value: commits on blur, and redraws when the server answers.
      cell: t => mayUpdate && !t.completed ? (
        <input key={t.owner} className="ward-control" aria-label={`Owner of ${t.title}`} defaultValue={t.owner} maxLength={80}
          onBlur={e => { const owner = e.target.value.trim(); if (owner && owner !== t.owner) update.mutate({ taskId: t.id, owner }); }} />
      ) : t.owner,
    },
    {
      key: "due", header: "Due", sort: (a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"),
      cell: t => mayUpdate && !t.completed ? (
        <input key={t.due} type="date" className="ward-control" aria-label={`Due date of ${t.title}`} defaultValue={t.due ?? ""}
          onBlur={e => { const due = e.target.value || null; if (due !== t.due) update.mutate({ taskId: t.id, due }); }} />
      ) : t.due ?? "–",
    },
    { key: "state", header: "State", cell: t => t.completed ? <Chip tone="done">Done</Chip> : isOverdue(t, on) ? <Chip tone="soon">Overdue</Chip> : <Chip>Open</Chip> },
  ];

  return (
    <>
      <PageHeader title="Tasks" lead={mayComplete ? undefined : "Your role can see tasks but cannot complete or change them."} />
      {list.data && (
        <InsightRow>
          <InsightCard tone={overdue.length ? "soon" : "done"} sources={overdue.length} lead={overdue.length ? `${overdue.length} task${overdue.length === 1 ? " is" : "s are"} overdue` : "Nothing is overdue"}
            next={overdue.length ? { label: "Show overdue", onAct: () => setFilter("overdue") } : undefined} />
          <InsightCard tone="info" sources={mine.length} lead={`${mine.length} open task${mine.length === 1 ? " is" : "s are"} yours, of ${open.length} open`}
            next={mine.length ? { label: "Show mine", onAct: () => setFilter("mine") } : undefined} />
        </InsightRow>
      )}
      {mayCreate && (visits.length > 0 ? (
        <form className="ward-form" onSubmit={submit}>
          <Field label="Task">{c => <input {...c} name="title" className="ward-control" required maxLength={200} />}</Field>
          <Field label="Visit">{c => <select {...c} name="encounterId" className="ward-control" required>{visits.map(v => <option key={v}>{v}</option>)}</select>}</Field>
          <Field label="Owner">{c => <input {...c} name="owner" className="ward-control" required maxLength={80} defaultValue={me.name} />}</Field>
          <Field label="Due">{c => <input {...c} name="due" type="date" className="ward-control" />}</Field>
          <Button type="submit" variant="primary" pending={create.isPending}>Add task</Button>
        </form>
      ) : list.data && <p className="ward-muted">A task is added to a visit, and no visit has tasks yet. Add the first one from the patient's page.</p>)}
      {(create.error ?? complete.error ?? update.error) && <p className="ward-error" role="alert">That did not save: {(create.error ?? complete.error ?? update.error)!.message}</p>}
      <div className="ward-filters" role="group" aria-label="Filter tasks">
        {FILTERS.map(f => <Button key={f} variant={f === filter ? "primary" : "quiet"} aria-pressed={f === filter} onClick={() => setFilter(f)}>{f[0]!.toUpperCase() + f.slice(1)}</Button>)}
      </div>
      <Loaded query={shown} what="tasks" empty={filter === "all" ? "No tasks yet." : `No ${filter === "mine" ? "tasks of yours" : "overdue tasks"}.`}>
        {rows => (
          <DataTable columns={columns} rows={rows} rowKey={t => t.id}
            rowAction={t => mayComplete && !t.completed ? <Button pending={complete.isPending && complete.variables?.taskId === t.id} onClick={() => complete.mutate({ taskId: t.id })}>Complete</Button> : null} />
        )}
      </Loaded>
    </>
  );
}
