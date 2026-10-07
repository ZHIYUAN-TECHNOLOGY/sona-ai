import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

// Dev only: the worst-case data toggle (README "Worst-case data"); production builds drop it.
const DataToggle = import.meta.env.DEV ? lazy(() => import("@/dev/worst-case/toggle")) : null;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: DataToggle ? () => <><Outlet /><Suspense><DataToggle /></Suspense></> : Outlet,
});
