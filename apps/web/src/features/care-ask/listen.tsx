import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/primitives";
import { client } from "@/lib/orpc";

/** An answer in sentences, so each is spoken as soon as it is ready. */
export const sentences = (text: string) => text.match(/[^.!?。！？\n]+[.!?。！？]*/g)?.map(s => s.trim()).filter(Boolean) ?? [];

/** The browser's own voice, when Sona's voice has no audio for a sentence (the phone app does the same). */
export function browserSay(text: string, signal?: AbortSignal) {
  return new Promise<void>(resolve => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.onend = u.onerror = () => resolve();
    signal?.addEventListener("abort", () => { speechSynthesis.cancel(); resolve(); });
    speechSynthesis.speak(u);
  });
}

function playWav(base64: string, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const audio = new Audio(`data:audio/wav;base64,${base64}`);
    audio.onended = audio.onerror = () => resolve();
    signal.addEventListener("abort", () => { audio.pause(); resolve(); });
    audio.play().catch(() => resolve());
  });
}

/** Reads an answer aloud with `care.speak`, sentence by sentence; a second press stops it. */
export function Listen({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);

  async function toggle() {
    if (stop.current) { stop.current.abort(); return; }
    const ctl = (stop.current = new AbortController());
    setOn(true);
    // All sentences are asked for at once and played in order.
    const parts = sentences(text).map(s => ({ s, said: client.care.speak({ text: s }).catch(() => null) as Promise<{ audio?: string } | null> }));
    for (const { s, said } of parts) {
      const res = await said;
      if (ctl.signal.aborted) break;
      await (res?.audio ? playWav(res.audio, ctl.signal) : browserSay(s, ctl.signal));
      if (ctl.signal.aborted) break;
    }
    stop.current = null;
    setOn(false);
  }

  return <Button className="ask-listen" onClick={toggle} aria-pressed={on}>{on ? "Stop" : "Listen"}</Button>;
}
