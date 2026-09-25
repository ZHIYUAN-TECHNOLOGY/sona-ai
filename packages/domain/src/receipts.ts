/**
 * Idempotent receipts for consequential actions (discharge, sending a claim, a prescription): the
 * first result for a requestId is kept, and a replay returns it instead of acting again.
 */
export interface ReceiptStore<R> {
  get(requestId: string): Promise<R | undefined>;
  put(requestId: string, receipt: R): Promise<void>;
}

// ponytail: in-memory, for tests and a single Durable Object; Postgres backs it with the unique receipts.request_id.
export function memoryReceipts<R>(): ReceiptStore<R> {
  const map = new Map<string, R>();
  return { get: async id => map.get(id), put: async (id, r) => void map.set(id, r) };
}

/**
 * Returns the stored receipt for requestId, or runs `make` once and stores its result. A throw
 * stores nothing, so a refused or failed request can be retried with the same id.
 * ponytail: two concurrent first calls both run `make`; callers serialise per encounter (a Durable
 * Object does) or rely on the store's unique request_id to reject the second put.
 */
export async function issueOnce<R>(store: ReceiptStore<R>, requestId: string, make: () => R | Promise<R>): Promise<R> {
  const existing = await store.get(requestId);
  if (existing !== undefined) return existing;
  const receipt = await make();
  await store.put(requestId, receipt);
  return receipt;
}
