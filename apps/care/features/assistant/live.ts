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
 * ./sona-voice); an answer that comes without her voice (it isn't ready) is read by the phone's voice, as today, and so
 * is every answer if the patient picked one of the phone's voices. `phase`: off (no live mode: voice mode stays turn by
 * turn), ready (the agent answered; no call yet), on (in a call), lost (the call dropped or was refused: turn by turn
 * from here, with one line saying so).
 */
export type LivePhase = "off" | "ready" | "on" | "lost";

export function useLiveVoice({ voice, voices, onFlood }: { voice?: SonaVoice; voices?: SonaVoice[]; onFlood: (flood: number) => void }) {
  const user = authClient.useSession().data?.user.id;
  const [talk, setTalk] = useState<Talk>(quiet);
  const [lost, setLost] = useState(false);
  const [error, setError] = useState<string>();
  // Sona is audible (her voice or the phone's); how far into her answer she has spoken (undefined: all of it).
  const [audible, setAudible] = useState(false);
  const [upto, setUpto] = useState<number>();
  const [standIn, setStandIn] = useState(false);
  const live = useRef<Live>(undefined);
  // The answer the phone's voice is reading (0: none), and the last one handed to it, so each is read once.
  const reading = useRef(0), handed = useRef(0);
  const latest = useRef({ talk, voice, onFlood });
  useEffect(() => { latest.current = { talk, voice, onFlood }; });

  const quietPhone = () => {
    if (!reading.current) return;
    reading.current = 0;
    live.current?.setPhone(false);
    setStandIn(false);
    setUpto(undefined);
    void Speech.stop();
  };

  useEffect(() => {
    if (!user || !liveVoiceAvailable()) return;
    let gone = false;
    void authClient.getCookie().then(cookie => {
      if (gone) return;
      live.current = connectLive(agentUrl(ENV.EXPO_PUBLIC_SERVER_URL, user), cookie || undefined, {
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
            const s = spanOf(t.said, at.frame, t.frames, t.done);
            setUpto(wordEnd(t.said, s.start + Math.round((s.end - s.start) * at.share), s.end));
          } else if (!reading.current && t.done) setUpto(undefined);
          latest.current.onFlood(on ? 1 : t.status === "thinking" ? 0.55 : Math.min(0.4, level * 6));
        },
        plays: () => !!latest.current.voice?.hosted,
        closed: () => {
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
    }).catch(() => { /* no session cookie: voice mode stays turn by turn */ });
    return () => { gone = true; live.current?.close(); live.current = undefined; void Speech.stop(); };
  }, [user]);

  // An answer the phone reads: Sona's voice sent none (it isn't ready), or the patient picked one of the phone's voices.
  useEffect(() => {
    const { said, answer, frames, written, done } = talk;
    if (!voice || !voices || !said?.trim() || answer <= handed.current) return;
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

  const start = async () => {
    const l = live.current;
    if (!l) return;
    setError(undefined);
    const started = await l.start();
    if (started === "mic") setError(translate(currentLang(), "listen.mic"));
    else if (started === "failed") { setLost(true); l.close(); }
  };

  const phase: LivePhase = lost ? "lost" : talk.call !== "off" ? "on" : talk.ready ? "ready" : "off";
  return {
    phase, status: talk.status, audible, upto, standIn, error, heard: talk.heard, said: talk.said,
    start,
    end: () => { live.current?.end(); quietPhone(); },
    /** A suggested question, asked in the conversation. */
    say: (question: string) => live.current?.say(question),
  };
}
