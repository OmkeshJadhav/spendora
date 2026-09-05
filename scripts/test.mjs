#!/usr/bin/env node
/**
 * `npm test` — every suite in this repository, in one run.
 *
 * Specification §61's Phase 13 asks for `npm run lint`, `npm run build` and
 * `npm test` to pass before the MVP is considered complete. The first two
 * already existed; this is the third, and it is a runner rather than a new
 * framework. Each suite underneath it is the one its phase shipped and is
 * still run on its own during development — this only removes the need to
 * remember all nine and the order they go in.
 *
 * Order is deliberate: the schema's own authorization first, then each
 * feature in the order it was built, then the cross-cutting security audit
 * last. A failure early on explains the failures after it, so the run stops at
 * the first one rather than printing eight more consequences of it.
 *
 *   npm run dev    (in another terminal)
 *   npm test
 *
 * Needs the same environment the suites do — see `.env.example`. They create
 * throwaway accounts and delete them again, so run this against a test
 * project, never one holding real people's expenses.
 *
 * Set BASE_URL to test something other than http://localhost:3000.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const SUITES = [
  ["db:verify-rls", "verify-rls.mjs", "row-level security policies"],
  ["verify:expenses", "verify-expenses.mjs", "personal expenses"],
  ["verify:groups", "verify-groups.mjs", "groups and invitations"],
  ["verify:group-expenses", "verify-group-expenses.mjs", "group expenses"],
  ["verify:budgets", "verify-budgets.mjs", "categories and budgets"],
  ["verify:dashboards", "verify-dashboards.mjs", "dashboards"],
  ["verify:search", "verify-search.mjs", "search, filters and history"],
  ["verify:export", "verify-export.mjs", "CSV and Excel export"],
  ["audit:security", "audit-security.mjs", "security audit"],
];

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value && !process.env[match[1]]) process.env[match[1]] = value;
  }
}

loadEnvLocal();

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const missing = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
].filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  console.error("See .env.example. The suites need a Supabase project to run against.");
  process.exit(1);
}

// Fail here rather than nine times over: every suite drives the real
// application over HTTP, so without it running none of them can say anything.
const probe = await fetch(`${BASE_URL}/sign-in`, { redirect: "manual" }).catch(() => null);

if (!probe) {
  console.error(`No application at ${BASE_URL}. Start it with: npm run dev`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Running the suites
// ---------------------------------------------------------------------------

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [new URL(file, import.meta.url).pathname], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

const started = Date.now();
const results = [];

for (const [script, file, description] of SUITES) {
  console.log(`\n${"=".repeat(72)}\n  ${script} — ${description}\n${"=".repeat(72)}`);

  const code = await run(file);
  results.push({ script, code });

  if (code !== 0) {
    // Everything after a failed suite is either a consequence of it or noise.
    console.error(`\n${script} failed. Stopping here.`);
    break;
  }
}

// ---------------------------------------------------------------------------

const elapsed = Math.round((Date.now() - started) / 1000);
const failed = results.filter((result) => result.code !== 0);
const skipped = SUITES.length - results.length;

console.log(`\n${"=".repeat(72)}`);
for (const { script, code } of results) {
  console.log(`  ${code === 0 ? "pass" : "FAIL"}  ${script}`);
}
for (const [script] of SUITES.slice(results.length)) {
  console.log(`  skip  ${script}`);
}
console.log(
  `\n${results.length - failed.length}/${SUITES.length} suites passed` +
    `${skipped > 0 ? `, ${skipped} not run` : ""} in ${elapsed}s`,
);

process.exit(failed.length > 0 ? 1 : 0);
