import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/care/_app/visit-summaries")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Visit summaries" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
