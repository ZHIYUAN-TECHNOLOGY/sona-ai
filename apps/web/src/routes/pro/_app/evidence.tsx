import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/evidence")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Evidence" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
