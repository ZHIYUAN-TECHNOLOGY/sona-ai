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
- **Components** and **Tokens**: see the sections below. They are exact, so a page never needs to open a shared file.

## Page shape

Every Sona Pro page reads top to bottom as glance, then decide (the UX principles in `docs/design-direction.md`):

1. **Insight** (`PageHeader`): the title, then a `lead` that says where things stand in one line. Wrap the part that
   needs the eye in `<Signal tone>` ("16 of 17 beds occupied · <Signal tone="soon">7 blocked</Signal>"). At most one
   primary button in `actions`: the most likely next step ("Open next visit").
2. **Overview** (`StatRow`): at most four `StatCard`s. A stat that matches a filter of the list below takes
   `onSelect` and `selected`, so pressing the number filters the list in place. A page whose lead already says it all
   needs no stat row.
3. **Work** (`WithRail` main column): one list or table, ranked so what needs the person is first, with the row's
   action in the row.
4. **Review and decide** (the rail, which stays in view while the list scrolls): Sona's `InsightCard` (lead, evidence,
   the one suggested next step, "You decide · N sources"), and the review panel for the selected row with its
   decision buttons beside the evidence. With a row selected, its panel and buttons are in view at 1440 x 900
   without scrolling: put it first, or keep the insight short (detail goes in `children`, behind the disclosure).
   After a decision, say what happened and offer the next step.

Act in place (no modals for the main action); loading, empty and refused states in plain words ("Nothing needs you
today", not a blank card). Colour carries meaning only: red must-not-miss, amber soon or blocked, green done or
safe, blue the next step. Glass for floating surfaces; halftone on one accent per page at most. Pro: dense, letter
avatars. Care: 17 px body, 48 px targets, red only for "call the hospital now", short sentences.

The Pro page column starts at the sidebar (left-aligned, `--page-max` wide); the Sona bar sits centred over it.


## Tokens

All tokens are custom properties in `src/styles/tokens.css`, set on `.pro` and `.care`. Rules:

- Pages use tokens only. No inline hex, no new colours, no raw pixel radii or shadows.
- Colour carries meaning only: red must-not-miss, amber soon or blocked, green done or safe, blue the next step.
- A calm state ("Stable", "Routine", "Seen") is plain `--muted` text, not a chip. A chip is for a state that needs the eye.

Values marked "Pro / Care" differ between the apps. Everything else is shared.

**Colour and meaning**

- `--canvas`: page background (Pro `#F5F6F8` / Care `#FAFAFA`).
- `--surface`: cards, tables, fields on a card.
- `--ink`: main text and the strongest fill.
- `--muted`: secondary text, captions, calm states.
- `--placeholder`: placeholder text in fields only.
- `--blue`, `--blue-wash`: the next step, links, selection accent; the wash is its soft background.
- `--green`, `--green-wash`: done or safe.
- `--amber`, `--amber-wash`: soon or blocked.
- `--red`, `--red-wash`: must-not-miss. In Care, red is only "call the hospital now".
- `--line`: borders of fields and controls.
- `--font`: the app typeface (Pro Inter / Care Plus Jakarta Sans). Already set on the app root.

All colour values differ between Pro and Care; the names and meanings do not.

**AI panel**

- `--navy`: the dark end of the AI gradient.
- `--ai-gradient`: background of a Sona insight panel. Use on Sona's own surfaces only.
- `--on-ai`: text on the gradient. `--on-ai-soft`: secondary text on the gradient.
- `--ai-row`: a row or tile fill on the gradient.

**Fills and lines**

- `--canvas-deep`: the shell behind the Pro frame, one step darker than `--canvas`.
- `--hairline`: dividers inside a card or table. Lighter than `--line`.
- `--fill-hover`: hover background of rows and quiet controls.
- `--fill-selected`: selected row or tab, neutral chip background.
- `--fill-field`: background of search and filter fields.
- `--glass`, `--glass-blur`, `--glass-edge`: parts of the `.glass` class. Use the class, not the parts.

**Radii**

- `--radius-control` 14px: buttons that are not pills, inputs, small tiles.
- `--radius-group` 20px: grouped blocks inside a card.
- `--radius-card`: cards (Pro 28px / Care 24px).
- `--radius-shell` 28px: the frame shell.
- `--radius-pill` 999px: pills, chips, badges.

**Type sizes**

- `--text-stat` (Pro 44px / Care 64px): the number in a stat card.
- `--text-page` 36px: page title.
- `--text-panel` 28px: panel or insight heading.
- `--text-display` 27px, `--text-title` (Pro 21px / Care 22px), `--text-heading` 19px: headings in descending order.
- `--text-body` (Pro 15px / Care 17px) with `--line-body` (Pro 22px / Care 26px): body text.
- `--text-small` 13px: captions, chips, table meta.
- `--text-overline` (Pro 12px / Care 11px): uppercase labels.

**Tracking**

- `--track-overline` 0.06em: uppercase overlines.
- `--track-tight` -0.02em: titles and headings.
- `--track-display` -0.03em: page title and stat numbers.

**Spacing and sizes**

- `--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px, `--space-5` 24px, `--space-6` 32px: all gaps and padding.
- `--gap-card` 12px: gap between cards. `--pad-card` 28px: padding inside a card.
- `--tap` (Pro 36px / Care 48px): smallest target for a custom control.
- `--pill-h` 48px: large pill button. `--field-h` 44px: fields. `--chip-h` 26px: chips. `--row-h` 64px: table and list rows.
- `--avatar-sm` 28px, `--avatar-md` 40px, `--avatar-lg` 56px: avatar sizes; match a custom leading tile to these.
- `--side-width` 220px, `--rail-width` 68px: frame navigation widths. `--page-max` 1440px: the Pro page column. Read-only facts for layout maths.

**Shadows**

- `--shadow-card`: resting cards. `--shadow-float`: popovers and floating surfaces. `--shadow`: the `.glass` shadow.

**Motion**

- `--ease`: the one easing curve. `--quick` 160ms: hover and press. `--slow` 240ms: reveal and expand. `--settle` 380ms: layout moves.
- `--press` 0.98: scale of a pressed control.
- Reduced motion is handled globally. Do not add your own media query for it.

**Focus**

- `:focus-visible` already draws a 2px `--blue` outline on everything. `--focus-ring` is the box-shadow form for a control that clips outlines.

**Utility classes a page may use**

- `.glass`: floating surfaces only. `.halftone`: one accent per page at most, never behind text.
- `.visually-hidden`: text for screen readers only.
- `data-tone="info|urgent|soon|done|blue|amber|red|green|ink|neutral"` on your own element sets `--tone` and `--tone-wash` for it (neutral sets the wash only).
- `.icon` is set by `Icon`. Other shared class names (`.card`, `.btn`, `.table`, ...) belong to the components: render the component instead of the class.

## Components

All in `src/components/`, no barrel. Import from `@/components/<file>`. Snippets use placeholders for data from your own queries.

### `@/components/icon`

`Icon({ name, size = 20, label, ...svgProps }: { name: IconName; size?: number; label?: string } & Omit<SVGProps<SVGSVGElement>, "name">)`. A line icon in `currentColor`. Give `label` only when the icon stands alone.

`IconName` is one of: `today` `calendar` `tasks` `users` `user` `clipboard` `flask` `scan` `message` `inbox` `bed` `swap` `home` `file` `shield-check` `book` `database` `settings` `activity` `search` `plus` `arrow-right` `arrow-up-right` `chevron-left` `chevron-right` `chevron-down` `check` `x` `mic` `send` `filter` `sort` `clock` `more` `edit` `download` `bell` `sign-out` `sparkle` `alert` `pill`. There are no others; do not add SVGs to a page.

```tsx
<Icon name="clock" size={16} />
```

### `@/components/avatar`

- `Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" })`. Letter avatar, tinted from the name. Also exported from `primitives`.
- `initials(name: string)`: the letters the avatar shows. `hueOf(name: string): number`: its hue, 0 to 359.

```tsx
<Avatar name={patient.name} size="sm" />
```

### `@/components/primitives`

Types: `Tone = "info" | "urgent" | "soon" | "done"` (blue, red, amber, green). `ChipTone = Tone | "neutral" | "blue" | "amber" | "red" | "green" | "ink"`. `Target = { to?; search?; params?; href? }` (TanStack `LinkProps` fields, or a plain `href`). `CornerAction = Target & { label: string }`. `TabItem<T extends string = string> = { id: T; label: ReactNode; count?: number }`.

- `Anchor(props: Target & { className?: string; children?: ReactNode; aria-*; data-* })`. A router link for `to`, an `<a>` for `href`.
- `Chip({ tone = "neutral", variant = "soft", icon, children }: { tone?: ChipTone; variant?: "soft" | "solid" | "outline"; icon?: IconName; children: ReactNode })`. A state that needs the eye. Calm states are plain text.
- `Button(props: ButtonHTMLAttributes<HTMLButtonElement> & Target & { variant?: "primary" | "secondary" | "quiet" | "danger"; size?: "sm" | "md" | "lg"; icon?: IconName; pending?: boolean })`. Defaults: `variant="quiet"`, `size="md"`, `type="button"`. With `to` or `href` it renders a link. States: `pending` shows a spinner in place of the icon, disables the button and sets `aria-busy`; `disabled` as usual (a link gets `aria-disabled` and loses its target). One primary button per page.
- `IconButton(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & Target & { icon: IconName; label: string; variant?: "outline" | "ink" | "quiet"; size?: "sm" | "md"; pending?: boolean })`. Defaults: `variant="outline"`, `size="md"`. `label` is required: it is the accessible name and the tooltip. `pending` disables and sets `aria-busy`.
- `Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: ReactNode; children: (control: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode })`. Labelled control; spread `control` onto your input. `error` is announced.
- `SearchField({ label, className, ...inputProps }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string })`. Search input with an icon. `label` is the accessible name.
- `Card({ title, action, className, children }: { title?: string; action?: CornerAction; className?: string; children: ReactNode })`. The white surface. `action` is a corner arrow link.
- `StatRow({ children }: { children: ReactNode })`. A row of stat cards.
- `StatCard({ title, value, unit, caption, chip, tone = "neutral", action, feature, progress, onSelect, selected }: { title: string; value: ReactNode; unit?: string; caption?: ReactNode; chip?: ReactNode; tone?: ChipTone; action?: CornerAction; feature?: boolean; progress?: number; onSelect?: () => void; selected?: boolean })`. A compact glance tile: title, number, one-line caption. `chip` (two or three words) sits beside the number in `tone`. `feature` marks the one highlighted stat in a row. `progress` is 0 to 1 and draws an arc. `onSelect` makes the whole card a button that filters the list below; `selected` marks the filter in use.
- `Signal({ tone = "info", children }: { tone?: Tone; children: ReactNode })`. Inline text in its tone's colour, for the part of a `PageHeader` lead that needs the eye.
- `Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string })`. Controlled tab list with arrow keys. The selected tab is `value`.
- `tabForKey<T extends string>(ids: T[], current: T, key: string): T | undefined`. The tab an arrow key moves to. `Tabs` uses it; pages rarely need it.
- `ListCard({ title, action, children }: { title?: string; action?: CornerAction; children: ReactNode })`. A card that holds `ListRow`s.
- `ListRow(props: Target & { title: ReactNode; caption?: ReactNode; avatar?: string; icon?: IconName; leading?: ReactNode; trailing?: ReactNode; onClick?: () => void; selected?: boolean; disabled?: boolean })`. Leading is one of `avatar` (a name), `icon` (a tile) or `leading` (any node). With a target or `onClick` the row is a link or button and shows a chevron instead of `trailing`.
- `Skeleton({ width = "100%", height = 16, round }: { width?: number | string; height?: number | string; round?: boolean })`. A loading placeholder block.
- `Pager({ page, pageSize, total, onPage, noun }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; noun?: string })`. Previous and next with a count. `page` starts at 1.
- `pageRange(page: number, pageSize: number, total: number): [number, number]`. First and last row numbers on a page; `[0, 0]` when `total` is 0.

```tsx
<Button variant="primary" icon="check" pending={complete.isPending} onClick={() => complete.mutate({ id: task.id })}>Mark done</Button>
<Button to="/pro/patients" icon="users">All patients</Button>
<IconButton icon="filter" label="Filter" onClick={openFilter} />
<Chip tone="urgent" icon="alert">{result.flag}</Chip>
<Card title="Results" action={{ to: "/pro/results", label: "All results" }}>{children}</Card>

<StatRow>
  <StatCard title="Due today" value={tasks.length} feature action={{ to: "/pro/tasks", label: "Open tasks" }} />
  <StatCard title="Beds in use" value={beds.used} unit={`of ${beds.total}`} progress={beds.used / beds.total} />
  <StatCard title="Overdue" value={overdue.length} chip={overdue.length ? "Act now" : undefined} tone="urgent" onSelect={() => setTab("overdue")} selected={tab === "overdue"} />
</StatRow>

<Tabs label="Results" tabs={[{ id: "new", label: "New", count: fresh.length }, { id: "all", label: "All" }]} value={tab} onChange={setTab} />
<SearchField label="Search patients" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />

<ListCard title="Up next" action={{ to: "/pro/schedule", label: "Schedule" }}>
  {slots.map((slot) => (
    <ListRow key={slot.id} avatar={slot.patientName} title={slot.patientName} caption={slot.time} to="/pro/visit" search={{ id: slot.encounterId }} />
  ))}
</ListCard>

{query.isPending ? <Skeleton height={20} width={160} /> : <p>{summary}</p>}
<Pager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} noun="patients" />
```

### `@/components/page`

- `Crumb = { label: string; to?: LinkProps["to"] }`.
- `PageHeader({ title, lead, subtitle, breadcrumb, status, actions, children }: { title: string; lead?: ReactNode; subtitle?: ReactNode; breadcrumb?: Crumb[]; status?: ReactNode; actions?: ReactNode; children?: ReactNode })`. `lead` is the one line under the title and says what matters; `subtitle` is the same slot. `status` is quiet text beside the title. `actions` are the buttons at the right.
- `EmptyState({ title, icon, action, children }: { title?: string; icon?: IconName; action?: ReactNode; children?: ReactNode })`. Empty, refused or failed states in plain words.
- `PatientStrip({ name, meta, tabs, chips }: { name: string; meta?: ReactNode; tabs?: ReactNode; chips?: ReactNode })`. The patient banner on a detail page: avatar, name, meta line, chips, and a `Tabs` slot.

```tsx
<PageHeader title="Results" lead={lead} status={updatedAt} actions={<Button variant="primary" icon="plus" onClick={add}>New order</Button>} />
<EmptyState icon="flask" title="No results to review" action={<Button to="/pro/patients">Open patients</Button>}>New results appear here.</EmptyState>
<PatientStrip name={patient.name} meta={patient.mrn} chips={allergyChips} tabs={<Tabs label="Record" tabs={tabs} value={tab} onChange={setTab} />} />
```

### `@/components/insight-card`

- `InsightCard({ lead, next, sources, tone = "info", children, label, meta, title, evidence }: { lead: string; next?: Next; sources?: number; tone?: Tone; children?: ReactNode; label?: string; meta?: ReactNode; title?: string; evidence?: { icon?: IconName; text: ReactNode }[] })` where `Next = { label: string; step?: string } & ({ onAct: () => void } | { to: LinkProps["to"] })`. `lead` says where things stand. `next` is the one suggested step. `sources` is how many sources it draws on. `children` is detail behind a disclosure. `label` is the pill at the top left, `meta` small text at the top right. With `title`, `lead` reads as the paragraph under it. `evidence` is one row per supporting fact.
- `InsightRow({ children }: { children: ReactNode })`. A row of at most three insight cards.

```tsx
<InsightCard label="Sona insight" title={insight.title} lead={insight.lead} tone="soon" sources={insight.sources.length}
  evidence={insight.sources.map((s) => ({ icon: "file", text: s.label }))}
  next={{ label: "Review", step: insight.step, to: "/pro/review" }} />
```

### `@/components/data-table`

- `Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode; sort?: (a: T, b: T) => number; align?: "left" | "center" | "right" }`. A `sort` comparator (ascending) makes the column sortable.
- `DataTable<T>({ columns, rows, rowKey, onRowOpen, rowAction, empty, selectedKey, toolbar, count, footer, loading }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; onRowOpen?: (row: T) => void; rowAction?: (row: T) => ReactNode; empty?: ReactNode; selectedKey?: string; toolbar?: ReactNode; count?: ReactNode; footer?: ReactNode; loading?: boolean | number })`.
- `PersonCell({ name, detail, size = "md" }: { name: string; detail?: ReactNode; size?: "sm" | "md" | "lg" })`. Avatar, name and a detail line.
- `ValueCell({ value, unit }: { value: ReactNode; unit?: ReactNode })`. A number with a quiet unit.
- `RowAction({ children, onClick, to }: { children: ReactNode; onClick?: () => void; to?: LinkProps["to"] })`. The in-place action for a row, with a trailing arrow. With `to` it is a router link (and still calls `onClick`); without, a button.

States: `loading` shows skeleton rows (a number sets how many, default 5). `empty` shows when `rows` is empty; pass an `EmptyState`. `selectedKey` marks one row selected. `onRowOpen` makes rows focusable; click or Enter opens. `toolbar` sits above the header, `count` at the footer left, `footer` at the footer right. The table sorts and does not page: slice `rows` yourself.

```tsx
const [from, to] = pageRange(page, pageSize, patients.length);
const columns: Column<Patient>[] = [
  { key: "name", header: "Patient", cell: (p) => <PersonCell name={p.name} detail={p.mrn} />, sort: (a, b) => a.name.localeCompare(b.name) },
  { key: "hb", header: "Hb", align: "right", cell: (p) => <ValueCell value={p.hb.value} unit={p.hb.unit} /> },
];
<Card>
  <DataTable columns={columns} rows={patients.slice(from - 1, to)} rowKey={(p) => p.id}
    loading={query.isPending} empty={<EmptyState title="No patients match" />}
    selectedKey={openId} onRowOpen={(p) => setOpenId(p.id)}
    rowAction={(p) => <RowAction onClick={() => review(p)}>Review</RowAction>}
    toolbar={<SearchField label="Search patients" value={q} onChange={(e) => setQ(e.target.value)} />}
    count={`Showing ${from}-${to} of ${patients.length}`}
    footer={<Pager page={page} pageSize={pageSize} total={patients.length} onPage={setPage} />} />
</Card>
```

### `@/components/charts`

`Point = { x: string; y: number }` (from `./chart-scale`). Shared chart props: `{ points: Point[]; label: string; unit?: string; height?: number; description?: string; goal?: { value: number; label?: string }; showValues?: boolean; describe?: (point: Point, index: number) => string }`. `label` is the accessible name, `description` a longer one. `goal` draws a dashed target line. `describe` gives the tooltip line for a point.

- `LineChart(props: ChartProps & { band?: { low: number; high: number } })`. `height` defaults to 200. `band` shades a normal range.
- `BarChart(props: ChartProps)`. `height` defaults to 200.
- `Sparkline({ values, label, tone = "neutral", width = 96, height = 28 }: { values: number[]; label: string; tone?: "amber" | "neutral"; width?: number; height?: number })`. A trend in a table cell or stat.

Empty `points` draws the chart's own empty state.

```tsx
<LineChart label="Haemoglobin" unit={series.unit} points={series.points} band={series.range} describe={(p) => `${p.y} on ${p.x}`} />
<BarChart label="Visits per day" points={visits} showValues />
<Sparkline label="Heart rate trend" values={vitals.map((v) => v.hr)} tone={rising ? "amber" : "neutral"} />
```

### `@/components/rail`

- `WithRail({ rail, children }: { rail: ReactNode; children: ReactNode })`. Main column with a right rail. On Pro the rail stays in view while the main column scrolls (and scrolls by itself when taller than the window); it drops below on narrow screens.
- `RightRail({ label, children }: { label: string; children: ReactNode })`. The rail itself. `label` names the region.

```tsx
<WithRail rail={<RightRail label="Next steps">{railCards}</RightRail>}>{main}</WithRail>
```

### Frame, Sona bar and navigation (already mounted, do not render)

- `Frame({ app, brand, groups, who, name, instead })` from `@/components/frame` and `SonaBar({ app }: { app: "pro" | "care" })` from `@/components/sona-bar` are drawn by the `_app` layout.
- `SonaGlow` (`@/components/sona-glow`) is the dithered halo around the Sona bar, drawn by `SonaBar` in both apps: still at rest, waving while the bar is in use, blooming with the voice, a sweeping beam while Sona thinks. It is the frame's one moving halftone; do not add another.
- `@/nav`: `NavItem = { to: string; label: string; icon: IconName; count?: number; needs?: string }`, `NavGroup = { label: string; items: NavItem[] }`, `PRO_NAV`, `CARE_NAV`, `navFor(role, groups = PRO_NAV): NavGroup[]`.

## Page recipe

```tsx
<>
  <PageHeader title={title} lead={lead} actions={actions} />
  <StatRow>{stats}</StatRow>
  <WithRail rail={
    <RightRail label="Insights">
      <InsightCard label="Sona insight" lead={insight.lead} next={insight.next} sources={insight.sources.length} />
      <ListCard title="Up next">{rows}</ListCard>
    </RightRail>
  }>
    <Card><DataTable columns={columns} rows={rows} rowKey={(r) => r.id} loading={query.isPending} /></Card>
  </WithRail>
</>
```

- The frame wraps the page in `.frame-page` (a column, `--gap-card` between children on Pro, left-aligned, max width `--page-max`). Do not add your own outer wrapper, max width or page padding.
- Pro pages get bottom padding for the Sona bar from the frame (`.frame-scroll`, 128px). Do not add your own.
- Navigation comes from `nav.ts`. `needs` hides an entry the role cannot use. `count` draws a badge when above zero, but nothing supplies it yet: do not expect or fake badges.
- Loading is `Skeleton` or `DataTable loading`. Empty and refused are `EmptyState` in plain words.
- Page-only styles go in `src/styles/pages/<page>.css`, using tokens.
- Do not edit: anything in `src/components/`, any `src/styles/*.css` outside `src/styles/pages/`, or `src/nav.ts`. If a shared piece is missing something, say so in your report.

### Shared additions (design-system fixes)

- `DataTable`: the table scrolls sideways inside its card (`.table-scroll`) and is never wider than it. `PersonCell` keeps name and caption on one line each with an ellipsis (full text in `title`) and sizes to its content between 150px and 220px. Header labels never wrap. Inside a `Card` the table drops its own padding, so the toolbar starts where any card content starts. The action column is as narrow as its content.
- `TextCell` (`data-table.tsx`): long cell text, two lines then an ellipsis.
- `TableToolbar({ children, end })`: pass it as `DataTable`'s `toolbar`; `children` (tabs, filters) sit left, `end` (`SearchField`, icon buttons) right, wrapping under 900px.
- `StatCard`: value and `unit` share one baseline, the unit shrinks with an ellipsis; title and caption keep to one line; value rows align across a `StatRow`.
- `InsightCard` `next`: `onAct`, or a full target (`to`, `params`, `search`, or `href`); `pending` shows the action as busy.
- `FileTile({ icon })`, `DetailList({ items: [{ label, value }] })`, `SectionLabel`, `Select({ label })` in `primitives.tsx`; `.num` for tabular numerals.
- Icons: `info`, `phone`, `upload`, `image`, `trash`, `refresh`, `external`.
- Token `--sona-bar-clearance` (176px): bottom padding of the Pro scroll area, so the last card clears the Sona bar.
