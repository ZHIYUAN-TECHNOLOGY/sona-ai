import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/check-ins")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Check-ins" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
