import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/review")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Review queue" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
