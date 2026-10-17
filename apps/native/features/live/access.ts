/** "just now", "12 min ago", "3 h ago", "2 d ago", from the server's own clock (the demo clock can move it). */
export function ago(at: Date | string, now: Date | string) {
  const mins = Math.max(0, Math.round((new Date(now).getTime() - new Date(at).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  return `${Math.floor(mins / (24 * 60))} d ago`;
}

/** One trail line as read aloud and shown: "Dr Test Aisyah · opened the note (3 times) · 10:02". */
export function trailLine(line: { who: string; did: string; at: Date | string; times: number }) {
  const time = new Date(line.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
  return `${line.who} · ${line.did}${line.times > 1 ? ` (${line.times} times)` : ""} · ${time}`;
}
