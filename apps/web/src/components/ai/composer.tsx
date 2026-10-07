import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Icon } from "@/components/icon";
import { client } from "@/lib/orpc";
import { type Recording, startRecording } from "@/lib/recorder";
import { plain } from "@/lib/sona";
import { toBase64, WAV_HEADER, WAV_RATE } from "@/lib/wav";
import "@/styles/ai.css";
import "@/styles/composer.css";

import { fitHeight } from "./composer-motion";
import { ComposerRing } from "./composer-ring";

type Phase = "idle" | "listening" | "transcribing";
const STATUS: Record<Phase, string> = { idle: "", listening: "Listening. Tap the mic when you're done.", transcribing: "Writing down what you said…" };
const MIN_WAV = WAV_HEADER + WAV_RATE * 2 * 0.3; // under 0.3 s is a slip, not speech
const LANGUAGES = ["en", "ms", "zh"] as const;

/** Puts the cursor in the composer on screen (the panel's, or a chat page's own), after the next paint. */
export const focusComposer = () => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".ai-composer-input")?.focus());

function fitInput(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  const style = getComputedStyle(el);
  const { height, scrolls } = fitHeight(el.scrollHeight, parseFloat(style.lineHeight), parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
  el.style.height = `${height}px`;
  el.style.overflowY = scrolls ? "auto" : "hidden";
}

/**
 * Where a question to Sona is written: type, or tap the mic, speak and tap it again (what was heard fills the box to
 * check before sending). Enter sends, Shift+Enter starts a new line, Escape lets go of the box. `busy` holds sending
 * while the last answer is still coming. One composer for the Sona panel, its full screen and the chat pages.
 */
export function Composer({ app, onSend, busy, placeholder = "Ask Sona" }: { app: "pro" | "care"; onSend: (question: string) => void; busy?: boolean; placeholder?: string }) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const level = useRef(0);
  const recording = useRef<Promise<Recording> | null>(null);
  const writing = useRef(false);

  // The box grows with the text to six lines, then scrolls; a change of width rewraps it.
  useLayoutEffect(() => fitInput(input.current!), [text]);
  useEffect(() => {
    const el = input.current!;
    let width = el.offsetWidth;
    const rewrap = new ResizeObserver(() => { if (el.offsetWidth !== width) { width = el.offsetWidth; fitInput(el); } });
    rewrap.observe(el);
    return () => rewrap.disconnect();
  }, []);

  const question = text.trim();
  const canSend = question.length >= (app === "care" ? 2 : 1) && !busy; // the servers' own minimums

  function send() {
    if (!canSend) return;
    setError("");
    onSend(question);
    setText("");
  }

  function begin() {
    if (recording.current || writing.current) return;
    setError("");
    setPhase("listening");
    // The level moves a CSS variable and a ref (the mic's ring and the living edge read them), not state: it changes many times a second.
    const started = startRecording(heard => {
      level.current = heard;
      form.current?.style.setProperty("--level", heard.toFixed(2));
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
    writing.current = true;
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
      writing.current = false;
      setPhase("idle");
    }
  }

  return (
    <form
      ref={form}
      className="ai-composer"
      data-phase={phase}
      onSubmit={event => { event.preventDefault(); send(); }}
      onFocus={() => setFocused(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    >
      <ComposerRing app={app} focused={focused} working={!!busy || phase === "transcribing"} recording={phase === "listening"} level={level} />
      <p className="ai-composer-status" data-error={error ? "" : undefined} aria-live="polite">{error || STATUS[phase]}</p>
      {/* `sona-bar-input` stays as a hook: Sona Care's Ask page focuses it from "Ask a follow-up". */}
      <textarea
        ref={input}
        className="ai-composer-input sona-bar-input"
        rows={1}
        aria-label={placeholder}
        placeholder={placeholder}
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
          else if (event.key === "Escape") event.currentTarget.blur();
        }}
        maxLength={500}
        enterKeyHint="send"
        autoComplete="off"
      />
      <button
        type="button"
        className="ai-composer-button ai-composer-mic"
        aria-label={phase === "listening" ? "Stop listening" : "Speak to Sona"}
        aria-pressed={phase === "listening"}
        disabled={phase === "transcribing"}
        onClick={() => (phase === "listening" ? void end() : begin())}
      >
        <Icon name="mic" size={18} />
      </button>
      <button type="submit" className="ai-composer-button ai-composer-send" aria-label="Send to Sona" disabled={!canSend}>
        <Icon name="send" size={18} />
      </button>
    </form>
  );
}
