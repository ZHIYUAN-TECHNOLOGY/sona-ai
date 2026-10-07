import { DataTable } from "@/components/pdf/data-table/data-table";
import { Heading } from "@/components/pdf/heading/heading";
import { KeyValue } from "@/components/pdf/key-value/key-value";
import { PdfList } from "@/components/pdf/list/list";
import { PageHeader } from "@/components/pdf/page-header/page-header";
import { Section } from "@/components/pdf/section/section";
import { Text } from "@/components/pdf/text/text";
import { PdfWatermark } from "@/components/pdf/watermark/watermark";
import type { orpc } from "@/lib/orpc";
import { Document, Page } from "@/lib/pdf/pdf-primitives";

type Status = Awaited<ReturnType<typeof orpc.claim.status.call>>;
type Codes = Awaited<ReturnType<typeof orpc.claim.suggestCodes.call>>;
type Appeal = Awaited<ReturnType<typeof orpc.claim.appealDraft.call>>["letter"];

const WORD: Record<string, string> = { draft: "Draft", sent: "Sent", approved: "Approved", denied: "Denied", queried: "Queried", appealed: "Appealed" };
const MUTED = "#59616B";
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : undefined);
const columns = [
  { key: "code", header: "Code", width: "14%" },
  { key: "title", header: "Title", width: "30%" },
  { key: "kind", header: "Kind", width: "14%" },
  { key: "from", header: "From the note", width: "42%" },
] as const;

export interface GuaranteeLetterDocumentProps {
  patient?: { id: string; name: string };
  status: Status;
  codes: Codes["codes"];
  sentences: Codes["sentences"];
  appeal?: Appeal;
  hospital?: string;
}

/** The guarantee letter as the page shows it: the claim's standing, the codes with their cited sentences, the checklist, and the appeal when one is drafted. */
export function GuaranteeLetterDocument({ patient, status, codes, sentences, appeal, hospital = "Sona Pro" }: GuaranteeLetterDocumentProps) {
  const title = appeal ? "Guarantee letter · Appeal" : "Guarantee letter";
  const facts = [
    { key: "Patient", value: patient ? `${patient.name} (${patient.id})` : "Unknown" },
    { key: "Status", value: WORD[status.status] ?? status.status },
    ...("approvedAt" in status && status.approvedAt ? [{ key: "Approved on", value: day(status.approvedAt)! }] : []),
    ...("denial" in status && status.denial?.at ? [{ key: "Denied on", value: day(status.denial.at)! }] : []),
    ...("appealedAt" in status && status.appealedAt ? [{ key: "Appeal sent on", value: day(status.appealedAt)! }] : []),
  ];
  const rows = codes.map(c => ({
    code: c.code,
    title: c.inTable === false ? `${c.label} (not in the ICD-10 table)` : c.label,
    kind: c.kind,
    from: sentences.find(x => x.id === c.evidence)?.text ?? c.evidence ?? "",
  }));

  return (
    <Document title={title}>
      <Page>
        {status.status === "draft" && <PdfWatermark text="DRAFT" />}
        <PageHeader title={title} subtitle={hospital} rightText={patient?.name} rightSubText={`${patient?.id ?? ""} · ${day(new Date().toISOString())} · ${WORD[status.status] ?? status.status}`} variant="two-column" />

        <Section><KeyValue items={facts} size="sm" /></Section>

        <Section>
          <Heading level={2}>Diagnoses and procedures claimed</Heading>
          {rows.length ? <DataTable columns={[...columns]} data={rows} /> : <Text color={MUTED}>The note has nothing to code yet.</Text>}
        </Section>

        {status.checks?.length ? (
          <Section>
            <Heading level={2}>Insurer's checklist</Heading>
            <PdfList items={status.checks.map(c => ({ text: `${c.status === "passed" ? "Met" : "Open"}: ${c.label}`, description: c.detail }))} />
          </Section>
        ) : null}

        {appeal && (
          <Section>
            <Heading level={2}>Appeal</Heading>
            <Text>{appeal.opening}</Text>
            <PdfList variant="numbered" items={appeal.points.map(p => ({ text: p.claim }))} />
            <Text>{appeal.closing}</Text>
          </Section>
        )}

        <Text variant="xs" color={MUTED}>SYNTHETIC. Synthetic demo data, fictional insurer.</Text>
      </Page>
    </Document>
  );
}
