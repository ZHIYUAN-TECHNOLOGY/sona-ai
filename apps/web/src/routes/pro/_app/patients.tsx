import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page";
import { PatientList } from "@/features/patients/patient-list";
import "@/styles/pages/patients.css";

export const Route = createFileRoute("/pro/_app/patients")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Patients" lead="Everyone registered at this hospital. Open a row for the overview." />
      <PatientList />
    </>
  );
}
