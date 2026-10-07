import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { queryClient } from "@/lib/orpc";
import { Icon } from "@/components/icon";
import "@/styles/sign-in.css";

export const Route = createFileRoute("/pro/sign-in")({ component: SignIn });

/** better-auth signs in by email, so a demo username typed bare (`doctor`) becomes its account's address. */
const demoEmail = (input: string) => { const v = input.trim(); return v.includes("@") ? v : `${v}@sona.test`; };

function SignIn() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(undefined);
    const { error } = await authClient.signIn.email({ email: demoEmail(String(form.get("email"))), password: String(form.get("password")) });
    if (error) { setBusy(false); setError(error.message ?? "We could not sign you in. Check your email and password, then try again."); return; }
    // Nothing read while signed out (or as someone else) may be shown to this clinician.
    queryClient.clear();
    await navigate({ to: "/pro/today" });
  };

  return <main className="pro sign-in">
    <section className="glass halftone sign-in-card">
      <div className="sign-in-brand"><span className="sign-in-brand-tile"><Icon name="activity" size={22} /></span>Sona Pro</div>
      <h1>Sign in to your ward</h1>
      <p>Use your hospital email and password.</p>
      <form onSubmit={submit}>
        <label htmlFor="email">Username or email</label>
        <input id="email" name="email" type="text" autoComplete="username" required autoFocus spellCheck={false} autoCapitalize="none" placeholder="doctor" />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        {error ? <p role="alert" className="sign-in-error">{error}</p> : null}
        <button type="submit" className="sign-in-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="sign-in-demo">Demo: doctor / 123, also nurse, beds, manager</p>
    </section>
  </main>;
}
