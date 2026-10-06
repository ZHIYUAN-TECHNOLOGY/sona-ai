import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/today")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Today" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
