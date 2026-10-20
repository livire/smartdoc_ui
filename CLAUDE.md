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

## Two halves of the app, one at a time
A customer administrator who is also on a project used to see both halves of
the menu at once — Customer Setup and User Management sitting under Digitize
and Verify. That is two jobs in one menu and neither of them clearly. Each
nav group now carries `space: "customer" | "project"`, and the sidebar shows
only the half you are already in.

**Which half is decided by the address, never by a stored mode.** A mode
disagrees with the address bar the moment somebody pastes a link or presses
Back — the same fault this app has been bitten by before. `CUSTOMER_PATHS` in
`AppSidebar.tsx` lists the customer half; everything else is the project
half.

**A choice is offered only when there is one to make.** `destinations` on
`MembershipContext` counts the projects somebody is on plus, for a customer
administrator, the customer's own screens. With one destination the project
selector at the top of the menu, the link at the foot, and the chooser screen
itself all disappear — a selector that can only reselect what is already open
is a control that does nothing. The four cases:

| Who | Destinations | What they get |
|---|---|---|
| One project, not an administrator | 1 | Straight into it. No selector, no chooser. |
| Administrator, no projects | 1 | Straight to Customer Setup. |
| Administrator, one project | 2 | The chooser, and the selector in the menu. |
| Two or more projects | 2+ | The chooser, and the selector. |

**The band at the top of the menu is the only navigator.** It names where
you are — the project, or *Customer Setup* on the customer's own screens —
with the folder button beside it that goes to the chooser. It is **not** tied
to a project being open: the customer screens are a destination too and need
the same way out. There is no second control at the foot of the menu; there
was, and a menu with two ways to do one thing reads as two different things.
`/select-project` lists Customer Setup alongside the projects, so crossing
halves is one click from there.

**A new nav group must say which half it belongs to.** An untagged group
shows in both, which is the thing this fixed.

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
  storage therefore opens the keys dialog straight away. **The form has no
  Vault folder** (2026-10-18): the API puts the keys in its own
  `VAULT_STORAGE_FOLDER` plus the storage's id, and drops a folder sent to
  it. A folder the customer could type let "Save Keys" overwrite another
  secret, such as an AI model's key.
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

**Memberships are read per customer** — `GET /user_project/customer/:id`
(2026-10-09). There is no "all memberships" call to go back to: this screen
used to ask for every row in the system and keep the ones it recognised, so
one company's memberships arrived in another company's browser. The route is
gone as well as the UI service function. `UserAccess.tsx` reads the same
way.

**A new account is not given a password (2026-10-06).** The Add New User
dialog asks for username, email and name; the account is created with no
credentials and emailed one link that both verifies the address and sets a
password. Email is required for that reason. The "Not verified" mark beside
an address is a button that sends the link again.

**Creating one is a single call to `smartdoc_api`** — `POST /user/provision`
(2026-10-08), which makes the Keycloak account and the `user` row together.
It was two calls, the first straight to `auth_api` with the admin's own
token, which meant **Keycloak** judged whether they could create a user: a
customer administrator without `manage-users` in Keycloak was refused, and
those are two different ideas of "administrator". `smartdoc_api` now decides
on SmartDoc's roles and calls `auth_api` with its own service token;
`auth_api` refuses `/add_user` from anything but one. The two-call path was
deleted rather than left, because its other fault was leaving a Keycloak
account with no row behind it whenever the second call failed.

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

**Usernames carry the customer (2026-10-10).** One Keycloak realm serves
every customer, so a username exists once across all of them: Keycloak holds
`acme.jsmith` and the person types `jsmith`. `services/usernameRules.ts` is a
copy of the rule in `smartdoc_api`, which has the tests — **the viewer has a
third copy and all three must agree.** `POST /user/provision` composes the
name on the server from `customer_url`, so the browser never decides it; this
screen only takes the prefix off for display and puts it back when the edit
dialog saves. On `/sys` it takes the url from the **`forCustomerUrl` prop**,
not from context — the context customer there belongs to somebody else or to
nobody.

**Use `useShortName()` to print a username** (`hooks/useShortName.ts`), never
`strip()` by hand. Doing it by hand missed sixteen places. The rule it
encodes: **a name going to a server is the stored one, a name going to a
screen is shortened.** Getting that backwards broke the viewer's password
dialog, which posts the name to `auth_api`. Stripping needs the customer, not just the first dot: plenty of
usernames are `john.smith`.

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

## Where the mail comes from
**Every `/sys` screen supplies its own padding and background** —
`SystemLayout` gives its children neither, so a screen that forgets sits
flush against the menu and runs off the right edge. The frame is
`flex min-h-0 flex-1 flex-col bg-gray-50` outside and
`min-h-0 flex-1 overflow-auto p-4` inside; SMTP Server and Sign-in were missing it.

`/sys` → SMTP Server holds **SmartDoc's own accounts and nothing else**. A
customer's server was listed there too, so the page could answer "who sends
what?" — but it is theirs, it cannot be changed from there, and a list of
other people's servers is a list nobody running SmartDoc acts on. It is on
their own SMTP Server tab, where it can be changed.

Each customer is **pointed at one** on `/sys` → the customer → SMTP Server → *Send their mail
through*. There is no default: a customer with none chosen is sent no mail,
and the tab says so where the consequence lands rather than in a toast after
somebody has waited for an email that never came.

That was not the first shape. An `is_default` flag lasted about an hour —
two ways to end up with a sender meant "where does this customer's mail come
from?" had two places to look, and moving the flag silently changed the From
address for every customer nobody had touched.

A customer may add one of their own when SmartDoc has turned on
*Allow own email server* (`customer.can_add_smtp`), and their people's
links then come from their address instead.
`components/customer/CustomerOwnSmtp.tsx` is the card, used twice: on their
own SMTP Server tab where they can change it, and on `/sys` → a customer → SMTP Server
with `canAdd={false}`, where it is only shown and tested — it is their server
and their password. The dropdown lists SmartDoc's accounts only, because
theirs is used ahead of any of them.

**The customer's card says where their mail comes from, not what it has.**
With no server of their own it asks `/smtp_account/resolved` and shows the
sender in the same two lines their own account uses — the address, then
*Provided by SmartDoc* — or, when SmartDoc has chosen no account for them,
*"Email server not set by SmartDoc. Please contact your system
administrator."* The card used to assert "password links come from
SmartDoc's address", which stopped being true the moment the default was
removed.

**With both servers available the customer chooses**, in a dropdown on
their own card, which has **two sections** — *Send our mail through* (the
picker, and the address it means) and *POPO smtp server* (their own server,
with Test and the edit buttons).

**They are separate because they are different jobs**: one is whose address
our mail carries, the other is whether our server is set up and working.
Tied together, their own server could only be tested while it was the one in
use — so a server that could not be reached could not be fixed without first
pointing the mail at it.
Each by the name on its row — "POPO SMTP", "Smartdoc" — rather than "ours"
and "theirs", and without the address, because the address of whichever is
chosen is right beside it. Written through `PUT /smtp_account/use_own`, **by the page's Save and not by
the dropdown**: it wrote itself on change, which on a page with one Save
button reads as a setting that did not take. `CustomerOwnSmtpHandle` is the
same arrangement `BrandingCard` and `CustomerModels` already use.

**It draws its own two cards and is not wrapped in a panel**, unlike every
other section of `BrandingCard` — a panel around them would be a third
border around two things that are already separate.

**The picker is always a dropdown**, even with one thing in it: it used to
disappear when the customer had no server of their own, and a control that
comes and goes reads as a setting that was taken away. With one option it is
enabled but can only reselect itself. It freezes only when SmartDoc has set
them no server, where the one option reads "No server set by SmartDoc" and
choosing it would mean no mail at all.

**Removing their server asks in a dialog, not `window.confirm`.** The
browser's box cannot say what else changes, and what else changes is the
address every password link for these people will carry — so the dialog
names the server it is about to remove and nothing else.

**The dropdown holding the answer is what says which is in use.** There was
a line of text under it saying so as well, and a sentence about SPF and DKIM
under that; both went when the picker moved beside the details. Theirs won simply by existing before, so a
customer with both could not tell which was carrying their mail and could
not go back to SmartDoc's without deleting their server. The dropdown is
absent when SmartDoc has given them nothing: one option is not a choice. The
row underneath says which is in force, because "we have a server" and "our
mail goes through it" are two different facts.

**The address and nothing else.** `/smtp_account/resolved` answers `{from,
own}` on purpose: the host, port and username of SmartDoc's own relay are
SmartDoc's, and the username is half a credential. That call is skipped on `/sys`
(`hideWhenEmpty`): it resolves for whoever is asking, and a system
administrator has no customer, so it would throw.

**Outcomes go to the toast, states stay on the card.** Pressing Test says
"Connected" or names the refusal in a toast; it used to leave a coloured
block under the row and a pill beside it, which is a record of something
that already happened. What stays written on the card is the state — "Email
server not set by SmartDoc", "no accounts yet" — because that is still true
when a toast would have faded.

**Test proves the connection, not delivery.** It signs in to the server.
Whether the mail is then accepted rather than treated as forged is SPF and
DKIM on the sending domain, which is theirs. The card says so, once, where
somebody can act on it.

**The port is a `<select>` of 587, 465 and 25**, not a number field. A free
number would let a customer point SmartDoc at anything listening; the server
refuses private addresses too, and the form says that before they save
rather than after.

## Single sign-on is a `/sys` tab, and only there
`pages/System/CustomerSso.tsx`, on `/sys` → a customer → *Single sign-on*
(2026-10-14). A customer's company login — the email domains, the discovery
address and client credentials their IT team sends, and an on/off switch —
held in Keycloak through `smartdoc_api` `/customer/:id/sso`. **Never on the
customer's own screens**: a domain decides who is sent to which company's
login, so SmartDoc checks the customer owns it.

**Its own Save**, like Storage — it is not in the customer's row. The client
secret is a password field that is never filled back in; empty keeps the
stored one. The return address at the top is what their IT team enters, and
comes from the server so there is one copy of how it is built.

## Two ways in, one session
**The password form is still the main door** (decided 2026-10-15: people
should not see Keycloak's pages). A customer whose single sign-on is on also
gets *Sign in with your company login* above it — `company_login` from the
public customer route. It sends the tab straight to their company's login
(`services/companyLogin.ts`, `kc_idp_hint`), so Keycloak shows nothing of
its own, and back to `/auth/callback`. **A redirect, not a popup**: a popup
could not tell it had been closed once a login page cut it off from the
opener, and the button waited for ever.

**A company-login session is marked** by `smartdoc.company_login` in
localStorage (its alias), and three things go another way for it:
refreshing (Keycloak directly — `auth_api` refreshes for the other client),
signing out (the Keycloak session is ended too, or the next person at the
machine goes straight in), and the session-expired prompt (the company
login again, coming back to the same page; the same Keycloak `sub` or it
is refused).
Everything else reads the tokens from the same keys as before.

**On the way back, `/user/me` must say this customer.** A password sign-in
proves it with the username prefix; a company login has none. The customer
travels in Keycloak's `state` and becomes the stored customer only then.

**`/auth/callback` is drawn by `main.tsx` without the app.** The app's
start-up acts on whatever session was there before — refreshes it, locks
it — while that page is replacing it.

`VITE_KEYCLOAK_AUTHORITY` and `VITE_KEYCLOAK_CLIENT_ID` are required; the
app throws on load without them.

## Setting a password from an emailed link
`pages/AuthPages/SetPassword.tsx` at `/:customerUrl/set-password`, **outside
`ProtectedRoute`** — the person cannot sign in yet, which is what the link is
for.

**Why it exists.** A customer can ask for 12 characters and a symbol. Those
rules are SmartDoc's, in `customer_setting`; Keycloak has one policy for the
whole realm. Both emailed links used to land on Keycloak's own pages, so the
two moments a password is most often chosen — a new account and a forgotten
one — enforced 8 characters whatever the customer had set. This page knows
the customer from the address bar, so it shows the rules as a checklist and
enforces them.

**The token is in the `#` of the address.** Everything after a `#` stays in
the browser — never sent to a server, so it cannot reach `smartdoc_api`'s log
(which records every request URL) or a `Referer` header. The page reads
`location.hash` once, in state, because navigating inside the app would drop
it, and sends it in a request body.

**One door for both links** — `passwordLinkService.request(username,
customerUrl)`. The server decides whether this account needs a first
password or a replacement; the form used to decide and got it the wrong way
round, offering "resend the verification email" to somebody who had simply
forgotten their password. `authService.forgotPassword` and
`resendVerification` are **gone**: they asked `auth_api` to send Keycloak's
mails.

The Users screen's "Not verified" mark now calls
`userManagementService.resendInvite(user_id)` → `POST /user/:id/invite`, and
`provisionUser` answers `invited: {sent, reason}` in place of
`verification` — the account exists whether the mail went or not.

## Caching the setup lists
`services/cache.ts` — a `Map` in memory, no library and not localStorage, so
it dies with the tab and can never serve yesterday's answer or the previous
person's. It stores the **promise**, not the value, so two screens asking in
the same moment make one request between them.

Four reads go through it, all until sign-out: the customer's users, its
projects, its memberships, and Keycloak's copy of the accounts
(`all_users?max=500`, the heavy one). Ten screens call
`getProjectsByCustomer` and each used to fetch it again — the Users screen
alone cost four lists, then all four again on the way back from User Access.

**Every write clears what it touched, in the service and never in the screen
that called it**, so a new caller cannot forget to. The one that is easy to
miss: enabling or disabling somebody writes a **Keycloak** field, so it is
Keycloak's copy that goes stale, and nothing about that call looks like it
touches a list.

**`authService.logout()` calls `forgetAll()`.** The cache belongs to the tab,
not to the account — without that line the next person to sign in at this
browser is handed the previous one's users and projects.

Not cached: the notification count and conditions. The bell re-counts on
every screen change and every two minutes, and being out of date is the thing
it exists to fix.

## AI models: who may choose what
SmartDoc's catalogue is on `/sys` → AI Models. **A customer chooses from the
models SmartDoc has given them** (`customer_model`, set on `/sys` → the
customer → AI models), plus any they added themselves when
`customer.can_add_models` is on. `GET /model_catalogue/offered` answers that
list, scoped to the caller's customer.

**A model is chosen on the project, nowhere else** (2026-10-12). The
customer-level Categorise and OCR dropdowns were removed: a default meant two
places could name a model, and a project inheriting one had to be kept in
step with it. `Projects.tsx` writes the model id **and** the stage's switch
together, so they cannot disagree — Manual means the stage does not run, and
the pipeline only ever looks at the switch.

Two rules the pickers encode, both enforced on the server as well:

- **Tesseract reads and cannot categorise**, so it is not offered under
  Categorise. Hiding an option is not refusing it.
- **A model with `retires_on` says so on the option itself** — "stops in
  9d". Telling somebody after they have chosen is late. After the date the
  project fails readiness rather than quietly using something else.

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
