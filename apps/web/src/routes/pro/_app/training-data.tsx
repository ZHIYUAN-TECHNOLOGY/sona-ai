import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/training-data")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Training data" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
