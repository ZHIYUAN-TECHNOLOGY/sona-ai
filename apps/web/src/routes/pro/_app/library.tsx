import { can } from "@sona-ai/api/roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { type Column, DataTable } from "@/components/data-table";
import { InsightCard, InsightRow } from "@/components/insight-card";
import { EmptyState, PageHeader } from "@/components/page";
import { Button, Chip, Field } from "@/components/primitives";
import { RightRail, WithRail } from "@/components/rail";
import { messageOf, toBase64 } from "@/features/library/files";
import { client, orpc } from "@/lib/orpc";
import "@/styles/pages/library.css";

export const Route = createFileRoute("/pro/_app/library")({ component: Page });

type Doc = Awaited<ReturnType<typeof client.library.list>>[number];
type Preview = Awaited<ReturnType<typeof client.library.previewArticle>>;
const KIND = { text: "Text", pdf: "PDF", pubmed: "Article" } as const;

const columns: Column<Doc>[] = [
  { key: "title", header: "Title", cell: d => <><strong>{d.title}</strong><div className="lib-note">{d.source} · {d.sections} sections</div></>, sort: (a, b) => a.title.localeCompare(b.title) },
  { key: "kind", header: "Kind", cell: d => <Chip>{KIND[d.kind]}</Chip>, sort: (a, b) => a.kind.localeCompare(b.kind) },
  { key: "year", header: "Year", cell: d => d.year, sort: (a, b) => a.year - b.year, align: "right" },
  { key: "by", header: "Added by", cell: d => <>{d.uploadedBy ?? "Sona"}<div className="lib-note">{d.scope === "hospital" ? "Whole hospital" : "Only you"}</div></> },
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
  const remove = useMutation(orpc.library.remove.mutationOptions({ onSuccess: () => { setConfirming(undefined); return refresh(); } }));

  const docs = list.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = q ? docs.filter(d => `${d.title} ${d.source} ${d.year} ${KIND[d.kind]} ${d.uploadedBy ?? ""}`.toLowerCase().includes(q)) : docs;
  const shared = docs.filter(d => d.scope === "hospital").length;
  const oldest = docs.reduce<Doc | undefined>((o, d) => (!o || d.year < o.year ? d : o), undefined);

  return (
    <>
      <PageHeader title="Library" lead="The sources Sona answers from." />
      {docs.length > 0 && (
        <InsightRow>
          <InsightCard lead={`${docs.length} source${docs.length === 1 ? "" : "s"}: ${shared} for the whole hospital, ${docs.length - shared} only yours.`} sources={docs.length} />
          {oldest && <InsightCard tone="soon" lead={`Oldest source is from ${oldest.year}: ${oldest.title}. Check it is still current.`} sources={1} />}
        </InsightRow>
      )}
      <WithRail rail={
        <RightRail label="Add a source">
          {mayAdd ? <AddSource onAdded={refresh} /> : <p className="lib-note">Your role cannot add to the library. Ask a doctor or management.</p>}
        </RightRail>
      }>
        <input className="lib-search" type="search" placeholder="Search title, kind, year or who added it" aria-label="Search the library" value={search} onChange={e => setSearch(e.target.value)} />
        {list.isPending ? <EmptyState>Loading the library…</EmptyState>
          : list.isError ? <EmptyState>The library could not be shown: {messageOf(list.error)}</EmptyState>
          : (
            <DataTable columns={columns} rows={rows} rowKey={d => d.id}
              empty={q ? `Nothing in the library matches "${search}".` : "No sources yet. Add the first one on the right."}
              rowAction={mayRemove ? d => confirming === d.id ? (
                <span className="lib-row">
                  <Button variant="danger" pending={remove.isPending} onClick={() => remove.mutate({ documentId: d.id })}>Remove for good</Button>
                  <Button onClick={() => setConfirming(undefined)}>Keep</Button>
                  {remove.isError && <span className="lib-error" role="alert">{messageOf(remove.error)}</span>}
                </span>
              ) : <Button onClick={() => { remove.reset(); setConfirming(d.id); }}>Remove</Button> : undefined} />
          )}
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
      <div className="lib-row" role="group" aria-label="How to add">
        {(["text", "pdf", "article"] as const).map(m => <Button key={m} variant={mode === m ? "primary" : "quiet"} aria-pressed={mode === m} onClick={() => pick(m)}>{m === "text" ? "Paste text" : m === "pdf" ? "PDF file" : "Article"}</Button>)}
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
      <Field label="Who can use it">{c => (
        <select {...c} value={scope} onChange={e => setScope(e.target.value as typeof scope)}>
          <option value="hospital">Whole hospital</option>
          <option value="me">Only me</option>
        </select>
      )}</Field>
      <div className="lib-row">
        <Button type="submit" variant="primary" pending={add.isPending}>{mode !== "article" ? "Add to library" : preview ? "Confirm and add" : "Preview article"}</Button>
        {preview && <Button onClick={() => setPreview(undefined)}>Choose another</Button>}
      </div>
      {add.isError && <p className="lib-error" role="alert">{messageOf(add.error)}</p>}
      {done && <p className="lib-note" role="status">{done}</p>}
    </form>
  );
}
