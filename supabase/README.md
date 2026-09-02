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

## Regenerating types

`src/types/database.ts` is currently hand-written to match the schema. Once the
Supabase CLI is linked, it can be generated instead:

```bash
npx supabase gen types typescript --linked > src/types/database.ts
```

## What exists so far

| Migration          | Contents                                                      |
| ------------------ | ------------------------------------------------------------- |
| `0001_profiles.sql` | `profiles` table, sign-up trigger, email-sync trigger, `updated_at` helper, RLS policies |

Groups, categories, budgets, expenses and invitations arrive in Phase 3.
