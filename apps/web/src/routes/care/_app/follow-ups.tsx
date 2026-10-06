import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/care/_app/follow-ups")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Follow-ups" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
