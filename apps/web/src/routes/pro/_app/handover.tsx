import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/handover")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Handover" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
