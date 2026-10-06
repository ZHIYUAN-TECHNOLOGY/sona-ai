import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";

import { client } from "@/lib/orpc";
import { type Recording, startRecording } from "@/lib/recorder";
import { plain, useSonaAsk } from "@/lib/sona";
import { toBase64, WAV_HEADER, WAV_RATE } from "@/lib/wav";

import { type GlowMode, SonaGlow } from "./sona-glow";
import "@/styles/sona-bar.css";

type Phase = "idle" | "listening" | "transcribing";
const STATUS: Record<Phase, string> = { idle: "", listening: "Listening. Let go when you're done.", transcribing: "Writing down what you said…" };
const MIN_WAV = WAV_HEADER + WAV_RATE * 2 * 0.3; // under 0.3 s is a slip, not speech
const LANGUAGES = ["en", "ms", "zh"] as const;
const isHoldKey = (event: KeyboardEvent) => event.key === " " || event.key === "Enter";

const micIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
const sendIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

/** The Sona bar under every page: type, or hold the mic. What you said fills the box to check before sending; answers land in the page. */
export function SonaBar({ app }: { app: "pro" | "care" }) {
  const ask = useSonaAsk();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const bar = useRef<HTMLFormElement>(null);
  const level = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const recording = useRef<Promise<Recording> | null>(null);
  const busy = useRef(false);

  const question = text.trim();
  const canSend = question.length >= (app === "care" ? 2 : 1); // the servers' own minimums

  function begin() {
    if (recording.current || busy.current) return;
    setError("");
    setPhase("listening");
    // The level moves a CSS variable and a ref (the glow reads it), not state: it changes many times a second.
    const started = startRecording(heard => {
      level.current = heard;
      bar.current?.style.setProperty("--level", heard.toFixed(2));
    });
    recording.current = started;
    // Refused or no microphone while still holding: say so at once rather than on release.
    started.catch(e => {
      if (recording.current !== started) return;
      recording.current = null;
      setPhase("idle");
      setError(plain(e));
    });
  }

  async function end() {
    const started = recording.current;
    if (!started) return;
    recording.current = null;
    busy.current = true;
    setPhase("transcribing");
    try {
      const wav = await (await started).stop();
      if (wav.length < MIN_WAV) throw new Error("Hold the mic while you speak, then let go.");
      const language = LANGUAGES.find(code => navigator.language.toLowerCase().startsWith(code));
      const said = { audio: toBase64(wav), language };
      const heard = await (app === "pro" ? client.voice.transcribe(said) : client.care.transcribe(said));
      const words = heard.text.trim();
      if (!words) throw new Error("Sona didn't catch that. Try again, or type.");
      setText(current => (current.trim() ? `${current.trim()} ${words}` : words));
      input.current?.focus();
    } catch (e) {
      setError(plain(e));
    } finally {
      busy.current = false;
      setPhase("idle");
    }
  }

  function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    setError("");
    ask(question);
    setText("");
  }

  const glow: GlowMode = phase === "listening" ? "listening" : phase === "transcribing" ? "thinking" : focused || question ? "awake" : "rest";

  return (
    <div className="sona-dock" onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <SonaGlow app={app} mode={glow} level={level} />
    <form ref={bar} className="sona-bar glass" data-phase={phase} onSubmit={send}>
      <p className="sona-bar-status" data-error={error ? "" : undefined} aria-live="polite">{error || STATUS[phase]}</p>
      <input
        ref={input}
        className="sona-bar-input"
        aria-label="Ask Sona"
        placeholder={app === "pro" ? "Ask Sona" : "Ask Sona anything"}
        value={text}
        onChange={event => setText(event.target.value)}
        maxLength={500}
        enterKeyHint="send"
        autoComplete="off"
      />
      <button
        type="button"
        className="sona-bar-button sona-bar-mic"
        aria-label="Hold to speak"
        aria-pressed={phase === "listening"}
        disabled={phase === "transcribing"}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); begin(); }}
        onPointerUp={end}
        onPointerCancel={end}
        onBlur={end}
        onContextMenu={event => event.preventDefault()}
        onKeyDown={event => { if (isHoldKey(event)) { event.preventDefault(); if (!event.repeat) begin(); } }}
        onKeyUp={event => { if (isHoldKey(event)) { event.preventDefault(); void end(); } }}
      >
        {micIcon}
      </button>
      <button type="submit" className="sona-bar-button sona-bar-send" aria-label="Send to Sona" disabled={!canSend}>
        {sendIcon}
      </button>
    </form>
    </div>
  );
}
