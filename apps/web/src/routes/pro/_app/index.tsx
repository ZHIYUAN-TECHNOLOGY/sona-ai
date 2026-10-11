import { createFileRoute, redirect } from "@tanstack/react-router";

// /pro alone is the frame with no page in it (a blank screen): Today is Sona Pro's home.
export const Route = createFileRoute("/pro/_app/")({ beforeLoad: () => { throw redirect({ to: "/pro/today" }); } });
