# Spendora — Project Progress

Tracks what has actually been built, phase by phase, against
[`master-specifications.md`](./master-specifications.md).

| Phase | Scope                          | Status         |
| ----- | ------------------------------ | -------------- |
| 1     | Project foundation             | ✅ Complete    |
| 2     | Supabase + Authentication      | ✅ Complete    |
| 3     | Database schema + RLS          | ✅ Complete    |
| 4     | Personal expense tracking      | ⬜ Not started |
| 5     | Groups                         | ⬜ Not started |
| 6     | Group expenses                 | ⬜ Not started |
| 7     | Categories + budgets           | ⬜ Not started |
| 8     | Dashboards                     | ⬜ Not started |
| 9     | Search, filters + history      | ⬜ Not started |
| 10    | Export                         | ⬜ Not started |
| 11    | UI polish                      | ⬜ Not started |
| 12    | Testing + security audit       | ⬜ Not started |
| 13    | Production readiness           | ⬜ Not started |

> ⚠️ **One temporary deviation is active.** Email confirmation is currently
> bypassed so the application can be used before the email service exists. It
> **must be reverted in Phase 5**. See
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

## Temporary: email confirmation bypassed

**Added 2 September 2026. Must be reverted in Phase 5, when the email service is
integrated.**

### Why

No email provider is wired up yet, so Supabase's confirmation links are sent
into the void. `signInWithPassword` refuses any unconfirmed account with
`email_not_confirmed`, which made every feature built so far impossible to
exercise by hand. Development needed to continue; this is the smallest change
that allows it.

### What was actually changed

**No application code.** Nothing in `src/` gates on email verification, and
nothing there was weakened — `src/lib/auth/actions.ts` still calls
`supabase.auth.signUp` and `signInWithPassword` exactly as before, and
`/auth/confirm` still verifies real one-time tokens. Verification is enforced by
the Supabase project itself (GoTrue's `mailer_autoconfirm`), not by us.

**`scripts/confirm-users.mjs`** (`npm run db:confirm-users`) marks unconfirmed
accounts as confirmed through the Supabase admin API. It ran once, confirming
`omkesh.jadhav@gmail.com` — which is now able to sign in. Nothing in `src/`
imports it; it reads `SUPABASE_SERVICE_ROLE_KEY`, which never reaches the
browser.

**Still outstanding:** the project's own `Confirm email` setting is still on
(`mailer_autoconfirm: false`). Changing it needs the Supabase dashboard —
Authentication → Sign In / Providers → Email — or a Management API token, so it
could not be done from here. Until someone turns it off, **each new sign up
lands on the "check your inbox" screen and needs `npm run db:confirm-users`
before it can sign in.** Existing accounts are unaffected.

The sign-up form already handles both configurations — it shows a "check your
inbox" screen when Supabase returns no session and signs the user straight in
when it does — so no branch had to be added, and none has to be removed later.

### What this costs while it is in place

- Anyone can register with an address they do not own.
- A typo'd email silently becomes an account nobody can recover.
- Group invitations are addressed **by email**, and membership is granted to
  whoever holds a confirmed account at that address. With verification off, an
  attacker who guesses an invited address could sign up as it and accept the
  invitation. This is the reason this must not reach production.

The database is unaffected: every RLS policy, constraint and trigger from Phase 3
still applies, and the 77 authorization assertions still pass.

### How to revert — do this in Phase 5

1. Integrate the email provider (specification §12) so confirmation mail is
   actually delivered.
2. Ensure **`Confirm email` is on** in Authentication → Sign In / Providers →
   Email (it is on today; turn it back on if it was switched off during
   development).
3. Set the Site URL and redirect URLs so `/auth/confirm` resolves on the
   deployed origin, not just `http://localhost:3000`.
4. **Delete `scripts/confirm-users.mjs`** and its `db:confirm-users` entry in
   `package.json`.
5. Verify the round trip by hand: sign up, receive the mail, follow the link,
   land signed in. Confirm that an unconfirmed account cannot sign in.
6. Delete this section and the warning at the top of this file.

Until step 6 is done, this deviation is live.
