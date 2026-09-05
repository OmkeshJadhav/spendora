# Spendora

A monthly expense tracker for personal and shared spending. Record expenses,
organise them into groups with per-category monthly budgets, and see where the
money went — month by month.

> **Status:** MVP complete. All thirteen phases have shipped — authentication,
> personal and group expenses, groups and in-app invitations, categories and
> budgets, dashboards, search, filters and history, CSV/Excel export, UI
> polish, a security audit, and the production-readiness review. See
> [`project-progress.md`](./project-progress.md) for what exists today and how
> each decision was reached, and
> [`master-specifications.md`](./master-specifications.md) for the full plan.

## What it does

- **Personal expenses** — private to the person who recorded them. Item,
  amount, date, category, payment mode and notes; create, edit and delete.
- **Groups** — a name, a currency, and members with admin or member roles.
  Admins invite by email address; invitations are answered inside the
  application, and email is only how one reaches somebody without an account.
- **Group expenses** — recorded against the group's currency, with any member
  selectable as the payer.
- **Categories and monthly budgets** — per group or per person, with budget
  versus actual, remaining, and utilisation.
- **Dashboards** — monthly summary, category breakdown, six-month trend, and,
  for a group, spending by member.
- **History, search and filters** — a month selector across every view, and
  filtering by category, payer, payment mode, date range and free text.
- **Export** — the month you are looking at, as CSV or XLSX.

## Tech stack

| Area          | Choice                                              |
| ------------- | --------------------------------------------------- |
| Framework     | Next.js 16 (App Router, Turbopack), React 19         |
| Language      | TypeScript (strict)                                  |
| Styling       | Tailwind CSS v4 with semantic design tokens          |
| UI            | Local component primitives in `src/components/ui`    |
| Icons         | lucide-react                                         |
| Animation     | Motion                                               |
| Notifications | Sonner (toasts)                                      |
| Validation    | Zod                                                  |
| Database/auth | Supabase (PostgreSQL, Auth, Row Level Security)     |
| Email         | Resend, behind a provider-agnostic service            |
| Linting       | ESLint (flat config, `eslint-config-next`)           |

## Prerequisites

- Node.js 20.9 or newer (developed on Node 22)
- npm 10 or newer
- A Supabase project
- A Resend account — optional; only for mailing invitations to people who
  do not have an account yet

## Installation

```bash
npm install
```

## Environment setup

Copy the example file and fill in your own values:

```bash
cp .env.example .env.local
```

| Variable                        | Scope     | Required | Purpose |
| ------------------------------- | --------- | -------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser   | Yes      | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser   | Yes      | Supabase anon key (public by design; RLS protects data) |
| `EMAIL_API_KEY`                 | Server    | No       | Resend API key — never exposed to the browser |
| `EMAIL_FROM`                    | Server    | No       | Sender address for invitation emails |
| `APP_ORIGIN`                    | Server    | No       | Canonical origin for links inside emails. Set it in production, so a spoofed `Host` header cannot rewrite them |
| `SUPABASE_SERVICE_ROLE_KEY`     | Test only | No       | Lets the test suites create and delete throwaway accounts. Never read by application code |
| `BASE_URL`                      | Test only | No       | Where the suites find the running app (default `http://localhost:3000`) |
| `SUPABASE_DB_URL`               | Tooling   | No       | Connection string for applying migrations with `psql` |

Leaving `EMAIL_API_KEY` and `EMAIL_FROM` blank is a supported configuration,
not a broken one: invitations are answered in the application, so without a
provider they are still created and the admin is shown the one-time link to
pass on by hand.

`.env.local` is git-ignored. Only `.env.example` is committed, and it never
contains real values. Variables are read through
[`src/lib/env.ts`](./src/lib/env.ts), which validates them with Zod and reports
which key is missing without printing its value.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Copy **Project URL** and the **anon** key from Project Settings → API into
   `.env.local`.
3. Apply the migrations in `supabase/migrations/` — the SQL Editor, `psql`, or
   the Supabase CLI all work. See [`supabase/README.md`](./supabase/README.md)
   for the commands and for what each migration contains.
4. Under Authentication → Providers, enable **Email** and leave **Confirm
   email** on. The application requires a confirmed address of its own accord —
   an unconfirmed account cannot sign in and is treated as signed out — so
   turning the setting off locks new sign-ups out rather than letting them in.
5. Under Authentication → URL Configuration, set the Site URL to your app origin
   (`http://localhost:3000` in development) so confirmation links come back to
   the app.
6. Under Authentication → Emails → SMTP Settings, configure a custom SMTP
   sender. Supabase's built-in sender is heavily rate-limited and only reaches
   project members, so without this a new sign-up never receives its
   confirmation link and can never sign in.

Everything the browser touches goes through the anon key, so **Row Level
Security is the security boundary** — the anon key alone grants no access to
another user's rows.

## Email setup

Two different senders are involved, and only one of them is this application's.

**Invitation mail** goes through `src/lib/email/`, which wraps
[Resend](https://resend.com) behind a small interface so the provider can be
replaced without touching calling code. Sending happens server-side only. Set
`EMAIL_API_KEY` and an `EMAIL_FROM` on a domain verified with the provider —
unverified, Resend refuses every recipient but your own address.

It is optional. With no key, or when the provider refuses a message, the
invitation is still created, still appears in the invitee's in-app
invitations, and the admin is shown its one-time link to pass on. A failed
send never takes down the action that triggered it, and a raw provider error is
never shown to a user.

**Sign-up confirmation mail is sent by Supabase**, not by this application,
through whatever SMTP the project is configured with. `EMAIL_API_KEY` has no
bearing on it. See [`supabase/README.md`](./supabase/README.md).

## Development

```bash
npm run dev
```

Then open http://localhost:3000.

## Production build

```bash
npm run build
npm start
```

Before deploying, check the four things that differ from development:

1. **`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be set
   at build time**, not only at runtime — Next.js inlines `NEXT_PUBLIC_*` into
   the client bundle while building. Missing, they fail loudly on the first
   request rather than silently.
2. **Set `APP_ORIGIN`** to the deployed origin, so a link inside an invitation
   email cannot be rewritten by a spoofed `Host` header.
3. **Point Supabase at that origin too** — Authentication → URL Configuration —
   or confirmation links come back to `localhost`.
4. **Do not set `SUPABASE_SERVICE_ROLE_KEY` in the deployed environment.** No
   application code reads it; only the test suites do. A production process
   that does not hold it cannot leak it.

Response security headers (`frame-ancestors`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy`, HSTS) are set for every route in
[`next.config.ts`](./next.config.ts), and `X-Powered-By` is off.

## Checks

```bash
npm run lint       # ESLint
npm run lint:fix   # ESLint with autofix
npm run typecheck  # Generates route types, then tsc --noEmit
npm run build      # Full production build
npm test           # Every end-to-end suite (see Testing, below)
```

## Testing

Each phase ships an end-to-end suite under `scripts/`. They drive the running
application over HTTP the way a signed-in browser does — submitting the real
forms, including the no-JavaScript path — and also query PostgREST directly
with each user's own JWT, so authorization claims are proved against the
database rather than against the absence of a link.

Start the app first, then run everything:

```bash
npm run dev   # in another terminal
npm test      # all nine suites, in order, stopping at the first failure
```

Or one suite at a time, which is what a normal edit-and-check loop wants:

```bash
npm run db:verify-rls          # row-level security policies
npm run verify:expenses        # personal expenses
npm run verify:groups          # groups and invitations
npm run verify:group-expenses  # group expenses
npm run verify:budgets         # categories and budgets
npm run verify:dashboards      # personal and group dashboards
npm run verify:search          # search, filters and history
npm run verify:export          # CSV and Excel export

npm run audit:security         # the security audit
```

`npm test` is a runner, not a framework — it invokes exactly the suites above,
in the order they were built, and stops at the first failure because everything
after one is either a consequence of it or noise.

Each suite creates throwaway accounts and deletes them at the end, even on
failure. They need `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` for that, and
run against `http://localhost:3000` unless `BASE_URL` says otherwise. Because
they write and delete real rows, **point them at a test project**, not one
holding real people's expenses. Because every page is compiled on demand under
`next dev`, a full pass is slow.

### The security audit

`npm run audit:security` is the odd one out, and deliberately so. The
`verify-*` suites prove that a phase's feature works and end by proving it
cannot be misused. The audit is *only* the misuse, and it crosses every phase:
every check in it is an attack that is expected to fail, so a passing line
means the attack was refused. If the application stopped working altogether,
most of it would still pass — which is why it supplements the other suites
rather than replacing them.

It covers secrets, response headers, authentication, the anonymous role,
one user's records against another's, group roles, expense tampering,
invitations, budget and dashboard arithmetic, export, and identifiers that name
nothing. The service role key is used only to create and delete the throwaway
accounts; the code under test never sees it.

## Project structure

```text
src/
├── app/
│   ├── (auth)/         # Sign in, sign up — public
│   ├── (dashboard)/    # Every private page, behind one layout
│   ├── api/            # Export route handlers
│   ├── auth/confirm/   # Verifies emailed one-time links
│   └── ...             # Root layout, error/loading/not-found UI
├── components/
│   ├── ui/             # Reusable presentational primitives
│   ├── budgets/  categories/  charts/  dashboard/
│   ├── expenses/  groups/     # Feature components
│   └── ...             # Header, navigation, month picker, toasts
├── lib/
│   ├── auth/           # Data access layer, server actions, error mapping
│   ├── budgets/  categories/  dashboard/  expenses/  groups/
│   │                   # Queries, server actions and pure calculation per area
│   ├── email/          # Provider-agnostic sending, and the invitation template
│   ├── export/         # CSV and XLSX writers, filenames, row building
│   ├── supabase/       # Request-scoped clients, and chunked reads
│   └── validations/    # Zod schemas shared by client and server
├── types/              # Shared value types and the database schema type
└── proxy.ts            # Session refresh + route protection

scripts/                # End-to-end suites, the security audit, the runner
supabase/
└── migrations/         # Numbered, re-runnable SQL
```

`@/*` resolves to `src/*`.

## How authentication works

- **Sessions live in cookies.** `@supabase/ssr` writes them, so a session
  survives a refresh and a browser restart, and ends on sign out.
- **`src/proxy.ts`** runs before every route: it refreshes expiring tokens
  (Server Components cannot write cookies, so this is the only place a refresh
  can be saved) and redirects unauthenticated visitors to `/sign-in?next=…`.
  Routes are private unless explicitly listed as public.
- **`src/lib/auth/dal.ts`** is the real gate. `getUser()` calls Supabase's
  `getUser()`, which revalidates the token with the auth server rather than
  trusting the cookie, and is memoised per render. Pages call `requireUser()` or
  `requireProfile()` so a check is never skipped at a call site.
- **Server Actions re-validate everything.** They are public POST endpoints, so
  each one parses its input with Zod and derives the user from the session
  rather than from the submitted form.
- **RLS is the last line.** Even with a valid session, the database only returns
  rows the policies allow.
