import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/care/_app/ask")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Ask Sona" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
