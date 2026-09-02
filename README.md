# Spendora

A monthly expense tracker for personal and shared spending. Record expenses,
organise them into groups with per-category monthly budgets, and see where the
money went — month by month.

> **Status:** in development. Phase 1 (project foundation) is complete;
> authentication, data and dashboards land in later phases. See
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
| Database/auth | Supabase (PostgreSQL, Auth, Row Level Security) — planned |
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

Not yet wired up. From Phase 2 the steps will be: create a Supabase project,
copy the URL and anon key into `.env.local`, run the SQL migrations, enable
email/password authentication, and apply the Row Level Security policies.

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

No test suite yet — tests are added alongside business logic, and the security
and authorization suite arrives in Phase 12.

## Project structure

```text
src/
├── app/            # App Router routes, layout, error/loading/not-found UI
├── components/
│   └── ui/         # Reusable presentational primitives
├── lib/            # Framework-agnostic helpers (utils, env, constants)
└── types/          # Shared value types
```

`@/*` resolves to `src/*`.
