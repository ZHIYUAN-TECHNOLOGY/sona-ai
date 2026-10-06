import { type FormEvent, useRef, useState } from "react";

import { EASE_OUT, gsap, moves, useGSAP } from "@/lib/motion";

import { client } from "@/lib/orpc";
import { type Recording, startRecording } from "@/lib/recorder";
import { plain, useSonaAsk } from "@/lib/sona";
import { toBase64, WAV_HEADER, WAV_RATE } from "@/lib/wav";

import { SonaGlow } from "./sona-glow";
import "@/styles/sona-bar.css";

type Phase = "idle" | "listening" | "transcribing";
const STATUS: Record<Phase, string> = { idle: "", listening: "Listening. Tap the mic when you're done.", transcribing: "Writing down what you said…" };
const MIN_WAV = WAV_HEADER + WAV_RATE * 2 * 0.3; // under 0.3 s is a slip, not speech
const LANGUAGES = ["en", "ms", "zh"] as const;

// What the resting bar invites, one line at a time, and the questions offered when it opens: the same ones.
const ASK = {
  pro: { name: "Ask Sona", questions: ["What needs me first?", "Which beds are blocked?", "What is due today?"] },
  care: { name: "Ask Sona anything", questions: ["When is my next visit?", "What medicines do I take today?", "What should I watch for at home?"] },
};

/**
 * The resting bar's placeholder: each line arrives letter by letter out of a blur, rests, and leaves the same way
 * for the next. It only plays while the bar is at rest and empty. Reduce Motion: the first line, still.
 */
function SonaHint({ lines }: { lines: string[] }) {
  const el = useRef<HTMLSpanElement>(null);
  const [index, setIndex] = useState(0);
  useGSAP(() => {
    if (!moves()) return;
    const letters = el.current!.children;
    gsap.timeline()
      .from(letters, { opacity: 0, y: 10, filter: "blur(12px)", duration: 0.4, ease: EASE_OUT, stagger: 0.025 })
      .to(letters, { opacity: 0, y: -10, filter: "blur(12px)", duration: 0.3, ease: "power2.in", stagger: { each: 0.015, from: "end" } }, "+=2.4")
      .call(() => setIndex(i => (i + 1) % lines.length));
  }, { dependencies: [index], revertOnUpdate: true });
  return (
    <span ref={el} className="sona-bar-hint" aria-hidden="true">
      {[...lines[index]!].map((letter, i) => <span key={i}>{letter === " " ? "\u00A0" : letter}</span>)}
    </span>
  );
}

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

/**
 * The Sona bar under every page: type, or tap the mic, speak, and tap it again. What you said fills the box to check before sending; answers
 * land in the page. At rest it is one row with a placeholder that cycles through things to ask; in use (focused, or
 * holding a draft) it opens a second row that offers those questions, one press each.
 */
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
    // Refused or no microphone: say so at once rather than when the mic is tapped again.
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
      if (wav.length < MIN_WAV) throw new Error("Sona didn't hear anything. Tap the mic, speak, then tap it again.");
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

  const { name, questions } = ASK[app];
  const open = focused || question.length > 0;
  const resting = !open && phase === "idle";

  return (
    <form
      ref={bar}
      className="sona-bar glass"
      data-phase={phase}
      data-open={open || undefined}
      onSubmit={send}
      onFocus={() => setFocused(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    >
      <SonaGlow app={app} listening={phase === "listening"} level={level} />
      <p className="sona-bar-status" data-error={error ? "" : undefined} aria-live="polite">{error || STATUS[phase]}</p>
      <div className="sona-bar-row">
        <div className="sona-bar-field">
          <input
            ref={input}
            className="sona-bar-input"
            aria-label={name}
            placeholder={resting ? undefined : name}
            value={text}
            onChange={event => setText(event.target.value)}
            maxLength={500}
            enterKeyHint="send"
            autoComplete="off"
          />
          {resting ? <SonaHint lines={[name, ...questions]} /> : null}
        </div>
        <button
          type="button"
          className="sona-bar-button sona-bar-mic"
          aria-label={phase === "listening" ? "Stop listening" : "Speak to Sona"}
          aria-pressed={phase === "listening"}
          disabled={phase === "transcribing"}
          onClick={() => (phase === "listening" ? void end() : begin())}
        >
          {micIcon}
        </button>
        <button type="submit" className="sona-bar-button sona-bar-send" aria-label="Send to Sona" disabled={!canSend}>
          {sendIcon}
        </button>
      </div>
      <div className="sona-bar-more" inert={!open}>
        <div className="sona-bar-asks">
          {questions.map(q => (
            <button key={q} type="button" className="sona-bar-ask" onClick={() => { setError(""); ask(q); setText(""); input.current?.focus(); }}>{q}</button>
          ))}
        </div>
      </div>
    </form>
  );
}
