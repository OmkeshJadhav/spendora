# Spendora

A monthly expense tracker for personal and shared spending. Record expenses,
organise them into groups with per-category monthly budgets, and see where the
money went — month by month.

> **Status:** in development. Phases 1-9 are complete — authentication,
> personal and group expenses, groups and in-app invitations, categories and
> budgets, dashboards, and search, filters and history. CSV export, UI polish
> and the security audit land in later phases. See
> [`project-progress.md`](./project-progress.md) for what exists today and
> [`master-specifications.md`](./master-specifications.md) for the full plan.

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
| Email         | Resend — planned                                     |
| Linting       | ESLint (flat config, `eslint-config-next`)           |

## Prerequisites

- Node.js 20.9 or newer (developed on Node 22)
- npm 10 or newer
- A Supabase project (needed from Phase 2 onwards)
- A Resend account (needed for group invitation emails, Phase 5)

## Installation

```bash
npm install
```

## Environment setup

Copy the example file and fill in your own values:

```bash
cp .env.example .env.local
```

| Variable                        | Scope   | Purpose                                              |
| ------------------------------- | ------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser | Supabase project URL                                 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser | Supabase anon key (public by design; RLS protects data) |
| `EMAIL_API_KEY`                 | Server  | Email provider API key — never exposed to the browser |
| `EMAIL_FROM`                    | Server  | Sender address for invitation emails                 |

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
4. Under Authentication → Providers, enable **Email**. Both settings of
   "Confirm email" are handled by the app.
5. Under Authentication → URL Configuration, set the Site URL to your app origin
   (`http://localhost:3000` in development) so confirmation links come back to
   the app.

Everything the browser touches goes through the anon key, so **Row Level
Security is the security boundary** — the anon key alone grants no access to
another user's rows.

## Email setup

Not yet wired up. Phase 5 adds a provider-agnostic service under `src/lib/email`
so the provider can be swapped without touching calling code. All sending
happens server-side.

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

## Checks

```bash
npm run lint       # ESLint
npm run lint:fix   # ESLint with autofix
npm run typecheck  # Generates route types, then tsc --noEmit
npm run build      # Full production build
```

## Testing

Each phase ships an end-to-end suite under `scripts/`. They drive the running
application over HTTP the way a signed-in browser does — submitting the real
forms, including the no-JavaScript path — and also query PostgREST directly
with each user's own JWT, so authorization claims are proved against the
database rather than against the absence of a link.

Start the app first, then run a suite:

```bash
npm run dev                    # in another terminal

npm run db:verify-rls          # row-level security policies
npm run verify:expenses        # personal expenses
npm run verify:groups          # groups and invitations
npm run verify:group-expenses  # group expenses
npm run verify:budgets         # categories and budgets
npm run verify:dashboards      # personal and group dashboards
npm run verify:search          # search, filters and history
```

Each suite creates throwaway accounts and deletes them at the end, even on
failure. They need `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` for that, and
run against `http://localhost:3000` unless `BASE_URL` says otherwise. Because
every page is compiled on demand under `next dev`, a full pass is slow.

A consolidated security and authorization audit arrives in Phase 12.

## Project structure

```text
src/
├── app/
│   ├── (auth)/         # Sign in, sign up — public
│   ├── (dashboard)/    # Dashboard, settings — requires a session
│   ├── auth/confirm/   # Verifies emailed one-time links
│   └── ...             # Root layout, error/loading/not-found UI
├── components/
│   └── ui/             # Reusable presentational primitives
├── lib/
│   ├── auth/           # Data access layer, server actions, error mapping
│   ├── supabase/       # Request-scoped Supabase clients
│   └── validations/    # Zod schemas shared by client and server
├── types/              # Shared value types and the database schema type
└── proxy.ts            # Session refresh + route protection

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
