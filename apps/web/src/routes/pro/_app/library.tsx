import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { type Column, DataTable, TableToolbar } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card, Field, SearchField, Select, StatCard, StatRow, Tabs } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { messageOf, toBase64 } from "@/features/library/files";
import { client, orpc } from "@/lib/orpc";
import "@/styles/pages/library.css";

export const Route = createFileRoute("/pro/_app/library")({ component: Page });

type Doc = Awaited<ReturnType<typeof client.library.list>>[number];
type Preview = Awaited<ReturnType<typeof client.library.previewArticle>>;
const KIND = { text: "Text", pdf: "PDF", pubmed: "Article" } as const;

type Scope = "all" | "hospital" | "me";
const who = (d: Doc) => (d.scope === "hospital" ? "Whole hospital" : "Only you");

const columns: Column<Doc>[] = [
  { key: "title", header: "Source", cell: d => (
    <div className="lib-title">
      <span className="lib-file" aria-hidden><Icon name={d.kind === "pubmed" ? "book" : "file"} size={18} /></span>
      <div><strong>{d.title}</strong><div className="lib-note">{d.source} · {KIND[d.kind]} · {d.sections} sections</div></div>
    </div>
  ), sort: (a, b) => a.title.localeCompare(b.title) },
  { key: "by", header: "Added by", cell: d => <>{d.uploadedBy ?? "Sona"}<div className="lib-note">{who(d)}</div></> },
  { key: "year", header: "Year", cell: d => <span className="lib-num">{d.year}</span>, sort: (a, b) => a.year - b.year, align: "right" },
];

function Page() {
  const { me } = Route.useRouteContext();
  const mayAdd = can(me.role, "library.add");
  const mayRemove = can(me.role, "library.remove");
  const list = useQuery(orpc.library.list.queryOptions());
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.library.list.key() });
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState<string>();
  const [tab, setTab] = useState<Scope>("all");
  const [openId, setOpenId] = useState<string>();
  const remove = useMutation(orpc.library.remove.mutationOptions({ onSuccess: () => { setConfirming(undefined); return refresh(); } }));

  const docs = list.data ?? [];
  const q = search.trim().toLowerCase();
  const inTab = tab === "all" ? docs : docs.filter(d => d.scope === tab);
  const rows = q ? inTab.filter(d => `${d.title} ${d.source} ${d.year} ${KIND[d.kind]} ${d.uploadedBy ?? ""}`.toLowerCase().includes(q)) : inTab;
  const open = docs.find(d => d.id === openId);
  const shared = docs.filter(d => d.scope === "hospital").length;
  const oldest = docs.reduce<Doc | undefined>((o, d) => (!o || d.year < o.year ? d : o), undefined);

  return (
    <>
      <PageHeader title="Library" lead={list.data ? `${docs.length} source${docs.length === 1 ? "" : "s"} Sona answers from · ${shared} shared with the whole hospital` : "The sources Sona answers from."} />
      {docs.length > 0 && (
        <StatRow>
          <StatCard title="Sources" value={docs.length} caption="Sona answers from these" feature />
          <StatCard title="Whole hospital" value={shared} unit={`of ${docs.length}`} progress={shared / docs.length} />
          <StatCard title="Only you" value={docs.length - shared} caption="Private to your account" />
          {oldest && (new Date().getFullYear() - oldest.year >= 5
            ? <StatCard title="Oldest source" value={oldest.year} caption={oldest.title} chip="Check it is current" tone="soon" />
            : <StatCard title="Oldest source" value={oldest.year} caption={oldest.title} />)}
        </StatRow>
      )}
      <WithRail rail={
        <RightRail label="Source detail and adding">
          {open && (
            <Card title="Selected source">
              <strong>{open.title}</strong>
              <dl className="lib-detail">
                <dt>Published by</dt><dd>{open.source}</dd>
                <dt>Kind</dt><dd>{KIND[open.kind]}</dd>
                <dt>Year</dt><dd>{open.year}</dd>
                <dt>Sections</dt><dd>{open.sections}</dd>
                <dt>Added by</dt><dd>{open.uploadedBy ?? "Sona"}</dd>
                <dt>Who can use it</dt><dd>{who(open)}</dd>
              </dl>
            </Card>
          )}
          <Card title="Add a source">
            {mayAdd ? <AddSource onAdded={refresh} /> : <p className="lib-note">Your role cannot add to the library. Ask a doctor or management.</p>}
          </Card>
        </RightRail>
      }>
        <Card>
          {list.isError ? <EmptyState icon="alert" title="The library could not be shown">{messageOf(list.error)}</EmptyState> : (
            <DataTable columns={columns} rows={rows} rowKey={d => d.id} loading={list.isPending}
              selectedKey={openId} onRowOpen={d => setOpenId(d.id)}
              count={`Showing ${rows.length} of ${docs.length}`}
              toolbar={
                <TableToolbar end={<SearchField label="Search the library" placeholder="Search title, kind, year or who added it" value={search} onChange={e => setSearch(e.target.value)} />}>
                  <Tabs label="Who can use the source" value={tab} onChange={setTab} tabs={[
                    { id: "all", label: "All", count: docs.length },
                    { id: "hospital", label: "Whole hospital", count: shared },
                    { id: "me", label: "Only you", count: docs.length - shared },
                  ]} />
                </TableToolbar>
              }
              empty={<EmptyState icon="book" title={q ? `Nothing matches "${search}"` : "No sources here yet"}>{q ? "Try a title, a year or a name." : "Add the first one on the right."}</EmptyState>}
              rowAction={mayRemove ? d => confirming === d.id ? (
                <span className="lib-row">
                  <Button variant="danger" size="sm" pending={remove.isPending} onClick={e => { e.stopPropagation(); remove.mutate({ documentId: d.id }); }}>Remove for good</Button>
                  <Button size="sm" onClick={e => { e.stopPropagation(); setConfirming(undefined); }}>Keep</Button>
                  {remove.isError && <span className="lib-error" role="alert">{messageOf(remove.error)}</span>}
                </span>
              ) : <Button size="sm" onClick={e => { e.stopPropagation(); remove.reset(); setConfirming(d.id); }}>Remove</Button> : undefined} />
          )}
        </Card>
      </WithRail>
    </>
  );
}

function AddSource({ onAdded }: { onAdded: () => unknown }) {
  const [mode, setMode] = useState<"text" | "pdf" | "article">("text");
  const [scope, setScope] = useState<"me" | "hospital">("hospital");
  // One ID per source, kept across retries so a retry replaces rather than duplicates.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<Preview>();
  const [done, setDone] = useState<string>();
  const add = useMutation({
    mutationFn: async (form: FormData) => {
      const title = String(form.get("title") ?? "");
      if (mode === "text") return client.library.add({ requestId, scope, title, source: String(form.get("source")), year: Number(form.get("year")), text: String(form.get("text")) });
      if (mode === "pdf") return client.library.addPdf({ requestId, scope, title, dataBase64: await toBase64(form.get("file") as File) });
      if (!preview) { setPreview(await client.library.previewArticle({ ref: String(form.get("ref")) })); return undefined; }
      return client.library.importArticle({ requestId, scope, pmid: preview.pmid });
    },
    onSuccess: saved => {
      if (!saved) return;
      setDone(`Added "${saved.title}" (${saved.sections} sections).`);
      setPreview(undefined);
      setRequestId(crypto.randomUUID());
      return onAdded();
    },
  });
  const pick = (m: typeof mode) => { setMode(m); setPreview(undefined); setDone(undefined); add.reset(); };

  return (
    <form className="lib-form" key={requestId + mode} onSubmit={e => { e.preventDefault(); setDone(undefined); add.mutate(new FormData(e.currentTarget)); }}>
      <div className="lib-modes" role="group" aria-label="How to add">
        {(["text", "pdf", "article"] as const).map(m => <Button key={m} size="sm" variant={mode === m ? "primary" : "quiet"} aria-pressed={mode === m} onClick={() => pick(m)}>{m === "text" ? "Paste text" : m === "pdf" ? "PDF file" : "Article"}</Button>)}
      </div>
      {mode !== "article" && <Field label="Title">{c => <input {...c} name="title" required maxLength={200} />}</Field>}
      {mode === "text" && <>
        <Field label="Source" hint="Who published it">{c => <input {...c} name="source" required maxLength={200} />}</Field>
        <Field label="Year">{c => <input {...c} name="year" type="number" min={1900} max={2100} required defaultValue={new Date().getFullYear()} />}</Field>
        <Field label="Text" hint="No patient details: Sona checks and refuses them.">{c => <textarea {...c} name="text" required maxLength={200000} />}</Field>
      </>}
      {mode === "pdf" && <Field label="PDF file" hint="Up to about 10 MB.">{c => <input {...c} name="file" type="file" accept="application/pdf" required />}</Field>}
      {mode === "article" && <Field label="Article reference" hint="A PubMed ID, link or DOI. You see it before it is added.">{c => <input {...c} name="ref" required maxLength={500} readOnly={Boolean(preview)} />}</Field>}
      {preview && (
        <div>
          <strong>{preview.title}</strong>
          <div className="lib-note">{preview.journal} · {preview.year} · {preview.sections} sections · <a href={preview.url} target="_blank" rel="noreferrer">Open on PubMed</a></div>
        </div>
      )}
      <Select label="Who can use it" value={scope} onChange={e => setScope(e.target.value as typeof scope)}>
          <option value="hospital">Whole hospital</option>
          <option value="me">Only me</option>
      </Select>
      <div className="lib-row">
        <Button type="submit" variant="primary" pending={add.isPending}>{mode !== "article" ? "Add to library" : preview ? "Confirm and add" : "Preview article"}</Button>
        {preview && <Button onClick={() => setPreview(undefined)}>Choose another</Button>}
      </div>
      {add.isError && <p className="lib-error" role="alert">{messageOf(add.error)}</p>}
      {done && <p className="lib-note" role="status">{done}</p>}
    </form>
  );
}
