import { Icon } from "@/components/icon";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";
import { orpc, queryClient } from "@/lib/orpc";
import "@/styles/sign-in.css";

export const Route = createFileRoute("/care/sign-in")({ component: SignIn });

/** A Malaysian mobile as typed (012-345 6789, 60123456789, +60 12…) to +60123456789; undefined until it is whole. */
function toE164(typed: string) {
  const digits = typed.replace(/\D/g, "").replace(/^60/, "").replace(/^0/, "");
  return /^1\d{8,9}$/.test(digits) ? `+60${digits}` : undefined;
}

/** +60123456789 as a patient writes it, 012-345 6789 (011-2345 6789 for the longer numbers), so they can check it. */
function toNational(e164: string) {
  const n = `0${e164.slice(3)}`;
  return `${n.slice(0, 3)}-${n.slice(3, -4)} ${n.slice(-4)}`;
}

function SignIn() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Staging only: the seeded demo patient's number and fixed code, shown so reviewers can sign in.
  const demo = useQuery({ ...orpc.care.demoSignIn.queryOptions(), staleTime: Infinity }).data ?? undefined;
  const number = toE164(phone);

  const send = async (to: string) => {
    setBusy(true); setError(undefined);
    const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber: to });
    setBusy(false);
    if (error) setError(error.message ?? "We could not send the code. Check the number, then try again.");
    else { setCode(""); setSentTo(to); }
  };
  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!sentTo) return;
    setBusy(true); setError(undefined);
    const { error } = await authClient.phoneNumber.verify({ phoneNumber: sentTo, code });
    if (error) { setBusy(false); setCode(""); setError(error.message ?? "That code did not work. Check it, or send a new one."); return; }
    queryClient.clear();
    // The guard on /care/home sends a patient who has not joined a record yet on to /care/join.
    await navigate({ to: "/care/home" });
  };
  const alert = error ? <p role="alert" className="sign-in-error">{error}</p> : null;

  return <main className="care sign-in">
    <section className="glass halftone sign-in-card">
      <div className="sign-in-brand"><span className="sign-in-brand-tile"><Icon name="activity" size={22} /></span>Sona Care</div>
      {sentTo ? <>
        <h1>Enter your code</h1>
        <p>We sent a 6-digit code to {toNational(sentTo)}.</p>
        <form onSubmit={verify}>
          <label htmlFor="code">6-digit code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} />
          {demo && demo.phone === sentTo ? <button type="button" className="sign-in-quiet" onClick={() => setCode(demo.code)}>Demo code: {demo.code}</button> : null}
          {alert}
          <button type="submit" className="sign-in-primary" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Sign in"}</button>
          <div className="sign-in-row">
            <button type="button" className="sign-in-quiet" disabled={busy} onClick={() => { void send(sentTo); }}>Send a new code</button>
            <button type="button" className="sign-in-quiet" onClick={() => { setError(undefined); setSentTo(undefined); }}>Change number</button>
          </div>
        </form>
      </> : <>
        <h1>Your recovery, between visits</h1>
        <p>Sign in with your mobile number. We will text you a code.</p>
        <form onSubmit={e => { e.preventDefault(); if (number) void send(number); }}>
          <label htmlFor="phone">Mobile number (+60)</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" required autoFocus placeholder="012-345 6789"
            value={phone} onChange={e => setPhone(e.target.value)} />
          {demo ? <button type="button" className="sign-in-quiet" onClick={() => setPhone(toNational(demo.phone))}>Demo number: {toNational(demo.phone)}</button> : null}
          {alert}
          <button type="submit" className="sign-in-primary" disabled={busy || !number}>{busy ? "Sending…" : "Send code"}</button>
        </form>
        <p>First time? Sign in, then enter the code on your discharge paper.</p>
      </>}
    </section>
  </main>;
}
