/** Two values hold the same data (plain data: what a server read or a count over the store derives). */
export const sameJSON = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Two objects hold the same values, key by key (a few fields picked out of a store). */
export const sameShallow = <T extends object>(a: T, b: T) => Object.keys(a).length === Object.keys(b).length && (Object.keys(b) as (keyof T)[]).every(k => Object.is(a[k], b[k]));
/**
 * The value already held when a re-read brings the same data. Screens re-read on every mount and focus, and a new object
 * re-renders every screen reading it though nothing changed: opening a visit from Patients re-rendered Today and the visit
 * 13 times on the simulator, most of them for re-reads like these (a store read through useSyncExternalStore, or a
 * state setter, leaves its readers alone when handed the value it already holds).
 */
export const keepSame = <T>(held: T | undefined, next: T): T => held !== undefined && sameJSON(held, next) ? held : next;
