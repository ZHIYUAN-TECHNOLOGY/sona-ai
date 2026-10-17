import { pcmToWav } from "./wav";

// The worklet only hands each block of the first channel to the page; inlined so there is no extra file to serve.
const TAP = `registerProcessor("sona-tap", class extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0][0]; if (c) this.port.postMessage(c.slice()); return true; }
});`;

export type Recording = { stop(): Promise<Uint8Array> };

/**
 * Listens on the microphone until `stop()`, which releases it and resolves with a 16 kHz mono WAV.
 * `onLevel` gets 0..1 per audio block, for the listening pulse. Every failure is thrown in plain words.
 */
export async function startRecording(onLevel?: (level: number) => void): Promise<Recording> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    throw new Error(name === "NotAllowedError" || name === "SecurityError"
      ? "The microphone is blocked. Allow it in your browser's site settings, or type instead."
      : "No microphone was found. Type instead.");
  }
  const release = () => stream.getTracks().forEach(track => track.stop());
  const context = new AudioContext();
  const url = URL.createObjectURL(new Blob([TAP], { type: "application/javascript" }));
  try {
    await context.audioWorklet.addModule(url);
  } catch {
    release();
    void context.close();
    throw new Error("This browser can't record here. Type instead.");
  } finally {
    URL.revokeObjectURL(url);
  }
  const chunks: Float32Array[] = [];
  const source = context.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(context, "sona-tap", { numberOfOutputs: 0 });
  tap.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
    chunks.push(data);
    if (!onLevel) return;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
  };
  source.connect(tap);

  return {
    async stop() {
      tap.port.onmessage = null;
      source.disconnect();
      release();
      const rate = context.sampleRate;
      await context.close();
      const pcm = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) { pcm.set(c, at); at += c.length; }
      return pcmToWav(pcm, rate);
    },
  };
}
