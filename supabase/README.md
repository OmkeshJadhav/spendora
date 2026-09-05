# Database

Migrations live in `migrations/` and are numbered so they apply in order. Each
one is written to be re-runnable, so applying the same file twice is safe.

## Applying migrations

Pick whichever suits you — all three run the same SQL.

**Supabase dashboard (quickest).** Open the project → SQL Editor → paste the
contents of each unapplied file in numeric order → Run.

**psql.** Use the connection string from Project Settings → Database. If the
password contains `@`, `:`, `/`, `?`, `#`, `[` or `]`, percent-encode it first
(`@` is `%40`) — libpq splits the URL at the first `@`, so an unencoded one in
the password is read as the start of the hostname and the connection fails with
`could not translate host name`:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_profiles.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_core_schema.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0003_invitation_preview.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0004_admin_succession.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/0005_in_app_invitations.sql
```

Apply them **in order**. 0004 and 0005 each replace a function that 0002 also
defines, so running 0002 on its own afterwards would quietly reinstate the
older versions.

**Supabase CLI.**

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

## After the first migration

In the Supabase dashboard, under Authentication → Providers, make sure **Email**
is enabled and **Confirm email** is on. It is on by default, and the
application depends on it: sign up shows a "check your inbox" screen, and the
link in the email lands on `/auth/confirm`, which verifies the token and signs
the user in.

**Turning "Confirm email" off does not sign people in faster — it locks them
out.** The application enforces a confirmed address itself, in
`src/lib/auth/actions.ts`, `src/lib/auth/dal.ts` and `src/proxy.ts`: an account
with no `email_confirmed_at` cannot sign in and is treated as signed out
everywhere. That check is deliberate rather than defensive duplication —
group membership is granted by email address, so an address nobody has proved
they own must not be able to accept an invitation meant for someone else.

Under Authentication → URL Configuration, set the Site URL to your app origin
(`http://localhost:3000` in development) so confirmation links point back to it.

### Email delivery

Two different senders are involved, and only one of them is ours:

- **Confirmation and recovery mail is sent by Supabase**, through whatever SMTP
  the project is configured with. `EMAIL_API_KEY` has no bearing on it. The
  built-in sender is heavily rate-limited and only reaches project members, so
  set a custom SMTP provider under Authentication → Emails → SMTP Settings
  before anyone else signs up.
- **Invitation mail is sent by the application**, through `src/lib/email/`
  (Resend). It needs `EMAIL_API_KEY` and an `EMAIL_FROM` on a domain verified
  with the provider. Unverified, the provider refuses every recipient but your
  own address.

When invitation mail cannot be sent — no key, or the provider refuses — the
invitation is still created and the admin is shown its one-time link to pass on
by hand. That is a deliberate fallback, not an error path.

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
| `0003_invitation_preview.sql` | `invitation_preview()` — what an invitation link may show its holder, keyed by the token hash — and the `mask_email()` helper it uses |
| `0004_admin_succession.sql` | Replaces `enforce_group_has_admin()` so deleting an *account* hands its groups on instead of failing |
| `0005_in_app_invitations.sql` | `declined` status, the invitee's decline policy, `role`/`expires_at` pinning for non-admins, and `my_pending_invitations()` |

## Verifying authorization

`scripts/verify-rls.mjs` is the real test of the schema. It creates three
throwaway accounts — a group admin, a member and an outsider — and then tries
to break the rules through PostgREST, which is exactly the surface a browser
reaches. It never goes through the application, because in production an
attacker would not either.

```bash
npm run db:verify-rls
```

`scripts/verify-groups.mjs` (`npm run verify:groups`) covers Phase 5 the same
way, and adds the other half: it drives the real forms over HTTP with a real
session, so the Server Actions themselves are exercised, then proves each
authorization claim again through PostgREST. It needs the application running
(`npm run dev`).

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
The one exception is a deletion nobody chose: when the last admin's *account*
is deleted, the cascade hands the group to its longest-standing member, or
deletes the group if there is nobody left (0004). Leaving a group with zero
members would be worse than deleting it — `group_is_unclaimed()` makes a
member-less group readable by every signed-in user, which exists so a creator
can read back the group they just inserted.

**An invitation link is a capability, and nothing more.** Only the SHA-256 of
the emailed token is stored. `invitation_preview()` turns a token hash into
just enough to render the invitation page — group name, inviter, currency, the
invited address *masked*, and whether it is addressed to the reader — and never
returns the group id. Joining is still the plain RLS insert from 0002.

**Invitations are answered in the app; the link is the fallback.**
`my_pending_invitations()` (0005) is the invitee's inbox, scoped by the database
to their own email address. Accepting from the inbox and accepting from a link
end in the same insert, allowed by the same policy — the token is a way of
*finding* an invitation, never a way of being authorized for one. The link
exists for somebody who has no account yet, and so has no inbox.

**An invitee can decline, and can do nothing else.** One policy permits
`pending → declined` on a row addressed to them. RLS `WITH CHECK` cannot see the
old row, so it cannot forbid a role change in the same statement — the pinning
trigger does that instead, resetting `role` and `expires_at` for anyone who is
not an admin of the group.
