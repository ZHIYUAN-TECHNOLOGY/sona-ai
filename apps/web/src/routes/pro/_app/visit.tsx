import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/visit")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Visit" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
