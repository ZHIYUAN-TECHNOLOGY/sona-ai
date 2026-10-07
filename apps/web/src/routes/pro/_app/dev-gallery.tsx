import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";

// Dev only: every shared component in each data state (src/dev/gallery.tsx). Production builds drop the gallery.
export const Route = createFileRoute("/pro/_app/dev-gallery")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: import.meta.env.DEV ? lazyRouteComponent(() => import("@/dev/gallery")) : () => null,
});
