import { PdfAlert } from "@/components/pdf/alert/alert";
import { DataTable } from "@/components/pdf/data-table/data-table";
import { Heading } from "@/components/pdf/heading/heading";
import { PdfList } from "@/components/pdf/list/list";
import { PageHeader } from "@/components/pdf/page-header/page-header";
import { Section } from "@/components/pdf/section/section";
import { Text } from "@/components/pdf/text/text";
import { PdfWatermark } from "@/components/pdf/watermark/watermark";
import { dayWords } from "@/features/care-plan/model";
import type { orpc } from "@/lib/orpc";
import { Document, Page } from "@/lib/pdf/pdf-primitives";

type Plan = Extract<Awaited<ReturnType<typeof orpc.care.discharge.call>>, { status: "discharged" }>;
type Visit = Awaited<ReturnType<typeof orpc.care.followUps.call>>[number];
type Medicine = Plan["medicines"]["new"][number];

// Same order and words as the discharge plan page.
const GROUPS = [["new", "New"], ["changed", "Changed"], ["continue", "Keep taking"], ["stopped", "Stopped: do not take"]] as const;

const note = (m: Medicine) => (m.finished ? "Finished" : m.endsAt ? `Last dose on ${dayWords(m.endsAt)}.` : "");
const columns = [
  { key: "name", header: "Medicine", width: "28%" },
  { key: "dose", header: "Dose", width: "22%" },
  { key: "how", header: "How often", width: "30%" },
  { key: "note", header: "Note", width: "20%" },
] as const;

export interface DischargePlanDocumentProps {
  plan: Plan;
  lang: string;
  visits: Visit[];
  hospital?: string;
  patientName?: string;
}

/** The discharge plan as the page shows it: leaflet, medicines by group, warning signs, follow-ups. */
export function DischargePlanDocument({ plan, lang, visits, hospital = "Sona Care", patientName }: DischargePlanDocumentProps) {
  const leaflet = plan.leaflets.find(l => l.language === lang) ?? plan.leaflets[0];
  const sample = Boolean(leaflet && "source" in leaflet && leaflet.source === "fixture");
  const wentHome = new Date(plan.dischargedAt).toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric" });
  const groups = GROUPS.filter(([g]) => plan.medicines[g].length);

  return (
    <Document title="Discharge plan">
      <Page>
        {sample && <PdfWatermark text="SAMPLE" />}
        <PageHeader title="Discharge plan" subtitle={hospital} rightText={patientName} rightSubText={`Went home ${wentHome}`} variant="two-column" />

        <Section>
          <Heading level={2}>What happened</Heading>
          {leaflet ? <Text>{leaflet.text}</Text> : <Text color="#59616B">Your care team has not written this part yet.</Text>}
        </Section>

        <Section>
          <Heading level={2}>Medicines to take</Heading>
          {groups.length === 0 && <Text color="#59616B">No medicines on your plan.</Text>}
          {groups.map(([g, label]) => (
            <Section key={g} spacing="sm">
              <Heading level={3}>{label}</Heading>
              <DataTable columns={[...columns]} data={plan.medicines[g].map(m => ({ name: m.name, dose: m.line, how: m.take, note: note(m) }))} />
            </Section>
          ))}
        </Section>

        <Section>
          <PdfAlert variant="warning" title="Warning signs: come back straight away if">
            {plan.warningSigns.length
              ? <PdfList items={plan.warningSigns.map(text => ({ text }))} />
              : <Text>Your care team listed no warning signs. If you feel much worse, come back anyway.</Text>}
            <Text>If you cannot reach the hospital, call 999.</Text>
          </PdfAlert>
        </Section>

        <Section>
          <Heading level={2}>Follow-up visits</Heading>
          {visits.length
            ? <PdfList items={visits.map(v => ({ text: `${v.title}: ${dayWords(v.date)}`, description: v.status === "missed" ? "Missed. Call the clinic to book a new time." : v.why }))} />
            : <Text color="#59616B">No visits are booked.</Text>}
        </Section>
      </Page>
    </Document>
  );
}
