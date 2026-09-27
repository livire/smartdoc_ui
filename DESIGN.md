# SmartDoc UI — Design & Pattern Conventions

Living reference for UI patterns established while building the Users,
Assignments, My Assignments, and Digitize screens. Follow these on new
screens rather than reinventing layout/behavior each time — several of them
exist to avoid bugs that were actually hit and fixed (see the notes on each).

## Page shell

Every "management" screen (Users, Assignments, My Assignments, Digitize)
uses the same three-part shell:

```tsx
<div className="flex flex-col flex-1 w-full bg-gray-50 dark:bg-gray-900 overflow-hidden min-w-0 min-h-0">
  {/* Header */}
  <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 min-w-0 flex-shrink-0 w-full">
    {/* filters / actions */}
  </div>

  {/* Body */}
  <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 w-full overflow-auto flex-1 min-w-0">
    {/* table / content */}
  </div>
</div>
```

- **No page-level `<h1>`/`<h2>` heading.** The sidebar breadcrumb (see
  `PageBreadCrumb.tsx`'s `pageTitles` map) already names the page — a
  redundant on-page heading was explicitly removed from both the app header
  and individual screens.
- **Don't add `overflow-hidden` to the header div.** It clips any dropdown
  panel that renders outside the header's bounds (see Filter dropdowns
  below) — this caused a real bug and was removed once found.

## Tables

Use the shared primitives in `components/ui/table`:
`Table` / `TableHeader` / `TableBody` / `TableRow` / `TableCell`.

`TableCell` and `TableRow` forward standard HTML attributes (`onClick`,
`colSpan`, etc.) — they extend `Th/TdHTMLAttributes` and `HTMLAttributes`
respectively. If you hit a "Property 'x' does not exist" TS error passing a
DOM attribute to one of these, it means this forwarding was regressed —
restore it rather than casting/working around it in the page.

Row click-to-select pattern (e.g. Users → shows selected user's detail):
give the `TableRow` an `onClick`, highlight with
`bg-brand-50 dark:bg-brand-500/10` when selected, and call
`e.stopPropagation()` inside any per-row action buttons so they don't also
trigger row selection.

## Buttons

Shared `components/ui/button/Button`. Sizes: `xs` (`px-3 py-1.5 text-xs`),
`sm` (`px-4 py-3 text-sm`), `md` (`px-5 py-3.5 text-sm`).

- Use **`xs`** for compact header actions ("Add User", "New Assignment").
  `sm` is still fairly tall for a header bar.
- **Don't pass `startIcon` to a short-label `xs` button.** The icon + `gap-2`
  pushes the label off the button's visual center (confirmed bug — "Add
  User" text looked off-center until the icon was dropped). Icon-only
  buttons are fine; icon+short-label combos on tiny buttons are not.

## Icon buttons (row actions)

Rounded-square, not circular pills: `h-8 w-8 flex items-center justify-center
rounded-md border border-gray-300 dark:border-gray-700`. Color the icon via
`hover:text-{semantic}-500` (`success` for positive/close actions, `error`
for destructive, `brand` for neutral primary). While an action is in flight,
swap the icon for a spinner and disable the button:

```tsx
{isBusy ? (
  <span className="block size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
) : (
  <YourIcon className="size-4" />
)}
```

Icons drawn as raw inline `<svg>` (play triangle, stop square) live directly
in the page file when they're one-off shapes not worth adding to
`src/icons/`.

## Confirmation dialogs

**Never use native `confirm()`/`alert()`** for state-changing actions on
these screens — use the shared `Modal` (`max-w-sm p-6`): bold title, one
explanatory sentence, then a `Cancel` (`variant="outline"`) / confirm
`Button` pair. This was a deliberate change away from `confirm()` after
explicit feedback that in-app dialogs are preferred.

`Modal`'s backdrop is `bg-gray-900/40 backdrop-blur-[1px]` — dark, minimal
blur. It used to be `bg-gray-400/50 backdrop-blur-[32px]`, which visually
flattened the page behind it to solid white on light screens; don't
reintroduce a heavy blur value here.

## Filter dropdowns (multi-select)

Don't use the generic chip/tag-style `MultiSelect` component for compact
filters — it's visually heavy (each selected chip can wrap to its own line
and inflate the control's height). Instead use the compact pattern built for
My Assignments' Status/Identifier filters:

- A single-line trigger button (`h-9`, bordered, `rounded-lg`) showing a
  summary label + a `ChevronDownIcon` that rotates on open.
- **Render the panel via `createPortal(..., document.body)`**, positioned
  with `position: fixed` using `top`/`left` computed from the trigger's
  `getBoundingClientRect()` on open — not a plain `position: absolute` child
  of the trigger. Ancestor `overflow-hidden`/stacking contexts reliably clip
  or hide a locally-positioned panel; this was hit twice before switching to
  a portal fixed it for good.
- Click-outside-to-close must check both the trigger button ref **and** the
  portal panel ref (the panel is no longer a DOM descendant of the trigger
  once portaled).
- Include a **"Select all" / "Clear all"** toggle at the top of the option
  list.
- When the selection is empty, show a distinct greyed-out placeholder
  (e.g. "Select statuses") — **do not** reuse the "All statuses" label for
  an empty selection. That was a real reported bug: showing "All X" when
  zero boxes were checked reads as if "All" had been actively chosen.
- Use `z-99999` on the portaled panel (see z-index section).

## Status badges

Use the shared `Badge` (`components/ui/badge/Badge`, `size="sm"`) rather
than plain colored text for assignment status. Standard 3-way color
mapping, reused verbatim across My Assignments / Assignments / Digitize:

```ts
const STATUS_COLORS: Record<number, "warning" | "info" | "success"> = {
  1: "warning", // Pending
  2: "info",    // In Progress
  3: "success", // Done
};
```

## Toasts

Shared `Toast` component. Default position is bottom-center (original
behavior, still used by the Digitize upload flow). Pass
`position="top-center"` for screens where the triggering action happens in
the header (Users, My Assignments) — added as an explicit prop rather than
changing the global default, so existing bottom-center usages weren't
disturbed. Fire a toast on **both** success and failure for any
state-changing action, not just errors.

## z-index

This app's established top-layer value is **`z-99999`** (five 9s — a valid
Tailwind v4 arbitrary-integer utility), used by the sticky app header and by
`Modal`. Match this for anything that must render above all page content
(e.g. portaled dropdown panels) rather than guessing a smaller value like
`z-50` or mistyping the digit count.

## SVG icon gotchas

- A stray `fill=""` (empty string) on a `<path>` silently overrides an
  inherited `currentColor`/`fill-current` and renders the icon **invisible**
  — found in `src/icons/plus.svg`. If an icon renders blank, check for this
  first before assuming a CSS/color issue.
- Prefer `fill="currentColor"` set directly on the `<path>` over relying on
  `class="fill-current"` on the parent `<svg>` — the latter depends on the
  SVGR transform preserving/converting the class correctly, which isn't
  guaranteed for every icon file in this set.
- `CheckCircleIcon` has a **hardcoded** `fill="#12B76A"` (green) on its
  path, not `currentColor` — it will not recolor via `text-*`/`hover:text-*`
  classes. Know this before reusing it somewhere that expects it to inherit
  a status color.

## Backend write patterns worth knowing from the UI side

- Several `PUT` endpoints (`/user/`, `/identifier/`, `/assignment/`) replace
  the **whole row**, not a partial patch. Always send the full current
  record (including fields you're not changing) — omitting a field can null
  it out server-side, not leave it untouched.
- Actions that touch both Keycloak (via `auth_api`) and the local DB (via
  `smartdoc_api`) — e.g. creating a user, enabling/disabling a user — do
  Keycloak first, then the DB write. If the DB write fails after Keycloak
  already succeeded, there is **no automatic rollback** (`auth_api` has no
  delete-user endpoint). Surface a clear "out of sync" error naming the
  entity rather than failing silently.
- **Never key a `Map`/`Set` (or compare with `===`) using a raw numeric ID
  fetched from two different endpoints.** MySQL `BIGINT` columns going
  through Sequelize/mysql2 can serialize as a JS string from one endpoint
  and a JS number from another, even though both are typed `number` in
  TypeScript (TS can't catch this — it's a runtime string/number mismatch
  hiding behind an honest-looking type). This actually broke the
  identifier/project/user name lookups on Digitize, My Assignments,
  Assignments, and Users (e.g. `assignment.identifier_id` vs.
  `identifier.identifier_id`, `user_project.user_id` vs. `user.user_id`).
  Fix: coerce **both sides** with `String(...)` before keying or comparing —
  `new Map(items.map((i) => [String(i.id), i]))` and
  `map.get(String(otherThing.id))`, not the raw values.
