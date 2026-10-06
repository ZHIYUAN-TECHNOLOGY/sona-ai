import { refusal } from "@sona-ai/api/roles";
import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";

import { Frame } from "@/components/frame";
import { EmptyState, PageHeader } from "@/components/page";
import { orpc } from "@/lib/orpc";
import { navFor, PRO_NAV } from "@/nav";

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
  const pathname = useLocation({ select: location => location.pathname });
  const groups = navFor(me.role);
  // A page the sidebar hides from this role is refused here too, however it was reached (a typed address, an old link).
  const here = PRO_NAV.flatMap(group => group.items).find(item => pathname === item.to || pathname.startsWith(`${item.to}/`));
  const refused = here?.needs && !groups.some(group => group.items.includes(here));
  return (
    <Frame
      app="pro"
      brand="Sona Pro"
      groups={groups}
      who={`${me.name} · ${me.label}`}
      instead={refused ? (
        <>
          <PageHeader title={here.label} />
          <EmptyState>{refusal(me.role, here.needs!)}</EmptyState>
        </>
      ) : undefined}
    />
  );
}
