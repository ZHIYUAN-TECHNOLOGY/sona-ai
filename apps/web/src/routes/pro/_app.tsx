import { can, refusal } from "@sona-ai/api/roles";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useLocation } from "@tanstack/react-router";

import { Frame } from "@/components/frame";
import { EmptyState, PageHeader } from "@/components/page";
import { useLiveUpdates } from "@/lib/live";
import { orpc } from "@/lib/orpc";
import { homeFor, navFor, opens, PRO_NAV } from "@/nav";

export const Route = createFileRoute("/pro/_app")({
  // Signed out, or not a clinician: the server refuses `clinician.me`, so go and sign in.
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.ensureQueryData(orpc.clinician.me.queryOptions()).catch(() => null);
    if (!me) throw redirect({ to: "/pro/sign-in" });
    // Sign-in and the site's front door send everyone to Today; a role that has no Today lands on its own first page.
    if (location.pathname === "/pro/today" && homeFor(me.role) !== "/pro/today") throw redirect({ to: homeFor(me.role) });
    return { me };
  },
  component: ProFrame,
});

function ProFrame() {
  const { me } = Route.useRouteContext();
  const pathname = useLocation({ select: location => location.pathname });
  const groups = navFor(me.role);
  // What another person or the insurer changes (a letter approved, a message in) reaches the open page without a reload.
  useLiveUpdates();
  // Sidebar badges: the same queries the pages run, so the cache is shared; a role only asks for what it may read.
  const inbox = useQuery(orpc.messages.inbox.queryOptions({ enabled: can(me.role, "messages.list") }));
  const summaries = useQuery(orpc.review.list.queryOptions({ enabled: can(me.role, "review.list") }));
  const results = useQuery(orpc.results.list.queryOptions({ input: {}, enabled: can(me.role, "results.list") }));
  const tasks = useQuery(orpc.tasks.list.queryOptions({ enabled: can(me.role, "tasks.list") }));
  const waiting = (inbox.data?.threads ?? []).filter(t => !t.handled).length;
  const counts: Record<string, number> = {
    "/pro/messages": waiting,
    "/pro/review": waiting + (summaries.data?.length ?? 0),
    "/pro/results": (results.data ?? []).filter(r => !r.acknowledgedAt).length,
    "/pro/tasks": (tasks.data ?? []).filter(t => !t.completed).length,
  };
  const counted = groups.map(group => ({ ...group, items: group.items.map(item => (counts[item.to] ? { ...item, count: counts[item.to] } : item)) }));
  // A page the sidebar hides from this role is refused here too, however it was reached (a typed address, an old link).
  const here = PRO_NAV.flatMap(group => group.items).find(item => pathname === item.to || pathname.startsWith(`${item.to}/`));
  const refused = here && !opens(me.role, here);
  return (
    <Frame
      app="pro"
      brand="Sona Pro"
      groups={counted}
      name={me.name}
      who={me.label}
      instead={refused ? (
        <>
          <PageHeader title={here.label} />
          <EmptyState>{refusal(me.role, [here.needs!].flat()[0]!)}</EmptyState>
        </>
      ) : undefined}
    />
  );
}
