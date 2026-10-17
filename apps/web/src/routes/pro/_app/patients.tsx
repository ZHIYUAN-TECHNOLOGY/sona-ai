import { createFileRoute } from "@tanstack/react-router";

import { PATIENT_TABS, PatientList, type PatientTab } from "@/features/patients/patient-list";
import "@/styles/pages/patients.css";
import "@/styles/pages/patients-list.css";

export const Route = createFileRoute("/pro/_app/patients")({
  // The tab lives in the URL so a filtered list can be linked to and survives a reload.
  validateSearch: (search: Record<string, unknown>): { tab?: PatientTab } =>
    PATIENT_TABS.includes(search.tab as PatientTab) && search.tab !== "all" ? { tab: search.tab as PatientTab } : {},
  component: Page,
});

function Page() {
  const { tab = "all" } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <PatientList tab={tab} onTab={(next) => navigate({ search: next === "all" ? {} : { tab: next }, replace: true })} />;
}
