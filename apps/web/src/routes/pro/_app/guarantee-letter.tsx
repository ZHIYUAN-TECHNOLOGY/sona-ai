import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/guarantee-letter")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Guarantee letter" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
