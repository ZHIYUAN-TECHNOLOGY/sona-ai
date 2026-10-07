import { useSyncExternalStore } from "react";

// The composer's voice input, without the DOM (components/ai/composer.tsx draws it). After the iPhone's listening moment
// (docs/design-direction.md: the dock, the Aurora core orb, apps/native/components/sona/veil-signal.ts).

/** idle: nothing heard. listening: the mic is open. transcribing: what was heard is being written down. */
export type VoicePhase = "idle" | "listening" | "transcribing";
/** mic: the mic button. done: the words arrived (or nothing did). fail: the mic was refused or the transcript failed. */
export type VoiceEvent = "mic" | "done" | "fail";

/** The mic opens from idle and closes from listening; it does nothing while transcribing. Done or failed, back to idle. */
export function voiceNext(phase: VoicePhase, event: VoiceEvent): VoicePhase {
  if (event !== "mic") return "idle";
  return phase === "idle" ? "listening" : phase === "listening" ? "transcribing" : phase;
}

/** The caption above the composer: how to send while listening, then what Sona is doing, then the words it heard. */
export function captionFor(phase: VoicePhase, heard = "") {
  return phase === "listening" ? "Listening… tap the mic to send" : phase === "transcribing" ? "Reading what you said…" : heard;
}

export const ATTACK_MS = 80;
export const RELEASE_MS = 350;
/** One-pole envelope follower (the phone's veil signal): rises over ~80 ms, falls over ~350 ms, whatever the frame rate. */
export function follow(env: number, target: number, dtMs: number) {
  const tau = target > env ? ATTACK_MS : RELEASE_MS;
  return env + (target - env) * (1 - Math.exp(-Math.max(0, dtMs) / tau));
}

export type Renderer = "webgpu" | "webgl2" | "css";
/** WebGPU where the browser has it, WebGL 2 otherwise, a still CSS glow last. */
export const pickRenderer = ({ gpu, webgl2 }: { gpu: boolean; webgl2: boolean }): Renderer => (gpu ? "webgpu" : webgl2 ? "webgl2" : "css");

// One mic listens at a time on a page, so its phase is one value the page shares (the Sona panel's orb follows it).
let current: VoicePhase = "idle";
const listeners = new Set<() => void>();
export function setVoice(phase: VoicePhase) {
  if (phase === current) return;
  current = phase;
  listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener));
/** The page's voice phase, for things outside the composer that answer to it. */
export const useVoice = () => useSyncExternalStore(subscribe, () => current, () => "idle" as VoicePhase);
