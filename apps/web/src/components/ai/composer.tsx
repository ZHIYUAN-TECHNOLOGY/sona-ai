import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Icon } from "@/components/icon";
import { EASE_OUT, gsap, moves, useGSAP } from "@/lib/motion";
import { client } from "@/lib/orpc";
import { type Recording, startRecording } from "@/lib/recorder";
import { plain } from "@/lib/sona";
import { captionFor, setVoice, type VoicePhase, voiceNext } from "@/lib/voice";
import { toBase64, WAV_HEADER, WAV_RATE } from "@/lib/wav";
import "@/styles/ai.css";
import "@/styles/composer.css";

import { fitHeight } from "./composer-motion";
import { ComposerRing } from "./composer-ring";
import { VoiceGlow } from "./voice-glow";

const MIN_WAV = WAV_HEADER + WAV_RATE * 2 * 0.3; // under 0.3 s is a slip, not speech
const LANGUAGES = ["en", "ms", "zh"] as const;
const HEARD_MS = 1800; // the heard words stay in the caption this long as they land in the box
/** What the listening veil covers: the Sona panel, or the page (a chat page's thread, Care's Ask page). */
const STAGE = ".sona-panel, .frame-main";

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
 * check before sending). Listening is the phone's listening moment (docs/design-direction.md, the dock): a frosted veil
 * settles over the conversation, a dithered glow rises from the box's bottom edge with the voice, a caption says how to
 * send, the mic turns into a stop square and the edge pulses; stop and it all eases back while Sona reads the words.
 * Enter sends, Shift+Enter starts a new line, Escape lets go of the box. `busy` holds sending
 * while the last answer is still coming. One composer for the Sona panel, its full screen and the chat pages.
 */
export function Composer({ app, onSend, busy, placeholder = "Ask Sona" }: { app: "pro" | "care"; onSend: (question: string) => void; busy?: boolean; placeholder?: string }) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const level = useRef(0);
  const recording = useRef<Promise<Recording> | null>(null);
  const writing = useRef(false);
  const glowOn = useRef(0);
  const veil = useRef<HTMLDivElement>(null);
  const listening = phase === "listening";
  const caption = captionFor(phase, heard);
  const shown = useRef(caption); // kept while the caption fades out
  if (caption) shown.current = caption;

  // The veil lives in the stage (the Sona panel or the page), under the composer.
  useLayoutEffect(() => {
    const stage = form.current!.closest(STAGE);
    if (!stage) return;
    const el = stage.appendChild(document.createElement("div"));
    el.className = "voice-veil";
    el.setAttribute("aria-hidden", "true");
    veil.current = el;
    return () => { el.remove(); veil.current = null; };
  }, []);

  useEffect(() => {
    setVoice(phase);
    return () => setVoice("idle");
  }, [phase]);

  // The listening moment, one timeline each way (from wherever the last one got to, so a quick tap reverses smoothly):
  // the veil (a fixed blur, only its opacity moves), the glow, the mic into a stop square. Tweens end, so GSAP's ticker
  // sleeps at rest. Instant under Reduce Motion.
  useGSAP(() => {
    const d = moves() ? 1 : 0;
    gsap.timeline({ defaults: { duration: 0.35 * d, ease: EASE_OUT, overwrite: "auto" } })
      .to(veil.current, { autoAlpha: listening ? 1 : 0 }, 0)
      .to(glowOn, { current: listening ? 1 : 0 }, 0)
      .to(".ai-composer-mic-icon", { autoAlpha: listening ? 0 : 1, scale: listening ? 0.4 : 1, rotate: listening ? -30 : 0, duration: 0.2 * d }, listening ? 0 : 0.1 * d)
      .to(".ai-composer-stop", { autoAlpha: listening ? 1 : 0, scale: listening ? 1 : 0.4, borderRadius: listening ? 3 : 9, duration: 0.3 * d }, listening ? 0.06 * d : 0);
  }, { scope: form, dependencies: [listening] });

  // The caption above the box rises in and sinks away (instant under Reduce Motion).
  useGSAP(() => {
    gsap.to(".ai-composer-caption", { autoAlpha: caption ? 1 : 0, y: caption ? 0 : 6, duration: moves() ? 0.35 : 0, ease: EASE_OUT });
  }, { scope: form, dependencies: [!!caption] });

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
    setHeard("");
    setPhase(voiceNext(phase, "mic"));
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
      setPhase(voiceNext("listening", "fail"));
      setError(plain(e));
    });
  }

  async function end() {
    const started = recording.current;
    if (!started) return;
    recording.current = null;
    writing.current = true;
    setPhase(voiceNext("listening", "mic"));
    try {
      const wav = await (await started).stop();
      if (wav.length < MIN_WAV) throw new Error("Sona didn't hear anything. Tap the mic, speak, then tap it again.");
      const language = LANGUAGES.find(code => navigator.language.toLowerCase().startsWith(code));
      const said = { audio: toBase64(wav), language };
      const heard = await (app === "pro" ? client.voice.transcribe(said) : client.care.transcribe(said));
      const words = heard.text.trim();
      if (!words) throw new Error("Sona didn't catch that. Try again, or type.");
      setText(current => (current.trim() ? `${current.trim()} ${words}` : words));
      setHeard(words);
      setTimeout(() => setHeard(now => (now === words ? "" : now)), HEARD_MS);
      input.current?.focus();
      setPhase(voiceNext("transcribing", "done"));
    } catch (e) {
      setError(plain(e));
      setPhase(voiceNext("transcribing", "fail"));
    } finally {
      writing.current = false;
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
      <ComposerRing app={app} focused={focused} working={!!busy || phase === "transcribing"} recording={listening} level={level} />
      <VoiceGlow app={app} live={listening} on={glowOn} level={level} />
      <p className="ai-composer-caption" aria-live="polite">{caption || shown.current}</p>
      <p className="ai-composer-status" aria-live="polite">{error}</p>
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
        <span className="ai-composer-mic-icon"><Icon name="mic" size={18} /></span>
        <span className="ai-composer-stop" />
      </button>
      <button type="submit" className="ai-composer-button ai-composer-send" aria-label="Send to Sona" disabled={!canSend}>
        <Icon name="send" size={18} />
      </button>
    </form>
  );
}
