import { Platform, TurboModuleRegistry } from "react-native";
import type * as Audio from "react-native-audio-api";
import { gate, step } from "./gate";
import { fromPcm16, RATE, resample, rms, toPcm16 } from "./pcm";
import { parse, PROTOCOL_VERSION, quiet, reduce, type Action, type ClientMessage, type Talk } from "./protocol";
import { Playback } from "./queue";

/**
 * A live conversation with Sona's voice agent: one WebSocket (./protocol), the mic streamed to it through the gate
 * (./gate), and Sona's audio played back to back (./queue) with react-native-audio-api, a sentence sent without her
 * audio read by the phone's voice in its place (`read`). For the call the phone's audio
 * is set up as a voice chat (play and record, voiceChat mode, the speaker unless headphones or AirPods are in) and handed
 * back when it ends. Expo Go and the web have no react-native-audio-api: `liveVoiceAvailable` is false there, nothing
 * here loads it, and voice mode stays turn by turn.
 */
export const liveVoiceAvailable = () => Platform.OS !== "web" && TurboModuleRegistry.get("AudioAPIModule") != null;

export type LiveHandlers = {
  /** The conversation changed: an event from the agent, or something the phone did. */
  change(talk: Talk): void;
  /** Sona was stopped (the patient spoke over her, or the agent cut her off): the phone's voice stops too. */
  hush(): void;
  /** The mic's loudness, every frame (about ten a second while the call is on). */
  tick(level: number): void;
  /** Whether to play Sona's own audio (not when the patient picked one of the phone's voices). */
  plays(): boolean;
  /** Her voice sent sentence `k` of her answer without audio (it was slow): the phone's voice reads it. Resolves once read or stopped. */
  read(text: string, k: number): Promise<void>;
  /** The socket closed; nothing more happens on this connection. */
  closed(): void;
};
export type Live = ReturnType<typeof connectLive>;

// React Native's WebSocket takes headers as a third argument; the session cookie signs the socket in (as features/live does).
const Socket = WebSocket as unknown as new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket;
// One recorder, reused across calls (react-native-audio-api: switching recorders costs memory and battery).
// ponytail: react-native-audio-api 1.0 (nightly today) takes { iosVoiceProcessing: true, androidInputPreset: "voiceCommunication" }
// here, the phone's own echo cancellation; 0.13 has no such switch, so ./gate keeps Sona from hearing herself.
let recorder: Audio.AudioRecorder | undefined;
// A call waits for the last one to let go of the mic and the audio session.
let released: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
/** How long a tap on the mic waits for the agent to answer the socket before the call counts as failed. */
const READY_MS = 2500;

export function connectLive(url: string, cookie: string | undefined, on: LiveHandlers) {
  const api = require("react-native-audio-api") as typeof Audio;
  let talk = quiet, g = gate(), phone = false, ctx: Audio.AudioContext | undefined, starting: Promise<"ok" | "mic" | "failed" | "ended"> | undefined;
  // The agent's welcome, or the socket closing first: a tap that came before either waits here (READY_MS at most).
  let welcomed = (_ok: boolean) => {};
  const ready = new Promise<boolean>(resolve => { welcomed = resolve; });
  // The patient still wants the call: ending it while it is starting stops the start.
  let wanted = false;
  // Every stop starts a new generation, so a chunk still decoding when Sona was stopped never plays.
  let generation = 0, decoding = Promise.resolve();
  const queue = new Playback();
  const ws = new Socket(url, undefined, { headers: cookie ? { Cookie: cookie } : {} });
  ws.binaryType = "arraybuffer";

  const open = () => ws.readyState === WebSocket.OPEN;
  const send = (m: ClientMessage) => { if (open()) ws.send(JSON.stringify(m)); };
  const act = (a: Action) => { talk = reduce(talk, a); on.change(talk); };
  const now = () => ctx?.currentTime ?? 0;
  const audible = () => phone || queue.busy(now());
  /** Sona stops at once: her audio here, and through `hush`, the phone's voice. */
  const hush = () => { generation++; queue.clear(); phone = false; on.hush(); };
  /** She is cut off: the agent is told, and audio still coming from that answer is dropped. */
  const cutOff = () => { hush(); act({ type: "barge_in" }); send({ type: "interrupt" }); };

  /** One audio frame from the agent, booked to play right after the one before. */
  const play = (data: ArrayBuffer) => {
    act({ type: "audio" });
    const c = ctx, t = talk, mine = generation;
    if (!c || t.muted || !on.plays()) return;
    decoding = decoding.then(async () => {
      const buffer = t.format === "pcm16" ? pcm(c, fromPcm16(data), t.rate) : await c.decodeAudioData(data);
      if (mine !== generation) return;
      const source = c.createBufferSource();
      source.buffer = buffer;
      source.connect(c.destination);
      source.start(queue.add(t.spoken - 1, buffer.duration, c.currentTime, () => source.stop()));
    }).catch(() => { /* a frame that won't decode is skipped; the next one plays */ });
  };

  /**
   * A sentence her voice sent without audio (sona_say) in an answer it has voiced so far: the phone's voice reads it in
   * its place, once her audio before it has played, and her next sentence waits for it. From then until it is read the
   * phone is her for the gate. Once her voice falls back it does for the rest of the answer (SonaVoice), so an answer
   * with no audio before such a sentence has none at all: the phone reads it whole at the end (features/assistant/live).
   */
  const read = (text: string) => {
    const t = talk, mine = generation;
    if (!ctx || t.muted || !t.frames || !on.plays()) return;
    decoding = decoding.then(async () => {
      if (mine !== generation) return;
      phone = true;
      while (mine === generation && queue.busy(now())) await sleep(50);
      if (mine === generation) await on.read(text, t.spoken - 1).catch(() => {});
      if (mine === generation) phone = false;
    });
  };

  /** One mic frame: to the agent through the gate, which also hears the patient talking over Sona. */
  const listen = (samples: Float32Array, rate: number) => {
    if (!ctx) return; // a frame arriving after the call ended
    const s = resample(samples, rate), level = rms(s);
    const r = step(g, { pcm: toPcm16(s), rms: level, ms: (s.length / RATE) * 1000 }, audible());
    g = r.gate;
    // She stops only if she still has something to say: audio playing, or the agent still sending this answer.
    if (r.interrupt && (audible() || !talk.done)) cutOff();
    if (r.mark) send({ type: r.mark });
    if (open()) for (const pcm16 of r.send) ws.send(pcm16);
    on.tick(level);
  };

  async function startAudio() {
    const { AudioContext, AudioManager, AudioRecorder } = api;
    await released;
    AudioManager.setAudioSessionOptions({ iosCategory: "playAndRecord", iosMode: "voiceChat", iosOptions: ["defaultToSpeaker", "allowBluetoothHFP", "allowBluetoothA2DP"] });
    await AudioManager.setAudioSessionActivity(true);
    // Playback before the mic: the order iOS voice processing wants, should a later version turn it on.
    ctx = new AudioContext();
    await ctx.resume();
    recorder ??= new AudioRecorder();
    recorder.onAudioReady({ sampleRate: RATE, bufferLength: RATE / 10, channelCount: 1 }, ({ buffer }) => listen(buffer.getChannelData(0), buffer.sampleRate));
    return (await recorder.start()).status === "success";
  }

  function stopAudio() {
    const c = ctx;
    if (!c) return;
    ctx = undefined;
    hush();
    recorder?.clearOnAudioReady();
    released = Promise.all([recorder?.stop(), c.close()]).catch(() => {})
      .then(() => api.AudioManager.setAudioSessionActivity(false)).catch(() => {});
    g = gate();
    decoding = Promise.resolve();
  }

  ws.onopen = () => send({ type: "hello", protocol_version: PROTOCOL_VERSION });
  ws.onmessage = (e: MessageEvent) => {
    if (typeof e.data !== "string") { play(e.data as ArrayBuffer); return; }
    const event = parse(e.data);
    if (!event) return;
    // The agent cut her off, or heard the patient's next words while she still played: she stops.
    if (event.type === "playback_interrupt" || (event.type === "transcript" && event.role === "user" && audible())) hush();
    act(event);
    if (talk.ready) welcomed(true);
    if (event.type === "sona_say") read(event.text);
    // The agent ended the call (refused it, or its speech recognition failed).
    if (talk.call === "off") stopAudio();
  };
  ws.onclose = () => { welcomed(false); stopAudio(); on.closed(); };
  ws.onerror = () => { /* onclose follows */ };

  const end = () => {
    wanted = false;
    if (talk.call !== "off") { send({ type: "end_call" }); act({ type: "hang_up" }); }
    stopAudio();
  };

  return {
    /**
     * Starts the call: waits for the agent if the socket is still opening (READY_MS at most), then the mic permission
     * ("mic" if refused), then start_call, then the phone's audio. "ended": the patient ended it while it was starting.
     */
    start() {
      starting ??= (async () => {
        if (talk.call !== "off") return "ok" as const;
        wanted = true;
        if (!await Promise.race([ready, sleep(READY_MS).then(() => false)]) || !open()) return "failed" as const;
        if (!wanted) return "ended" as const;
        const allowed = await api.AudioManager.requestRecordingPermissions().catch(() => "Denied");
        if (allowed !== "Granted") return "mic" as const;
        if (!wanted) return "ended" as const;
        act({ type: "call" });
        send({ type: "start_call" });
        const started = await startAudio().catch(() => false);
        // The agent may have refused the call while the audio was starting.
        if (started && talk.call !== "off") return "ok" as const;
        const ended = !wanted;
        end();
        return ended ? "ended" as const : "failed" as const;
      })().finally(() => { starting = undefined; });
      return starting;
    },
    /** Ends the call; the socket stays open, so the next one starts at once. */
    end,
    /** Asks by text (a suggested question), cutting her off first if she is talking. */
    say(text: string) {
      if (audible()) cutOff();
      send({ type: "text_message", text });
    },
    /** The audio frame playing and how far into it, for her words to light up. */
    playing: () => queue.at(now()),
    audible,
    /** The phone's voice is reading in Sona's place: the gate treats it as her. */
    setPhone(reading: boolean) { phone = reading; },
    close() { end(); ws.close(); },
  };
}

/** Raw PCM from the agent (audio_config pcm16) as a buffer to play. */
function pcm(c: Audio.AudioContext, samples: Float32Array<ArrayBuffer>, rate: number) {
  const buffer = c.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(samples, 0);
  return buffer;
}
