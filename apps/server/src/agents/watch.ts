import { hosted } from "@sona-ai/api/sagemaker";
import { watchKeeper, type Watch, type WatchBook } from "@sona-ai/api/watches";
import { Agent } from "agents";

import { announcer } from "../context";
import { getDb } from "../services";

type Who = { hospitalId: string; userId: string };

/**
 * A clinician's own watches: one agent per clinician (named by the user), created the first time they
 * ask Sona to keep watching something. It keeps its own state (the watches and each one's latest answer)
 * and wakes itself with an alarm when the next one is due. The work is watchKeeper's (packages/api/src/watches.ts):
 * read-only, answered through the ask bar's checked path.
 *
 * The demo clock moves "due" under the alarm, so a jump calls tick too (wakeWatches).
 *
 * Typed on Cloudflare.Env, not Env: Env (alchemy.run.ts) names every agent class, and a second class written
 * `extends Agent<Env, …>` after CheckInAgent is a type cycle. The return types are written out for the same reason.
 */
export class WatchAgent extends Agent<Cloudflare.Env, WatchBook | null> {
  initialState = null;
  // One step at a time: an alarm, a jump and a new watch can arrive together while a step awaits the model.
  private acting: Promise<unknown> = Promise.resolve();

  list(hospitalId: string, userId: string): Watch[] {
    return this.keeper({ hospitalId, userId }).list();
  }

  add(hospitalId: string, userId: string, watch: Pick<Watch, "id" | "question" | "hour">): Promise<Watch> {
    return this.step({ hospitalId, userId }, async keeper => {
      const { watch: kept, wakeAt } = await keeper.add(watch);
      return { result: kept, wakeAt };
    });
  }

  remove(hospitalId: string, userId: string, watchId: string): Promise<void> {
    return this.step({ hospitalId, userId }, async keeper => ({ result: undefined, wakeAt: (await keeper.remove(watchId)).wakeAt }));
  }

  /** Asks whatever is due now, then sleeps until the next one. */
  tick(hospitalId: string, userId: string): Promise<{ ran: number }> {
    return this.step({ hospitalId, userId }, async keeper => {
      const { ran, wakeAt } = await keeper.tick();
      return { result: { ran }, wakeAt };
    });
  }

  /** The alarm (this.schedule): a watch is due. */
  async wake(who: Who): Promise<void> {
    await this.tick(who.hospitalId, who.userId);
  }

  private keeper(who: Who): ReturnType<typeof watchKeeper> {
    const env = this.env as Env;
    return watchKeeper({ db: getDb(), baseten: hosted(env), announce: announcer(env) }, { get: () => this.state, set: book => this.setState(book) }, who.hospitalId, who.userId);
  }

  private step<T>(who: Who, act: (keeper: ReturnType<typeof watchKeeper>) => Promise<{ result: T; wakeAt?: Date }>): Promise<T> {
    const run = this.acting.then(async () => {
      const { result, wakeAt } = await act(this.keeper(who));
      for (const alarm of await this.listSchedules()) if (alarm.callback === "wake") await this.cancelSchedule(alarm.id);
      if (wakeAt) await this.schedule(wakeAt, "wake", who);
      return result;
    });
    this.acting = run.catch(() => {});
    return run;
  }
}
