import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/library")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Library" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
