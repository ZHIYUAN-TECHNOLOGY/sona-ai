# Sona on the web

Sona Pro (`/pro`, clinicians) and Sona Care (`/care`, patients) in one Vite app, served by the Worker on its own
origin. Plan: `docs/web-apps-plan.md`. Design rules: the "UX principles" section of `docs/design-direction.md`.

## Run

- `bun run build`, then `bun run check-types` (the build writes the gitignored `src/routeTree.gen.ts` that the types need), `bun test src`.
- `bun run dev` proxies `/rpc`, `/api/auth`, `/live`, `/agents` to the Worker at `SONA_SERVER_URL` (default `http://localhost:3000`).

## Building a page

A page is its route file in `src/routes/pro/_app/` or `src/routes/care/_app/` (TanStack Router file routes; the
`_app` layout signs the user in and draws the frame). A page owns its route file(s), a folder `src/features/<page>/`
for its parts, and one stylesheet `src/styles/pages/<page>.css` imported by the route file. Everything else is shared
and read-only: if a shared file needs a change, say so in your report instead of editing it.

- **Data**: `import { orpc, client } from "@/lib/orpc"`. Read with `useQuery(orpc.day.list.queryOptions({ input }))`,
  write with `useMutation(orpc.tasks.complete.mutationOptions())` and invalidate with `orpc.tasks.list.key()`.
  The routers are in `packages/api/src/routers/` (the map is `index.ts`); the phone apps (`apps/native`,
  `apps/care`, read-only) show how each procedure is used: grep them for the procedure name.
  Real data only: no sample patients, no mock rows. A model answer the server labels `source: "fixture"` or
  `waking` is shown labelled as a sample, as the phone apps do.
- **Who is signed in**: `Route.useRouteContext()` in a child of `_app` gives `me` (Pro: `role`, `name`; hide or
  explain what the role cannot do with `can(me.role, "results.acknowledge")` from `@sona-ai/api/roles`).
- **Sona bar**: the frame already shows it and renders answers at the top of the page. To answer from the page's
  own data: `useSonaAsk(handler)` from `@/lib/sona`, a stable `(question: string) => Promise<ReactNode>`.
- **Components** (`src/components/`, no barrel): `page` (`PageHeader`, `EmptyState`), `insight-card`
  (`InsightCard`, `InsightRow`), `data-table` (`DataTable`, `Column`), `charts` (`LineChart`, `BarChart`),
  `primitives` (`Avatar`, `Chip`, `Button`, `Field`, `Card`, `Tone`), `rail` (`RightRail`, `WithRail`).
  Read the file for props before use.
- **Tokens** (`src/styles/tokens.css`): `--canvas --surface --ink --muted --line --blue --blue-wash --green --amber
  --red` and their `-wash`, `--text-* --space-1..6 --radius-* --tap`, `.glass`, `.halftone`. Tokens only, no new
  colours, no inline hex.

## Page shape

Insight first: a row of at most three insight cards (one lead line, one suggested next step, "You decide · N
sources"), then the main table or detail, then a right rail when there is a second thing worth seeing. Act in
place (no modals for the main action), review before deciding, loading, empty and refused states in plain words.
Colour carries meaning only: red must-not-miss, amber soon or blocked, green done or safe, blue the next step.
Glass for floating surfaces; halftone on one accent per page at most. Pro: dense, letter avatars. Care: 17 px
body, 48 px targets, red only for "call the hospital now", short sentences.
