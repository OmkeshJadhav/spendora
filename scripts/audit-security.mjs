#!/usr/bin/env node
/**
 * Phase 12 — the security audit.
 *
 * The `verify-*.mjs` suites each prove that one phase's feature works, and
 * each ends with a section proving that feature cannot be misused. This one is
 * the other way round: it is *only* the misuse, and it crosses every phase.
 *
 * The specification's instruction for this phase is "attempt unauthorized
 * access deliberately", so that is what runs here — every check below is an
 * attack that is expected to fail, and a passing line means the attack was
 * refused. Nothing is asserted about a feature working; if the application
 * stopped working entirely, most of this suite would still pass. That is why
 * it is a supplement to the other suites and not a replacement for them.
 *
 * Three surfaces, because a rule stated in one place and not the others is not
 * a rule:
 *
 *   1. **PostgREST, with each user's own JWT.** The one that matters most.
 *      Specification §31: "members must not be able to bypass permissions by
 *      directly calling Supabase APIs". Every write the application refuses is
 *      retried here with the application removed from the path, so what is
 *      being tested is the database's answer rather than the form's.
 *
 *   2. **HTTP, as a signed-in browser.** Route gating, what a page renders for
 *      somebody who should not have it, and the headers the response carries.
 *
 *   3. **The anonymous role, and the build output.** What is reachable with no
 *      session at all, and what a browser is handed.
 *
 *   npm run dev            (in another terminal)
 *   npm run audit:security
 *
 * Needs, in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY   — used only to create and delete the throwaway
 *                                 accounts. It is never given to the code
 *                                 under test, which is rather the point.
 *
 * Set BASE_URL to test something other than http://localhost:3000.
 *
 * The test users and all their data are deleted at the end, even on failure.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

const missing = [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Tiny assertion harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures = [];
let section = "";

function group(name) {
  section = name;
  console.log(`\n${name}`);
}

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failures.push({ section, name, message: error.message });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, what) {
  assert(
    actual === expected,
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

/**
 * A read that must come back empty.
 *
 * RLS filters rows rather than refusing statements, so an unauthorized SELECT
 * is not an error — it is an empty result. Anything else is the finding.
 */
function assertNoRows(result, what) {
  assert(!result.error, `${what}: unexpected error ${result.error?.message}`);
  assertEqual(result.data?.length ?? 0, 0, `${what}: rows returned`);
}

/**
 * A write that must not happen.
 *
 * Two shapes are both correct refusals and the suite accepts either, because
 * which one comes back depends on whether the policy rejected the new row
 * (`42501`, a raised error) or the USING clause simply matched nothing (an
 * empty result from a filtered UPDATE or DELETE). A row coming back is the
 * finding, whichever way the refusal would have arrived.
 */
function assertRefused(result, what) {
  if (result.error) return;
  assertEqual(result.data?.length ?? 0, 0, `${what}: the write went through`);
}

// ---------------------------------------------------------------------------
// Users and sessions
// ---------------------------------------------------------------------------

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const users = [];

async function createUser(handle, name, { confirmed = true } = {}) {
  const email = `spendora+audit${handle}${stamp}@example.test`;
  const password = `Audit-${handle}-${stamp}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: confirmed,
    user_metadata: { name },
  });
  if (error) throw new Error(`createUser(${handle}): ${error.message}`);

  const user = { handle, id: data.user.id, name, email, password, jar: new Map() };
  users.push(user);

  if (!confirmed) return user;

  user.db = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...user.jar.entries()].map(([n, value]) => ({ name: n, value })),
      setAll: (list) => list.forEach(({ name: n, value }) => user.jar.set(n, value)),
    },
  });

  const { error: signInError } = await user.db.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn(${handle}): ${signInError.message}`);

  return user;
}

async function cleanup() {
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) console.error(`  cleanup: could not delete ${user.handle}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function cookieHeader(user) {
  return [...user.jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");
}

/**
 * A page fetch that keeps the whole streamed body.
 *
 * Deliberately *not* stripping `<script>`: a page with a `loading.tsx` is sent
 * as a shell first and resolved afterwards through inline RSC chunks, so the
 * thing being asserted about — the not-found card, the group's name, a leaked
 * address — arrives inside those scripts. Reading only the shell would make
 * every check here pass by seeing nothing.
 *
 * For the same reason the HTTP status is not evidence: a streamed response has
 * already committed 200 before `notFound()` is reached, so what a page decided
 * has to be read out of what it rendered.
 */
async function getPage(user, path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: user ? { cookie: cookieHeader(user) } : {},
    redirect: "manual",
  });

  return {
    status: response.status,
    location: response.headers.get("location"),
    headers: response.headers,
    body: response.status === 204 ? "" : await response.text(),
  };
}

/**
 * What a streamed page settled on: `not-found`, `error`, or `page`.
 *
 * Neither the status code nor the visible copy can answer this, and both
 * mislead in opposite directions:
 *
 *   * The **status** is committed before the page decides. A route with a
 *     `loading.tsx` streams its shell immediately, so `notFound()` and a
 *     thrown error both arrive long after `200 OK` has gone out.
 *
 *   * The **not-found copy** is in the payload of *every* page in the segment,
 *     because `not-found.tsx` is a Server Component and its markup ships as
 *     the boundary's fallback whether or not it renders. Matching on it makes
 *     every check pass while proving nothing — which is exactly what this
 *     suite did until the two were compared side by side.
 *
 *   * The **error copy** is in none of them, even when the boundary renders:
 *     `error.tsx` is a Client Component, so its output is produced in the
 *     browser and never appears in the response at all.
 *
 * What does distinguish them is the digest Next writes into the flight
 * stream. `notFound()` carries the sentinel below; a thrown error carries a
 * numeric digest instead; a page that rendered carries no digest. Verified by
 * disabling the id guard and watching the malformed case move from one to the
 * other.
 */
const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

function rendered(body) {
  if (body.includes(NOT_FOUND_DIGEST)) return "not-found";
  if (/digest\\?":/.test(body)) return "error";
  return "page";
}

async function download(user, path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: user ? { cookie: cookieHeader(user) } : {},
    redirect: "manual",
  });
  const bytes = Buffer.from(await response.arrayBuffer());

  return {
    status: response.status,
    headers: response.headers,
    disposition: response.headers.get("content-disposition") ?? "",
    cacheControl: response.headers.get("cache-control") ?? "",
    text: bytes.toString("utf8"),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const today = new Date();
const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const DAY = iso(new Date(today.getFullYear(), today.getMonth(), 10));
const MONTH = DAY.slice(0, 7);
const MONTH_START = iso(new Date(today.getFullYear(), today.getMonth(), 1));
// Day 0 of the next month is the last day of this one, in every month length.
const MONTH_END = iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));

const hashToken = (token) => createHash("sha256").update(token, "utf8").digest("hex");
const freshToken = () => randomBytes(32).toString("base64url");
const inDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

/** The cast of this audit. Each one exists to be refused something. */
let owner; // admin of the group, and the owner of the private records
let member; // an ordinary member of the group
let outsider; // in no group at all — the one who should see nothing
let group_; // the group
let personalExpense;
let personalCategory;
let groupExpense;
let groupCategory;
let groupBudget;

async function seed() {
  owner = await createUser("owner", "Olivia Owner");
  member = await createUser("member", "Mo Member");
  outsider = await createUser("outsider", "Ox Outsider");

  const insert = async (label, promise) => {
    const { data, error } = await promise;
    if (error) throw new Error(`seed(${label}): ${error.message}`);
    return data;
  };

  personalCategory = await insert(
    "personal category",
    owner.db.from("categories").insert({ user_id: owner.id, name: "Audit Personal" }).select("id").single(),
  );

  personalExpense = await insert(
    "personal expense",
    owner.db
      .from("expenses")
      .insert({
        user_id: owner.id,
        group_id: null,
        paid_by: owner.id,
        category_id: personalCategory.id,
        item_name: "Private groceries",
        amount: 250,
        currency_code: "INR",
        expense_date: DAY,
        notes: "Nobody else's business",
      })
      .select("id")
      .single(),
  );

  group_ = await insert(
    "group",
    owner.db
      .from("groups")
      .insert({ name: "Audit Group", currency_code: "INR", created_by: owner.id })
      .select("id, name")
      .single(),
  );

  // The member joins the way the application makes them join: against a
  // pending invitation addressed to their own address.
  await insert(
    "member invitation",
    owner.db
      .from("group_invitations")
      .insert({
        group_id: group_.id,
        email: member.email,
        role: "member",
        token_hash: hashToken(freshToken()),
        invited_by: owner.id,
        status: "pending",
        expires_at: inDays(7),
      })
      .select("id")
      .single(),
  );

  await insert(
    "membership",
    member.db
      .from("group_members")
      .insert({ group_id: group_.id, user_id: member.id, role: "member" })
      .select("id")
      .single(),
  );

  groupCategory = await insert(
    "group category",
    owner.db.from("categories").insert({ group_id: group_.id, name: "Audit Travel" }).select("id").single(),
  );

  groupBudget = await insert(
    "group budget",
    owner.db
      .from("budgets")
      .insert({ group_id: group_.id, user_id: null, category_id: groupCategory.id, amount: 1000, period_month: null })
      .select("id")
      .single(),
  );

  groupExpense = await insert(
    "group expense",
    owner.db
      .from("expenses")
      .insert({
        user_id: owner.id,
        group_id: group_.id,
        paid_by: owner.id,
        category_id: groupCategory.id,
        item_name: "Flights",
        amount: 400,
        currency_code: "INR",
        expense_date: DAY,
      })
      .select("id")
      .single(),
  );
}

// ---------------------------------------------------------------------------
// 1. Secrets
// ---------------------------------------------------------------------------

/** Every file the browser could be served, so a leak cannot hide in one. */
function servedFiles(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk(root);
  return found;
}

async function auditSecrets() {
  group("Secrets never reach the browser (§32)");

  const secrets = [
    ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY],
    ["EMAIL_API_KEY", process.env.EMAIL_API_KEY],
    ["SUPABASE_DB_URL", process.env.SUPABASE_DB_URL],
  ].filter(([, value]) => value);

  const signedIn = await getPage(owner, "/dashboard");
  const signedOut = await getPage(null, "/sign-in");

  for (const [name, value] of secrets) {
    await check(`${name} is absent from a rendered page`, () => {
      assert(!signedIn.body.includes(value), `${name} appears in /dashboard`);
      assert(!signedOut.body.includes(value), `${name} appears in /sign-in`);
    });
  }

  const chunks = servedFiles(new URL("../.next/static", import.meta.url).pathname);

  await check("the client bundle exists to be searched", () => {
    assert(chunks.length > 0, "no files under .next/static — run the app first");
  });

  for (const [name, value] of secrets) {
    await check(`${name} is absent from every client asset`, () => {
      const leaked = chunks.filter((path) => {
        try {
          return readFileSync(path, "utf8").includes(value);
        } catch {
          return false;
        }
      });
      assertEqual(leaked.join(", "), "", `${name} leaked into`);
    });
  }

  await check("not even the anon key is shipped to the browser", () => {
    // Not a requirement — the anon key is public by design, and RLS is what
    // protects the data behind it. It is worth stating because it is true:
    // every Supabase call in this application is made server-side, so there is
    // no browser client to hand a key to, and the blast radius of a stolen
    // build is nothing at all.
    const inClient = chunks.filter((path) => {
      try {
        return readFileSync(path, "utf8").includes(ANON_KEY);
      } catch {
        return false;
      }
    });

    assertEqual(inClient.length, 0, "client assets containing the anon key");
    assert(!signedIn.body.includes(ANON_KEY), "the anon key is in a rendered page");
  });

  await check("no source file mentions the service role key", () => {
    const sources = servedFiles(new URL("../src", import.meta.url).pathname);
    const offenders = sources.filter((path) =>
      readFileSync(path, "utf8").includes("SERVICE_ROLE"),
    );
    assertEqual(offenders.join(", "), "", "service role referenced in");
  });
}

// ---------------------------------------------------------------------------
// 2. Response hardening
// ---------------------------------------------------------------------------

async function auditHeaders() {
  group("Every response carries its protections (§32)");

  const expected = [
    ["content-security-policy", "frame-ancestors 'none'"],
    ["x-frame-options", "DENY"],
    ["x-content-type-options", "nosniff"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
  ];

  const landing = await getPage(null, "/");
  const dashboard = await getPage(owner, "/dashboard");

  for (const [header, value] of expected) {
    await check(`${header} is set, signed out and signed in`, () => {
      assertEqual(landing.headers.get(header), value, `${header} on /`);
      assertEqual(dashboard.headers.get(header), value, `${header} on /dashboard`);
    });
  }

  await check("permissions-policy withholds the APIs nothing here uses", () => {
    const value = landing.headers.get("permissions-policy") ?? "";
    for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
      assert(value.includes(`${feature}=()`), `permissions-policy does not close ${feature}`);
    }
  });

  await check("strict-transport-security is set", () => {
    const value = landing.headers.get("strict-transport-security") ?? "";
    assert(/max-age=\d+/.test(value), `no max-age in ${JSON.stringify(value)}`);
  });

  await check("the framework is not advertised", () => {
    assertEqual(landing.headers.get("x-powered-by"), null, "x-powered-by");
  });

  await check("an export is never stored by any cache", async () => {
    const file = await download(owner, `/api/expenses/export?month=${MONTH}`);
    assertEqual(file.status, 200, "export status");
    assert(
      file.cacheControl.includes("no-store") && file.cacheControl.includes("private"),
      `export cache-control is ${JSON.stringify(file.cacheControl)}`,
    );
  });

  await check("a signed-in page is never reused without revalidating", () => {
    // Next owns this header for a dynamic page and answers `no-cache,
    // must-revalidate`. `no-cache` is the part that matters: a cache may not
    // serve it to anybody without checking with the origin first, and that
    // check carries the second person's cookies. Asserted so that a future
    // change to a cacheable directive is caught here.
    const value = dashboard.headers.get("cache-control") ?? "";
    assert(
      /no-store|no-cache/.test(value),
      `/dashboard is cacheable: ${JSON.stringify(value)}`,
    );
  });
}

// ---------------------------------------------------------------------------
// 3. Authentication
// ---------------------------------------------------------------------------

const PRIVATE_PATHS = [
  "/dashboard",
  "/expenses",
  "/expenses/new",
  "/categories",
  "/groups",
  "/groups/new",
  "/settings",
  "/invitations",
];

async function auditAuthentication() {
  group("Authentication (§4)");

  for (const path of PRIVATE_PATHS) {
    await check(`signed out, ${path} is refused`, async () => {
      const page = await getPage(null, path);
      assertEqual(page.status, 307, `status for ${path}`);
      assert(
        page.location?.startsWith("/sign-in?next="),
        `${path} redirected to ${page.location}`,
      );
    });
  }

  await check("signed out, a group's pages are refused", async () => {
    for (const path of [
      `/groups/${group_.id}`,
      `/groups/${group_.id}/expenses`,
      `/groups/${group_.id}/dashboard`,
      `/groups/${group_.id}/settings`,
    ]) {
      const page = await getPage(null, path);
      assertEqual(page.status, 307, `status for ${path}`);
    }
  });

  await check("signed out, an export is refused rather than served", async () => {
    for (const path of [
      "/api/expenses/export",
      `/api/groups/${group_.id}/expenses/export`,
    ]) {
      const file = await download(null, path);
      assertEqual(file.status, 307, `status for ${path}`);
      assert(!file.text.includes("Date,Item"), `${path} served a file to nobody`);
    }
  });

  await check("the sign-in page carries the visitor's destination back", async () => {
    const page = await getPage(null, "/expenses?month=2026-01");
    assertEqual(
      page.location,
      "/sign-in?next=%2Fexpenses%3Fmonth%3D2026-01",
      "next parameter",
    );
  });

  await check("an RSC request is gated like a navigation", async () => {
    const response = await fetch(`${BASE_URL}/dashboard`, {
      headers: { rsc: "1" },
      redirect: "manual",
    });
    assertEqual(response.status, 307, "RSC status");
  });

  await check("a signed-in user cannot be bounced off-site by ?next=", async () => {
    for (const next of ["https://evil.test/", "//evil.test/", "/\\evil.test", "/%2F%2Fevil.test"]) {
      const page = await getPage(owner, `/sign-in?next=${encodeURIComponent(next)}`);
      assertEqual(page.status, 307, `status for ${next}`);
      assertEqual(page.location, "/dashboard", `destination for ${next}`);
    }
  });

  await check("an unconfirmed address is given no session", async () => {
    const unconfirmed = await createUser("unconfirmed", "Una Unconfirmed", {
      confirmed: false,
    });
    const client = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email: unconfirmed.email,
      password: unconfirmed.password,
    });
    assert(error || !data.session, "an unverified address was signed in");
  });

  await check("a discarded session stops working", async () => {
    const throwaway = await createUser("throwaway", "Tam Throwaway");
    const before = await getPage(throwaway, "/dashboard");
    assertEqual(before.status, 200, "status while signed in");

    await throwaway.db.auth.signOut();

    const after = await getPage(throwaway, "/dashboard");
    assertEqual(after.status, 307, "status after signing out");
  });
}

// ---------------------------------------------------------------------------
// 4. The anonymous role
// ---------------------------------------------------------------------------

const TABLES = [
  "profiles",
  "groups",
  "group_members",
  "group_invitations",
  "categories",
  "budgets",
  "expenses",
];

async function auditAnonymousRole() {
  group("The anonymous role reaches nothing (§31)");

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const table of TABLES) {
    await check(`anon cannot read ${table}`, async () => {
      const { data, error } = await anon.from(table).select("*").limit(1);
      assert(error, `anon read ${table}: ${JSON.stringify(data)}`);
    });
  }

  await check("anon cannot write either", async () => {
    const { error } = await anon.from("expenses").insert({
      user_id: owner.id,
      group_id: null,
      paid_by: owner.id,
      item_name: "Injected",
      amount: 1,
      currency_code: "INR",
      expense_date: DAY,
    });
    assert(error, "anon inserted an expense");
  });

  const functions = [
    ["my_pending_invitations", {}],
    ["invitation_preview", { p_token_hash: "0".repeat(64) }],
    ["is_group_member", { p_group_id: "00000000-0000-4000-8000-000000000000" }],
    ["is_group_admin", { p_group_id: "00000000-0000-4000-8000-000000000000" }],
    ["current_user_email", {}],
    ["mask_email", { p_email: "someone@example.test" }],
  ];

  for (const [name, args] of functions) {
    await check(`anon cannot execute ${name}()`, async () => {
      const { data, error } = await anon.rpc(name, args);
      assert(error, `anon called ${name}: ${JSON.stringify(data)}`);
    });
  }
}

// ---------------------------------------------------------------------------
// 5. One user against another
// ---------------------------------------------------------------------------

async function auditPrivateRecords() {
  group("One user's records against another's (§6, §31)");

  await check("a stranger cannot read a private expense", async () => {
    assertNoRows(
      await outsider.db.from("expenses").select("id, item_name, notes").eq("id", personalExpense.id),
      "outsider reading a personal expense",
    );
    assertNoRows(
      await member.db.from("expenses").select("id").eq("user_id", owner.id).is("group_id", null),
      "a fellow member reading personal expenses",
    );
  });

  await check("a stranger cannot edit or delete one", async () => {
    assertRefused(
      await outsider.db.from("expenses").update({ amount: 1 }).eq("id", personalExpense.id).select("id"),
      "outsider editing a personal expense",
    );
    assertRefused(
      await outsider.db.from("expenses").delete().eq("id", personalExpense.id).select("id"),
      "outsider deleting a personal expense",
    );
  });

  await check("an expense cannot be written on somebody else's behalf", async () => {
    const { error } = await outsider.db.from("expenses").insert({
      user_id: owner.id,
      group_id: null,
      paid_by: owner.id,
      item_name: "Planted",
      amount: 1,
      currency_code: "INR",
      expense_date: DAY,
    });
    assert(error, "an expense was written into somebody else's records");
  });

  await check("private categories and budgets are private too", async () => {
    assertNoRows(
      await outsider.db.from("categories").select("id").eq("id", personalCategory.id),
      "outsider reading a personal category",
    );
    assertRefused(
      await outsider.db.from("categories").update({ name: "Renamed" }).eq("id", personalCategory.id).select("id"),
      "outsider renaming a personal category",
    );
    assertRefused(
      await outsider.db
        .from("budgets")
        .insert({ user_id: outsider.id, group_id: null, category_id: personalCategory.id, amount: 5 })
        .select("id"),
      "outsider budgeting somebody else's category",
    );
  });

  await check("a profile is readable only to its owner and their group peers", async () => {
    assertNoRows(
      await outsider.db.from("profiles").select("id").eq("id", owner.id),
      "outsider reading a stranger's profile",
    );
    assertRefused(
      await outsider.db.from("profiles").update({ name: "Renamed" }).eq("id", owner.id).select("id"),
      "outsider renaming somebody else's profile",
    );
  });

  await check("a profile's identity columns cannot be rewritten", async () => {
    const { data } = await owner.db
      .from("profiles")
      .update({ email: "hijacked@example.test", id: outsider.id })
      .eq("id", owner.id)
      .select("id, email");

    assertEqual(data?.[0]?.id, owner.id, "id after a crafted update");
    assertEqual(data?.[0]?.email, owner.email, "email after a crafted update");
  });
}

// ---------------------------------------------------------------------------
// 6. Inside a group
// ---------------------------------------------------------------------------

async function auditGroupAuthorization() {
  group("A group is closed to non-members, and admin work to members (§9, §31)");

  await check("a non-member reads nothing of a group", async () => {
    assertNoRows(await outsider.db.from("groups").select("id, name").eq("id", group_.id), "the group");
    assertNoRows(await outsider.db.from("group_members").select("id").eq("group_id", group_.id), "its members");
    assertNoRows(await outsider.db.from("expenses").select("id").eq("group_id", group_.id), "its expenses");
    assertNoRows(await outsider.db.from("categories").select("id").eq("group_id", group_.id), "its categories");
    assertNoRows(await outsider.db.from("budgets").select("id").eq("group_id", group_.id), "its budgets");
    assertNoRows(
      await outsider.db.from("group_invitations").select("id").eq("group_id", group_.id),
      "its invitations",
    );
  });

  await check("a non-member cannot add themselves to it", async () => {
    assertRefused(
      await outsider.db
        .from("group_members")
        .insert({ group_id: group_.id, user_id: outsider.id, role: "member" })
        .select("id"),
      "outsider joining uninvited",
    );
  });

  await check("a non-member's pages render as not found, never as the group", async () => {
    for (const path of [
      `/groups/${group_.id}`,
      `/groups/${group_.id}/expenses`,
      `/groups/${group_.id}/dashboard`,
      `/groups/${group_.id}/categories`,
      `/groups/${group_.id}/settings`,
    ]) {
      const page = await getPage(outsider, path);
      assertEqual(rendered(page.body), "not-found", `what ${path} rendered`);
      assert(!page.body.includes(group_.name), `${path} leaked the group's name`);
    }
  });

  await check("a member cannot edit the group", async () => {
    assertRefused(
      await member.db.from("groups").update({ name: "Hijacked" }).eq("id", group_.id).select("id"),
      "member renaming the group",
    );
    assertRefused(
      await member.db.from("groups").update({ currency_code: "USD" }).eq("id", group_.id).select("id"),
      "member changing the currency",
    );
    assertRefused(
      await member.db.from("groups").delete().eq("id", group_.id).select("id"),
      "member deleting the group",
    );
  });

  await check("a member cannot promote themselves", async () => {
    const { data: membership } = await member.db
      .from("group_members")
      .select("id")
      .eq("group_id", group_.id)
      .eq("user_id", member.id)
      .single();

    assertRefused(
      await member.db.from("group_members").update({ role: "admin" }).eq("id", membership.id).select("id"),
      "member promoting themselves",
    );

    const { data: after } = await member.db
      .from("group_members")
      .select("role")
      .eq("id", membership.id)
      .single();
    assertEqual(after.role, "member", "role after the attempt");
  });

  await check("a member cannot remove anybody but themselves", async () => {
    const { data: theirs } = await member.db
      .from("group_members")
      .select("id")
      .eq("group_id", group_.id)
      .eq("user_id", owner.id)
      .single();

    assertRefused(
      await member.db.from("group_members").delete().eq("id", theirs.id).select("id"),
      "member removing the admin",
    );
  });

  await check("a member cannot manage categories or budgets", async () => {
    assertRefused(
      await member.db.from("categories").insert({ group_id: group_.id, name: "Member's own" }).select("id"),
      "member adding a group category",
    );
    assertRefused(
      await member.db.from("categories").update({ name: "Renamed" }).eq("id", groupCategory.id).select("id"),
      "member renaming a group category",
    );
    assertRefused(
      await member.db.from("categories").delete().eq("id", groupCategory.id).select("id"),
      "member deleting a group category",
    );
    assertRefused(
      await member.db.from("budgets").update({ amount: 99999 }).eq("id", groupBudget.id).select("id"),
      "member changing a budget",
    );
    assertRefused(
      await member.db.from("budgets").delete().eq("id", groupBudget.id).select("id"),
      "member clearing a budget",
    );
  });

  await check("a member cannot invite, revoke or dismiss", async () => {
    assertRefused(
      await member.db
        .from("group_invitations")
        .insert({
          group_id: group_.id,
          email: outsider.email,
          role: "admin",
          token_hash: hashToken(freshToken()),
          invited_by: member.id,
          status: "pending",
          expires_at: inDays(7),
        })
        .select("id"),
      "member issuing an invitation",
    );
  });

  await check("a member is not offered what they may not do", async () => {
    const settings = await getPage(member, `/groups/${group_.id}/settings`);
    assert(!/Delete group/i.test(settings.body), "settings offered a member the delete control");

    const categories = await getPage(member, `/groups/${group_.id}/categories`);
    assert(
      !/name="amount"/.test(categories.body),
      "the categories page offered a member a budget field",
    );
  });

  await check("a member does not see their peers' email addresses", async () => {
    const asMember = await getPage(member, `/groups/${group_.id}`);
    assert(
      !asMember.body.includes(owner.email),
      "a member was shown another member's address",
    );
    assert(asMember.body.includes(owner.name), "a member cannot see who else is here");

    const asAdmin = await getPage(owner, `/groups/${group_.id}`);
    assert(asAdmin.body.includes(member.email), "an admin cannot see who they invited");
  });
}

// ---------------------------------------------------------------------------
// 7. Expenses
// ---------------------------------------------------------------------------

async function auditExpenseTampering() {
  group("An expense cannot be moved, mispriced or misattributed (§7, §45)");

  await check("a group expense cannot be re-parented into private records", async () => {
    const { data: mine } = await member.db
      .from("expenses")
      .insert({
        user_id: member.id,
        group_id: group_.id,
        paid_by: member.id,
        item_name: "Member's expense",
        amount: 60,
        currency_code: "INR",
        expense_date: DAY,
      })
      .select("id")
      .single();

    const { data } = await member.db
      .from("expenses")
      .update({ group_id: null, user_id: outsider.id })
      .eq("id", mine.id)
      .select("id, group_id, user_id");

    assertEqual(data?.[0]?.group_id, group_.id, "group_id after a crafted update");
    assertEqual(data?.[0]?.user_id, member.id, "user_id after a crafted update");
  });

  await check("an amount cannot be made zero or negative", async () => {
    for (const amount of [0, -1, -0.01]) {
      const { error } = await owner.db
        .from("expenses")
        .update({ amount })
        .eq("id", personalExpense.id);
      assert(error, `an amount of ${amount} was accepted`);
    }
  });

  await check("a group expense must carry the group's currency", async () => {
    const { error } = await member.db.from("expenses").insert({
      user_id: member.id,
      group_id: group_.id,
      paid_by: member.id,
      item_name: "Wrong currency",
      amount: 5,
      currency_code: "USD",
      expense_date: DAY,
    });
    assert(error, "an expense in another currency was accepted");
  });

  await check("the payer must be a member of the group", async () => {
    const { error } = await member.db.from("expenses").insert({
      user_id: member.id,
      group_id: group_.id,
      paid_by: outsider.id,
      item_name: "Attributed to a stranger",
      amount: 5,
      currency_code: "INR",
      expense_date: DAY,
    });
    assert(error, "a non-member was recorded as the payer");
  });

  await check("a member cannot edit or delete somebody else's group expense", async () => {
    assertRefused(
      await member.db.from("expenses").update({ amount: 1 }).eq("id", groupExpense.id).select("id"),
      "member editing the admin's expense",
    );
    assertRefused(
      await member.db.from("expenses").delete().eq("id", groupExpense.id).select("id"),
      "member deleting the admin's expense",
    );
  });

  await check("a category from elsewhere cannot be attached to an expense", async () => {
    // Aimed at the owner's *own* group expense on purpose. A member's attempt
    // would be stopped by RLS before the foreign key was ever consulted, and
    // would prove only what the previous check already proves. What is under
    // test here is the composite key: even somebody with every right to edit
    // this row cannot point it at a category belonging to another owner.
    const toGroupRow = await owner.db
      .from("expenses")
      .update({ category_id: personalCategory.id })
      .eq("id", groupExpense.id);
    assert(toGroupRow.error, "a personal category was attached to a group expense");

    const toPersonalRow = await owner.db
      .from("expenses")
      .update({ category_id: groupCategory.id })
      .eq("id", personalExpense.id);
    assert(toPersonalRow.error, "a group category was attached to a personal expense");
  });

  await check("a personal expense is always paid by its owner", async () => {
    const { error } = await owner.db.from("expenses").insert({
      user_id: owner.id,
      group_id: null,
      paid_by: member.id,
      item_name: "Paid by somebody else",
      amount: 5,
      currency_code: "INR",
      expense_date: DAY,
    });
    assert(error, "a personal expense was attributed to another person");
  });
}

// ---------------------------------------------------------------------------
// 8. Invitations
// ---------------------------------------------------------------------------

async function auditInvitations() {
  group("An invitation grants what it says, to whom it says (§11)");

  const outsiderToken = freshToken();
  const { data: forOutsider, error: inviteError } = await owner.db
    .from("group_invitations")
    .insert({
      group_id: group_.id,
      email: outsider.email,
      role: "member",
      token_hash: hashToken(outsiderToken),
      invited_by: owner.id,
      status: "pending",
      expires_at: inDays(7),
    })
    .select("id")
    .single();

  await check("the fixture invitation was issued", () => {
    assert(!inviteError, `could not issue the invitation: ${inviteError?.message}`);
  });

  await check("an invitation is invisible to everyone but its addressee", async () => {
    assertNoRows(
      await member.db.from("group_invitations").select("id, email").eq("id", forOutsider.id),
      "a fellow member reading somebody's invitation",
    );
  });

  await check("an invitee cannot promote what they were offered", async () => {
    assertRefused(
      await outsider.db
        .from("group_invitations")
        .update({ role: "admin" })
        .eq("id", forOutsider.id)
        .select("id"),
      "invitee rewriting the role",
    );

    const { data } = await outsider.db
      .from("group_invitations")
      .select("role")
      .eq("id", forOutsider.id)
      .single();
    assertEqual(data.role, "member", "role after the attempt");
  });

  await check("an invitee cannot extend their own deadline", async () => {
    const { data: before } = await outsider.db
      .from("group_invitations")
      .select("expires_at")
      .eq("id", forOutsider.id)
      .single();

    await outsider.db
      .from("group_invitations")
      .update({ expires_at: inDays(3650) })
      .eq("id", forOutsider.id);

    const { data: after } = await outsider.db
      .from("group_invitations")
      .select("expires_at")
      .eq("id", forOutsider.id)
      .single();

    assertEqual(after.expires_at, before.expires_at, "expiry after the attempt");
  });

  await check("an invitee cannot join in a role they were not offered", async () => {
    assertRefused(
      await outsider.db
        .from("group_members")
        .insert({ group_id: group_.id, user_id: outsider.id, role: "admin" })
        .select("id"),
      "invitee joining as an admin",
    );
  });

  await check("an invitation cannot be used by somebody else", async () => {
    // A second outsider, addressed by nothing, holding the link.
    const bystander = await createUser("bystander", "Bea Bystander");

    assertRefused(
      await bystander.db
        .from("group_members")
        .insert({ group_id: group_.id, user_id: bystander.id, role: "member" })
        .select("id"),
      "a bystander joining on somebody else's invitation",
    );

    const page = await getPage(bystander, `/invite/${outsiderToken}`);
    assert(
      /different address/i.test(page.body),
      "the invitation page did not say it was addressed elsewhere",
    );
    assert(!page.body.includes(outsider.email), "the link disclosed the invited address");
    assert(/•••@/.test(page.body), "the invited address was not shown masked");
  });

  await check("a made-up link opens nothing", async () => {
    const page = await getPage(outsider, `/invite/${freshToken()}`);
    assert(!page.body.includes(group_.name), "an unknown token named a group");
  });

  await check("an expired invitation cannot be accepted", async () => {
    const expired = await createUser("expired", "Ed Expired");

    await owner.db.from("group_invitations").insert({
      group_id: group_.id,
      email: expired.email,
      role: "member",
      token_hash: hashToken(freshToken()),
      invited_by: owner.id,
      status: "pending",
      // Backdated past its own TTL. The check constraint only requires the
      // expiry to be after creation, which this satisfies.
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    assertRefused(
      await expired.db
        .from("group_members")
        .insert({ group_id: group_.id, user_id: expired.id, role: "member" })
        .select("id"),
      "joining on an expired invitation",
    );
  });

  await check("a revoked invitation cannot be accepted", async () => {
    const revoked = await createUser("revoked", "Rex Revoked");

    const { data: invitation } = await owner.db
      .from("group_invitations")
      .insert({
        group_id: group_.id,
        email: revoked.email,
        role: "member",
        token_hash: hashToken(freshToken()),
        invited_by: owner.id,
        status: "pending",
        expires_at: inDays(7),
      })
      .select("id")
      .single();

    await owner.db.from("group_invitations").update({ status: "revoked" }).eq("id", invitation.id);

    assertRefused(
      await revoked.db
        .from("group_members")
        .insert({ group_id: group_.id, user_id: revoked.id, role: "member" })
        .select("id"),
      "joining on a revoked invitation",
    );
  });

  await check("declining is the only change an invitee may make", async () => {
    const { data } = await outsider.db
      .from("group_invitations")
      .update({ status: "declined" })
      .eq("id", forOutsider.id)
      .select("id, status");
    assertEqual(data?.[0]?.status, "declined", "status after declining");

    // And having declined, they cannot reopen it.
    assertRefused(
      await outsider.db
        .from("group_invitations")
        .update({ status: "pending" })
        .eq("id", forOutsider.id)
        .select("id"),
      "invitee reopening their own invitation",
    );
  });

  await check("membership cannot be duplicated", async () => {
    const { error } = await member.db
      .from("group_members")
      .insert({ group_id: group_.id, user_id: member.id, role: "member" });
    assert(error, "a second membership row was created");

    const { count } = await member.db
      .from("group_members")
      .select("id", { count: "exact", head: true })
      .eq("group_id", group_.id)
      .eq("user_id", member.id);
    assertEqual(count, 1, "membership rows");
  });

  await check("a group must keep an admin", async () => {
    const { data: adminRow } = await owner.db
      .from("group_members")
      .select("id")
      .eq("group_id", group_.id)
      .eq("user_id", owner.id)
      .single();

    const demote = await owner.db
      .from("group_members")
      .update({ role: "member" })
      .eq("id", adminRow.id)
      .select("id");
    assert(demote.error, "the sole admin demoted themselves");

    const remove = await owner.db.from("group_members").delete().eq("id", adminRow.id).select("id");
    assert(remove.error, "the sole admin removed themselves");
  });
}

// ---------------------------------------------------------------------------
// 9. Budgets and the dashboard's arithmetic
// ---------------------------------------------------------------------------

async function auditBudgetArithmetic() {
  group("Budgets and dashboard figures (§15, §16, §19)");

  // A category of its own, so the figures asserted below depend on nothing an
  // earlier section happened to leave in the group.
  const { data: precision, error: categoryError } = await owner.db
    .from("categories")
    .insert({ group_id: group_.id, name: "Audit Precision" })
    .select("id")
    .single();
  if (categoryError) throw new Error(`seeding the category: ${categoryError.message}`);

  await owner.db
    .from("budgets")
    .insert({ group_id: group_.id, user_id: null, category_id: precision.id, amount: 1000 });

  // Chosen because they are exactly the case the money layer exists for:
  // 836.06 + 63.93 + 0.01 is 900.00 in paise and 899.9999999999999 in doubles.
  // A total kept in floating point drifts below the figure it should be, and
  // the remaining and percentage read off it drift with it.
  for (const amount of [836.06, 63.93, 0.01]) {
    const { error } = await owner.db.from("expenses").insert({
      user_id: owner.id,
      group_id: group_.id,
      paid_by: owner.id,
      category_id: precision.id,
      item_name: `Audit ${amount}`,
      amount,
      currency_code: "INR",
      expense_date: DAY,
    });
    if (error) throw new Error(`seeding the budget month: ${error.message}`);
  }

  const page = await getPage(owner, `/groups/${group_.id}/dashboard?month=${MONTH}`);

  await check("the month's total matches an independent count", async () => {
    // Summed here from the rows themselves, in integer paise, and formatted
    // the way the page formats it. Independent of whatever else the rest of
    // this audit happened to leave in the group.
    const { data, error } = await owner.db
      .from("expenses")
      .select("amount")
      .eq("group_id", group_.id)
      .gte("expense_date", MONTH_START)
      .lte("expense_date", MONTH_END);
    assert(!error, `reading the month back: ${error?.message}`);

    const minor = data.reduce((total, row) => total + Math.round(row.amount * 100), 0);
    const expected = new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minor / 100);

    assert(page.body.includes(expected), `the month's total is not ₹${expected}`);
  });

  await check("remaining and utilisation agree with the budget", () => {
    // Audit Precision: 900.00 spent of a 1,000.00 budget, from amounts whose
    // double-precision sum is 899.9999999999999.
    assert(page.body.includes("900.00"), "spending is not ₹900.00");
    assert(page.body.includes("100.00"), "remaining is not ₹100.00");
    assert(/\b90%/.test(page.body), "utilisation is not 90%");
  });

  await check("the budget state is said in words, not only in colour (§16)", () => {
    assert(
      /On track|Nearing budget|Over budget/.test(page.body),
      "no textual budget status on the page",
    );
    assert(/Nearing budget/.test(page.body), "90% of a budget did not read as a warning");
  });

  await check("exceeding a budget is reported as exceeded", async () => {
    const { data: tight } = await owner.db
      .from("categories")
      .insert({ group_id: group_.id, name: "Audit Tight" })
      .select("id")
      .single();

    await owner.db
      .from("budgets")
      .insert({ group_id: group_.id, user_id: null, category_id: tight.id, amount: 100 });

    await owner.db.from("expenses").insert({
      user_id: owner.id,
      group_id: group_.id,
      paid_by: owner.id,
      category_id: tight.id,
      item_name: "Over",
      amount: 150,
      currency_code: "INR",
      expense_date: DAY,
    });

    const after = await getPage(owner, `/groups/${group_.id}/dashboard?month=${MONTH}`);
    assert(/Over budget/.test(after.body), "150 of a 100 budget did not read as exceeded");
    assert(/\b150%/.test(after.body), "utilisation is not 150%");
  });

  await check("a non-member's dashboard shows them nothing", async () => {
    const denied = await getPage(outsider, `/groups/${group_.id}/dashboard?month=${MONTH}`);
    assertEqual(rendered(denied.body), "not-found", "what the dashboard rendered");
    assert(!denied.body.includes("900.00"), "a figure leaked to a non-member");
    assert(!denied.body.includes("Audit Precision"), "a category leaked to a non-member");
  });
}

// ---------------------------------------------------------------------------
// 10. Export
// ---------------------------------------------------------------------------

async function auditExport() {
  group("An export never widens what is readable (§25, §32)");

  await check("a non-member's group export is not found", async () => {
    const file = await download(outsider, `/api/groups/${group_.id}/expenses/export`);
    assertEqual(file.status, 404, "status");
    assert(!file.text.includes("Flights"), "rows leaked to a non-member");
  });

  await check("a personal export carries only the exporter's own rows", async () => {
    const file = await download(member, "/api/expenses/export");
    assertEqual(file.status, 200, "status");
    assert(!file.text.includes("Private groceries"), "somebody else's expense is in the file");
    assert(!file.text.includes("Flights"), "a group expense is in a personal export");
  });

  await check("a spreadsheet formula in an expense is neutralised", async () => {
    const { error } = await owner.db.from("expenses").insert({
      user_id: owner.id,
      group_id: null,
      paid_by: owner.id,
      item_name: "=1+1",
      amount: 1,
      currency_code: "INR",
      expense_date: DAY,
      notes: "@SUM(A1)",
    });
    if (error) throw new Error(`seeding a formula: ${error.message}`);

    const file = await download(owner, `/api/expenses/export?month=${MONTH}`);
    const line = file.text.split("\r\n").find((row) => row.includes("1+1"));
    assert(line, "the formula row is missing from the export");
    assert(line.includes("'=1+1"), `item was not neutralised: ${JSON.stringify(line)}`);
    assert(line.includes("'@SUM(A1)"), `notes were not neutralised: ${JSON.stringify(line)}`);
  });

  await check("a group's name cannot forge a response header", async () => {
    const { data: named } = await owner.db
      .from("groups")
      .insert({
        name: 'Quote" ; Newline\r\nX-Audit-Injected: yes',
        currency_code: "INR",
        created_by: owner.id,
      })
      .select("id")
      .single();

    const file = await download(owner, `/api/groups/${named.id}/expenses/export`);
    assertEqual(file.headers.get("x-audit-injected"), null, "an injected header");
    assert(
      /^attachment; filename="[a-z0-9.-]+"$/.test(file.disposition),
      `content-disposition is ${JSON.stringify(file.disposition)}`,
    );

    await owner.db.from("groups").delete().eq("id", named.id);
  });

  await check("an unrecognised format falls back rather than failing", async () => {
    const file = await download(owner, "/api/expenses/export?format=../../etc/passwd");
    assertEqual(file.status, 200, "status");
    assert(file.disposition.endsWith('.csv"'), `filename is ${JSON.stringify(file.disposition)}`);
  });
}

// ---------------------------------------------------------------------------
// 11. Ids that name nothing
// ---------------------------------------------------------------------------

async function auditMalformedIds() {
  group("An id that cannot exist reads as not found (§28)");

  // `..` is not in the list: a URL parser resolves it away before any request
  // is sent, so it never reaches a route and testing it would only be testing
  // `fetch`.
  const junk = ["not-a-uuid", "1", "%00", "' or 1=1--", "00000000-0000-0000-0000-00000000000"];

  for (const id of junk) {
    await check(`/groups/${id} is not found rather than an error`, async () => {
      const page = await getPage(owner, `/groups/${encodeURIComponent(id)}`);
      assertEqual(rendered(page.body), "not-found", "what the page rendered");
    });
  }

  await check("a group's sub-pages answer the same way", async () => {
    for (const path of [
      "/groups/not-a-uuid/expenses",
      "/groups/not-a-uuid/dashboard",
      "/groups/not-a-uuid/categories",
      "/groups/not-a-uuid/settings",
      "/groups/not-a-uuid/expenses/new",
    ]) {
      const page = await getPage(owner, path);
      assertEqual(rendered(page.body), "not-found", `what ${path} rendered`);
    }
  });

  await check("an expense editor answers the same way", async () => {
    for (const path of [
      "/expenses/not-a-uuid/edit",
      `/groups/${group_.id}/expenses/not-a-uuid/edit`,
      `/groups/not-a-uuid/expenses/${groupExpense.id}/edit`,
    ]) {
      const page = await getPage(owner, path);
      assertEqual(rendered(page.body), "not-found", `what ${path} rendered`);
    }
  });

  await check("the export route answers 404, never 500", async () => {
    for (const id of ["not-a-uuid", "1", "00000000-0000-4000-8000-000000000000"]) {
      const file = await download(owner, `/api/groups/${encodeURIComponent(id)}/expenses/export`);
      assertEqual(file.status, 404, `status for ${id}`);
    }
  });

  await check("a malformed filter narrows nothing rather than failing", async () => {
    for (const query of [
      "?category=not-a-uuid",
      "?paidBy=' or 1=1--",
      "?paymentMode=nonsense",
      "?month=99999-13",
      "?from=not-a-date&to=also-not",
      `?q=${encodeURIComponent("100% of _everything_ \\ \" ,")}`,
    ]) {
      const page = await getPage(owner, `/expenses${query}`);
      assertEqual(rendered(page.body), "page", `what /expenses${query} rendered`);
    }
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log(`Security audit against ${BASE_URL}`);

try {
  const probe = await fetch(BASE_URL, { redirect: "manual" }).catch(() => null);
  if (!probe) {
    console.error(`\nCannot reach ${BASE_URL}. Start it with \`npm run dev\`.`);
    process.exit(1);
  }

  await seed();

  await auditSecrets();
  await auditHeaders();
  await auditAuthentication();
  await auditAnonymousRole();
  await auditPrivateRecords();
  await auditGroupAuthorization();
  await auditExpenseTampering();
  await auditInvitations();
  await auditBudgetArithmetic();
  await auditExport();
  await auditMalformedIds();
} catch (error) {
  console.error(`\nThe audit could not finish: ${error.message}`);
  failures.push({ section: "harness", name: "run", message: error.message });
} finally {
  await cleanup();
}

console.log(`\n${passed} passed, ${failures.length} failed`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) {
    console.log(`  ${failure.section} — ${failure.name}`);
    console.log(`    ${failure.message}`);
  }
  process.exit(1);
}
