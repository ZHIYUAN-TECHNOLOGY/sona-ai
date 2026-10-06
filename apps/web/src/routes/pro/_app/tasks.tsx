import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/tasks")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Tasks" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
