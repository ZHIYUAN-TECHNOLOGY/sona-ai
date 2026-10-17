import { Icon } from "@/components/icon";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { oneParam } from "@/features/discharge/shared";
import { authClient } from "@/lib/auth-client";
import { client, queryClient } from "@/lib/orpc";
import { signOut } from "@/lib/session";
import "@/styles/sign-in.css";

export const Route = createFileRoute("/care/join")({
  // `?code=` comes from the discharge paper's QR. Signed out, the preview (public) still shows whose code it is;
  // redeeming needs an account, so confirming goes through sign-in and comes back here with the code.
  validateSearch: oneParam("code"),
  beforeLoad: async () => ({ signedIn: Boolean((await authClient.getSession()).data) }),
  component: Join,
});

const said = (e: unknown, fallback: string) => e instanceof Error && e.message ? e.message : fallback;

function Join() {
  const navigate = useNavigate();
  const { code: linked } = Route.useSearch();
  const { signedIn } = Route.useRouteContext();
  const [code, setCode] = useState(linked ?? "");
  // Review before deciding: who the code is for, confirmed before it is redeemed (a code works once).
  const [found, setFound] = useState<{ firstName: string; hospital: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const preview = async (value: string) => {
    setBusy(true); setError(undefined);
    try { setFound(await client.care.preview({ code: value.trim() })); } catch (e) { setError(said(e, "We could not use that code. Check it, or ask the ward for a new one.")); }
    setBusy(false);
  };
  // A code from the QR's link is checked straight away.
  useEffect(() => { if (linked) void preview(linked); }, [linked]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!found) return preview(code);
    if (!signedIn) return navigate({ to: "/care/sign-in", search: { code: code.trim() } });
    setBusy(true); setError(undefined);
    try {
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
          {busy ? "One moment…" : !found ? "Check code" : signedIn ? `Yes, I am ${found.firstName}` : `Yes, sign in as ${found.firstName}`}
        </button>
        {signedIn ? <button type="button" className="sign-in-quiet" onClick={() => { void signOut("care"); }}>Use a different account</button> : null}
      </form>
    </section>
  </main>;
}
