import { createFileRoute, redirect } from "@tanstack/react-router";

import { Frame } from "@/components/frame";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";
import { CARE_NAV } from "@/nav";

export const Route = createFileRoute("/care/_app")({
  // Signed out, or not yet joined to a hospital's patient record: the server refuses `care.me`.
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(orpc.care.me.queryOptions()).catch(() => null);
    if (me) return { me };
    // Signed in but not linked to a record joins by code; signed out signs in.
    const { data: session } = await authClient.getSession();
    throw redirect({ to: session ? "/care/join" : "/care/sign-in" });
  },
  component: CareFrame,
});

function CareFrame() {
  const { me } = Route.useRouteContext();
  return <Frame app="care" brand="Sona Care" groups={CARE_NAV} who={`${me.name} · ${me.hospital}`} />;
}
