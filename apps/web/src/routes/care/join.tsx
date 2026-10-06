import { Icon } from "@/components/icon";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { client, queryClient } from "@/lib/orpc";
import { signOut } from "@/lib/session";
import "@/styles/sign-in.css";

export const Route = createFileRoute("/care/join")({
  // Joining needs an account first: the server redeems a code only for a signed-in person.
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) throw redirect({ to: "/care/sign-in" });
  },
  component: Join,
});

const said = (e: unknown, fallback: string) => e instanceof Error && e.message ? e.message : fallback;

function Join() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  // Review before deciding: who the code is for, confirmed before it is redeemed (a code works once).
  const [found, setFound] = useState<{ firstName: string; hospital: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(undefined);
    try {
      if (!found) { setFound(await client.care.preview({ code: code.trim() })); setBusy(false); return; }
      await client.care.join({ code: code.trim() });
      queryClient.clear();
      await navigate({ to: "/care/home" });
    } catch (e) {
      setBusy(false);
      setError(said(e, "We could not use that code. Check it, or ask the ward for a new one."));
    }
  };

  return <main className="care sign-in">
    <section className="glass halftone sign-in-card">
      <div className="sign-in-brand"><span className="sign-in-brand-tile"><Icon name="activity" size={22} /></span>Sona Care</div>
      <h1>Join your care plan</h1>
      <p>Enter the code on your discharge paper. The ward can give you a new one.</p>
      <form onSubmit={submit}>
        <label htmlFor="join-code">Your code</label>
        <input id="join-code" name="code" autoComplete="off" autoCapitalize="characters" spellCheck={false} required autoFocus
          value={code} onChange={e => { setCode(e.target.value); setFound(undefined); }} />
        {found ? <p role="status" className="sign-in-confirm">This code is for <strong>{found.firstName}</strong> at {found.hospital}. Is that you?</p> : null}
        {error ? <p role="alert" className="sign-in-error">{error}</p> : null}
        <button type="submit" className="sign-in-primary" disabled={busy || !code.trim()}>
          {busy ? "One moment…" : found ? `Yes, I am ${found.firstName}` : "Check code"}
        </button>
        <button type="button" className="sign-in-quiet" onClick={() => { void signOut("care"); }}>Use a different account</button>
      </form>
    </section>
  </main>;
}
