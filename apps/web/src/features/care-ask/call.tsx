import { useEffect, useRef, useState, type ReactNode } from "react";

import { CareMarked } from "@/components/marked";
import { Button, Card } from "@/components/primitives";
import { resample } from "@/lib/wav";

import { browserSay } from "./listen";
import { agentUrl, encode, gate, hello, parse, quiet, RATE, reduce, rms, step, toPcm16, type ClientMessage, type ServerEvent, type Talk } from "./protocol";

type Phase = "off" | "connecting" | "on" | "reconnecting" | "mic" | "failed";
const STATE: Record<Talk["status"], string> = { idle: "Connecting…", listening: "Listening", thinking: "Sona is thinking…", speaking: "Sona is speaking" };
const HINT: Record<Talk["status"], string> = { idle: "One moment.", listening: "Speak when you are ready.", thinking: "One moment.", speaking: "You can talk over her." };
const STOPPED: Partial<Record<Phase, string>> = { mic: "Microphone blocked. Allow it in your browser, then try again.", failed: "The call ended. Please try again." };
type Parts = { open: boolean; button: ReactNode; stage: ReactNode; transcript: ReactNode };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const lang = () => (navigator.language.startsWith("zh") ? "zh" : navigator.language.startsWith("ms") ? "ms" : "en");

/** The live voice call, as the phone runs it (apps/care/lib/live-voice/session.ts) with the browser's audio. */
export function Call({ instance, children }: { instance: string; children: (parts: Parts) => ReactNode }) {
  const [phase, setPhase] = useState<Phase>("off");
  const [talk, setTalk] = useState(quiet);
  const end = useRef<(() => void) | null>(null);
  useEffect(() => () => end.current?.(), []);

  async function start() {
    setPhase("connecting");
    setTalk(quiet);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch {
      setPhase("mic");
      return;
    }
    const ctx = new AudioContext({ sampleRate: RATE });
    let t = quiet, g = gate(), ws: WebSocket | undefined, ended = false, retries = 0, nextAt = 0, generation = 0, saying = false, order = Promise.resolve();
    const sources = new Set<AudioBufferSourceNode>();
    const act = (e: ServerEvent | { type: "barge_in" }) => { t = reduce(t, e); setTalk(t); };
    const send = (m: ClientMessage) => { if (ws?.readyState === WebSocket.OPEN) ws.send(encode(m)); };
    const audible = () => saying || nextAt > ctx.currentTime;
    /** Sona stops at once: her audio, and the browser's voice reading in her place. */
    const hush = () => { generation++; sources.forEach(s => s.stop()); sources.clear(); nextAt = 0; saying = false; window.speechSynthesis?.cancel(); };

    /** One audio frame (a sentence) from the agent, booked to play right after the one before. */
    const play = (data: ArrayBuffer) => {
      const mine = generation;
      if (t.muted) return;
      order = order.then(async () => {
        const buffer = await ctx.decodeAudioData(data);
        if (mine !== generation) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => sources.delete(source);
        sources.add(source);
        nextAt = Math.max(ctx.currentTime, nextAt);
        source.start(nextAt);
        nextAt += buffer.duration;
      }).catch(() => { /* a frame that won't decode is skipped; the next one plays */ });
    };
    /** A sentence that came without audio: the browser's voice reads it, in its place in the answer. */
    const say = (text: string) => {
      const mine = generation;
      order = order.then(async () => {
        if (mine !== generation) return;
        saying = true;
        await sleep(Math.max(0, nextAt - ctx.currentTime) * 1000);
        if (mine === generation) await browserSay(text);
        if (mine === generation) saying = false;
      });
    };

    // ponytail: ScriptProcessorNode (deprecated, still in every browser) keeps capture in one file; move to an
    // AudioWorklet if frames drop on slow devices.
    const mic = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = e => {
      const samples = resample(e.inputBuffer.getChannelData(0), ctx.sampleRate), level = rms(samples);
      const r = step(g, level, (samples.length / RATE) * 1000, audible());
      g = r.gate;
      if (r.interrupt) { hush(); act({ type: "barge_in" }); send({ type: "interrupt" }); }
      if (r.mark) send({ type: r.mark });
      if (ws?.readyState === WebSocket.OPEN) ws.send(toPcm16(samples));
    };
    mic.connect(node);
    node.connect(ctx.destination);

    const finish = (to: Phase) => {
      if (ended) return;
      ended = true;
      end.current = null;
      send({ type: "end_call" });
      ws?.close();
      hush();
      node.disconnect();
      mic.disconnect();
      stream.getTracks().forEach(track => track.stop());
      void ctx.close();
      setPhase(to);
    };
    end.current = () => finish("off");

    const open = () => {
      t = { ...t, status: "idle" };
      ws = new WebSocket(agentUrl(location.origin, instance, lang()));
      ws.binaryType = "arraybuffer";
      ws.onopen = () => { ws!.send(hello); send({ type: "start_call", preferred_format: "mp3" }); };
      ws.onmessage = e => {
        if (typeof e.data !== "string") { play(e.data as ArrayBuffer); return; }
        const event = parse(e.data);
        if (!event) return;
        if (event.type === "playback_interrupt" || (event.type === "transcript" && event.role === "user" && audible())) hush();
        const was = t.status;
        act(event);
        if (event.type === "sona_say" && !t.muted) say(event.text);
        if (event.type !== "status") return;
        // The agent says idle as the socket opens; idle after it took the call (or after an error) ends it.
        if (event.status !== "idle") { retries = 0; setPhase("on"); }
        else if (was !== "idle" || t.error) finish("failed");
      };
      ws.onclose = () => {
        if (ended) return;
        hush();
        if (retries++ < 2) { setPhase("reconnecting"); setTimeout(() => { if (!ended) open(); }, 1000 * retries); }
        else finish("failed");
      };
    };
    open();
  }

  const live = phase === "connecting" || phase === "on" || phase === "reconnecting";
  const mood = phase === "on" ? talk.status : phase;
  const status = STOPPED[phase] ?? (phase === "reconnecting" ? "The connection dropped. Reconnecting…" : phase === "connecting" ? "Connecting…" : STATE[talk.status]);
  const caption = talk.said || talk.heard;
  return children({
    open: phase !== "off",
    button: <Button variant="primary" icon="mic" className="ask-pill" onClick={start}>Talk to Sona</Button>,
    stage: (
      <section className="ask-stage" data-mood={mood} aria-label="Voice call with Sona">
        <p className="ask-stage-status" role={live ? "status" : "alert"}><span className="ask-stage-dot" aria-hidden="true" />{status}</p>
        <div className="ask-orb" aria-hidden="true"><span>S</span></div>
        <p className="ask-stage-hint">{live ? (phase === "on" ? HINT[talk.status] : "Your microphone is on only during the call.") : "Nothing is being recorded."}</p>
        <p className="ask-caption" aria-live="polite">{(talk.said ? <CareMarked text={talk.said} /> : caption) || (live ? "What you and Sona say will show here." : "The call is not connected.")}</p>
        <div className="ask-dock">
          {live ? <Button className="ask-pill ask-end" icon="phone" onClick={() => end.current?.()}>End call</Button> : (
            <>
              <Button variant="primary" icon="refresh" className="ask-pill" onClick={start}>Try again</Button>
              <Button className="ask-pill ask-close" onClick={() => setPhase("off")}>Close</Button>
            </>
          )}
        </div>
      </section>
    ),
    transcript: (
      <Card title="This call">
        {talk.heard || talk.said ? (
          <div className="ask-lines">
            {talk.heard ? <p className="ask-line"><span>You</span>{talk.heard}</p> : null}
            {talk.said ? <p className="ask-line"><span>Sona</span><CareMarked text={talk.said} /></p> : null}
          </div>
        ) : <p className="ask-quiet">What Sona hears and says will show here.</p>}
      </Card>
    ),
  });
}
