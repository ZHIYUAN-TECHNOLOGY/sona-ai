import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/care/_app/messages")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Messages" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
