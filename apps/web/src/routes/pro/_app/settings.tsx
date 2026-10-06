import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/settings")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Settings" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
