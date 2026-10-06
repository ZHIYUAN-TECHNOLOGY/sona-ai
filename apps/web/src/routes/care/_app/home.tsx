import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/care/_app/home")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Home" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
