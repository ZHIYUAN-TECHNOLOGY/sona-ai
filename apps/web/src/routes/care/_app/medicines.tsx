import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/care/_app/medicines")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Medicines" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
