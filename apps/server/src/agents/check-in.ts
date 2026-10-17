import type { FollowUp } from "@sona-ai/api/context";
import { runFollowUp } from "@sona-ai/api/routers/check-ins";
import { Agent } from "agents";

import { announcer } from "../context";
import { getDb } from "../services";

type Visit = { hospitalId: string; encounterId: string };

/**
 * Sona's follow-up after discharge: one agent per discharged visit (named by the visit), started by the
 * discharge. It keeps its own state (who it follows, the check-in schedule as it last read it, what it
 * sent, the replies and every decision with why) and wakes itself with an alarm when the next check-in
 * or re-ask is due. The decisions are decideFollowUp's (packages/domain), the database work runFollowUp's.
 *
 * The demo clock moves "due" under the alarm, so a jump, every reply and the hourly cron (the backstop)
 * call tick, which acts on whatever is due by the hospital's clock and sets the alarm again.
 */
export class CheckInAgent extends Agent<Env, FollowUp | null> {
  initialState = null;
  // One wake at a time: an alarm, a reply and a jump can arrive together while a wake awaits Postgres.
  private acting: Promise<unknown> = Promise.resolve();

  /** Acts on what is due now, reads new replies, then sleeps until its next step. */
  tick(hospitalId: string, encounterId: string) {
    const run = this.acting.then(() => this.act({ hospitalId, encounterId }));
    this.acting = run.catch(() => {});
    return run;
  }

  /** The alarm (this.schedule): the next check-in or re-ask is due. */
  async wake(visit: Visit) {
    await this.tick(visit.hospitalId, visit.encounterId);
  }

  /** What it remembers and did, for the clinician; nothing for another hospital. */
  view(hospitalId: string) {
    return this.state?.hospitalId === hospitalId ? this.state : null;
  }

  private async act(visit: Visit) {
    if (this.state && this.state.hospitalId !== visit.hospitalId) throw new Error("This visit is followed for another hospital");
    const { followUp, sent, wakeAt } = await runFollowUp({ db: getDb(), announce: announcer(this.env) }, visit.hospitalId, visit.encounterId, this.state ?? undefined);
    this.setState(followUp);
    for (const alarm of await this.listSchedules()) if (alarm.callback === "wake") await this.cancelSchedule(alarm.id);
    if (wakeAt) await this.schedule(wakeAt, "wake", visit);
    return { sent };
  }
}
