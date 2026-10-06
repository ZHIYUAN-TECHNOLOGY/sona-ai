import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/care/_app/readings")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Readings" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
