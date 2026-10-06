import { createFileRoute, redirect } from "@tanstack/react-router";

import { Frame } from "@/components/frame";
import { orpc } from "@/lib/orpc";
import { CARE_NAV } from "@/nav";

export const Route = createFileRoute("/care/_app")({
  // Signed out, or not yet joined to a hospital's patient record: the server refuses `care.me`.
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(orpc.care.me.queryOptions()).catch(() => null);
    if (!me) throw redirect({ to: "/care/sign-in" });
    return { me };
  },
  component: CareFrame,
});

function CareFrame() {
  const { me } = Route.useRouteContext();
  return <Frame app="care" brand="Sona Care" groups={CARE_NAV} who={`${me.name} · ${me.hospital}`} />;
}
