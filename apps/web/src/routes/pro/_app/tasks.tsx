import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { TableToolbar, TextCell, DataTable, PersonCell, type Column } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Chip, Field, SearchField, StatCard, StatRow, Tabs } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { dueLabel, groupTasks, matchesTask, sourceOf, type TaskTab } from "@/features/tasks/state";
import { isOverdue, today } from "@/features/ward/state";
import { orpc } from "@/lib/orpc";
import "@/styles/pages/tasks.css";

export const Route = createFileRoute("/pro/_app/tasks")({ component: Page });

const EMPTY: Record<TaskTab, string> = {
  open: "No open tasks. The ward is caught up.", mine: "No open task is yours.", overdue: "Nothing is overdue.",
  done: "No task has been marked done yet.", all: "No tasks yet.",
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Page() {
  const { me } = Route.useRouteContext();
  const mayComplete = can(me.role, "tasks.complete"), mayCreate = can(me.role, "tasks.create"), mayUpdate = can(me.role, "tasks.update");
  const queryClient = useQueryClient();
  const list = useQuery(orpc.tasks.list.queryOptions());
  const refresh = { onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.tasks.list.key() }) };
  // A task marked done stays in the tab it was in, settled, until the tab changes.
  const [settled, setSettled] = useState<string[]>([]);
  const complete = useMutation(orpc.tasks.complete.mutationOptions({
    onSuccess: (_, { taskId }) => { setSettled(ids => [...ids, taskId]); return refresh.onSuccess(); },
  }));
  const update = useMutation(orpc.tasks.update.mutationOptions(refresh));
  const [tab, setTab] = useState<TaskTab>("open");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string>();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const create = useMutation(orpc.tasks.create.mutationOptions({
    onSuccess: () => { setRequestId(crypto.randomUUID()); return refresh.onSuccess(); },
  }));

  type Task = NonNullable<typeof list.data>[number];
  const on = today();
  const all = list.data ?? [];
  const groups = groupTasks(all, me.name, on);
  // A task belongs to a visit; the visits this hospital already has tasks on are the ones a new task can join.
  const visits = [...new Set(all.flatMap(t => t.encounterId ?? []))];
  const q = search.trim().toLowerCase();
  const inTab = new Set(groups[tab].map(t => t.id));
  const rows = all.filter(t => (inTab.has(t.id) || settled.includes(t.id)) && matchesTask(t, q));
  const task = rows.find(t => t.id === picked) ?? rows[0];
  const error = create.error ?? complete.error ?? update.error;
  const pick = (next: TaskTab) => { setTab(next); setSettled([]); };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    const due = String(f.get("due") ?? "");
    create.mutate({ encounterId: String(f.get("encounterId")), title: String(f.get("title")), owner: String(f.get("owner")), ...(due ? { due } : {}), requestId }, { onSuccess: () => form.reset() });
  };
  const markDone = (t: Task) => mayComplete && !t.completed
    ? <Button size="sm" icon="check" pending={complete.isPending && complete.variables?.taskId === t.id} onClick={() => complete.mutate({ taskId: t.id })}>Mark done</Button>
    : null;

  const columns: Column<Task>[] = [
    {
      key: "task", header: "Task", sort: (a, b) => a.title.localeCompare(b.title),
      cell: t => <span className="tasks-title" data-done={t.completed || undefined}><strong><TextCell>{t.title}</TextCell></strong><span className="tasks-muted">{t.encounterId ? `Visit ${t.encounterId}` : "Ward task"}</span></span>,
    },
    { key: "source", header: "Source", cell: t => { const s = sourceOf(t.kind); return <span className="tasks-source"><Icon name={s.icon} size={16} />{s.label}</span>; } },
    { key: "owner", header: "Assignee", sort: (a, b) => a.owner.localeCompare(b.owner), cell: t => <span className="tasks-owner">{t.owner}</span> },
    {
      key: "due", header: "Due", align: "right", sort: (a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"),
      cell: t => t.completed ? <span className="tasks-due"><Chip tone="done" icon="check">Done</Chip></span>
        : isOverdue(t, on) ? <span className="tasks-due" data-overdue>{dueLabel(t.due, on)}<Chip tone="urgent">Overdue</Chip></span>
        : <span className="tasks-due">{dueLabel(t.due, on)}</span>,
    },
  ];

  return (
    <>
      <PageHeader title="Tasks"
        lead={list.data ? `${plural(groups.open.length, "open task")} · ${groups.dueToday.length} due today · ${groups.overdue.length} overdue` : undefined}
        status={mayComplete ? undefined : "Your role can see tasks but cannot complete or change them."} />
      {list.data && (
        <StatRow>
          <StatCard title="Open" value={groups.open.length} unit="tasks" caption={`${groups.mine.length} of them yours`} feature />
          <StatCard title="Due today" value={groups.dueToday.length} caption={groups.dueToday.length ? "Finish these before handover" : "Nothing is due today"} />
          <StatCard title="Overdue" value={groups.overdue.length} caption={groups.overdue.length ? "Past their due date" : "Nothing is overdue"}
            chip={groups.overdue.length ? "Needs action" : undefined} tone="urgent" />
          <StatCard title="Done" value={groups.done.length} unit={`of ${all.length}`} caption="Marked done by the care team" />
        </StatRow>
      )}
      <WithRail rail={(
        <RightRail label="Task detail and new task">
          {task && (
            <Card title="Task detail">
              <strong className="tasks-detail-title" title={task.title}>{task.title}</strong>
              <dl className="tasks-detail">
                <dt>Why</dt><dd>{sourceOf(task.kind).label}</dd>
                <dt>Visit</dt><dd>{task.encounterId ?? "Ward task, no visit"}</dd>
                <dt>State</dt><dd>{task.completed ? "Done" : isOverdue(task, on) ? "Overdue" : "Open"}</dd>
              </dl>
              <div className="tasks-actions">
                {markDone(task)}
                {task.encounterId && <Link className="tasks-link" to="/pro/visit" search={{ encounterId: task.encounterId }}>Open the patient's visit</Link>}
              </div>
              {/* Uncontrolled and keyed on the saved value: commits on blur, and redraws when the server answers. */}
              {mayUpdate && !task.completed ? (
                <div className="tasks-form">
                  <Field label="Assignee">{c => <input {...c} key={task.id + task.owner} defaultValue={task.owner} maxLength={80}
                    onBlur={e => { const owner = e.target.value.trim(); if (owner && owner !== task.owner) update.mutate({ taskId: task.id, owner }); }} />}</Field>
                  <Field label="Due">{c => <input {...c} key={task.id + task.due} type="date" defaultValue={task.due ?? ""}
                    onBlur={e => { const due = e.target.value || null; if (due !== task.due) update.mutate({ taskId: task.id, due }); }} />}</Field>
                </div>
              ) : <PersonCell name={task.owner} detail={task.completed ? "Completed" : `Due: ${dueLabel(task.due, on)}`} size="sm" />}
            </Card>
          )}
          {mayCreate && list.data && (
            <Card title="Add a task">
              {visits.length > 0 ? (
                <form className="tasks-form" onSubmit={submit}>
                  <Field label="Task">{c => <input {...c} name="title" required maxLength={200} />}</Field>
                  <Field label="Visit">{c => <select {...c} name="encounterId" required>{visits.map(v => <option key={v}>{v}</option>)}</select>}</Field>
                  <Field label="Assignee">{c => <input {...c} name="owner" required maxLength={80} defaultValue={me.name} />}</Field>
                  <Field label="Due">{c => <input {...c} name="due" type="date" />}</Field>
                  <Button type="submit" variant="primary" icon="plus" pending={create.isPending}>Add task</Button>
                </form>
              ) : <p className="tasks-muted">A task is added to a visit, and no visit has tasks yet. Add the first one from the patient's page.</p>}
            </Card>
          )}
          {error && <p className="tasks-error" role="alert">That did not save: {error.message}</p>}
        </RightRail>
      )}>
        {list.error ? (
          <Card><EmptyState icon="alert" title="Tasks could not load">{list.error.message}</EmptyState></Card>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={t => t.id} loading={list.isPending} selectedKey={task?.id} onRowOpen={t => setPicked(t.id)}
            empty={<EmptyState icon="check" title={q ? `No task matches "${search}".` : EMPTY[tab]} />}
            count={list.data ? `Showing ${rows.length} of ${all.length} tasks` : undefined}
            toolbar={(
              <TableToolbar end={<SearchField label="Search tasks" placeholder="Search tasks" value={search} onChange={e => setSearch(e.target.value)} />}>
                <Tabs label="Tasks by state" value={tab} onChange={pick} tabs={[
                  { id: "open", label: "Open", count: groups.open.length }, { id: "mine", label: "Mine", count: groups.mine.length },
                  { id: "overdue", label: "Overdue", count: groups.overdue.length }, { id: "done", label: "Done", count: groups.done.length },
                  { id: "all", label: "All", count: all.length },
                ]} />
              </TableToolbar>
            )}
            rowAction={markDone} />
        )}
      </WithRail>
    </>
  );
}
