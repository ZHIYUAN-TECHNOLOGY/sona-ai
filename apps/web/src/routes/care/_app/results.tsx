import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/care/_app/results")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Results" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
