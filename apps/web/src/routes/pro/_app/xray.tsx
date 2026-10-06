import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/xray")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="X-ray" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
