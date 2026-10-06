import { createFileRoute, redirect } from "@tanstack/react-router";

import { Frame } from "@/components/frame";
import { orpc } from "@/lib/orpc";
import { navFor } from "@/nav";

export const Route = createFileRoute("/pro/_app")({
  // Signed out, or not a clinician: the server refuses `clinician.me`, so go and sign in.
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(orpc.clinician.me.queryOptions()).catch(() => null);
    if (!me) throw redirect({ to: "/pro/sign-in" });
    return { me };
  },
  component: ProFrame,
});

function ProFrame() {
  const { me } = Route.useRouteContext();
  return <Frame app="pro" brand="Sona Pro" groups={navFor(me.role)} who={`${me.name} · ${me.label}`} />;
}
