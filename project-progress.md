# Spendora — Project Progress

Tracks what has actually been built, phase by phase, against
[`master-specifications.md`](./master-specifications.md).

| Phase | Scope                          | Status         |
| ----- | ------------------------------ | -------------- |
| 1     | Project foundation             | ✅ Complete    |
| 2     | Supabase + Authentication      | ✅ Complete    |
| 3     | Database schema + RLS          | ✅ Complete    |
| 4     | Personal expense tracking      | ✅ Complete    |
| 5     | Groups + in-app invitations    | ✅ Complete    |
| 6     | Group expenses                 | ✅ Complete    |
| 7     | Categories + budgets           | ✅ Complete    |
| 8     | Dashboards                     | ✅ Complete    |
| 9     | Search, filters + history      | ✅ Complete    |
| 10    | Export                         | ⬜ Not started |
| 11    | UI polish                      | ⬜ Not started |
| 12    | Testing + security audit       | ⬜ Not started |
| 13    | Production readiness           | ⬜ Not started |

> ⚠️ **One temporary deviation is still active, and is parked by decision.**
> Sign-up email confirmation is not enforced end to end, and
> `scripts/confirm-users.mjs` stays in place. This was reviewed on
> 3 September 2026 and deliberately left as it is, to be revisited later. See
> [Temporary: email confirmation bypassed](#temporary-email-confirmation-bypassed).

---

## Phase 1 — Project foundation (complete, 2 September 2026)

Starting point: a stock `create-next-app` scaffold (Next.js 16.3.4, React 19.2.8,
Tailwind v4, strict TypeScript, flat ESLint config) with the boilerplate landing
page and no application structure.

### Structure

- Moved `app/` to `src/app/` and repointed the `@/*` path alias to `./src/*`,
  matching the structure in specification §42.
- Created `src/components/ui/`, `src/lib/`, and `src/types/`. Folders are added
  only when something goes in them.

### Design system

- Replaced the boilerplate `globals.css` with a semantic token palette in oklch:
  `background`, `foreground`, `card`, `muted`, `border`, `input`, `ring`,
  `primary`, `accent`, plus `success` / `warning` / `danger`. Light values live
  on `:root`; a `prefers-color-scheme: dark` block supplies the dark set.
- Tokens are exposed to Tailwind through `@theme inline`, so components use
  `bg-card`, `text-muted-foreground` and so on, and never a raw colour. A future
  theme toggle only has to redefine the variables.
- Radius scale, font tokens, a `.tabular` helper for aligning financial figures,
  and a global `prefers-reduced-motion` rule.

### UI primitives (`src/components/ui/`)

| Component  | Notes                                                                   |
| ---------- | ----------------------------------------------------------------------- |
| `button`   | CVA variants (primary/secondary/ghost/danger/link × sm/md/lg/icon), built-in `loading` state with spinner and `aria-busy`; `buttonVariants` is exported so links can be styled as buttons |
| `card`     | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` |
| `input`    | Focus ring plus `aria-invalid` styling for accessible form errors        |
| `label`    | Semantic `<label>`                                                       |
| `badge`    | Neutral / success / warning / danger — for budget status, which must not rely on colour alone |
| `skeleton` | Loading placeholder, hidden from screen readers                          |
| `toaster`  | Sonner host, mounted once in the root layout, themed with the tokens     |
| `fade-in`  | Motion entrance that collapses to a plain fade under reduced motion      |

### Application shell

- Root layout: real metadata (title template `%s · Spendora`), Geist fonts, and
  the toast host.
- `error.tsx` and `global-error.tsx`: friendly copy, no stack traces, the error
  digest shown as a support reference, and a retry action. Next 16 passes
  `retry` (not `reset`) to error boundaries.
- `not-found.tsx` and a skeleton `loading.tsx`.
- `page.tsx`: placeholder landing page, replaced when authentication lands.

### Configuration

- `src/lib/env.ts` — Zod-validated environment access. `getClientEnv()` reads the
  two `NEXT_PUBLIC_` Supabase keys; `getServerEnv()` reads the email secrets and
  throws if called in the browser. Validation is lazy so a missing key fails at
  the point of use, and error messages name the key without printing its value.
- `.env.example` committed with empty placeholders; `.gitignore` updated to
  `.env*` with a `!.env.example` exception. `.env.local` is created locally and
  stays ignored.
- `src/lib/constants.ts` and `src/types/index.ts` — the spec's fixed
  vocabularies: four currencies (stored as ISO codes with symbol/locale for
  display only), eight payment modes, the fourteen default categories, and the
  `admin` / `member` roles. Declarations only; no data access.
- `package.json` scripts: added `typecheck` (`next typegen && tsc --noEmit`, so
  it works on a fresh clone without a prior build) and `lint:fix`.
- Dependencies added: `clsx`, `tailwind-merge`, `class-variance-authority`,
  `lucide-react`, `sonner`, `zod`, `motion`.

### Checks run

| Check              | Result                                                   |
| ------------------ | -------------------------------------------------------- |
| `npm run lint`     | ✅ Clean, 0 errors, 0 warnings                            |
| `npm run typecheck`| ✅ Clean                                                  |
| `npm run build`    | ✅ Compiled; `/` and `/_not-found` prerendered as static  |
| `npm run dev`      | ✅ `/` returns 200 and renders; unknown route returns 404; no console errors |

### Deliberately not done in this phase

No Supabase client, no authentication, no database schema, no expense/group/
budget features, and no test suite — all of these belong to Phases 2 and later.
Radix UI is not installed yet; it will be added when dialogs, selects and other
interactive primitives are actually needed, rather than up front.

### Decisions worth knowing

- **`src/` layout** — chosen to match specification §42 and keep application code
  separate from root config. `.env*` files stay in the repository root, as Next
  only loads them from there.
- **Hand-written primitives instead of the shadcn/ui CLI** — same conventions
  (CVA variants, `cn`, token-driven colours) with no generator step, and the
  token names are shadcn-compatible so its components can be dropped in later.
- **Lazy environment validation** — validating at import time would crash pages
  that do not need Supabase at all while integrations are still being built.

---

## Phase 2 — Supabase + Authentication (complete, 2 September 2026)

Sign up, sign in, sign out, persistent sessions, user profiles and protected
routes. No expense, group or budget features — those start in Phase 4.

### Database foundation

`supabase/migrations/0001_profiles.sql`, written to be re-runnable:

- **`profiles`** — `id` (FK to `auth.users`, cascade delete), `name`, `email`,
  `created_at`, `updated_at`, with a name length check and an email format
  check. Unique index on `lower(email)`.
- **`handle_new_user()`** — an `after insert` trigger on `auth.users` creates the
  profile as part of sign up, taking the name from the sign-up metadata and
  falling back to the email's local part. `security definer` with
  `search_path = ''` so it cannot be hijacked.
- **`handle_user_email_change()`** — keeps `profiles.email` in step with the auth
  email.
- **`profiles_pin_identity_columns()`** — a before-update trigger that resets
  `id`, `email` and `created_at` to their old values, so only `name` is
  user-editable even if a crafted update gets through.
- **`set_updated_at()`** — a shared helper the later tables will reuse.
- **RLS** — enabled, with select-own and update-own policies for `authenticated`.
  There is deliberately no insert policy (the sign-up trigger owns creation) and
  no delete policy (profiles go with the cascade). `anon` is revoked entirely.

`supabase/README.md` documents three ways to apply migrations and the two
Supabase dashboard settings the app depends on.

### Supabase wiring

- `src/lib/supabase/server.ts` — request-scoped `createServerClient` reading and
  writing cookies through `next/headers`. A new client per request; never shared.
- `src/types/database.ts` — hand-written in the shape the Supabase CLI emits, so
  `supabase gen types` can replace it later without changing call sites.
- No browser client yet: authentication runs entirely through Server Actions, so
  adding one now would be unused code.

### Session handling and route protection

- `src/proxy.ts` (Next 16 renamed `middleware` to `proxy`) refreshes the session
  on every request and writes rotated tokens back — Server Components cannot set
  cookies, so this is the only place a refresh survives. It also carries those
  cookies onto redirect responses so a refresh is not dropped mid-redirect, and
  applies the no-store headers the library supplies so a rotated session cannot
  be cached by a CDN.
- Routes are **private by default**: only `/`, `/sign-in`, `/sign-up` and
  `/auth/*` are public. New pages are protected without anyone remembering to
  add them to a list.
- Signed-in users hitting `/sign-in` or `/sign-up` are sent to `/dashboard`.
- `src/lib/auth/dal.ts` is the real check, not the proxy. `getUser()` uses
  Supabase's `getUser()` (revalidates the token with the auth server) rather
  than `getSession()` (trusts the cookie), memoised per render with React
  `cache()`. Pages call `requireUser()` / `requireProfile()`.

### Authentication flows

- **Sign up** — Zod-validated, passes the name as user metadata for the trigger,
  and sets `emailRedirectTo` to `/auth/confirm` on the request's own origin. If
  the project requires email confirmation the form switches to a "check your
  inbox" state; if not, the user is signed straight in.
- **Sign in** — email/password, with an optional `?next=` destination.
- **Sign out** — a Server Action posted from a plain form, so it works without
  client-side JavaScript.
- **`/auth/confirm`** — verifies the emailed one-time token (`verifyOtp`) against
  a whitelist of link types and establishes the session. Expired or malformed
  links land on `/sign-in?error=invalid_link` with an explanation.
- **Profile name** — editable from `/settings`; the action derives the user from
  the session and never trusts an id from the form.

### Security decisions

- `safeRedirectPath()` rejects anything that is not a same-site absolute path,
  so `?next=//evil.example.com` cannot bounce a user off-site. Verified.
- `authErrorMessage()` maps Supabase error codes to friendly copy and logs the
  original server-side; raw provider errors never reach the browser.
- Server Actions treat every input as untrusted: parse with Zod, then re-derive
  identity from the session.
- Passwords are never echoed back into a re-rendered form.

### UI

- `(auth)` route group with a centred card layout; `(dashboard)` group with a
  header showing the user's name, a link to settings and sign out.
- `FormField` primitive wires label, `aria-invalid`, `aria-describedby`, hint
  text and a `role="alert"` error message together.
- Forms use `useActionState` for pending state and inline field errors, plus a
  toast for the overall result. Toasts use a stable id so repeated failures
  replace rather than stack.
- Landing page now links to sign up and sign in.

### Checks run

| Check               | Result                                                        |
| ------------------- | ------------------------------------------------------------- |
| `npm run lint`      | ✅ Clean                                                       |
| `npm run typecheck` | ✅ Clean                                                       |
| `npm run build`     | ✅ 7 routes; auth pages dynamic, landing static                |
| `/` unauthenticated | ✅ 200                                                         |
| `/dashboard`, `/settings` unauthenticated | ✅ 307 → `/sign-in?next=…`              |
| `/groups` (not built yet) | ✅ 307 → `/sign-in?next=/groups` — private by default    |
| `/sign-in`, `/sign-up` | ✅ 200, forms render server-side with labels wired to inputs |
| Garbage session cookie | ✅ Treated as signed out, no crash                          |
| `?next=//evil.example.com` | ✅ Rejected, falls back to `/dashboard`                 |
| `/auth/confirm` with a bad token | ✅ 307 → `/sign-in?error=invalid_link`            |
| Unconfigured environment | ✅ Fails loudly naming the missing keys, without printing values |

### Not verified yet

There is no Supabase project connected — `.env.local` still holds empty
placeholders — so the following could not be exercised end to end and need a
run-through once credentials are in place:

1. Applying `0001_profiles.sql` to a real database.
2. A real sign up creating the profile row via the trigger.
3. Sign in, session persistence across a browser restart, and sign out.
4. The email confirmation link round trip.
5. Renaming a profile through RLS.

Local PostgreSQL is installed but requires credentials and has no `auth` schema,
so the migration could not be rehearsed against it.

### Deliberately not done in this phase

No groups, expenses, categories, budgets or invitations, and no email provider
integration — Phase 3 onwards. Password reset and OAuth providers are not built
either; the architecture leaves room for both (`/auth/confirm` already handles
recovery links, and the DAL does not assume a password login).

---

## Phase 3 — Database schema + RLS (complete, 2 September 2026)

The whole data model, its constraints, its indexes and every row-level security
policy. No application features: nothing in `src/app/` changed, and no page
reads any of these tables yet — that starts in Phase 4.

### What was found first

Phase 2 was written but never applied. `NEXT_PUBLIC_SUPABASE_URL` and the anon
key now point at a real project (`zlstsryapuylybgcqrxo.supabase.co`), and
GoTrue answers, but `GET /rest/v1/profiles` returned `PGRST205 — Could not find
the table 'public.profiles'`. So `0001_profiles.sql` had never been run, and the
five items Phase 2 listed as "not verified yet" were still unverified. Both
migrations are applied and exercised as part of this phase.

Rehearsing the SQL against the local PostgreSQL 18 install was not possible: it
demands a password that is not on this machine, and it has no `auth` schema for
the triggers to hang off.

### Schema — `supabase/migrations/0002_core_schema.sql`

Six tables joining `profiles`: `groups`, `group_members`, `group_invitations`,
`categories`, `budgets`, `expenses`.

Five decisions shape everything else.

**Personal and group data share one shape.** `categories`, `budgets` and
`expenses` each carry both `group_id` and `user_id`, with
`check (num_nonnulls(group_id, user_id) = 1)`. A personal row and a group row
are the same table with a different owner, so there is one expense form, one set
of queries and one set of policies rather than two of each.

**Cross-owner integrity is declarative, not trigger-based.** A composite foreign
key with a NULL column is not enforced at all, which turns out to be exactly the
tool for this job: `(category_id, group_id) → categories(id, group_id)` checks
group rows and skips personal ones, `(category_id, user_id)` does the reverse,
and between them a category can never belong to a different owner than the row
pointing at it. The same trick pins a group expense to its group's currency via
`(group_id, currency_code) → groups(id, currency_code)`, with `on update
restrict` — so a group's currency can be changed freely until its first expense
and never after, when the recorded amounts would silently change meaning.

**Budgets are monthly, with month-specific ones already possible.**
`period_month` NULL is the standing budget; a row with a month set overrides it
for that month alone. Reading a month is `coalesce(month-specific, standing)`.
Two partial unique indexes keep both cases single. This is specification §15's
"support future month-specific budgets" without a second table.

**`paid_by` is a trigger, not a foreign key.** Specification §45 requires the
payer to be an active member — at the time the expense is written. A foreign key
to `group_members` would keep enforcing that forever, so removing a member would
either delete or freeze the expenses they had already paid for. Verified: after
a member leaves, their recorded expenses survive.

**Categories are archived, not deleted, once in use.** Deleting one leaves its
expenses in place and uncategorised (`on delete set null (category_id)` — the
column list matters, or Postgres would null `group_id` too), and takes its
budgets with it. `is_archived` is the path for "I do not need this any more",
and a trigger refuses archived categories on new expenses.

Constraints cover specification §30 in full: `amount > 0` on expenses and
budgets, non-empty trimmed names, a currency whitelist, a payment-mode
whitelist, note and description length caps, `expires_at > created_at` on
invitations, a SHA-256-shaped `token_hash`, `unique (group_id, user_id)` on
membership, a partial unique index giving one pending invitation per email per
group, and per-owner unique category names.

Indexes follow the read paths that actually exist: `(user_id, expense_date desc)
where group_id is null` and `(group_id, expense_date desc)` for the monthly
lists, `(group_id, paid_by)` for member spending, plus the composite unique
indexes the foreign keys above need.

### Triggers

- **`handle_new_group()`** — the creator becomes admin (§9). `security definer`,
  because at that instant they are not yet a member and the insert policy would
  refuse them.
- **`enforce_group_has_admin()`** — the last admin cannot be demoted or removed.
  They delete the group instead. It stands down during a group's own cascade.
- **`normalize_invitation_email()`** — lowercases the address so the pending
  index and the invitee's own lookup compare like with like, and refuses to
  invite someone already in the group.
- **`close_invitation_on_join()`** — joining marks the invitation accepted.
- **`expenses_validate_paid_by()`**, **`expenses_reject_archived_category()`**.
- **Identity pinning** on all six tables. RLS decides who may update a row;
  these decide which columns an update may not touch, so a crafted `UPDATE`
  cannot move a row to another owner even where the policy's `WITH CHECK` would
  accept the result. This is what stops a member re-parenting a group expense
  into their private records.

### RLS

Every table: RLS on, `anon` revoked, `authenticated` granted, and nothing
readable that a policy does not open.

Policies read membership through `is_group_member()` / `is_group_admin()`,
`security definer` with `search_path = ''`. A policy on `group_members` that
queried `group_members` directly would recurse.

| Table | Read | Write |
| --- | --- | --- |
| `groups` | members | creator inserts; admin updates/deletes |
| `group_members` | members | admin adds/removes; a user may join against a valid invitation, or leave |
| `group_invitations` | admin, or the invitee by email | admin only |
| `categories` | owner, or group members | owner; group categories are admin-only (§14) |
| `budgets` | owner, or group members | owner; group budgets are admin-only (§9) |
| `expenses` | owner (personal), or group members | author edits their own; group admin edits any |

Two changes worth calling out.

**Accepting an invitation is pure RLS.** A user may insert their own
`group_members` row only when a pending, unexpired invitation addressed to their
email exists for that group, *and only in the role that invitation grants*.
There is no privileged accept endpoint to get wrong later. Specification §11's
"do not expose the group before acceptance" holds: the invitee can read their
invitation but `groups` still requires membership.

**`profiles` reads widened.** 0001 limited reads to your own row, which would
have made "Paid by: Rahul" impossible. A second permissive policy allows reading
the profile of anyone you share a group with, via `shares_group_with()`.
Trade-off: fellow members of a group can see each other's name and email.
Non-members still see nothing.

### TypeScript

`src/types/database.ts` gains all six tables in the Supabase CLI's shape, so
`supabase gen types` can replace it later without touching call sites. `Update`
types list only the columns the pinning triggers actually allow. `amount` is
typed `string` on read, because PostgREST returns `numeric` as a string and
parsing it to a float is how currency bugs start. `src/types` re-exports the
entity types so application code has one import surface.

### Testing — `scripts/verify-rls.mjs`, `npm run db:verify-rls`

77 assertions, all made through PostgREST with a real user's JWT: the surface a
browser reaches if someone skips the UI entirely. The suite creates three
throwaway accounts — a group admin, a member and an outsider — attacks the
schema from each, and deletes them afterwards even when it fails.

It covers personal privacy, every constraint above, invitation flow and its
duplicate/expiry rules, admin-only category and budget management, group expense
permissions, group administration, unauthenticated access to all seven tables,
and the cascades.

**All 77 pass.** They did not at first. Four real defects came out of the run,
none of which would have been visible without executing against a real database:

1. **A group's creator could not read back the group they had just created.**
   `INSERT ... RETURNING` — which is what PostgREST issues for
   `.insert().select()` — checks the new row against the SELECT policy *before*
   `AFTER INSERT` triggers run, so the creator was not yet a member at that
   instant. Fixed with `group_is_unclaimed()`, which is true only in that gap.
   Scoping it to "the group has no members yet" rather than to `created_by`
   means a founder later removed from a group loses sight of it, which
   `created_by = auth.uid()` alone would not have done.

2. **The same problem on joining a group.** `group_members` now also lets a user
   read their own membership rows, which is both correct on its own terms and
   covers the `RETURNING` case.

3. **The personal-category foreign key fired on group expenses.** The
   "exactly one owner is null" trick works for `categories` and `budgets`, but
   not for `expenses`, where `user_id` is the *recorder* and is set on group
   rows too. Fixed with a generated `personal_owner_id` column that is null
   unless the expense is personal. A foreign key containing a generated column
   cannot carry a referential action, so `categories_detach_expenses()` now
   clears `category_id` before a category is deleted — which also removes the
   ordering risk in a group's own cascade.

4. **A user account could not be deleted.** `group_invitations.accepted_by` is
   `on delete set null`, which collided with a check constraint requiring it to
   be present on accepted invitations. `accepted_at` is now the durable record
   of acceptance and `accepted_by` is best effort. This surfaced only because
   the suite's cleanup was changed to report failures rather than swallow them.

### Phase 2's five unverified items, now verified

Applying `0001` revealed it had never been run: the account
`omkesh.jadhav@gmail.com` predated the table and so had no profile at all, which
would have broken `requireProfile()` on first sign in. `0001` now backfills
profiles for any account that predates it, and did so on apply.

| Item | Result |
| --- | --- |
| Applying `0001_profiles.sql` to a real database | ✅ Applied; both migrations re-run cleanly four times |
| Sign up creating the profile row via the trigger | ✅ Every test account got a correct profile |
| Renaming a profile through RLS | ✅ Own rename allowed, another user's refused |
| Route protection against live Supabase | ✅ `/dashboard`, `/settings`, `/groups` → 307 to `/sign-in?next=…`; `/`, `/sign-in`, `/sign-up` → 200; no errors in the dev log |
| Session persistence across a browser restart | ⬜ Still needs a human with a browser — it is a cookie-lifetime question the suite cannot answer |

### Checks run

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ Clean |
| `npm run typecheck` | ✅ Clean |
| `npm run build` | ✅ 7 routes, unchanged from Phase 2 |
| `npm run db:verify-rls` | ✅ 77 passed, 0 failed |
| Migrations re-applied repeatedly | ✅ No errors; both files are re-runnable |
| Database left clean | ✅ All test accounts and their data removed |
| RLS enabled on all 7 tables | ✅ 27 policies, 19 foreign keys, 23 check constraints, 29 indexes |

### Decisions worth knowing

- **`amount` is a JavaScript `number`, not a string.** PostgREST serialises
  `numeric` as a JSON number. Within `numeric(14,2)` this is exact, but sums and
  comparisons belong in SQL, where the type still is. The types say so.
- **Group peers can see each other's name and email.** The cost of "Paid by:
  Rahul". Non-members see nothing. Worth revisiting if profiles ever hold
  anything more sensitive.
- **Deleting an account deletes the group expenses that account paid for.**
  There is no UI for account deletion in the MVP, and the alternative is a
  tombstone profile, which is not worth building yet.
- **A sole admin cannot leave their own group** — they delete it instead.
- **No default categories are seeded.** Specification §13 says the admin picks
  which defaults to use, so `DEFAULT_CATEGORIES` stays a suggestion list the UI
  offers in Phases 4 and 7, not rows forced on every user.

### Deliberately not done in this phase

Nothing in `src/app/` changed and no page reads any of these tables — Phase 4
starts that. No `create_group` RPC, no invitation token generation, no email:
accepting an invitation is expressed entirely in RLS precisely so that Phase 5
has no privileged endpoint to get wrong.

### Note on tooling

`SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY` are now in `.env.local` and
`.env.example`. Neither is read by application code: the first applies
migrations via `psql`, the second only lets the test suite create and delete its
throwaway accounts. The database password contains an `@`, so the URL must be
parsed rather than handed to `psql` as a URI.

---

## Phase 4 — Personal expense tracking (complete, 3 September 2026)

Add, list, edit and delete personal expenses, with categories, payment modes,
dates, notes and timestamps, plus a personal dashboard. No groups, no budgets,
no charts, no filters — those are Phases 5 to 10.

### Phases 1-3 re-verified first

Nothing was changed until the existing work was confirmed to still run:

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ Clean |
| `npm run typecheck` | ✅ Clean |
| `npm run build` | ✅ 7 routes |
| `npm run db:verify-rls` | ✅ 77 passed, 0 failed, against the live database |
| Route protection | ✅ `/dashboard`, `/settings`, `/expenses` → 307 to `/sign-in?next=…`; `/`, `/sign-in`, `/sign-up` → 200 |

The working tree was clean and the migrations were already applied, so Phase 4
is application code only. No migration was added: the Phase 3 schema already
carries everything an expense needs.

### Foundations

Two small modules exist because the specification calls out both areas as
precision-critical, and both are easy to get quietly wrong.

**`src/lib/dates.ts`.** `expense_date` is a PostgreSQL `date` — a calendar day
with no time and no zone — so every helper works on `YYYY-MM-DD` strings.
Nothing calls `new Date("2026-09-10")`, which is midnight UTC and therefore
still 9 September in the Americas; `parseIsoDate` builds local midnight
instead. `isIsoDate` rejects 31 February, which `Date` would silently roll
forward. Display is `en-GB`, which renders exactly the specification's
"10 Sept 2026". `elapsedDaysInMonth` is what average daily spending divides by,
so a figure part-way through a month is not diluted by days that have not
happened yet.

**`src/lib/money.ts`.** Amounts are `numeric(14,2)` and arrive from PostgREST
as JSON numbers, which is exact at that scale — but adding doubles repeatedly
is not. Every total is accumulated in integer minor units and converted back
only to format. There is a test for exactly this: ₹0.10 + ₹0.20 + ₹0.30 +
₹70.07 renders as ₹70.67, not ₹70.67000000000002.

### Data access and mutations

`src/lib/expenses/queries.ts` holds the reads, `actions.ts` the writes.

Every query filters on `user_id` **and** `group_id is null`, even though RLS
already restricts the rows. The filters are not the security boundary; they
state the intent at the call site and let PostgreSQL use the partial index
built for this path. The `group_id is null` half matters on the edit page in
particular: without it, a group expense the user can legitimately read would
open in the personal editor.

Categories are fetched in a separate query and joined in memory rather than
embedded in the expense select. `expenses` has two foreign keys to
`categories` — one for group rows, one for personal — which makes a PostgREST
embed ambiguous, and disambiguating a composite relationship by constraint name
is more fragile than one small extra query.

Each Server Action re-validates its input with Zod and re-derives the user from
the session. Nothing identifying comes from the form: `user_id` and `paid_by`
are always the session's user, and updates and deletes are matched on that user
before they can touch a row. Database errors are mapped to copy a user can act
on (`23514` → "check the amount", `23503` → "that category is no longer
available") and the original is logged server-side.

### Categories without a setup step

Phase 3 deliberately seeded no default categories, because specification §13
says defaults are offered rather than forced. The expense form resolves that:
the category select lists the user's own categories, then the fourteen suggested
defaults they have not created yet, then "+ Create a new category".

Picking a suggestion or typing a name is a find-or-create. Names are matched the
way the database's unique index compares them — `lower(btrim(name))` — so
"gROCERIES  " reuses "Groceries" instead of colliding. A lost race on the unique
index (`23505`) re-reads and uses the winner's row. An existing category id that
is not the user's own is treated as a tampered form and refused, not as a typo.

### The form

Field order follows the specification's quick-entry flow: item name, amount,
paid by, date, category, payment mode, notes. Every control is native — `select`,
`input type="date"`, `textarea` — which is keyboard-accessible and
screen-reader-correct without any code of ours, and opens the platform's own
pickers on mobile. Radix is still not installed, because nothing yet needs a
control the platform does not provide.

Three details worth recording:

- **"Paid by" is read-only.** A personal expense is always paid by its owner, and
  the database enforces it (`expenses_personal_paid_by_owner`). Rendering a
  disabled-looking picker that can only hold one value would be a lie, so it
  shows the user's name and says that a group lets you choose.
- **The date default is corrected in the browser.** The server's "today" is its
  own calendar day, which for an IST user between midnight and 05:30 is
  yesterday in UTC. The field is uncontrolled and an effect corrects it once the
  browser can answer — only for a new expense, and only while it still holds the
  server's guess, so a typed date is never overwritten.
- **Toasts survive the redirect.** A Server Action that redirects cannot also
  return a message to `useActionState`, because the component it would render
  into is gone. Actions append `?flash=…` and the destination toasts it once and
  strips it from the URL, so a refresh does not repeat it.

Delete is behind an inline confirmation rather than a modal. The first button is
a real submit button, so without JavaScript it posts straight to the action;
with JavaScript it becomes a confirmation step instead.

### UI

- `Field` + `fieldAria` extract the label/hint/error wiring every control
  shares; `FormField` now builds on them, so the accessibility markup exists
  once rather than per control type. New primitives: `Select`, `Textarea`,
  `EmptyState`.
- Expense rows are cards, not table cells — an expense has seven fields, and a
  seven-column table is unreadable on a phone. Days are grouped under a heading
  carrying that day's total.
- Dashboard: month stated up front, three stat cards (total, count, average
  daily), a category breakdown, and recent expenses. The breakdown's bar is a
  proportion and every row states its share in words, so nothing depends on
  seeing colour.
- Navigation now has Dashboard and Expenses with an active state, on one row
  that works at every width. A floating action button adds an expense on mobile.
- Empty states for "no expenses yet" and "no expenses recorded for
  <month>"; skeleton loading states for both new pages.
- Pagination at 20 per page, with a junk `?page=` value falling back to page 1.

### Testing — `scripts/verify-expenses.mjs`, `npm run verify:expenses`

41 assertions, all made against the running application over HTTP with a real
Supabase session cookie. Expenses are created, edited and deleted by submitting
the **actual forms**, hidden Server Action fields and all — the no-JavaScript
path — so the suite exercises the Server Actions themselves rather than a
re-implementation of them. The cookie jar is filled by `@supabase/ssr`, so the
cookies are byte-for-byte what a browser would hold.

It covers empty states, the full create/read/update/delete cycle, every
validation rule, category find-or-create and its case-insensitive matching,
privacy between two users, the signed-out redirect, exact money arithmetic,
calendar-date fidelity, and pagination. Throwaway accounts are deleted at the
end even when assertions fail; the database was confirmed empty afterwards.

**All 41 pass.** Three of the first-run failures were the test's fault, not the
application's, and are worth recording because they will recur:

1. **React writes `<!-- -->` between adjacent text nodes**, so "Welcome, {name}"
   arrives as `Welcome, <!-- -->Ada Owner`. Assertions on rendered copy strip
   those first.
2. **The suite ran across midnight**, so an expense dated "today" was headed
   "Yesterday". Day grouping is now asserted on the heading's `id`, which
   carries the ISO date, rather than on its label.
3. **`notFound()` does not produce a 404 status here** — see below.

### A finding: `notFound()` returns 200

Requesting a missing expense, or another user's, renders the not-found UI and
leaks nothing — the expense form is absent, the response carries
`NEXT_HTTP_ERROR_FALLBACK;404` and `<meta name="robots" content="noindex">`.
But the HTTP status is **200, not 404**.

This is Next 16.3.4 behaviour, not something this phase introduced: a page whose
body is only `notFound()` behaves the same way, in development and in a
production build alike. Next streams the document shell and its metadata before
the page finishes rendering, so the 200 status line is already committed by the
time the 404 is thrown. Removing the `loading.tsx` Suspense boundaries above the
route does not change it.

Nothing is being worked around. `notFound()` is the correct API, it renders the
correct UI, and it does not expose the record. The status code is noted here so
it is not rediscovered later, and is worth revisiting in Phase 12 against a
newer Next release.

### Checks run

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ Clean |
| `npm run typecheck` | ✅ Clean |
| `npm run build` | ✅ 10 routes; `/expenses`, `/expenses/new`, `/expenses/[id]/edit` added |
| `npm run verify:expenses` | ✅ 41 passed, 0 failed |
| `npm run db:verify-rls` | ✅ 77 passed, 0 failed — Phase 3 unaffected |
| Dev server log | ✅ No errors or warnings during the whole suite |
| Database left clean | ✅ 0 expenses, 0 categories, only the 2 real accounts |

Two lint errors were fixed rather than suppressed: `react-hooks/set-state-in-effect`
fired twice, and both call sites were genuinely better without the state update
— the date field became uncontrolled, and a failed delete now leaves its
confirmation open instead of resetting it.

### Decisions worth knowing

- **No migration in this phase.** The Phase 3 schema already had everything;
  adding one would have meant re-verifying 77 authorization assertions for no
  gain.
- **Totals are summed in TypeScript, in integer minor units, not in SQL.** One
  user-month is a small bounded set and PostgREST does not expose aggregates by
  default. Group dashboards aggregate across members and will need a
  database-side summary instead — noted in the code.
- **Native form controls over a component library.** Fewer dependencies, better
  mobile behaviour, and accessibility that does not have to be re-implemented.
- **Personal expenses are INR.** `DEFAULT_CURRENCY_CODE` in one place, the
  schema's own default, and the currency is already a column — per-user currency
  is a settings change later, not a migration.

### Deliberately not done in this phase

Month selector, search and filters (Phase 9); charts (Phase 8); budgets and a
category management screen (Phase 7); groups, invitations and email (Phase 5);
CSV export (Phase 10). Personal categories can be created while adding an
expense but not yet renamed or archived from the UI — the schema and the
actions already support both.

The email-confirmation deviation recorded below is still active and still must
be reverted in Phase 5.

---

## Phase 5 — Groups (complete, 3 September 2026)

Create a group, choose its currency, see and manage its members, invite people,
and accept or decline an invitation. No group *expenses* — that is Phase 6, and
the group page says so where they will go.

> Invitations were first built around an emailed link. They were then reworked
> so they are answered **inside the application**, with email demoted to a
> fallback. Both halves are recorded below: the original build first, then
> [the in-app rework](#in-app-invitations-added-3-september-2026), which is the
> current behaviour.

### Phases 1-4 re-verified first

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ Clean |
| `npm run typecheck` | ✅ Clean |
| `npm run build` | ✅ 10 routes |
| `npm run db:verify-rls` | ✅ 77 passed, against the live database |

The Phase 3 schema already had every table this phase needed, so almost all of
it is application code. Two small migrations were still required, both for
things the schema could not express yet — see below.

### What the schema already gave us

Phase 3 deliberately expressed *accepting an invitation* as pure RLS: a user may
insert their own `group_members` row only when a pending, unexpired invitation
addressed to their email exists for that group, **and only in the role that
invitation grants**. Phase 5 did not add a privileged accept endpoint, because
there was nothing left for one to do. `acceptInvitation` reads the invitation
with the user's own client (RLS decides whether they may see it) and inserts the
membership; the database is what accepts or refuses.

The same is true of every permission on the group pages. Nothing in `src/`
decides who may rename a group or remove a member — RLS does, and the pages only
avoid offering controls that would be refused.

### Migrations

**`0003_invitation_preview.sql`** — `invitation_preview(token_hash)`.

The RLS policy on `group_invitations` lets only the addressee (or an admin) read
a row. Correct for the table, but it makes the three cases that matter most on
an invitation page indistinguishable from a typo: *signed in as the wrong
person*, *already used or withdrawn*, and *expired* would all have rendered as
"invalid link".

The function answers them, keyed by the token's hash — so the emailed token, and
only the emailed token, opens it. It is `stable`, returns **no group id**, and
returns the invited address **masked** (`r•••@example.com`), so a leaked link
discloses neither the group's records nor somebody's email.

**`0004_admin_succession.sql`** — replaces `enforce_group_has_admin()`.

Found by this phase's own test suite, which could not delete its accounts:
Phase 3's "the last admin cannot be removed" guard also fired on the cascade
`auth.users → profiles → group_members`, so **an account that was the sole admin
of any surviving group could not be deleted at all**. Postgres reported it as
"Database error deleting user", with nothing to act on.

The cascade is distinguishable from a person's own action — by the time the
membership is removed, the `profiles` row it pointed at is already gone. In that
case the group is handed on rather than defended: the longest-standing remaining
member becomes admin, or, if nobody remains, the group is deleted.

That second half is not tidiness. `group_is_unclaimed()` opens a member-less
group to *every* signed-in user — it exists so a creator can read back the group
they just inserted, in the instant before the trigger makes them its admin. A
group left with zero members would sit in that state permanently and be
world-readable. Deleting it closes that off.

Applying migrations in order matters now: 0004 replaces a function 0002 also
defines, so re-running 0002 alone afterwards would quietly reinstate the older
version. `supabase/README.md` says so.

### Email (`src/lib/email/`)

Resend, chosen for its free tier and for needing nothing but `fetch` — a whole
SDK for one POST is the sort of dependency specification §3 asks us not to add.
The provider sits behind `sendEmail(message)`, so no caller knows which one is
in use, and swapping in Brevo or Mailjet is one new file plus one line.

`sendEmail` never throws and never returns provider detail: failures are logged
server-side and described to the user in the caller's own words. The invitation
template is inline-styled HTML with a plain-text twin, and every value that came
from a person — a group name, a display name — is escaped.

**When mail cannot be sent, the invitation still exists.** No key configured, or
the provider refuses the recipient, and the action hands the one-time link back
to the admin to pass on. That is the only moment it can be shown — only the hash
is stored, so nothing can reproduce it afterwards — and it is shown *only* on
that failure, never on the happy path.

`getServerEnv()` became `getEmailEnv()`, which returns null rather than throwing
when the provider is unconfigured: that is a deployment state the application
handles, not a programming error that should take a page down. Malformed values
still throw.

### Invitation tokens

256 bits from a CSPRNG, base64url so nothing needs percent-encoding in an email,
and only its SHA-256 is stored. At that entropy there is no salt or stretching to
justify — unlike a password, there is no low-entropy input to protect. Seven-day
expiry. `token_hash` is pinned by a trigger, so "resend" is deliberately
*revoke and re-issue* rather than an in-place edit: a link that can be re-read
from a screen is a link that outlives whoever needed it.

### The pages

- **`/groups`** — cards, each stating the currency, because it is the one piece
  of group context that changes what every number in it means. Empty state
  offers "Create group".
- **`/groups/new`** — name, description, currency. The currency is chosen up
  front (§10) rather than being an afterthought.
- **`/groups/[id]`** — group context header (§59: name, currency, your role),
  members with roles, and, for admins, the invite form and outstanding
  invitations. A panel where group expenses will go says that they are next,
  rather than showing a blank space or a button that does nothing.
- **`/groups/[id]/settings`** — admin only; edit details, delete the group. A
  member who types the URL gets the same not-found answer as a stranger.
- **`/invite/[token]`** — the landing page for an emailed link. Private, so the
  proxy sends an anonymous visitor to `/sign-in?next=/invite/…` and back. Every
  dead end explains itself: wrong account (with the masked address), already a
  member, withdrawn, expired, or not a link at all. Marked `noindex`.

Sign-up now honours `?next=`, so following an invitation before you have an
account carries you back to it afterwards.

### Reuse rather than repetition

`ConfirmAction` extracts the inline-confirmation pattern Phase 4 wrote once for
deleting an expense: first click is a real submit button (so it works without
JavaScript), second click confirms. Leave group, delete group, remove member,
revoke invitation and delete expense are now all the same component.

### A bug worth recording: never bind a Server Action inside a Client Component

`InviteForm` first called `useActionState(inviteMember.bind(null, groupId), …)`.
Every invite POST then **hung forever** — the action itself finished in under a
second, and the response never completed. Next's own log showed the action never
returning, while a plain GET of the same page rendered in two seconds.

It was not the email, not `revalidatePath`, and not the returned value; each was
ruled out by measurement. Reducing the page to a heading plus that one form
still hung. The fix is to bind in the Server Component that renders the form —
`action={inviteMember.bind(null, group.id)}` — which is exactly what
`ExpenseForm` already did, and why nothing in Phase 4 ever hit it.

`MemberRoleForm` had the same shape and was changed with it. Both now take the
bound action as a prop, and say why in a comment.

A second, quieter version of the same rule: `ConfirmAction` is a Client
Component, so it could not take `icon` as a *component* — a function cannot
cross that boundary. It takes an element instead.

### Testing — `scripts/verify-groups.mjs`, `npm run verify:groups`

58 assertions across two surfaces, because both are real:

1. **The running application over HTTP**, driving the actual forms with their
   hidden Server Action fields — the no-JavaScript path, so the Server Actions
   themselves run rather than a re-implementation of them.
2. **PostgREST directly, with each user's own JWT**, which is what someone
   reaches when they skip the UI. Every authorization claim is proved there
   rather than by the absence of a button.

Three throwaway accounts — an admin, a member, an outsider — cover: the empty
state; creating a group and its validation; the creator becoming admin; a
non-member seeing nothing at all; inviting, duplicate invitations, self-invites,
inviting an existing member; the token being stored only as a hash and never
rendered; the invitation page in every state; a wrong-account link disclosing
only a masked address; an invitee failing to join as admin against a member
invitation; acceptance closing the invitation; expired and revoked invitations
being refused; every admin-only write refused for a member through PostgREST;
promotion, demotion, the last-admin rule, removal, leaving, deletion and its
cascade; and unauthenticated access to all of it.

**All 58 pass.** Test accounts are deleted at the end even on failure.

Two of the first-run failures were the suite's own fault and are worth recording:

1. **An invitation cannot be aged by updating `expires_at`** —
   `expires_at > created_at` is a check constraint, so an expired invitation has
   to be born that way. The suite writes one with past dates through the service
   role, which is precisely what no policy allows a user to do.
2. **The suite cannot assume the invitation link comes back.** It only does when
   mail is *not* delivered. When it is, the token is gone by design, so the
   suite re-issues the invitation with a token it chose — the acceptance path is
   still exercised end to end, without the result depending on mail
   configuration.

### Checks run

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ Clean |
| `npm run typecheck` | ✅ Clean |
| `npm run build` | ✅ 15 routes; `/groups`, `/groups/new`, `/groups/[id]`, `/groups/[id]/settings`, `/invite/[token]` added |
| `npm run verify:groups` | ✅ 58 passed, 0 failed |
| `npm run verify:expenses` | ✅ 41 passed, 0 failed — Phase 4 unaffected |
| `npm run db:verify-rls` | ✅ 77 passed, 0 failed — Phase 3 unaffected |
| Migrations re-applied in order | ✅ All four re-run cleanly |
| Database left clean | ✅ 0 groups, 0 memberships, 0 invitations, only the 2 real accounts |

### Decisions worth knowing

- **An admin can invite someone as an admin.** The schema already carried a role
  on the invitation, and the accept policy already insisted the two agree. The
  form offers it rather than pretending the column does not exist.
- **Invitations are listed as pending only.** Accepted and revoked ones are
  noise on a group page. An expired-but-pending one is shown with an "Expired"
  badge, and re-inviting retires it so the "one pending per email" index frees
  up.
- **Expiry is computed on read, never swept.** The insert policy already refuses
  an expired invitation, so a status column would only ever be catching up with
  what the clock had already decided.
- **A group's currency stays editable until its first expense**, then the
  database refuses (`on update restrict` from `expenses`). The settings form
  disables the control and says why, and the action maps the refusal to a
  sentence rather than a Postgres error.
- **Group reads are three small queries, not a nested select.** `expenses` has
  two foreign keys to `categories`, which is why Phase 4 stopped embedding; the
  group queries follow the same habit, so the shapes stay obvious and no
  relationship has to be disambiguated by constraint name.
- **`APP_ORIGIN` is new and optional.** Without it the request's own origin is
  used, which is right in development. With it, a spoofed `Host` header cannot
  rewrite the link inside an invitation email.

### Deliberately not done in this phase

Group expenses, paid-by selection and group categories (Phase 6); group budgets
and category management (Phase 7); the group dashboard, member spending and
charts (Phase 8); month selection and filters (Phase 9); export (Phase 10).
There is no "resend invitation" button — revoking and inviting again is the same
thing and one fewer path to get wrong.

---

## In-app invitations (added 3 September 2026)

Extends Phase 5. Invitations now arrive in the application, and email is a
fallback for the one case the application cannot serve.

### Why

An emailed link is a detour for anyone who already has an account, and it makes
a core flow depend on deliverability. It bit us immediately: the Resend key is
on the sandbox sender, which refuses every recipient except the account owner,
so no invitation in the test suite was ever actually delivered.

Invitations were already addressed by email, and
`group_invitations_select_admin_or_invitee` already let a signed-in user read
the ones addressed to them. The in-app path was therefore mostly already
authorized — it just had nowhere to appear.

### What email is still for

Somebody who has **no account yet** has no in-app inbox for an invitation to
appear in. The emailed link, `/invite/[token]`, and `invitation_preview()` all
stay for exactly that case: follow the link, sign up (`?next=` carries you
back), accept. Nothing about that flow changed.

So: in-app is the mechanism, email is the reach. If email is unconfigured or
the provider refuses, the invitation still exists and is still waiting in the
app — the admin is simply offered the one-time link to pass on by hand.

### Migration — `0005_in_app_invitations.sql`

Three things the schema could not yet express.

**`declined` joins the status vocabulary.** Previously an invitee could ignore
an invitation but never answer it. A declined invitation is no longer pending,
so it releases the "one pending invitation per email per group" index and the
admin can invite that person again.

**One narrow policy lets them decline.** `group_invitations_decline_invitee`
permits exactly one transition — `pending → declined`, on a row whose email is
the caller's own. Every other status change is still admin-only.

**The pinning trigger now pins `role` and `expires_at` too**, for anyone who is
not an admin of the group. This is the part that matters: RLS `WITH CHECK`
cannot see the old row, so a policy alone cannot say "and don't change the
role". Without the trigger an invitee could have declined *and* promoted their
own invitation to admin in the same statement, leaving a row that a later
re-read would honour. There is a test that does precisely this through
PostgREST.

**`my_pending_invitations()`** is the inbox. The invitee can read their own
invitation row but not the group it points at — `groups` requires membership,
which is the rule that stops an invitation leaking a group's contents. The
function returns only what is needed to decide: group name, currency, inviter,
role, expiry. Like `invitation_preview()`, it returns **no group id**;
accepting re-reads the invitation row itself, under RLS.

### Accepting is one code path

`joinAgainstInvitation()` does the work; `acceptInvitation` (by invitation id,
from the inbox) and `acceptInvitationByToken` (from a link) differ only in how
they find the row. That is deliberate — the two entry points must not be able
to drift apart on what they allow.

Neither checks a token for authorization, because neither needs to:
`group_members_insert_admin_or_invitee` allows the insert only when a pending,
unexpired invitation addressed to *this user's own email* exists for that group,
and only in the role it grants. An invitation id from the client is safe for the
same reason an id is always safe here — RLS only lets a user find one addressed
to them.

### UI

- **`/invitations`** — the inbox. Group, currency, inviter, role, expiry, and
  `[ Accept ] [ Decline ]`. Decline is behind a confirmation, because from the
  invitee's side it cannot be undone; only the admin can invite again.
- **Notification bell in the top bar** — a count of waiting invitations, linking
  to the page. It renders from the *same* query the page uses, memoised per
  render by React `cache()`, so the badge and the list cannot disagree and the
  layout does not pay for a second lookup. This is specification §34's
  "Notifications" slot, finally holding something.
- **The group page** now lists declined invitations alongside pending ones, with
  a "Declined" badge and a "Remove" control. An admin who cannot see that
  somebody said no would re-invite them blindly.
- **`SubmitAction`** — the non-destructive twin of `ConfirmAction`: same shape,
  one click, still a real form so it works without JavaScript.

### Testing

`npm run verify:groups` grew from 58 to **71 assertions**, all passing. The new
ones cover: an invitation appearing in the right person's inbox and nobody
else's; the notification count; the inbox never rendering a token or a link;
declining and what it does and does not do; a declined invitation being
unusable; the admin seeing it as declined; accepting from the app; the inbox and
badge emptying afterwards; and two attacks made directly through PostgREST —
an invitee trying to change `role` and `expires_at` while declining, and an
invitee trying to set `revoked`, `expired` or `accepted` on their own
invitation. All are refused by the database.

One first-run failure was the suite's own: the invite success copy changed, and
twelve later assertions cascaded off one stale string match.

### Checks run

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ Clean |
| `npm run typecheck` | ✅ Clean |
| `npm run build` | ✅ 16 routes; `/invitations` added |
| `npm run verify:groups` | ✅ 71 passed, 0 failed |
| `npm run verify:expenses` | ✅ 41 passed, 0 failed |
| `npm run db:verify-rls` | ✅ 77 passed, 0 failed |
| `0005` applied | ✅ Applied and re-runnable |

### Specification updated

`master-specifications.md` was amended to match, rather than left describing
something the application no longer does: §2 (in-app notifications), §11
(rewritten around the in-app flow, with the email flow kept as the fallback for
users without an account), §12 (email is explicitly optional), §26 (an empty
state for invitations), §35 (invitations live in the top bar, not the main
nav), §49 and §55 (accept *and* decline, plus the two authorization rules),
Phase 5's own checklist, and §63's definition of done, which no longer requires
sending an email to consider the project finished.

### Decisions worth knowing

- **Email was not removed.** It is the only way to reach somebody who has not
  signed up, and the fallback already degrades cleanly. Say the word and it can
  go, but then an invitation to a stranger has no way to travel.
- **No notifications table.** There is one kind of notification and it already
  has a durable row of its own. A general notification system for a single
  event type would be the premature complexity §3 warns about.
- **The bell links; it does not open a popover.** One notification type, one
  page. A popover would be a second place to keep the same list correct.
- **Declined is recorded, not deleted.** An admin needs to know the answer was
  no, and the "one pending per email" index frees up either way.

---

## Phase 6 — Group expenses (complete, 3 September 2026)

Recording, listing, editing, deleting and filtering a group's expenses, with a
paid-by picker and the group's own categories. No budgets, no group dashboard,
no charts — those are Phases 7 and 8, and nothing here anticipates them.

### Phases 1-5 re-verified first

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ Clean |
| `npm run typecheck` | ✅ Clean |
| `npm run build` | ✅ 16 routes |
| `npm run verify:expenses` | ✅ 41 passed |
| `npm run verify:groups` | ✅ 71 passed |
| `npm run db:verify-rls` | ✅ 77 passed, against the live database |

### No migration was needed

Phase 3 built the schema for both kinds of expense at once, and this phase is
what finally exercises the group half of it. Everything Phase 6 needs was
already there and already tested:

- `expenses.group_id` with `user_id` as the *recorder*, so "who wrote it down"
  and "who paid" are separate columns (`paid_by`).
- `expenses_check_paid_by`, the trigger that insists the payer is a member of
  the group **at the time of writing** — and, being a trigger rather than a
  foreign key, lets a departed member's expenses stay with the group.
- The composite `(group_id, currency_code) → groups(id, currency_code)` key,
  which is what makes a group expense carry its group's currency and nothing
  else, and what locks that currency once the first expense exists.
- `expenses_pin_identity`, which stops an update moving a group expense into
  somebody's private records.
- `expenses_update_author_or_admin` / `..._delete_author_or_admin`, which are
  specification section 9's edit rule stated once, in the database.

Adding a migration would have meant re-proving 77 authorization assertions for
no gain. This phase is application code only.

### What was built

**`src/lib/expenses/group-queries.ts`** — the reads. `listGroupExpenses`
(paged, filtered, with the filtered total), `listRecentGroupExpenses` for the
group page, `getGroupExpense`, and `listGroupCategories`. Every query is scoped
to `group_id`, which is the intent and the index rather than the security
boundary: RLS already returns a group's expenses only to its members, so a
non-member asking gets an empty result — the same answer as a group that does
not exist.

One thing these reads *do* decide is who may edit a row, because a page has to
know before it renders a button. `canEdit` states specification section 9's
rule once — the member who recorded it, or an admin — and the pages ask it
rather than restating it.

**`src/lib/expenses/group-actions.ts`** — the writes, following the same
discipline as every action before them: re-validate, re-derive the user from
the session, treat the group id as a claim about *which* group and never about
the right to act on one. The insert never takes `user_id` from the form (it is
the session's user), never takes the currency from the form (it is the
group's), and lets the database refuse everything else.

**`src/lib/expenses/filters.ts`** — filters travel in the query string, so the
list is linkable and survives a refresh, and the filter bar is a plain GET
form that works with JavaScript off. Values are read leniently: an
unrecognised one is dropped rather than rejected, because a stale link should
still show a list. The ids are only shape-checked — whether one names a
category or a member of *this* group is settled by the query itself, which is
scoped to the group and runs under RLS, so an id from somewhere else simply
matches nothing.

**Pages** — `/groups/[id]/expenses` (list, filters, pagination),
`/groups/[id]/expenses/new`, `/groups/[id]/expenses/[expenseId]/edit`, and the
group page's expense panel, which replaces Phase 5's "coming next" placeholder
with the five most recent expenses, the group's running total, and a link to
the full list.

### Reuse rather than repetition

`ExpenseForm` and `ExpenseList` are now the same components for personal and
group expenses, with the differences expressed as props rather than as a second
copy:

- **`members`** — given, the form renders a "Paid by" picker over the group's
  members, defaulting to the signed-in user (specification section 7); omitted,
  the expense is personal and the payer is fixed, which the database enforces
  as well (`expenses_personal_paid_by_owner`).
- **`canCreateCategories`** — false for a group member, so "+ Create a new
  category" and the suggested defaults are not offered at all. Specification
  section 14's simple MVP choice is that an admin manages a group's categories;
  offering a control that RLS would then refuse is worse than not offering it.
- **`ExpenseList`** takes an optional `paidByName` and a `actions` render prop,
  so a group row says who paid and carries controls the *viewer* is allowed to
  use, while a personal row keeps the defaults it always had.

`ExpensePagination` gained `basePath` and `query`, so paging a filtered list
does not silently drop its filters.

The Phase 5 rule was observed throughout: **a Server Action is bound in the
Server Component that renders the form**, never inside a Client Component,
because the latter hangs forever.

### Authorization, and where it actually lives

Nothing in `src/` decides who may add, edit or delete a group expense. The
pages avoid offering controls that would be refused, and the actions turn a
refusal into a sentence; both are courtesies on top of the database's answer.
Three places carry the real rule:

| Question | Answered by |
| --- | --- |
| May I add an expense to this group? | `expenses_insert_owner_or_member` |
| May I change or delete *this* expense? | `expenses_update_author_or_admin`, `expenses_delete_author_or_admin` |
| May the person I named as payer be named? | the `expenses_check_paid_by` trigger |
| May I add a category to this group? | `categories_insert_owner_or_admin` |

A member who reaches the edit URL for somebody else's expense is told plainly
that they cannot edit it, rather than being shown a 404 for a record they can
legitimately see in the list — but the write is refused either way.

### Testing — `scripts/verify-group-expenses.mjs`, `npm run verify:group-expenses`

54 assertions across the same two surfaces Phase 5 used: the running
application over HTTP, driving the real forms with their hidden Server Action
fields (the no-JavaScript path, so the actions themselves run), and PostgREST
directly with each user's own JWT, which is what somebody reaches when they
skip the UI.

Three throwaway accounts — an admin, a member and an outsider — plus a second,
unrelated group belonging to the outsider. Coverage: the empty states; the
paid-by picker listing every member; a member recording an expense paid by
somebody else and every field landing correctly, including the recorder, the
payer and **the group's currency rather than the application default**; the
expense staying out of personal records and out of the personal editor; a
non-member being refused as the payer, from the form and from PostgREST; group
categories, including a member being refused the creation of one and a
category from another group — or a personal one — being refused; the full edit
and delete matrix for author, admin and neither; a group expense resisting an
attempt to re-parent it into private records; outsiders seeing nothing on any
surface; the signed-out redirect; every filter, alone, combined, empty, and
with nonsense values; exact totals in a non-default currency; the currency lock
now that expenses exist; server-side validation; and a departed member's
expenses staying with the group while they can no longer add to it.

**All 54 pass.** Test accounts are deleted at the end even on failure.

Three of the first-run failures were the suite's own fault and are worth
recording:

1. **A member reads the *whole* membership list**, not just their own row —
   which is correct, and RLS says so. The assertion had to name the row it
   meant.
2. **EUR is formatted in its own locale**: "2.450,50 €", not "€2,450.50". A
   suite that asserts on money has to know which locale it is reading, which
   is exactly the property being tested.
3. A copy assertion that quoted the empty state slightly wrong.

### Checks run

| Check | Result |
| --- | --- |
| `npm run lint` | ✅ Clean |
| `npm run typecheck` | ✅ Clean |
| `npm run build` | ✅ 19 routes; `/groups/[id]/expenses`, `/groups/[id]/expenses/new`, `/groups/[id]/expenses/[expenseId]/edit` added |
| `npm run verify:group-expenses` | ✅ 54 passed, 0 failed |
| `npm run verify:groups` | ✅ 71 passed, 0 failed — Phase 5 unaffected |
| `npm run verify:expenses` | ✅ 41 passed, 0 failed — Phase 4 unaffected |
| `npm run db:verify-rls` | ✅ 77 passed, 0 failed — Phase 3 unaffected |
| Dev server log | ✅ No errors or warnings beyond the deliberate refusals the suite provokes |
| Database left clean | ✅ Every test account and its data removed; only the two real accounts and their own data remain |

### Decisions worth knowing

- **The recorder and the payer are different people, and both are kept.**
  `user_id` is whoever wrote the expense down and never changes hands — an
  admin correcting somebody's entry does not become its author, which is what
  keeps "you may edit what you recorded" meaningful. A test asserts it.
- **A group member cannot create categories, and is not asked to.** The
  alternative in specification section 14 — letting members suggest one — needs
  a request-and-approve flow that would be its own feature. The control is
  hidden, the refusal is still enforced by RLS, and the message tells a member
  what to do instead.
- **Filters are a GET form, not a Server Action.** The result is a URL, which
  is shareable, bookmarkable, back-button-correct and free of JavaScript.
- **Search and date ranges were left for Phase 9.** Phase 6's brief is "group
  expense filtering"; Phase 9 owns the month selector, free-text search and
  date ranges across both personal and group lists, and building half of that
  here would mean building it twice.
- **Totals are still summed in TypeScript, in integer minor units.** A group's
  list is a bounded set and PostgREST exposes no aggregate by default. Phase 8
  needs several figures at once across members and categories, and that is the
  point at which a database-side summary earns its place — the code says so
  where it matters.
- **The group page shows five recent expenses, not a dashboard.** A monthly
  summary with charts is Phase 8, and a half-built version of it here would
  only have to be replaced.

### Deliberately not done in this phase

Category management screens and monthly budgets (Phase 7); the group dashboard,
member spending and charts (Phase 8); the month selector, free-text search and
date ranges (Phase 9); CSV export (Phase 10). A group's categories can be
created while adding an expense but not yet renamed or archived from the UI —
the schema and the actions already support both, and the screen for it is
Phase 7's.

---

## Phase 7 — Categories + budgets (complete, 3 September 2026)

Specification §13-16 and §19: default categories, custom categories, category
management, monthly budgets, budget vs actual, remaining budget and budget
utilisation — for a personal area and for a group, under the same rules.

### Phases 1-6 re-verified first

Before writing anything, the existing suites were run against the running
application, so a regression later in this phase could not be mistaken for a
pre-existing failure:

| Suite                        | Result           |
| ---------------------------- | ---------------- |
| `npm run db:verify-rls`      | 77 passed, 0 failed |
| `npm run verify:expenses`    | 41 passed, 0 failed |
| `npm run verify:groups`      | 71 passed, 0 failed |
| `npm run verify:group-expenses` | 54 passed, 0 failed |

All four still pass unchanged at the end of the phase.

### No migration was needed

Phase 3 already created `categories` and `budgets` in full — columns, the
single-owner check constraints, the composite foreign keys, the partial unique
indexes, the identity-pinning triggers and every RLS policy. Phase 7 is
therefore entirely an application-layer phase. Nothing in
`supabase/migrations/` changed.

Two pieces of that schema turned out to carry this phase on their own:

- **`budgets.period_month`.** NULL is the *standing* monthly budget; a date is
  an override for that month only. Reading a month is
  `coalesce(month-specific, standing)`. That satisfies "budgets are monthly"
  today (§15) and "the architecture should support future month-specific
  budgets" without a schema change — the reader already honours both, and only
  the standing budget is editable from the UI.
- **The `categories_detach_expenses` trigger.** Deleting a category leaves its
  expenses in place and merely uncategorised, so "delete" is a safe verb.

### One owner, one implementation

`categories` and `budgets` are the same tables for personal and group rows,
distinguished by which owning column is set. Rather than write each query
twice, `src/lib/categories/owner.ts` makes the owner a value:

```ts
type CategoryOwner =
  | { kind: "personal"; userId: string }
  | { kind: "group"; groupId: string };
```

`ownerColumn()` selects the column to filter on and `ownerColumns()` the pair
to insert. Every read and every mutation below takes a `CategoryOwner`, so the
personal page and the group page run the *same* code — there is no second
implementation to drift.

A personal owner's `userId` always comes from the session. A group owner's
`groupId` comes from the route and says only *which* group; whether the caller
may act on it is RLS's answer, never this type's.

### What was built

**Money and month arithmetic**

- `src/lib/budgets/status.ts` — `budgetProgress()` and `budgetTotals()`: pure,
  free of any server import, working in integer minor units. Returns state
  (`none` / `healthy` / `warning` / `exceeded`), remaining, percentage used, a
  clamped bar width and a label in words. Thresholds are read from the exact
  amounts rather than the rounded percentage, so 99.6% of a budget is not
  reported as having reached 100%.
- `src/lib/dates.ts` — month-in-a-URL helpers: `monthParam`, `parseMonthParam`,
  `compareMonths`, `shiftMonth`, `maxMonth`, `monthStartIso`, `resolveMonth`.
  A month out of range, or malformed, falls back to the current month rather
  than erroring.

**Reads**

- `src/lib/categories/queries.ts` — `listOwnerCategories()` (active first, then
  archived, alphabetical within each) and `unusedDefaults()`, which matches on
  `lower(btrim(name))` exactly as the unique index does, so a suggestion the
  database would reject as a duplicate is never offered.
- `src/lib/budgets/queries.ts` — `getBudgetOverview(owner, month)`, the single
  answer to "budget vs actual for this month", in three parallel queries.
  Resolves the standing/month-specific precedence in one place, and orders rows
  by *need* — over budget, then nearing it, then healthy, then unbudgeted,
  archived last — so the categories wanting attention are at the top rather
  than the ones that happen to start with "A".

**Mutations**

- `src/lib/categories/actions.ts` — create, add several suggested defaults at
  once, rename, archive, restore, delete.
- `src/lib/budgets/actions.ts` — set (or replace) and clear.
- `src/lib/categories/scope.ts` — `resolveOwner()` and one shared
  `writeFailureMessage()`, so an RLS refusal reads the same wherever it lands.
- `src/lib/validations/category.ts` and `src/lib/validations/budget.ts` —
  bounds mirroring the database's own constraints exactly, so a value that
  passes in the browser cannot be rejected by Postgres for a reason the user
  was never shown.

**UI**

- `src/components/month-nav.tsx` — `‹ September 2026 ›` (§58), as plain links.
  The month lives in the URL, so the view is shareable, the back button steps
  through months, and no client state is involved.
- `src/components/budgets/budget-meter.tsx` — the bar, the status badge and the
  figures. Colour is never the only signal (§16, §40): every meter states its
  status in words, spells out the figures beside it, and carries an
  `aria-valuetext` that reads as a sentence.
- `src/components/categories/` — `category-budgets.tsx` (the shared page body),
  `category-row.tsx`, `add-category-form.tsx`, `suggested-categories.tsx`.
- Pages: `/categories` and `/groups/[id]/categories`, each with a skeleton
  `loading.tsx`. "Categories" joined the main navigation; the group page and
  the group's other screens link to theirs from `GroupContext`.

### Two verbs for "I don't need this"

Archiving and deleting are genuinely different, and both are offered:

- **Archive** keeps the category, so historical expenses still name it, and
  stops it being offered for new ones — enforced by the
  `expenses_check_category_active` trigger, not by the absence of an option.
- **Delete** removes it. Its expenses survive as uncategorised (the detach
  trigger), and its budget goes with it through the composite foreign key's
  cascade.

### Clearing a budget deletes the row

`budgets_amount_positive` refuses zero, so "no budget" cannot be stored as a
budget of nothing — and it should not be: the first is untracked, the second
would be permanently over budget. Clearing therefore deletes.

### Setting a budget is read-then-write, not an upsert

The uniqueness behind "one standing budget per category" is a *partial* unique
index (`budgets_standing_unique_idx ... where period_month is null`).
PostgREST's `on_conflict` takes column names only — it cannot express the
predicate — so the inference would fail. `setBudget` reads first and then
inserts or updates. The race that leaves is a duplicate insert, which the index
still refuses; that refusal (23505) is caught and retried as an update, so the
last writer wins rather than the user seeing an error they cannot act on.

### A correction made during the phase: rename had to work without JavaScript

The rename control was first written as a form behind a piece of `useState`,
with its action redirecting on success. That was wrong in two ways at once:

- The form was not in the rendered HTML, so — unlike the archive, delete and
  budget controls beside it, which are built on `SubmitAction` and
  `ConfirmAction` precisely so they post without JavaScript — renaming was
  reachable only with JavaScript running.
- Redirecting made it the only control on the page that navigated, for no
  reason the user would notice.

Both were fixed: `renameCategory` now returns a `FormState` like its siblings,
and the form sits inside a native `<details>` disclosure. `<details>` is
keyboard accessible and correctly announced with no code of ours, it collapses
so a long category list stays readable, and the form is in the document either
way — so the rename posts when JavaScript never arrives. The unused
`categoriesUrl()` helper and the `category-renamed` flash key were removed with
it.

### Testing — `scripts/verify-budgets.mjs`, `npm run verify:budgets`

57 checks, over the same two surfaces the earlier suites use: the running
application over HTTP (submitting the *actual* forms, hidden Server Action
fields and all, which is the no-JavaScript path and therefore runs the real
Server Actions), and PostgREST directly with each user's own JWT, which is
what somebody reaches when they skip the UI.

| Group | Checks |
| ----- | ------ |
| Empty states | 3 |
| Creating personal categories | 5 |
| Budget versus actual | 8 |
| Months | 4 |
| Changing a budget | 4 |
| Category lifecycle | 5 |
| Group categories and budgets | 10 |
| Authorization, proved against the database | 11 |
| Database constraints | 5 |

Worth calling out among them:

- 80% of a budget is a warning and 100% an overspend, reported as an amount
  over rather than as a negative remaining.
- A standing budget applies to a month with no spending in it; an expense in a
  past month counts in that month only; a month-specific budget overrides the
  standing one; a nonsense `?month=` falls back to the current month.
- More than two decimal places is refused rather than rounded.
- Personal and group budgets never see each other's spending — in both
  directions.
- A member is offered no way to change a group's categories or budgets, *and*
  the database refuses them when the UI is skipped: create, rename, archive,
  delete, set, change and clear are each proved against PostgREST.
- A budget cannot be attached to somebody else's category, a group's budget
  cannot point at another group's category, and neither a category nor a
  budget can be re-owned by an update.

Three defects in the suite itself were found and fixed while getting it green,
each of which would have made it lie rather than fail honestly:

1. `submitForm` did not read the redirect a Server Action answers with (a
   header, not a document), so group creation yielded no id and nine
   downstream checks failed against `/groups//categories`. It now uses the
   same header-then-embedded extraction Phase 5 settled on.
2. Category names are user text, so one containing `&` reaches the page as
   `&amp;`. Matching an `aria-label` or a heading against the raw string
   silently failed to find the control it meant to click; both now escape the
   name the way React does.
3. Two assertions searched the whole page for `value="Food"` to prove a
   suggestion was or was not offered. Every category also renders a rename
   field carrying its own name, so the page at large was not evidence — both
   are now scoped to the suggestions form. A third asserted a personal
   category had not leaked into a group by searching for its name as bare
   text, which the add-category form's placeholder ("Weekend trips") matched
   on every page; it now matches the rendered category heading.

### Checks run

| Check | Result |
| ----- | ------ |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run build` | succeeds, 21 routes |
| `npm run verify:budgets` | 57 passed, 0 failed |
| `npm run db:verify-rls` | 77 passed, 0 failed |
| `npm run verify:expenses` | 41 passed, 0 failed |
| `npm run verify:groups` | 71 passed, 0 failed |
| `npm run verify:group-expenses` | 54 passed, 0 failed |

One thing worth knowing for next time: running `npm run typecheck` or
`npm run build` while `next dev` is running can produce
`.next/dev/types/routes.d.ts(58,10): error TS1109` — the two race on writing
the generated route types. It is not a code error. Stop the dev server, or
`rm -rf .next/dev/types`, and re-run.

### Decisions worth knowing

- **The UI sets the standing budget, not a per-month one.** §15 asks for
  monthly budgets and for the *architecture* to support month-specific ones.
  Both are read; only the standing one is written, because a per-month editor
  is a screen nobody has asked for yet and the reader already handles it. A row
  whose figure came from an override is labelled "Set for this month".
- **A month view is a URL, not client state.** `?month=2026-09`. Linkable,
  bookmarkable, and the back button behaves. This is also the month selector
  Phase 9 needs, arriving early because budgets are meaningless without one.
- **Group category management stays admin-only** (§14's simple MVP choice).
  The pages hide controls they know would be refused; the refusal itself is the
  database's, in `categories_*` and `budgets_*`.
- **Archived categories were already filtered out of the expense pickers** in
  Phases 4 and 6, so archiving needed no change there — only a UI to do it
  from.
- **Spending outside any budget is stated rather than hidden.** The page calls
  out what was spent with no category, and what was spent in categories with
  no budget, so "Total budget" never quietly implies it covers everything.

### Deliberately not done in this phase

The personal and group dashboards, member spending and charts (Phase 8); free
text search, the payment-mode and person filters and date ranges (Phase 9);
CSV export (Phase 10). Per-month budget *editing* is deliberately left out, as
above. Budgets do not yet appear on either dashboard — that is Phase 8's
first job, and `getBudgetOverview()` is the function it will call.

---

## Phase 8 — Dashboards (complete, 3 September 2026)

Specification §17-21 and §37-38: a personal dashboard and a group dashboard,
each with a monthly summary, a category breakdown, monthly expenditure and
budget charts — plus spending per member for a group.

### Regression runs

Unlike the previous phases, the earlier suites were re-run *after* this phase
rather than before it. That was the wrong order, and it cost something: a stale
assertion in Phase 4's suite (below) was found at the end instead of being
ruled out at the start. All five earlier suites were eventually run in full and
all five pass — see "Checks run" at the end of this section.

### No migration was needed

Phase 3's schema carries this phase whole. A dashboard is a read, and every
read it needs is an existing table with an existing index behind an existing
policy. Nothing in `supabase/migrations/` changed.

### Built on Phase 7 rather than beside it

`getBudgetOverview(owner, month)` already answered "what was spent in each
category this month, against what budget" for a personal area or a group. The
dashboards call it rather than asking the database the same question again, so
a dashboard costs the budget overview plus **one** range query — and for a
group, one more for who paid.

That also means the figure on the dashboard and the figure on the categories
page cannot disagree: they are the same function's return value.

The consequence is that `getPersonalMonthSummary()` in
`src/lib/expenses/queries.ts` — Phase 4's narrower version of the same sum —
was **deleted** along with its `MonthSummary` and `CategoryTotal` types. Two
implementations of "this month's spending per category" is exactly the drift
this phase was meant to remove.

### What was built

**Summary arithmetic — `src/lib/dashboard/summary.ts`**

Pure, free of any server import, in integer minor units, so the same functions
decide what a page renders and what a test asserts:

- `categoryTotals()` — ranks the month's spending, drops categories with
  nothing in them, keeps uncategorised spending as a row of its own so the
  parts always add up to the total printed above them, and folds the tail past
  six into "Other categories (n)".
- `memberTotals()` — spending per member, including members who paid nothing
  (a zero is information; a row that vanished would read as a bug), and
  keeping a row for somebody who paid and has since left, because their money
  is still in the total.
- `averageDaily()` — divides by days *elapsed*, so a figure read on the 3rd is
  not diluted by the 27 days that have not happened.

Shares are whole numbers rounded independently, so a set of them can total 99
or 101. That is deliberate: the alternative is an adjusted percentage that does
not match the amount printed beside it.

**Reads — `src/lib/dashboard/queries.ts`**

- `monthlyTrend(owner, month, months)` — one range query for the whole window,
  bucketed by the `YYYY-MM` prefix of `expense_date`. Slicing the stored string
  rather than parsing it means no timezone can move a row into the wrong month.
  Months with nothing in them are returned at zero, because a gap in a trend is
  information and a chart that skipped them would compress the axis.
- `memberSpending(groupId, month, viewerId)` — attribution by `paid_by`, not by
  who typed the expense in. A member may record that somebody else paid, and it
  is the payer the group cares about. This is also the figure a settlement
  feature would later be computed from (§46).
- `getPersonalDashboard(month)` and `getGroupDashboard(groupId, month, isAdmin)`
  — each composing the above in parallel.

**Charts — `src/components/charts/`**

Hand-built, with no chart library. Every visualisation this phase needs is a
single series of magnitudes, which is a `<div>` with a width or a height; a
library would have added a dependency, a client bundle and a hydration step to
draw a rectangle.

- `bar-list.tsx` — the ranked horizontal bar chart, used for both category
  spending and member spending, because they are the same question. Bars are
  scaled against the largest value (so the width compares magnitudes) while the
  share of the total is printed as text. 8px marks, square at the baseline and
  rounded at the data end.
- `column-chart.tsx` — monthly expenditure. Every column is a **link to that
  month**, so the chart is also the fastest way to move through history.

**Presentation — `src/components/dashboard/`**

`month-summary.tsx` (the four stat cards plus the overall budget meter),
`category-breakdown.tsx`, `monthly-trend.tsx`, `member-spending.tsx`, and
`budget-table.tsx` — the category-by-category budget/spent/remaining/% table
§19 asks for, which scrolls sideways in its own container on a narrow screen
rather than squeezing the page.

**Pages**

`/dashboard` rewritten, and `/groups/[id]/dashboard` added, each with a
skeleton `loading.tsx`. The group dashboard is linked from `GroupContext`, so
it is one click from the group's home, its expenses and its categories.

### A decision worth explaining: no donut chart

§38 suggests a donut or pie for category spending. This phase deliberately used
a **ranked horizontal bar list** instead, and the reason is measurable rather
than aesthetic.

A pie tells its slices apart by colour alone, so the palette has to survive
colour-vision deficiency. The categorical palette was run through the data-viz
validator, which reports pairwise perceptual distance under deutan, protan and
tritan simulation:

```text
3 slices  →  PASS in both light and dark
4 slices  →  FAIL (blue↔violet ΔE 1.9 dark; yellow↔orange ΔE 4.8 dark)
5 slices  →  FAIL (magenta↔orange ΔE 12.9, below the 15 normal-vision floor)
```

A real month has more than three categories. A six-slice donut would therefore
be asking a substantial number of people to distinguish colours they cannot,
for a reading — "what did I spend most on?" — that a ranked bar answers better
anyway, with the amount and the share printed as text on every row.

Everything the donut would have shown is still shown: the parts, their shares,
and the whole. The one thing lost is the circle.

Colour is used only where a single hue carries a single series, plus the
existing reserved status colours (healthy / nearing / over budget), which never
appear without their worded badge.

### Three bugs this phase found and fixed

1. **"Over budget" with no budget at all.** `budgetTotals.remaining` is
   `budget − spent`, which is negative whenever anything was spent and no
   budget exists. Both the new summary cards and — as it turned out — Phase 7's
   categories page titled that card "Over budget" for somebody who had never
   set one. Both now check `hasBudget` first. The value was always correct; the
   heading was the lie.

2. **A dashboard that never appeared as a page.** During development the group
   dashboard was reachable only by typing its URL. `GroupContext` gained a
   `showDashboard` link and the group's home, expenses and categories pages all
   pass it, which the suite now asserts.

3. **Chart labels read "₹150.0".** `formatCompactMinorUnits` set
   `maximumFractionDigits: 1` and nothing else. Currency formatting defaults to
   two decimal places, and a maximum below that clamps the *minimum* up to it
   rather than allowing none — so every figure that did not need a decimal
   gained a trailing zero: "₹3.0K", "₹150.0", "8500,0 €". Adding
   `minimumFractionDigits: 0` fixes it. This one was found by looking at the
   formatter's actual output across all four currencies rather than by a test,
   because nothing asserted the shortened label; a check that pins it was added
   with the fix, using a whole-thousand month, since a value like 8,500 shortens
   identically either way and would not have caught it.

   Worth knowing: each locale compacts in its own units, which is why the
   formatter asks the locale rather than dividing by 1,000 itself. An Indian
   reader gets "₹12.5L" for 1,250,000 rather than a lakh spelled as millions,
   and German does not abbreviate below a million at all.

A further change was needed in an older suite rather than in the application:
Phase 4's `verify-expenses.mjs` asserted the dashboard card was titled "Total
spent". Phase 8 renamed it to "Spent" so the four summary cards read as one row
rather than one of them shouting. The assertion was updated, with a comment
saying why, and the suite passes.

### Testing — `scripts/verify-dashboards.mjs`, `npm run verify:dashboards`

51 checks, over the same two surfaces the earlier suites use: the running
application over HTTP (submitting the actual forms, which is the
no-JavaScript path and therefore runs the real Server Actions), and PostgREST
directly with each user's own JWT, which is what somebody reaches when they
skip the UI.

| Group                                   | Checks |
| --------------------------------------- | ------ |
| Empty states                            | 3      |
| Monthly summary                         | 5      |
| Category breakdown                      | 5      |
| Monthly expenditure                     | 6      |
| Historical months                       | 4      |
| Budget vs actual on the dashboard       | 6      |
| Group dashboard                         | 12     |
| Authorization, proved against the database | 10  |

Worth calling out among them:

- Every figure is arithmetic checked against amounts the suite itself entered:
  the total, the count, the average daily (divided by days elapsed for the
  current month, by the month's whole length for a completed one), each
  category's share, each member's share, and every budget's remaining and
  percentage.
- Bar widths and column heights are read out of the rendered `style`
  attributes, so "proportional" is asserted rather than assumed.
- 6,200 of an 8,000 budget renders as **78% and "On track"** — the rounded
  percentage says 78 while the state is computed from the exact 77.5%, below
  the 80% threshold. The suite pins both halves of that.
- Member spending follows "Paid by": an expense the admin recorded on the
  member's behalf counts towards the **member**.
- A personal expense never reaches a group dashboard and a group expense never
  reaches a personal one — asserted in both directions, and one group's figures
  never appear on another's.
- A non-member gets a not-found for a group dashboard, a signed-out visitor
  gets the sign-in page, and a member is refused a budget write by the database
  and not merely by a hidden button.

Three defects in the suite itself were found and fixed while getting it green,
each of which would have made it lie rather than fail honestly:

1. **The suite was reading the hydration payload, not the page.** Next inlines
   the RSC payload in `<script>` tags, which repeats every `href`, class and
   inline style of the page as escaped JSON — and, for a streamed page, *before*
   the markup it belongs to. "Find this month's link, then read the next
   `height:`" found the link inside the payload and then the first bar in the
   real document, reporting the tallest column as 1%. `readable()` now strips
   `<script>` blocks, so an assertion can only ever see what was rendered.
2. **A category name is not proof of a chart row.** `barRow()` took any `<li>`
   containing the name, and an expense row carries its category in a badge — so
   a category absent from a breakdown was reported as present, from the recent
   expenses list beside it. Rows must now contain a bar.
3. **The month navigator's back arrow is also a link to last month**, and it
   sits earlier in the document than the chart, so `column()` matched the arrow
   and measured whichever column followed. Columns must now contain a column.

All three were the same mistake: matching a page-wide string and trusting what
came after it. Every helper is now anchored to the element it claims to read.

### Checks run

| Check                           | Result                                  |
| ------------------------------- | --------------------------------------- |
| `npm run lint`                  | clean                                   |
| `npm run typecheck`             | clean                                   |
| `npm run build`                 | succeeds, 22 routes                     |
| `npm run verify:dashboards`     | 51 passed, 0 failed                     |
| `npm run db:verify-rls`         | 77 passed, 0 failed                     |
| `npm run verify:expenses`       | 41 passed, 0 failed                     |
| `npm run verify:groups`         | 71 passed, 0 failed                     |
| `npm run verify:group-expenses` | 54 passed, 0 failed                     |
| `npm run verify:budgets`        | 57 passed, 0 failed                     |

351 checks across the six suites, none failing. One caveat worth recording for
next time: these HTTP suites run against `next dev`, where every page is
compiled on demand, and on the machine this phase was built on a full pass took
several hours per suite. That is a reason to run them earlier, not a reason to
skip them.

### Decisions worth knowing

- **The trend window is six months.** Long enough to read a trend, short enough
  that six columns stay legible on a phone. It is a constant, `TREND_MONTHS`.
- **The chart is a navigation control.** Clicking a column opens that month.
  Together with `MonthNav` this is most of what §23 asks of Phase 9 — arriving
  early because a dashboard without a month selector is a dashboard of one
  month.
- **A dashboard reports, the categories page manages.** The dashboard shows
  only categories that were spent in or budgeted; the full list, including
  unused and archived ones, stays where they are edited.
- **The group dashboard is a separate route**, not the group's home page. The
  home page is where members, invitations and settings live; conflating the two
  would have made both longer and neither better.
- **Empty is not the same as new.** A month with no expenses shows an empty
  month, with its trend intact. The first-run "add your first expense" screen
  appears only when there is genuinely nothing anywhere.

### Deliberately not done in this phase

Free-text search, the payment-mode and person filters, and date ranges
(Phase 9); CSV export (Phase 10). Per-month budget *editing* remains out, as in
Phase 7. The personal expense list still has no month selector of its own — the
dashboard has one, and the list gets its filters in Phase 9.

> Phase 9 has since delivered all of the above except CSV export and per-month
> budget editing. See [Phase 9](#phase-9--search-filters--history-complete-4-september-2026).

---

## Phase 9 — Search, filters + history (complete, 4 September 2026)

Specification §23 and §24: a month selector, free-text search, category,
payment-mode, person and date-range filters, and historical records — on both
the personal and the group expense list. No export; that is Phase 10 and
nothing here anticipates it.

### No migration was needed

Phase 3's schema carries this phase whole. Every clause this adds lands on a
column that already exists and an index that already covers it:
`expenses_personal_date_idx` and `expenses_group_date_idx` are both ordered by
`expense_date`, which is what a month scope and a date range narrow on, and
`expenses_category_idx` and `expenses_group_paid_by_idx` cover the two id
filters. Nothing in `supabase/migrations/` changed.

Free-text search is the one clause with no index behind it, and that is
deliberate — see "Search is `ILIKE`, not full-text" below.

### What already existed, and what was actually missing

Phase 6 had built three of this phase's seven controls for the *group* list
only: category, paid-by and payment mode, parsed by `parseExpenseFilters` and
applied by a local `applyFilters` inside `group-queries.ts`. Phase 8 had built
`MonthNav` and put it on both dashboards.

So the gap was narrower than the phase title suggests, and mostly about reach:

- The personal list had **no filters at all** — not even the three the group
  list already had.
- Nothing anywhere searched text.
- Nothing anywhere filtered by date range.
- The month selector existed but stopped at the dashboards; the expense lists,
  which are where §23 says historical records are read, had no notion of a
  month.

The work was therefore as much about making one implementation serve both
lists as about adding controls.

### What was built

**`src/lib/expenses/filters.ts`** — rewritten. Still the pure half: parsing a
query string into `ExpenseFilters`, and turning filters back into the
parameters a link must carry. It grew `search`, `from`, `to` and `month`, plus
`monthScope()`, `dateBounds()` and `filterParamsWithoutScope()`. It imports
nothing server-only, so the filter bar can import it.

**`src/lib/expenses/filter-query.ts`** — new, and the point of the phase.
`applyExpenseFilters(query, filters)` turns those filters into PostgREST
clauses, and **both** lists call it. A personal list and a group list now
differ by exactly one thing — the owning clause the caller states — so they
cannot come to disagree about what "paid by cash in September" means. The
local `applyFilters` in `group-queries.ts` is gone.

**`src/components/expenses/expense-filters.tsx`** — the filter bar, extended
with a search box and From/To dates, and made to serve both lists. "Paid by"
renders only when members are passed: on a personal list every expense is the
viewer's own, so the control would have had exactly one option.

**`src/components/expenses/expense-scope-nav.tsx`** — new. The time scope
above a list, in whichever of its three states is in force: a month (with
`MonthNav`'s arrows), a custom range (named, with "Clear dates"), or all time.
`MonthNav` is reused rather than reimplemented — it already carries the other
filters across a month change, disables its arrows at the ends of the allowed
window, and announces the month it moved to.

**`src/lib/expenses/queries.ts`** — `listPersonalExpenses` takes filters and
returns `filteredTotal`, matching `listGroupExpenses`'s shape.

**Both expense pages** — scope navigator, filter bar, a summary line that
counts and totals *what matched*, filter-aware empty states, and pagination
links that keep the filters.

**Both dashboards** — a "View expenses" link beside the month navigator,
carrying the month through to the list. §23 asks that changing the month update
the expense list; this is the join that makes the dashboard's month and the
list's month the same month.

### One canonical answer to "when", from two controls

A month selector and a date range are two ways of saying the same kind of
thing, and left alone they contradict each other. The rule is stated once, in
`dateBounds()`:

1. `from`/`to`, if either is present.
2. Otherwise `month`.
3. Otherwise no bound at all.

Three things follow, and each is deliberate:

- **The filter bar has no `month` field.** It is a GET form, so submitting it
  replaces the whole query string — choosing dates *drops* the month rather
  than silently losing to it.
- **`MonthNav`'s links carry `filterParamsWithoutScope()`**, not
  `filterParams()`. Were they to carry the `from`/`to` they are replacing, the
  range would keep winning and the arrows would appear to do nothing.
- **The scope navigator shows only the control in force**, so the two are never
  on screen contradicting each other.

### The unfiltered list is all time, not this month

The obvious reading of §22 ("a monthly expense list") is to default the list to
the current month. It was not done, and the reason is worth recording: a page
called "Expenses" that silently omits August is a page that has lost data as
far as the person reading it is concerned. The month is one click away on the
scope navigator, one link away from the dashboard, and permanent in a URL — and
"all time" is the honest default for a list whose heading makes no claim about
a month. The dashboards, whose headings *do* name a month, still default to the
current one.

### Search is `ILIKE`, not full-text

`item_name ILIKE %term% OR notes ILIKE %term%`. A leading-wildcard `LIKE`
cannot use a B-tree index, so this is a sequential scan of the rows RLS already
narrowed to one person or one group — hundreds of rows, not millions. A
`pg_trgm` GIN index or a `tsvector` column would both be real answers at a size
this application does not have, and both would need a migration, a trigger and
a decision about stemming. §50 says make the architecture correct and
measurable first. The clause lives in one function, so replacing it later is a
local change.

### Two escapes, and why both are needed

`ilikePattern()` in `filter-query.ts` escapes a search term twice, in order:

1. **PostgreSQL's.** `%` and `_` are `LIKE` wildcards, and the default escape
   character is a backslash. Without this, searching for "50%" would quietly
   match every row containing "50" — wrong answers, silently.
2. **PostgREST's.** Its filter grammar separates `or(...)` operands with
   commas, so an unquoted term containing one would be cut in half into two
   nonsense filters, or rejected outright. The value is wrapped in double
   quotes; inside them, `"` and `\` are escaped with `\`.

Step 2 doubles the backslashes step 1 introduced, which is correct: PostgREST
unescapes them back to one before PostgreSQL ever sees the pattern. The suite
proves both ends of this — a literal `%` matches nothing, and a term containing
a comma, a quote, a bracket or a backslash returns a page rather than an error.

### Lenient parsing, and why that is not a hole

Nothing in a query string is validated the way a form submission is. An
unreadable value is dropped, not rejected: `?category=not-a-uuid` shows the
unfiltered list rather than an error page, because a stale link or a hand-typed
URL is a normal thing to arrive with, and a list is the right answer to it. A
range typed backwards is read as the range it describes rather than as a
request for nothing.

That is safe because a filter is not a permission. Ids are only shape-checked;
whether one names a category or a member of *this* list's owner is settled by
the query, which is scoped by the caller and runs under RLS. An id from
somewhere else matches nothing — proved twice in the suite, once through the
page and once against PostgREST directly.

### Testing — `scripts/verify-search.mjs`, `npm run verify:search`

50 checks, all passing, over the two surfaces the earlier suites use: the
running application over HTTP as a signed-in browser, and PostgREST with each
user's own JWT.

| Section | What it covers |
| --- | --- |
| Nothing to narrow | An empty list offers a first expense, not a filter bar |
| Seeding | Five personal expenses across two categories, three payment modes and three months |
| Search | Name, notes, case, partial words, no matches, echo, literal `%` and `_`, commas, quotes, brackets, backslashes, matching totals |
| Field filters | Category, uncategorised, payment mode, combinations, search + filter, unreadable values, another user's category |
| Date range | From, to, inclusivity at both ends, a reversed range, the range named on screen |
| Month scope and history | This month, a previous month, the month named, an empty month named, filters carried across the arrows, range-beats-month, the dashboard's link through |
| Paging a filtered list | 21 matching rows over two pages; filters survive the page change and the link keeps them |
| Group lists | Search on notes, paid-by, the members offered, a month in the group's currency, a date range, the group dashboard's link through |
| A filter narrows, it never widens | Seven filtered requests by a stranger return nothing; a non-member gets a 404; two direct PostgREST attempts return nothing; a group filter matching only personal rows returns nothing |

The last section is the one that matters. Every new control is a new way to ask
the database a question, and the claim being tested is that none of them is a
way to ask a *wider* question than before.

**Assertions are anchored to the list, not to the page.** Phase 8 recorded the
cost of matching a page-wide string: a search term is echoed into the search
box, a category name appears in the filter dropdown, and a member's name
appears in "Paid by" — so "the page mentions Groceries" is no evidence at all
that a row for Groceries came back. `rows()` reads only the `<ul>` of expense
rows and `itemNames()` reads only the item-name spans inside it, so a check can
say exactly which rows the filter returned.

### Three earlier assertions this phase broke, and what each actually was

None of the three was a defect in the application. All three were assertions
that matched a page-wide string, which is the failure mode Phase 8 recorded.

**1. `verify:expenses` — "another user's list does not show these expenses".**
Not a leak. Phase 4 asserted `assertExcludes(page.html, "Groceries")` against
the *whole document*, and this phase put a search box on that page whose
placeholder reads "Groceries, dinner with friends…". The test was reporting
page furniture as somebody else's money.

Changing the placeholder would have hidden the fragility rather than fixed it,
so the assertion was anchored instead: a new `expenseRows()` helper in
`scripts/verify-expenses.mjs` reads only the `<ul>` of expense rows, and the
privacy check reads that. The privacy claim itself is unaffected and
independently proved — Phase 9's own suite re-asks it across seven filter
combinations, with row-anchored assertions, and passes.

**2 and 3. `verify:group-expenses` — "filtering by category narrows the list"
and "filters combine, and an empty result says so".** Both looked for the
literal text "Clear filters". The control is still there and still does what
those checks are about; it is now labelled **"Clear all"**, because the bar it
sits in clears a search and a date range as well as the three filters Phase 6
gave it. The label was the deliberate change; the two assertions were updated
to match it rather than the copy being reverted to satisfy them.

### Checks run

### Decisions worth knowing

- **One applier, two lists.** `applyExpenseFilters` is the whole reason this
  phase is small. Adding a filter now means adding it in one place and it
  appears, identically, on both lists.
- **Filters are links, not state.** Everything is a GET form and a set of
  anchors: a filtered list is shareable, the back button undoes a filter, and
  the entire feature works with JavaScript turned off. No client-side store was
  added, and none is needed.
- **Applying a filter returns to page one.** A GET form replaces the whole
  query string, `page` included. That is correct rather than incidental — page
  3 of the old result set is not page 3 of the new one.
- **The month wins for display, the range wins for data.** Stated once in
  `dateBounds()`, and the UI is built so the two controls can never both claim
  to be in force.
- **"Paid by" is a group control.** A personal expense is always the viewer's
  own, so the filter would have had one option. §24 lists it; on a personal
  list it is answered by the list existing.
- **The controls stay put while a filter is active**, even when the filter
  matched nothing. Hiding them on an empty result would mean going *back* to
  undo a filter rather than pressing "Clear all".
- **An empty month says which month.** §26 asks for "No expenses recorded for
  September 2026", not "no results" — the month is the thing the person needs
  told back to them.

### Deliberately not done in this phase

CSV export, its filename and its formatting (Phase 10) — though the export will
want the same `ExpenseFilters` this phase defined, so exporting "what I am
looking at" should be a small addition rather than a second query language.

Search remains `ILIKE` rather than full-text (above). The dashboard's category
and member bars are still not clickable links into a filtered list: it is an
appealing idea, but it would change chart markup that Phase 8's suite reads,
and the month link beside the navigator already covers what §23 asks for. The
personal list still has no per-category budget context — that lives on the
categories page and the dashboard, which is where it belongs.

---

## Temporary: email confirmation bypassed

**Added 2 September 2026. Reviewed 3 September 2026 and deliberately parked.**

> **Decision (3 September 2026):** leave this exactly as it is for now, and
> revisit it later. Nothing below is scheduled against a phase any more. The
> revert checklist at the end stays accurate and is what to follow when the
> time comes.
>
> Two things make this less urgent than it was when it was written. Invitations
> are now answered in the application rather than by email, so no *feature*
> depends on mail delivery. And the risk it carries — see
> "What this costs" — is a production risk, and this is not deployed. It must
> still be closed before it is.

### Why it exists

No email provider was wired up, so Supabase's confirmation links went nowhere.
`signInWithPassword` refuses an unconfirmed account with `email_not_confirmed`,
which made every feature impossible to exercise by hand.

### What Phase 5 resolved

**The email service exists** (`src/lib/email/`, Resend) and sends group
invitations. `EMAIL_API_KEY` and `EMAIL_FROM` are configured.

**Still no application code gates on email verification**, and none ever did.
`src/lib/auth/actions.ts` calls `signUp` and `signInWithPassword` exactly as it
always has, and `/auth/confirm` still verifies real one-time tokens.
Verification is enforced by the Supabase project itself.

### What is still outstanding

**Confirmation mail is sent by Supabase, not by us.** `EMAIL_API_KEY` has no
bearing on it. Supabase's built-in sender is heavily rate-limited and, on
current projects, only reaches project members — so a new sign-up by anyone
else still receives nothing.

Checked directly against the project's auth settings on 3 September 2026:
`mailer_autoconfirm` is `false`, so **confirmation is required and has never
been switched off**. Each new sign-up therefore lands on the "check your inbox"
screen and needs `npm run db:confirm-users` before it can sign in. Existing
accounts are unaffected.

`scripts/confirm-users.mjs` was **kept** rather than deleted. Deleting it while
confirmation mail cannot actually be delivered would leave no way to onboard an
account at all, and configuring delivery needs the Supabase dashboard, which is
not reachable from the codebase. It reads `SUPABASE_SERVICE_ROLE_KEY`, nothing
in `src/` imports it, and it never reaches the browser.

### What this costs while it is in place

- Anyone can register with an address they do not own.
- A typo'd email silently becomes an account nobody can recover.
- **Group invitations are addressed by email**, and membership is granted to
  whoever holds an account at that address — through the in-app inbox now, as
  well as through a link. With verification not actually enforced end to end,
  someone who guesses an invited address could register as it and accept the
  invitation. This is the reason it must not reach production, and it did not
  get smaller when invitations moved in-app: the in-app inbox is keyed on the
  account's email exactly as the link was.

The database is unaffected: every RLS policy, constraint and trigger still
applies, and all 77 authorization assertions still pass.

### How to finish the revert, when it is picked up again

Two Supabase dashboard settings and one manual check. Neither setting is
reachable from the codebase.

1. **Configure custom SMTP** in Authentication → Emails → SMTP Settings. The
   Resend credentials already in `.env.local` can be reused; the sending domain
   has to be verified with Resend either way (today's key is on the sandbox
   sender, which refuses every recipient but the account owner's own address).
2. **Set the Site URL and redirect URLs** under Authentication → URL
   Configuration so `/auth/confirm` and `/invite/<token>` resolve on the
   deployed origin, not just `http://localhost:3000`. Set `APP_ORIGIN` to the
   same value so invitation links do not depend on the request's `Host` header.
3. Leave **Confirm email on** — it already is.
4. **Verify the round trip by hand**: sign up, receive the mail, follow the
   link, land signed in; then confirm an unconfirmed account cannot sign in.
   Also send one group invitation to a real address and follow it through.
5. **Then delete `scripts/confirm-users.mjs`** and its `db:confirm-users` entry
   in `package.json`.
6. Delete this section and the warning at the top of this file.

Until step 6 is done, this deviation is live.
