import type { Context } from "@sona-ai/api/context";
import type { EncounterEdit, RecordReview } from "@sona-ai/api/contracts";
import { applyEdit, applyReview, loadEncounter, saveEncounter, type EncounterSnapshot } from "@sona-ai/api/routers/encounter";
import { createDb } from "@sona-ai/db";
import type { DatabaseConfig } from "@sona-ai/db/config";
import { DurableObject } from "cloudflare:workers";

/**
 * One per encounter: the live state and revision the agent works against, kept in Durable Object
 * storage and written through to the Postgres snapshot on every change. Postgres stays the arbiter
 * of revisions, so a write that lost a race is refused and the object reloads what won.
 */
export class EncounterState extends DurableObject<DatabaseConfig> {
  constructor(ctx: DurableObjectState, env: DatabaseConfig, private readonly db: Context["db"] = createDb(env)) {
    super(ctx, env);
  }

  async get(hospitalId: string, encounterId: string): Promise<EncounterSnapshot> {
    return (await this.ctx.storage.get<EncounterSnapshot>("snapshot")) ?? this.reload(hospitalId, encounterId);
  }

  async edit(hospitalId: string, edit: EncounterEdit): Promise<EncounterSnapshot> {
    const current = await this.get(hospitalId, edit.encounterId);
    return this.commit(hospitalId, current, () => applyEdit(current, edit));
  }

  /** The medication review ran against `expectedRevision`; it stays current until the next eligibility or medicine edit. */
  async recordReview(hospitalId: string, review: RecordReview): Promise<EncounterSnapshot> {
    const current = await this.get(hospitalId, review.encounterId);
    return this.commit(hospitalId, current, () => applyReview(current, review));
  }

  private async commit(hospitalId: string, current: EncounterSnapshot, next: () => EncounterSnapshot) {
    try {
      const saved = await saveEncounter(this.db, hospitalId, current.revision, next());
      await this.ctx.storage.put("snapshot", saved);
      return saved;
    } catch (error) {
      await this.reload(hospitalId, current.encounterId);
      throw error;
    }
  }

  private async reload(hospitalId: string, encounterId: string) {
    const snapshot = await loadEncounter(this.db, hospitalId, encounterId);
    await this.ctx.storage.put("snapshot", snapshot);
    return snapshot;
  }
}
