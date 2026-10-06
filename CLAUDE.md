# smartdoc_ui — Instructions for Claude Code

Part of the SmartDoc system — see `../smartdoc_context/` (sibling folder) for
the shared domain model, DB schema, service map, and known issues.

React + Vite (TypeScript, `tailadmin-react` template). Run: `npm run dev`.
Build: `npm run build`.

## What this service does
Front-end — admin UI + viewer. All data operations go through `smartdoc_api`
over REST (Keycloak-authenticated); this app has no other backend
dependency and no direct DB access.

## Digitize screen (formerly `AddDocuments.tsx`, renamed to `pages/Digitize.tsx`)
Uploading is now gated on the logged-in user having a real, in-progress
`assignment` row (`assigned_to === current user`, `assignment_status === 2`,
enforced one-at-a-time — see `MyAssignments.tsx`). The Identifier field and
the upload batch's `assignmentId` are both derived from that real assignment
(`activeAssignment.identifier_id` / `activeAssignment.assignment_id`) — there
is no manual identifier picker or "New Assignment" button anymore. See
`../smartdoc_context/known-issues.md`'s "Fixed" section for the history here
(attribute values used to be silently dropped end-to-end, and separately the
upload batch used to be tagged with a client-generated UUID that never
matched a real `assignment` row — both are resolved).

## Three kinds of session, two answers
Who the signed-in person is comes from two calls, held in
`context/MembershipContext.tsx`: `GET /user_project/me/project/:id`
(their role on the open project — `membership`) and `GET /user/me` (their
customer-level role, or that they are a system administrator — `account`).
The sidebar filters its groups on both: `adminOnly` (project admin),
`customerAdminOnly` (cadmin, shown with or without a project) and
`needsProject` (shown greyed and unclickable until one is open, so the
shape of the app is visible before the choice; admin-only groups wait,
since who is an admin is a fact about the project).

Choosing a project is a page inside the shell (`/:customerUrl/select-project`
under `AppLayout`), not a gate in front of it — the header's user menu is
there, so somebody can change their name or password before choosing, and
a customer administrator can go straight to Customer Setup without ever
choosing.

A **system administrator** has no `user` row at all — they exist in Keycloak
and sign in at `/sys` (`pages/System/`). **They never render a customer's
screens.** `/sys*` and `/:customerUrl/*` are separate spaces with no bridge
between them: a system session landing on a customer's url is sent back to
`/sys/customers`, at any depth. The system space has its own shell,
`pages/System/SystemLayout.tsx` — header, a menu of the system's areas
(Customers, AI Models), and the guards, so a screen added there cannot
forget them. What the SaaS owner needs to do to a
customer — its row, its branding, its storage, its accounts — is on
`/sys/customers` (a list on the left, the customer on the right), which reuses `pages/Users.tsx` and
`pages/Storage.tsx` by passing a `customerId` prop instead of reading the
customer from context. `Users` also takes `manageProjects={false}` there:
who works on which project is the customer administrator's decision, not
SmartDoc's. `smartdoc.system_session` in localStorage marks such a session —
written only after `/user/me` confirms it — and is what sends sign-out back
to `/sys` and lets the first render know which space it is in.

**The rule these keep teaching: never draw a decision before the answer
that decides it.** A screen that renders on a guess and corrects itself is
not a cosmetic problem — it has shown somebody a customer's logo that was
not theirs, bounced a customer administrator back to the chooser, and let an
ordinary account see the system screens for a second. Where the answer is a
request (`/user/me`, membership), hold the decision until it lands; where it
is in the browser already (contexts, the `/sys` session mark), read it in
the initial state so the first render is right — and only write such a mark
once the server has confirmed what it claims.

Two things that bit here, both about first render: contexts read
`localStorage` in the initial state, never in an effect (a frame with no
project or customer redraws every screen); and `ProtectedRoute` records
which authentication state it validated rather than a "checking" flag,
because React renders before it runs effects. See `known-issues.md`.

## Storage screen (`pages/Storage.tsx`)
Customer-scoped, under Setup. A customer defines as many storages as they
like — a MinIO or AWS bucket each — and a project picks one.

Two things about it are easy to get wrong:

- **Keys are a second step, not a form field.** A storage's Vault path is
  built from its own id, so it cannot exist until the row does. Creating a
  storage therefore opens the keys dialog straight away. `vault_path` on the
  row is only the FOLDER; the API appends the id.
- **Keys go in and never come back.** `POST /customer_storage/credentials`
  answers `{ok, vault_path}` — no key values, because `smartdoc_api` logs every
  response body. The row's status ("Stored" / "Not set") comes from
  `/customer_storage/verify`, which also returns no values.

See `../smartdoc_context/customer-storage-design.md` before changing it.

## Projects screen is master/detail
`pages/Projects.tsx` is a project list on the left and, on the right, that
project's row **and** its `project_setting` row edited as one form — they are
saved with two calls because they are two records.

A project's settings row may not exist yet (`getByProject` returns null); the
form then starts from defaults and the first save is a POST. Storage must be
chosen before settings can be saved at all — `smartdoc_api` refuses a
`project_setting` with no `customer_storage_id`.

Two API refusals are shown verbatim rather than reworded, because they say
exactly what to do next: a storage belonging to another customer, and changing
storage on a project that already holds documents (409 — the objects are not
moved).

## Users screen: two sources, one list
The app's `user` table holds only username, customer and status. **Email and
real name live in Keycloak**, fetched via `auth_api`'s `POST /all_users` with
the caller's own token — so an admin without `view-users` gets a 403. That call
is deliberately allowed to fail: the screen shows a warning and drops the name
and email columns rather than failing to load.

Rows are matched on `keycloak_id`, falling back to username for legacy rows
created before that column existed.

**A new account is not given a password (2026-10-06).** The Add New User
dialog asks for username and email; `auth_api` creates the account with no
credentials and emails one link that both verifies the address and sets a
password. Email is required for that reason. The "Not verified" mark beside
an address is a button that sends the link again.

**Passwords are set here too** — the lock button beside each
row, which opens with a generated password ready to copy rather than an
empty field. It calls `auth_api`'s `POST /set_password` with the caller's own token,
so Keycloak decides who may; the password is always temporary, meaning the
person is asked to choose their own at the next sign-in. This is the only
way back in for a customer administrator who has forgotten theirs: nobody
inside their customer outranks them, so a system administrator does it from
`/sys/customers/:id`, on this same screen.

That temporary password cannot sign in on its own: Keycloak answers "Account
is not fully set up" to the direct grant our form uses. `SignInForm` turns
that refusal (`PasswordChangeRequiredError` from `authService.login`) into a
second step on the same page, and `authService.completePassword` →
`auth_api`'s `POST /complete_password` sets the chosen password and signs
them in. `AuthContext.login` lets that one error through without setting
`error`, so the page does not go red for a password that was right.

**Roles are per project, not per user** (`user_project.role_id`: 1 admin,
2 worker, 4 viewer), so they belong to the membership, not the user row.
Changing one is a `PUT /user_project/`, which writes the whole row —
`user_id` and `project_id` go with it or they get blanked.

### Projects and privileges (rebuilt 2026-10-01)
The projects pane on this screen is **read-only**: it says which projects
the selected person is on and in what capacity, and for a viewer it shows
three small marks for comment, annotate and forward — tinted when they have
it, faint when they do not. "Viewer" alone says nothing about whether they
can send a page on, which is what somebody came to check.

Everything is changed on **its own screen**, `pages/UserAccess.tsx`, reached
by the key beside each person (`/:customerUrl/users/:userId/access`). Every
project the customer has is a row — the ones they are on and the ones they
are not — so "what can this person see?" is read rather than assembled by
clicking through projects one at a time, which was the old screen's real
fault.

Changes are held until Save, which counts them. A screen that writes on
every click turns a moment's rethinking into four requests and a
half-applied state. Leaving with something unsaved asks first.

The three privileges are shown for every role and greyed except on viewer:
an administrator has all three whatever is stored, a worker does not open
the reading app at all. Shown rather than hidden, so the answer for every
role is in one place.

Unticking a project clears its row — a role and three privileges left under
an unticked project read as settings that still apply, and they do not.

## Two endpoints with caps, and why both broke
`smartdoc_upload_api` refuses more than **100 files** to
`/upload/request-urls` and more than **200 keys** to `/s3/download-urls`.
Each answer is a signed link per item, and a few hundred at once is what the
caps exist to prevent.

Both front ends handed it a whole collection and showed the refusal to the
person as though their documents were at fault — "Cannot request more than
100 files at once" on a 120-page batch, "Too many keys: 354" on a long file.
Both now ask in runs and join the answers, saying nothing: it is a limit of
the call, not of the work.

**This is the shape to watch for.** It works in testing and fails on real
data, and it will not be the last capped endpoint.

## Saving a batch of verification decisions
`POST /verification/decide-many` — every verdict in one request. Sending
them one at a time meant the server rebuilt the entire review per page: on a
194-page batch, about eleven minutes. Notes typed on a page are still
written one at a time, because each is its own row and there are rarely more
than a handful.

## Before working on verification UI
Verification is scoped to an **identifier** (a batch of images), not a
single image — via the `assignment` table. Read
`../smartdoc_context/domain-model.md` and the verification section of
`../smartdoc_context/workflows.md` before changing this flow; it's easy to
build UI that assumes per-image verification, which doesn't match the data
model.
