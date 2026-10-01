/**
 * Sona's audio, back to back: each chunk is booked on the audio clock to start where the last one ends (or now, if the
 * queue ran dry), so her sentences play without a gap or a click at the seams, as VoiceClient schedules them. It also
 * says which chunk is playing and how far into it, so her words can light up. Pure: times are the audio clock's seconds,
 * and `stop` is how a booked chunk is silenced.
 */
type Slot = { frame: number; at: number; end: number; stop: () => void };

export class Playback {
  private slots: Slot[] = [];
  private cursor = 0;

  /** Books audio frame `frame` (`duration` s long); returns the time it starts. */
  add(frame: number, duration: number, now: number, stop: () => void) {
    const at = Math.max(now, this.cursor);
    this.cursor = at + duration;
    this.slots = [...this.slots.filter(s => s.end > now), { frame, at, end: this.cursor, stop }];
    return at;
  }

  /** The frame playing at `now` and how far into it (0–1); undefined between and after them. */
  at(now: number) {
    const s = this.slots.find(x => x.at <= now && now < x.end);
    return s && { frame: s.frame, share: (now - s.at) / (s.end - s.at) };
  }

  /** Something is playing, or booked to. */
  busy(now: number) {
    return now < this.cursor;
  }

  /** Silences everything booked, at once. */
  clear() {
    for (const s of this.slots) {
      try { s.stop(); } catch { /* already over */ }
    }
    this.slots = [];
    this.cursor = 0;
  }
}
