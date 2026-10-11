import * as Speech from "expo-speech";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { currentLang, translate } from "@/lib/i18n";
import { agentUrl, quiet, spanOf, type Talk } from "@/lib/live-voice/protocol";
import { connectLive, liveVoiceAvailable, type Live } from "@/lib/live-voice/session";
import { ENV } from "@/src/env";
import { standInFor, voiceFor, wordEnd, type SonaVoice } from "./voices";
import "./strings";

/**
 * Voice mode as one live conversation with Sona's voice agent (lib/live-voice), where this build has the audio module
 * and the server has the agent: the patient just talks, Sona answers in her own voice as each sentence is ready, and
 * talking over her stops her. Her words light up by how much of each sentence has played (an estimate, as in
 * ./sona-voice); a sentence her voice was too slow for is read by the phone's voice in its place (lit on its word
 * boundaries), an answer that comes with none of her voice (it isn't ready) is read whole by the phone's voice, and so
 * is every answer if the patient picked one of the phone's voices. `phase`: off (no call: the socket is opening, closed,
 * or this build has no live mode), ready (the agent answered; no call yet), on (in a call, or starting one), lost (the
 * call dropped or was refused, with one line saying so). `available`: this build and account can try a live call, so a
 * tap on the mic starts one whatever the phase (it waits for a socket still opening, and opens a closed one again);
 * voice mode goes turn by turn only when that fails.
 */
export type LivePhase = "off" | "ready" | "on" | "lost";

export function useLiveVoice({ voice, voices, onFlood }: { voice?: SonaVoice; voices?: SonaVoice[]; onFlood: (flood: number, level: number) => void }) {
  const user = authClient.useSession().data?.user.id;
  const [talk, setTalk] = useState<Talk>(quiet);
  const [lost, setLost] = useState(false);
  // A tap on the mic is starting a call (the socket may still be opening): shown as the call, with "Connecting".
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  // Sona is audible (her voice or the phone's); how far into her answer she has spoken (undefined: all of it).
  const [audible, setAudible] = useState(false);
  const [upto, setUpto] = useState<number>();
  const [standIn, setStandIn] = useState(false);
  const live = useRef<Live>(undefined);
  const gone = useRef(false);
  // The answer the phone's voice is reading (0: none), and the last one handed to it, so each is read once.
  const reading = useRef(0), handed = useRef(0);
  const latest = useRef({ talk, voice, voices, onFlood });
  useEffect(() => { latest.current = { talk, voice, voices, onFlood }; });

  const quietPhone = () => {
    if (!reading.current) return;
    reading.current = 0;
    live.current?.setPhone(false);
    setStandIn(false);
    setUpto(undefined);
    void Speech.stop();
  };

  const available = !!user && liveVoiceAvailable();
  /** The socket to the agent: the one open, or a new one (a closed one is opened again on the next tap). */
  const open = async () => {
    if (live.current || !available) return live.current;
    // No session cookie: voice mode stays turn by turn.
    const cookie = await authClient.getCookie().catch(() => undefined);
    if (gone.current || live.current) return live.current;
    const mine: Live = live.current = connectLive(agentUrl(ENV.EXPO_PUBLIC_SERVER_URL, user, currentLang()), cookie || undefined, {
      change: t => {
        // A new answer starts faint and lights up as she speaks it.
        if (t.answer !== latest.current.talk.answer) setUpto(0);
        latest.current.talk = t;
        setTalk(t);
        if (t.dropped) { setLost(true); live.current?.close(); }
      },
      hush: quietPhone,
      tick: level => {
        const l = live.current, t = latest.current.talk;
        if (!l) return;
        const on = l.audible(), at = l.playing();
        setAudible(on);
        if (at && t.said) {
          const s = spanOf(t.said, at.frame, t.spoken, t.done);
          setUpto(wordEnd(t.said, s.start + Math.round((s.end - s.start) * at.share), s.end));
        } else if (!on && t.done) setUpto(undefined);
        latest.current.onFlood(on ? 1 : t.status === "thinking" ? 0.55 : Math.min(0.4, level * 6), on ? 0.55 : Math.min(1, level * 10));
      },
      plays: () => !!latest.current.voice?.hosted,
      read: (text, k) => new Promise<void>(done => {
        const { talk: t, voices: all } = latest.current, answer = t.answer;
        if (!all) return done();
        const { start, end } = spanOf(t.said ?? "", k, t.spoken, t.done), v = standInFor(text, all);
        reading.current = answer;
        setStandIn(true);
        setUpto(start);
        const finished = () => { if (reading.current === answer) { reading.current = 0; setStandIn(false); } done(); };
        Speech.speak(text, { voice: v.voice, language: v.language, rate: v.rate, pitch: v.pitch,
          onBoundary: (e: { charIndex: number; charLength: number }) => { if (reading.current === answer) setUpto(Math.min(end, start + e.charIndex + e.charLength)); },
          onDone: finished, onStopped: finished, onError: finished });
      }),
      closed: () => {
        // A socket closed after a newer one opened says nothing about the newer one.
        if (live.current !== mine) return;
        // The last exchange stays on screen; only the connection is gone.
        const wasOn = latest.current.talk.call !== "off", t: Talk = { ...latest.current.talk, ready: false, call: "off" };
        live.current = undefined;
        latest.current.talk = t;
        setTalk(t);
        setAudible(false);
        quietPhone();
        if (wasOn) setLost(true);
      },
    });
    return mine;
  };

  useEffect(() => {
    gone.current = false;
    void open();
    return () => { gone.current = true; live.current?.close(); live.current = undefined; void Speech.stop(); };
  }, [user]);

  // An answer the phone reads: Sona's voice sent none (it isn't ready), or the patient picked one of the phone's voices.
  // Never one she was cut off from (`muted`): the patient has already moved on.
  useEffect(() => {
    const { said, answer, frames, written, done, muted } = talk;
    if (!voice || !voices || !said?.trim() || muted || answer <= handed.current) return;
    if (voice.hosted ? !(done && frames === 0) : !written) return;
    handed.current = reading.current = answer;
    const v = voice.hosted ? standInFor(said, voices) : voiceFor(said, voice, voices);
    live.current?.setPhone(true);
    setStandIn(!!voice.hosted);
    setUpto(0);
    const finished = () => { if (reading.current === answer) quietPhone(); };
    Speech.speak(said, { voice: v.voice, language: v.language, rate: v.rate, pitch: v.pitch,
      onBoundary: (e: { charIndex: number; charLength: number }) => { if (reading.current === answer) setUpto(e.charIndex + e.charLength); },
      onDone: finished, onStopped: finished, onError: finished });
  }, [talk, voice, voices]);

  /** Starts a call. False when there is none to be had now (no agent within READY_MS, or it refused): the caller goes turn by turn. */
  const start = async () => {
    setError(undefined);
    setLost(false);
    setStarting(true);
    try {
      const l = await open();
      const started = l ? await l.start() : "failed";
      if (started === "mic") setError(translate(currentLang(), "listen.mic"));
      else if (started === "failed") l?.close();
      return started !== "failed";
    } finally {
      setStarting(false);
    }
  };

  const phase: LivePhase = starting || talk.call !== "off" ? "on" : lost ? "lost" : talk.ready ? "ready" : "off";
  return {
    phase, available, status: talk.status, audible, upto, standIn, error, heard: talk.heard, said: talk.said, marks: talk.marks,
    start,
    end: () => { live.current?.end(); quietPhone(); },
    /** A suggested question, asked in the conversation. */
    say: (question: string) => live.current?.say(question),
  };
}
