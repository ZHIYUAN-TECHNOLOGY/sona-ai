import type { client } from "@/lib/orpc";

export type ResultRow = Awaited<ReturnType<typeof client.results.list>>[number];
