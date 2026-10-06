import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/care/sign-in")({ component: SignIn });

function SignIn() {
  return <div className="care">Sign in</div>;
}
