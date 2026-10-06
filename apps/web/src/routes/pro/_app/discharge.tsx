import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/discharge")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Discharge" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
