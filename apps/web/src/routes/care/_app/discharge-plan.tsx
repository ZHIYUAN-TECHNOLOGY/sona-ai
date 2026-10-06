import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/care/_app/discharge-plan")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Discharge plan" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
