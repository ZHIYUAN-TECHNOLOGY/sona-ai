import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/results")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Results" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
