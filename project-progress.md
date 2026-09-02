# Spendora — Project Progress

Tracks what has actually been built, phase by phase, against
[`master-specifications.md`](./master-specifications.md).

| Phase | Scope                          | Status         |
| ----- | ------------------------------ | -------------- |
| 1     | Project foundation             | ✅ Complete    |
| 2     | Supabase + Authentication      | ⬜ Not started |
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
