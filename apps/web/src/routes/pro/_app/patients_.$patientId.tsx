import { createFileRoute } from "@tanstack/react-router";

import { PatientOverview } from "@/features/patients/patient-overview";
import "@/styles/pages/patients.css";

export const Route = createFileRoute("/pro/_app/patients_/$patientId")({ component: Page });

function Page() {
  const { patientId } = Route.useParams();
  const { me } = Route.useRouteContext();
  return <PatientOverview patientId={patientId} role={me.role} />;
}
