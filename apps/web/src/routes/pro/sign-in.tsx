import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/pro/sign-in")({ component: SignIn });

function SignIn() {
  return <div className="pro">Sign in</div>;
}
