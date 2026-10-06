import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/patients")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Patients" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
