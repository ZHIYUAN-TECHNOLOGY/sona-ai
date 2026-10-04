/**
 * The judge build's rules (EXPO_PUBLIC_JUDGE_BUILD, read once in ./index as JUDGE): the hospital record
 * is the only mode, so nothing a judge sees is sample data. Pure, so the rules are tested without the app.
 */

/** Whether the app reads the server: always in the judge build, else the Settings switch. */
export const wantsLive = (judge: boolean, chosen: boolean) => judge || chosen;

/**
 * What stands between a judge and the app. "open": nothing (always, outside the judge build). "wait": the
 * saved sign-in is still being checked. "sign-in": nobody is signed in. "reading": signed in, the hospital
 * record is on its way. "failed": the server refused or did not answer; the reason is shown, never a sample.
 */
export type Gate = "open" | "wait" | "sign-in" | "reading" | "failed";
export function gateOf({ judge, settled, signedIn, read, failed }: { judge: boolean; settled: boolean; signedIn: boolean; read: boolean; failed: boolean }): Gate {
  if (!judge) return "open";
  if (!settled) return "wait";
  if (!signedIn) return "sign-in";
  // A record already read stays up through a later failed re-read: what is on screen is still the server's.
  return read ? "open" : failed ? "failed" : "reading";
}
