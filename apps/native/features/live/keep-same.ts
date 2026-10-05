/**
 * The value already held when a re-read brings the same data. Screens re-read on every mount and focus, and a new object
 * re-renders every screen reading it though nothing changed: opening a visit from Patients re-rendered Today and the visit
 * 13 times on the simulator, most of them for re-reads like these (a store read through useSyncExternalStore, or a
 * state setter, leaves its readers alone when handed the value it already holds).
 */
export const keepSame = <T>(held: T | undefined, next: T): T => held !== undefined && JSON.stringify(held) === JSON.stringify(next) ? held : next;
