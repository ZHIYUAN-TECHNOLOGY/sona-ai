import { createFileRoute, redirect } from "@tanstack/react-router";

// /care alone is the frame with no page in it (a blank screen): Home is Sona Care's.
export const Route = createFileRoute("/care/_app/")({ beforeLoad: () => { throw redirect({ to: "/care/home" }); } });
