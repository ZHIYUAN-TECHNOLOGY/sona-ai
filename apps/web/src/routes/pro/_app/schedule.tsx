import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/schedule")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Schedule" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
