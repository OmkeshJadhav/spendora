# Database

Migrations live in `migrations/` and are numbered so they apply in order. Each
one is written to be re-runnable, so applying the same file twice is safe.

## Applying migrations

Pick whichever suits you — all three run the same SQL.

**Supabase dashboard (quickest).** Open the project → SQL Editor → paste the
contents of each unapplied file in numeric order → Run.

**psql.** Use the connection string from Project Settings → Database:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_profiles.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_core_schema.sql
```

**Supabase CLI.**

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

## After the first migration

In the Supabase dashboard, under Authentication → Providers, make sure **Email**
is enabled. "Confirm email" is on by default; the app handles both settings:

- **Confirmation on** — sign up shows a "check your inbox" screen, and the link
  in the email lands on `/auth/confirm`, which verifies the token and signs the
  user in.
- **Confirmation off** — sign up signs the user in immediately.

Under Authentication → URL Configuration, set the Site URL to your app origin
(`http://localhost:3000` in development) so confirmation links point back to it.

### Temporary: confirmation is currently off

Until the email service is integrated in Phase 5, confirmation mail goes
nowhere, so unconfirmed accounts cannot sign in. `npm run db:confirm-users`
marks every unconfirmed account as confirmed and unblocks them.

To avoid running it after every sign up, turn **Confirm email off** under
Authentication → Sign In / Providers → Email. New sign ups then get a session
straight away.

This is a development-only setting with real consequences — anyone can register
with an address they do not own, and group invitations are addressed by email.
It must be reverted before the application is deployed. The full reasoning and
the revert checklist are in `project-progress.md`, under
"Temporary: email confirmation bypassed".

## Regenerating types

`src/types/database.ts` is currently hand-written to match the schema. Once the
Supabase CLI is linked, it can be generated instead:

```bash
npx supabase gen types typescript --linked > src/types/database.ts
```

## What exists so far

| Migration              | Contents                                                  |
| ---------------------- | --------------------------------------------------------- |
| `0001_profiles.sql`    | `profiles` table, sign-up trigger, email-sync trigger, `updated_at` helper, RLS policies |
| `0002_core_schema.sql` | `groups`, `group_members`, `group_invitations`, `categories`, `budgets`, `expenses` — plus the authorization helpers and every RLS policy |

## Verifying authorization

`scripts/verify-rls.mjs` is the real test of the schema. It creates three
throwaway accounts — a group admin, a member and an outsider — and then tries
to break the rules through PostgREST, which is exactly the surface a browser
reaches. It never goes through the application, because in production an
attacker would not either.

```bash
npm run db:verify-rls
```

It needs `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, used only to create and
then delete the test accounts. The accounts are removed even when assertions
fail, and everything they own goes with them via the cascade from `auth.users`.

Run it after any change to a policy, a trigger or a constraint.

## Schema notes

A few decisions are easy to misread from the SQL alone.

**One shape for personal and group data.** `categories`, `budgets` and
`expenses` each carry both a `group_id` and a `user_id`, and a check constraint
insists exactly one is set. Personal rows and group rows are the same table with
a different owner, which keeps queries, policies and the expense form single.

**Cross-owner integrity is declarative.** A composite foreign key with a NULL
column is not enforced at all, so `(category_id, group_id) → categories(id,
group_id)` checks group rows and skips personal ones, while
`(category_id, user_id)` does the reverse. Between them, a category can never
belong to a different owner than the budget or expense pointing at it — no
trigger required. The same trick pins a group expense to its group's currency
through `(group_id, currency_code) → groups(id, currency_code)`.

**Budgets.** `period_month` NULL is the standing monthly budget; a row with a
month set overrides it for that month alone. Reading a month is therefore
`coalesce(month-specific, standing)`, which is monthly today and month-specific
whenever the UI wants to be.

**Categories are archived, not deleted, once in use.** Deleting one leaves its
expenses in place and merely uncategorised (`ON DELETE SET NULL (category_id)`,
Postgres 15+), but it also destroys the category's budgets. `is_archived` is the
path for "I do not need this category any more".

**paid_by is checked by a trigger, not a foreign key.** Whoever is recorded as
having paid must be a member *at the moment the expense is written*. A foreign
key would keep enforcing that forever, so removing a member would either delete
or freeze the expenses they had already paid for.

**Membership never recurses.** Policies read membership through
`is_group_member()` / `is_group_admin()`, which are `security definer`. A policy
on `group_members` that queried `group_members` directly would loop.

**Accepting an invitation is pure RLS.** A user may insert their own
`group_members` row only when a pending, unexpired invitation addressed to their
email exists for that group, and only in the role it grants. A trigger then
closes the invitation. There is no privileged "accept" endpoint to get wrong.

**A group always has an admin.** The creator is made admin by a trigger, and the
last admin cannot be demoted or removed — they have to delete the group instead.
