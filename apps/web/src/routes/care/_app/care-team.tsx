import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/care/_app/care-team")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Care team" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
