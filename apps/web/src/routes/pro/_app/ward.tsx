import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";

export const Route = createFileRoute("/pro/_app/ward")({ component: Page });

function Page() {
  return (
    <>
      <PageHeader title="Ward" />
      <EmptyState>Not built yet.</EmptyState>
    </>
  );
}
