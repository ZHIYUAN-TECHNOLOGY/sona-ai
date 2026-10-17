import { createFileRoute } from "@tanstack/react-router";

import { CareHome } from "@/features/care-home/home-page";

import "@/styles/pages/care-home.css";

export const Route = createFileRoute("/care/_app/home")({ component: Page });

function Page() {
  const { me } = Route.useRouteContext();
  return <CareHome firstName={me.firstName} />;
}
