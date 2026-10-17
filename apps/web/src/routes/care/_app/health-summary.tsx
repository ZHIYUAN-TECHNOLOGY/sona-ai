import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";
import { Button, Card } from "@/components/primitives";
import { HealthSummaryView } from "@/features/health-summary/summary-view";
import { orpc } from "@/lib/orpc";
import { downloadServerPdf } from "@/lib/pdf/render";

export const Route = createFileRoute("/care/_app/health-summary")({ component: Page });

const TITLE = "My health summary";

/**
 * Her record as one summary, to read before she sends it: the same summary the PDF holds (care.healthSummaryData), and
 * the PDF itself in the header to take or send to another hospital. Reading it is not logged; downloading it is.
 */
function Page() {
  const summary = useQuery(orpc.care.healthSummaryData.queryOptions());
  const pdf = useMutation(orpc.care.healthSummary.mutationOptions({ onSuccess: downloadServerPdf }));

  if (summary.isPending) return <><PageHeader title={TITLE} lead="Getting your summary…" /><Card><EmptyState icon="file">Getting your summary…</EmptyState></Card></>;
  if (summary.isError)
    return (
      <>
        <PageHeader title={TITLE} lead="We could not open your summary." />
        <Card><EmptyState icon="refresh" title="We couldn't open your summary" action={<Button variant="primary" onClick={() => { void summary.refetch(); }}>Try again</Button>}>{summary.error.message}</EmptyState></Card>
      </>
    );
  const s = summary.data;
  return (
    <>
      <PageHeader title={TITLE} lead={`${s.patient.name} · ${s.patient.age} · ${s.patient.sex} · ${s.hospital}. Check it, then download it for another hospital.`} actions={
        <Button variant="primary" icon="download" pending={pdf.isPending} onClick={() => pdf.mutate({})}>{pdf.isPending ? "Making the PDF…" : "Download PDF"}</Button>
      } />
      {pdf.isError ? <p className="hs-text" role="alert">We could not make the PDF. {pdf.error.message}</p> : null}
      <HealthSummaryView s={s} marks />
    </>
  );
}
