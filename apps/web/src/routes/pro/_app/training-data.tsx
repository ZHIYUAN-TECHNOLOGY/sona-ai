import { can } from "@sona-ai/api/roles";
import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, PageHeader } from "@/components/page";
import { Review } from "@/features/training-data/review";

export const Route = createFileRoute("/pro/_app/training-data")({ component: Page });

function Page() {
  const { me } = Route.useRouteContext();
  if (!can(me.role, "training.status")) return <><PageHeader title="Training data" /><EmptyState>Only management can see the hospital's training data.</EmptyState></>;
  return <Review />;
}
