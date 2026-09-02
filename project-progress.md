# Spendora — Project Progress

Tracks what has actually been built, phase by phase, against
[`master-specifications.md`](./master-specifications.md).

| Phase | Scope                          | Status         |
| ----- | ------------------------------ | -------------- |
| 1     | Project foundation             | ✅ Complete    |
| 2     | Supabase + Authentication      | ✅ Complete    |
| 3     | Database schema + RLS          | ⬜ Not started |
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
