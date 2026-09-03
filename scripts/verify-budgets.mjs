#!/usr/bin/env node
/**
 * End-to-end test suite for Phase 7, categories and budgets.
 *
 * Two surfaces are exercised, because both are real:
 *
 *   1. The running application over HTTP, as a signed-in browser would use it.
 *      Categories are created, renamed, archived and deleted, and budgets set
 *      and cleared, by submitting the *actual forms* — hidden Server Action
 *      fields and all — which is the no-JavaScript path, so it runs the Server
 *      Actions themselves rather than a re-implementation of them. The
 *      budget-versus-actual figures are then read back off the rendered page,
 *      so what is asserted is what a person would see.
 *
 *   2. PostgREST directly, with each user's own JWT. That is what somebody
 *      reaches when they skip the UI, so every authorization claim is proved
 *      there rather than by the absence of a button.
 *
 *   npm run dev              (in another terminal)
 *   npm run verify:budgets
 *
 * Needs, in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY   — used only to create and delete the throwaway
 *                                 accounts, and to seat the second member,
 *                                 whose invitation flow Phase 5 already tests.
 *
 * Set BASE_URL to test something other than http://localhost:3000.
 *
 * The test users and all their data are deleted at the end, even on failure.
 */

import { readFileSync } from "node:fs";
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

function assertIncludes(haystack, needle, what) {
  assert(haystack.includes(needle), `${what}: expected to find ${JSON.stringify(needle)}`);
}

function assertExcludes(haystack, needle, what) {
  assert(!haystack.includes(needle), `${what}: did not expect ${JSON.stringify(needle)}`);
}

// ---------------------------------------------------------------------------
// Money and dates, formatted exactly as the application formats them
//
// Computed rather than hard-coded: the assertions then survive an ICU update,
// and a mismatch means the application is wrong rather than the test's copy of
// a string being stale.
// ---------------------------------------------------------------------------

const inr = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

const eur = (amount) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const now = new Date();
const TODAY = iso(now);
const THIS_MONTH = TODAY.slice(0, 7);

// The 15th, so the day exists in every month and no timezone can move it out
// of the month it was chosen for.
const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
const LAST_MONTH_DAY = iso(lastMonthDate);
const LAST_MONTH = LAST_MONTH_DAY.slice(0, 7);

// ---------------------------------------------------------------------------
// Users and sessions
// ---------------------------------------------------------------------------

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const users = [];

async function createUser(handle, name) {
  const email = `spendora+${handle}${stamp}@example.test`;
  const password = `Test-${handle}-${stamp}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) throw new Error(`createUser(${handle}): ${error.message}`);

  const jar = new Map();
  const db = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([n, value]) => ({ name: n, value })),
      setAll: (list) => list.forEach(({ name: n, value }) => jar.set(n, value)),
    },
  });

  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn(${handle}): ${signInError.message}`);

  const user = { handle, id: data.user.id, name, email, jar, db };
  users.push(user);
  return user;
}

async function cleanup() {
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) console.error(`  cleanup: could not delete ${user.handle}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP as a signed-in browser
// ---------------------------------------------------------------------------

function cookieHeader(user) {
  return [...user.jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");
}

/** React writes `<!-- -->` between adjacent text nodes; strip before matching. */
function readable(html) {
  return html.replaceAll("<!-- -->", "");
}

async function getPage(user, path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: user ? { cookie: cookieHeader(user) } : {},
    redirect: "manual",
  });
  const raw = response.status === 200 ? await response.text() : "";
  return {
    status: response.status,
    raw,
    html: readable(raw),
    location: response.headers.get("location"),
  };
}

/**
 * A route resolved to `notFound()`. The status line cannot be used: Next
 * streams the document shell before the page finishes, so the 200 is already
 * committed by the time the 404 is thrown (recorded in Phase 4).
 */
function assertNotFound(page, what) {
  assert(
    page.raw.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
    `${what}: expected a not-found result, got a rendered page`,
  );
}

/**
 * A value as React writes it into HTML.
 *
 * Names are user text, so one containing `&` reaches the page as `&amp;` — a
 * suite that matched the raw string would silently stop finding the control it
 * meant to click.
 */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeEntities(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** The `<form>` matching every string in `include` and none in `exclude`. */
function findForm(html, include, exclude = []) {
  const forms = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find(
    (candidate) =>
      include.every((needle) => candidate.includes(needle)) &&
      exclude.every((needle) => !candidate.includes(needle)),
  );
  assert(form, `no form matching ${JSON.stringify(include)} (excluding ${JSON.stringify(exclude)})`);
  return form;
}

function hasForm(html, include, exclude = []) {
  try {
    findForm(html, include, exclude);
    return true;
  } catch {
    return false;
  }
}

/** The hidden inputs Next renders so a form works without JavaScript. */
function hiddenFields(form) {
  const fields = [];
  for (const input of form.match(/<input\b[^>]*type="hidden"[^>]*>/g) ?? []) {
    const name = input.match(/\bname="([^"]*)"/)?.[1];
    if (!name) continue;
    const value = input.match(/\bvalue="([^"]*)"/)?.[1] ?? "";
    fields.push([decodeEntities(name), decodeEntities(value)]);
  }
  return fields;
}

/**
 * Submits a form the way a browser with no JavaScript would.
 *
 * `multi` exists for the suggested-categories form, whose checkboxes all share
 * the name `names` — a plain object cannot express a repeated key.
 */
async function submitForm(user, path, { include, exclude = [], values = {}, multi = {}, replace = {} }) {
  const page = await getPage(user, path);
  assert(page.status === 200, `GET ${path} returned ${page.status}`);

  const form = findForm(page.html, include, exclude);
  const body = new FormData();

  for (const [name, value] of hiddenFields(form)) {
    // `replace` overrides a hidden field, which is how a tampered form is
    // simulated — the client controls these, so the server must not trust them.
    body.append(name, name in replace ? replace[name] : value);
  }
  for (const [name, value] of Object.entries(values)) body.append(name, value);
  for (const [name, list] of Object.entries(multi)) {
    for (const value of list) body.append(name, value);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    // A browser sends Origin on a form POST, and Next compares it to Host as
    // its CSRF check. Sending it keeps the suite on the same path a user is.
    headers: { cookie: cookieHeader(user), origin: BASE_URL },
    body,
    redirect: "manual",
  });

  const text = await response.text();
  // A Server Action that redirects answers with a header, not a document. The
  // embedded fallback covers the streamed case, where the destination arrives
  // inside the RSC payload instead (the same extraction Phase 5 settled on).
  const header =
    response.headers.get("location") ?? response.headers.get("x-action-redirect");
  const embedded = text.match(/"(\/[a-z0-9/[\]-]*\?flash=[a-z-]+)"/i)?.[1];

  return {
    status: response.status,
    redirect: header ?? embedded ?? null,
    text: readable(text),
  };
}

// ---------------------------------------------------------------------------
// Form shorthands
// ---------------------------------------------------------------------------

const CATEGORIES = "/categories";
const groupCategoriesPath = (groupId) => `/groups/${groupId}/categories`;

function addCategory(user, path, name) {
  return submitForm(user, path, {
    include: ['name="name"', 'placeholder="Weekend trips"'],
    values: { name },
  });
}

function addSuggested(user, path, names) {
  return submitForm(user, path, {
    include: ['name="names"'],
    multi: { names },
  });
}

function setBudget(user, path, categoryId, amount) {
  return submitForm(user, path, {
    include: ['name="amount"', `value="${categoryId}"`],
    values: { amount },
  });
}

function clickAction(user, path, ariaLabel, values = {}) {
  return submitForm(user, path, {
    include: [`aria-label="${escapeHtml(ariaLabel)}"`],
    values,
  });
}

function addPersonalExpense(user, values) {
  return submitForm(user, "/expenses/new", {
    include: ['name="itemName"'],
    values: {
      itemName: "",
      amount: "",
      expenseDate: TODAY,
      category: "",
      newCategoryName: "",
      paymentMode: "",
      notes: "",
      ...values,
    },
  });
}

function addGroupExpense(user, groupId, values) {
  return submitForm(user, `/groups/${groupId}/expenses/new`, {
    include: ['name="itemName"'],
    values: {
      itemName: "",
      amount: "",
      paidBy: user.id,
      expenseDate: TODAY,
      category: "",
      newCategoryName: "",
      paymentMode: "",
      notes: "",
      ...values,
    },
  });
}

// ---------------------------------------------------------------------------
// Data helpers, read with each user's own JWT
// ---------------------------------------------------------------------------

async function categoriesOf(user, filter) {
  let query = user.db.from("categories").select("id, name, is_archived, user_id, group_id");
  query = filter.groupId
    ? query.eq("group_id", filter.groupId)
    : query.eq("user_id", filter.userId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

async function budgetsOf(user, filter) {
  let query = user.db.from("budgets").select("id, category_id, amount, period_month, user_id, group_id");
  query = filter.groupId
    ? query.eq("group_id", filter.groupId)
    : query.eq("user_id", filter.userId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

function findByName(categories, name) {
  const match = categories.find((category) => category.name === name);
  assert(match, `no category named ${JSON.stringify(name)}`);
  return match;
}

/** The list item a category's figures are rendered in. */
function categoryBlock(html, name) {
  const marker = `>${escapeHtml(name)}</h3>`;
  const start = html.indexOf(marker);
  assert(start !== -1, `no category block for ${JSON.stringify(name)}`);

  const from = html.lastIndexOf("<li", start);
  const to = html.indexOf("</li>", start);
  assert(from !== -1 && to !== -1, `malformed category block for ${JSON.stringify(name)}`);

  return html.slice(from, to);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

async function run() {
  const probe = await fetch(`${BASE_URL}/sign-in`, { redirect: "manual" }).catch(() => null);
  if (!probe) {
    console.error(`No application at ${BASE_URL}. Start it with: npm run dev`);
    process.exit(1);
  }

  const owner = await createUser("bowner", "Ada Owner");
  const mate = await createUser("bmate", "Rahul Mate");
  const stranger = await createUser("bstranger", "Grace Stranger");

  let groupId = "";
  let otherGroupId = "";

  // -------------------------------------------------------------------------
  group("Empty states");

  await check("the categories page invites a first category", async () => {
    const page = await getPage(owner, CATEGORIES);
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, "No categories yet", "categories page");
    assertIncludes(page.html, "Suggested categories", "categories page");
    assertIncludes(page.html, "Not set", "categories page: total budget");
  });

  await check("every suggested default is offered while none exists", async () => {
    const page = await getPage(owner, CATEGORIES);
    // Scoped to the suggestions form: every category also renders a rename
    // field carrying its own name, so the page at large is not evidence.
    const suggestions = findForm(page.html, ['name="names"']);
    for (const name of ["Food", "Groceries", "Transportation", "Rent", "Other"]) {
      assertIncludes(suggestions, `value="${name}"`, "suggestions");
    }
  });

  await check("the month in view is stated, with navigation", async () => {
    const page = await getPage(owner, CATEGORIES);
    const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(now);
    assertIncludes(page.html, label, "categories page month label");
    assertIncludes(page.html, "Previous month", "categories page month nav");
  });

  // -------------------------------------------------------------------------
  group("Creating personal categories");

  await check("a custom category is created from the form", async () => {
    await addCategory(owner, CATEGORIES, "Weekend trips");
    const categories = await categoriesOf(owner, { userId: owner.id });
    const created = findByName(categories, "Weekend trips");
    assert(created.user_id === owner.id, "user_id was not the signed-in user");
    assert(created.group_id === null, "a personal category must have no group");
    assert(created.is_archived === false, "a new category should be active");
  });

  await check("several suggested defaults are added in one request", async () => {
    await addSuggested(owner, CATEGORIES, ["Food", "Transportation", "Rent"]);
    const names = (await categoriesOf(owner, { userId: owner.id })).map((c) => c.name);
    for (const name of ["Food", "Transportation", "Rent"]) {
      assert(names.includes(name), `${name} was not created`);
    }
  });

  await check("a default already taken is no longer suggested", async () => {
    const page = await getPage(owner, CATEGORIES);
    // The chip is gone from the suggestions; the category itself is on the
    // page as a heading, and in its own rename field.
    const suggestions = findForm(page.html, ['name="names"']);
    assertExcludes(suggestions, 'value="Food"', "suggestions still offer Food");
    assertIncludes(page.html, ">Food</h3>", "Food is not listed as a category");
  });

  await check("a duplicate name is refused, in words the user can act on", async () => {
    const result = await addCategory(owner, CATEGORIES, "  food  ");
    assertIncludes(
      result.text,
      "A category with that name already exists here.",
      "duplicate category",
    );
    const matches = (await categoriesOf(owner, { userId: owner.id })).filter(
      (c) => c.name.trim().toLowerCase() === "food",
    );
    assert(matches.length === 1, `expected one Food category, found ${matches.length}`);
  });

  await check("an empty name is refused", async () => {
    const result = await addCategory(owner, CATEGORIES, "   ");
    assertIncludes(result.text, "Category name is required", "empty category name");
  });

  await check("a name past the column's limit is refused", async () => {
    const result = await addCategory(owner, CATEGORIES, "x".repeat(61));
    assertIncludes(result.text, "60 characters or fewer", "over-long category name");
  });

  // -------------------------------------------------------------------------
  group("Budget versus actual");

  let foodId = "";

  await check("a monthly budget is set against a category", async () => {
    foodId = findByName(await categoriesOf(owner, { userId: owner.id }), "Food").id;
    await setBudget(owner, CATEGORIES, foodId, "8000");

    const budgets = await budgetsOf(owner, { userId: owner.id });
    assert(budgets.length === 1, `expected one budget, found ${budgets.length}`);
    assert(Number(budgets[0].amount) === 8000, `amount ${budgets[0].amount}`);
    // Null means "standing": it applies to every month until replaced.
    assert(budgets[0].period_month === null, `period_month ${budgets[0].period_month}`);
    assert(budgets[0].user_id === owner.id, "the budget was not owned by its setter");
    assert(budgets[0].group_id === null, "a personal budget must have no group");
  });

  await check("with no spending, the whole budget is remaining", async () => {
    const page = await getPage(owner, CATEGORIES);
    const block = categoryBlock(page.html, "Food");
    assertIncludes(block, inr(0), "Food: spent");
    assertIncludes(block, inr(8000), "Food: budget");
    assertIncludes(block, "0% used", "Food: utilisation");
    assertIncludes(block, `${inr(8000)} left`, "Food: remaining");
    assertIncludes(block, "On track", "Food: status");
  });

  await check("spending is counted against the budget for the month", async () => {
    await addPersonalExpense(owner, {
      itemName: "Weekly shop",
      amount: "6200",
      expenseDate: TODAY,
      category: foodId,
    });

    const page = await getPage(owner, CATEGORIES);
    const block = categoryBlock(page.html, "Food");
    assertIncludes(block, `${inr(6200)}`, "Food: spent");
    // 6200 / 8000 = 77.5%, rounded for display.
    assertIncludes(block, "78% used", "Food: utilisation");
    assertIncludes(block, `${inr(1800)} left`, "Food: remaining");
    assertIncludes(block, "On track", "Food: status");
  });

  await check("reaching 80% of the budget is a warning, not an error", async () => {
    await addPersonalExpense(owner, {
      itemName: "Corner shop",
      amount: "400",
      expenseDate: TODAY,
      category: foodId,
    });

    const block = categoryBlock((await getPage(owner, CATEGORIES)).html, "Food");
    assertIncludes(block, `${inr(6600)}`, "Food: spent");
    assertIncludes(block, "83% used", "Food: utilisation");
    assertIncludes(block, `${inr(1400)} left`, "Food: remaining");
    assertIncludes(block, "Nearing budget", "Food: status");
  });

  await check("passing the budget is reported as an overspend, not a negative", async () => {
    await addPersonalExpense(owner, {
      itemName: "Restaurant",
      amount: "1500",
      expenseDate: TODAY,
      category: foodId,
    });

    const block = categoryBlock((await getPage(owner, CATEGORIES)).html, "Food");
    assertIncludes(block, `${inr(8100)}`, "Food: spent");
    assertIncludes(block, "101% used", "Food: utilisation");
    assertIncludes(block, `${inr(100)} over`, "Food: overspend");
    assertIncludes(block, "Over budget", "Food: status");
  });

  await check("the status is stated in words, not only in colour", async () => {
    const block = categoryBlock((await getPage(owner, CATEGORIES)).html, "Food");
    assertIncludes(block, 'role="progressbar"', "Food: meter role");
    assertIncludes(block, "aria-valuetext", "Food: meter description");
    assertIncludes(block, "Over budget.", "Food: spoken status");
  });

  await check("the month summary totals budget, spending and what is left", async () => {
    const page = await getPage(owner, CATEGORIES);
    assertIncludes(page.html, "Total budget", "summary");
    assertIncludes(page.html, inr(8000), "summary: total budget");
    assertIncludes(page.html, inr(8100), "summary: spent");
    assertIncludes(page.html, "Over budget", "summary: remaining card title");
  });

  await check("a category with no budget says so rather than showing zero", async () => {
    const block = categoryBlock((await getPage(owner, CATEGORIES)).html, "Rent");
    assertIncludes(block, "no budget set", "Rent: figures");
    assertIncludes(block, "No budget set", "Rent: status");
    assertExcludes(block, "% used", "Rent should not claim a utilisation");
  });

  await check("spending outside any budget is called out separately", async () => {
    await addPersonalExpense(owner, {
      itemName: "Unfiled",
      amount: "250",
      expenseDate: TODAY,
      category: "",
    });

    const page = await getPage(owner, CATEGORIES);
    assertIncludes(page.html, "was spent with no category", "uncategorised note");
    assertIncludes(page.html, inr(250), "uncategorised amount");
  });

  // -------------------------------------------------------------------------
  group("Months");

  await check("a standing budget applies to a month with no spending in it", async () => {
    const page = await getPage(owner, `${CATEGORIES}?month=${LAST_MONTH}`);
    assert(page.status === 200, `status ${page.status}`);

    const block = categoryBlock(page.html, "Food");
    assertIncludes(block, inr(8000), "last month: budget still applies");
    assertIncludes(block, "0% used", "last month: nothing spent");
    assertIncludes(block, "On track", "last month: status");
  });

  await check("an expense in a past month counts in that month only", async () => {
    await addPersonalExpense(owner, {
      itemName: "Last month's shop",
      amount: "2000",
      expenseDate: LAST_MONTH_DAY,
      category: foodId,
    });

    const past = categoryBlock(
      (await getPage(owner, `${CATEGORIES}?month=${LAST_MONTH}`)).html,
      "Food",
    );
    assertIncludes(past, inr(2000), "last month: spent");
    assertIncludes(past, "25% used", "last month: utilisation");

    const current = categoryBlock((await getPage(owner, CATEGORIES)).html, "Food");
    assertIncludes(current, inr(8100), "this month is unchanged");
  });

  await check("a nonsense month falls back to the current one", async () => {
    for (const value of ["banana", "2026-13", "1998-01", "%2E%2E%2F"]) {
      const page = await getPage(owner, `${CATEGORIES}?month=${value}`);
      assert(page.status === 200, `month=${value} returned ${page.status}`);
      const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(now);
      assertIncludes(page.html, label, `month=${value} should fall back to this month`);
    }
  });

  await check("a month-specific budget overrides the standing one", async () => {
    // Written directly: the UI sets standing budgets, and this proves the
    // schema and the read path already support the month-specific ones the
    // specification asks the architecture to allow.
    const { error } = await owner.db.from("budgets").insert({
      user_id: owner.id,
      category_id: foodId,
      amount: 4000,
      period_month: `${LAST_MONTH}-01`,
    });
    assert(!error, `could not set a month-specific budget: ${error?.message}`);

    const past = categoryBlock(
      (await getPage(owner, `${CATEGORIES}?month=${LAST_MONTH}`)).html,
      "Food",
    );
    assertIncludes(past, inr(4000), "last month: the override applies");
    assertIncludes(past, "50% used", "last month: recalculated against the override");
    assertIncludes(past, "Set for this month", "last month: the override is labelled");

    const current = categoryBlock((await getPage(owner, CATEGORIES)).html, "Food");
    assertIncludes(current, inr(8000), "this month still uses the standing budget");

    await admin.from("budgets").delete().eq("category_id", foodId).not("period_month", "is", null);
  });

  // -------------------------------------------------------------------------
  group("Changing a budget");

  await check("a budget is replaced rather than duplicated", async () => {
    await setBudget(owner, CATEGORIES, foodId, "10000");

    const budgets = (await budgetsOf(owner, { userId: owner.id })).filter(
      (b) => b.category_id === foodId && b.period_month === null,
    );
    assert(budgets.length === 1, `expected one standing budget, found ${budgets.length}`);
    assert(Number(budgets[0].amount) === 10000, `amount ${budgets[0].amount}`);

    const block = categoryBlock((await getPage(owner, CATEGORIES)).html, "Food");
    assertIncludes(block, "81% used", "Food: recalculated against the new budget");
    assertIncludes(block, "Nearing budget", "Food: status after the increase");
  });

  await check("zero and negative budgets are refused", async () => {
    for (const amount of ["0", "-500"]) {
      const result = await setBudget(owner, CATEGORIES, foodId, amount);
      assertIncludes(result.text, "greater than zero", `budget of ${amount}`);
    }
    const budgets = (await budgetsOf(owner, { userId: owner.id })).filter(
      (b) => b.category_id === foodId,
    );
    assert(Number(budgets[0].amount) === 10000, "a rejected amount changed the budget");
  });

  await check("more than two decimal places is refused rather than rounded", async () => {
    const result = await setBudget(owner, CATEGORIES, foodId, "999.999");
    assertIncludes(result.text, "Enter an amount such as", "over-precise budget");
  });

  await check("clearing a budget removes the row rather than storing zero", async () => {
    await clickAction(owner, CATEGORIES, "Clear the budget for Food");

    const budgets = (await budgetsOf(owner, { userId: owner.id })).filter(
      (b) => b.category_id === foodId,
    );
    assert(budgets.length === 0, "the budget row survived being cleared");

    const block = categoryBlock((await getPage(owner, CATEGORIES)).html, "Food");
    assertIncludes(block, "No budget set", "Food after clearing");
  });

  // -------------------------------------------------------------------------
  group("Category lifecycle");

  await check("a category is renamed, and its expenses follow it", async () => {
    await submitForm(owner, CATEGORIES, {
      include: ['name="categoryId"', `value="${foodId}"`, 'name="name"'],
      values: { name: "Food & drink" },
    });

    const renamed = (await categoriesOf(owner, { userId: owner.id })).find((c) => c.id === foodId);
    assert(renamed.name === "Food & drink", `name is ${renamed.name}`);

    const page = await getPage(owner, "/expenses");
    assertIncludes(page.html, "Food &amp; drink", "expense list shows the new name");
  });

  await check("archiving keeps the category but takes it out of the picker", async () => {
    await clickAction(owner, CATEGORIES, "Archive Food & drink");

    const archived = (await categoriesOf(owner, { userId: owner.id })).find((c) => c.id === foodId);
    assert(archived.is_archived === true, "the category was not archived");

    const form = await getPage(owner, "/expenses/new");
    assertExcludes(form.html, `value="${foodId}"`, "archived category still offered");

    const page = await getPage(owner, CATEGORIES);
    assertIncludes(page.html, ">Archived</span>", "the categories page should mark it archived");
  });

  await check("the database refuses an archived category even when the UI is skipped", async () => {
    const { error } = await owner.db.from("expenses").insert({
      user_id: owner.id,
      group_id: null,
      paid_by: owner.id,
      category_id: foodId,
      item_name: "Straight to the API",
      amount: 100,
      currency_code: "INR",
      expense_date: TODAY,
    });
    assert(error, "an archived category was accepted");
  });

  await check("restoring puts it back in the picker", async () => {
    await clickAction(owner, CATEGORIES, "Restore Food & drink");

    const restored = (await categoriesOf(owner, { userId: owner.id })).find((c) => c.id === foodId);
    assert(restored.is_archived === false, "the category was not restored");

    const form = await getPage(owner, "/expenses/new");
    assertIncludes(form.html, `value="${foodId}"`, "restored category not offered");
  });

  await check("deleting a category leaves its expenses in place, uncategorised", async () => {
    await setBudget(owner, CATEGORIES, foodId, "5000");
    await clickAction(owner, CATEGORIES, "Delete Food & drink");

    const remaining = (await categoriesOf(owner, { userId: owner.id })).find((c) => c.id === foodId);
    assert(!remaining, "the category survived deletion");

    // The budget went with it, through the composite foreign key's cascade.
    const budgets = (await budgetsOf(owner, { userId: owner.id })).filter(
      (b) => b.category_id === foodId,
    );
    assert(budgets.length === 0, "the budget outlived its category");

    const { data: expenses } = await owner.db
      .from("expenses")
      .select("item_name, category_id")
      .eq("user_id", owner.id)
      .is("group_id", null);

    const shop = expenses.find((e) => e.item_name === "Weekly shop");
    assert(shop, "the expense was deleted along with its category");
    assert(shop.category_id === null, "the expense kept a dangling category");

    const page = await getPage(owner, "/expenses");
    assertIncludes(page.html, "Weekly shop", "the expense list after deleting a category");
  });

  // -------------------------------------------------------------------------
  group("Group categories and budgets");

  let groupFoodId = "";

  await check("an admin creates a group and its categories", async () => {
    const result = await submitForm(owner, "/groups/new", {
      include: ['name="name"'],
      values: { name: "Goa Trip 2026", description: "Shared costs", currencyCode: "EUR" },
    });
    assert(
      result.redirect?.includes("flash=group-created"),
      `the group was not created: ${result.redirect ?? result.text.slice(0, 200)}`,
    );
    groupId = result.redirect.replace("/groups/", "").split("?")[0];
    assert(groupId.length === 36, `group id looks wrong: ${groupId}`);

    await addCategory(owner, groupCategoriesPath(groupId), "Beach food");
    const categories = await categoriesOf(owner, { groupId });
    groupFoodId = findByName(categories, "Beach food").id;
    const created = categories.find((c) => c.id === groupFoodId);
    assert(created.group_id === groupId, "the category was not attached to the group");
    assert(created.user_id === null, "a group category must have no personal owner");
  });

  await check("a second member joins", async () => {
    // Seated directly: the invitation flow is Phase 5's to prove.
    const { error } = await admin
      .from("group_members")
      .insert({ group_id: groupId, user_id: mate.id, role: "member" });
    assert(!error, `could not seat the member: ${error?.message}`);
  });

  await check("the stranger creates an unrelated group", async () => {
    const result = await submitForm(stranger, "/groups/new", {
      include: ['name="name"'],
      values: { name: "Someone Else's Group", description: "", currencyCode: "INR" },
    });
    assert(
      result.redirect?.includes("flash=group-created"),
      `the group was not created: ${result.redirect ?? result.text.slice(0, 200)}`,
    );
    otherGroupId = result.redirect.replace("/groups/", "").split("?")[0];
    assert(otherGroupId.length === 36, `group id looks wrong: ${otherGroupId}`);
  });

  await check("the admin budgets a group category, in the group's currency", async () => {
    await setBudget(owner, groupCategoriesPath(groupId), groupFoodId, "500");

    const budgets = await budgetsOf(owner, { groupId });
    assert(budgets.length === 1, `expected one budget, found ${budgets.length}`);
    assert(budgets[0].group_id === groupId, "the budget was not attached to the group");
    assert(budgets[0].user_id === null, "a group budget must have no personal owner");

    const block = categoryBlock(
      (await getPage(owner, groupCategoriesPath(groupId))).html,
      "Beach food",
    );
    assertIncludes(block, eur(500), "the group budget uses the group's currency");
    assertExcludes(block, "₹", "the group page should not use the default currency");
  });

  await check("group spending counts against the group's budget", async () => {
    await addGroupExpense(owner, groupId, {
      itemName: "Beach shack dinner",
      amount: "400",
      category: groupFoodId,
    });

    const block = categoryBlock(
      (await getPage(mate, groupCategoriesPath(groupId))).html,
      "Beach food",
    );
    assertIncludes(block, eur(400), "group spend");
    assertIncludes(block, "80% used", "group utilisation");
    assertIncludes(block, "Nearing budget", "group status");
  });

  await check("personal and group budgets never see each other's spending", async () => {
    // Matched as a rendered category heading rather than as bare text: the
    // add-category form carries an example name in its placeholder, so a
    // substring search over the page proves nothing either way.
    const personal = await getPage(owner, CATEGORIES);
    assertExcludes(
      personal.html,
      ">Beach food</h3>",
      "a group category leaked into personal budgets",
    );

    const groupPage = await getPage(owner, groupCategoriesPath(groupId));
    assertExcludes(
      groupPage.html,
      ">Weekend trips</h3>",
      "a personal category leaked into a group",
    );
    // The admin's own personal spending must not be added to the group's.
    const block = categoryBlock(groupPage.html, "Beach food");
    assertIncludes(block, eur(400), "the group total picked up personal spending");
  });

  await check("a member sees the budgets but is offered no way to change them", async () => {
    const page = await getPage(mate, groupCategoriesPath(groupId));
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, "Beach food", "member view");
    assertIncludes(page.html, eur(500), "member view: the budget is readable");
    assertIncludes(page.html, "Only a group admin can change these.", "member view: the rule");
    assert(
      !hasForm(page.html, ['name="amount"']),
      "a member was offered a budget form",
    );
    assert(
      !hasForm(page.html, ['placeholder="Weekend trips"']),
      "a member was offered an add-category form",
    );
    assertExcludes(page.html, "Suggested categories", "a member was offered the defaults");
  });

  await check("an admin is offered all of it", async () => {
    const page = await getPage(owner, groupCategoriesPath(groupId));
    assert(hasForm(page.html, ['name="amount"']), "the admin has no budget form");
    assert(hasForm(page.html, ['placeholder="Weekend trips"']), "the admin cannot add a category");
    assertIncludes(page.html, "Every member sees these", "admin view: the rule");
  });

  await check("a non-member cannot reach a group's categories at all", async () => {
    const page = await getPage(stranger, groupCategoriesPath(groupId));
    assertNotFound(page, "stranger on a group's categories page");
  });

  await check("signing out is required to see any of it", async () => {
    const page = await getPage(null, CATEGORIES);
    assert(page.status === 307 || page.status === 302, `status ${page.status}`);
    assert(page.location?.includes("/sign-in"), `redirected to ${page.location}`);
  });

  // -------------------------------------------------------------------------
  group("Authorization, proved against the database");

  await check("a member cannot create a group category", async () => {
    const { error } = await mate.db
      .from("categories")
      .insert({ group_id: groupId, name: "Member's category" });
    assert(error, "a member created a group category");
  });

  await check("a member cannot rename or archive one", async () => {
    const { data: renamed } = await mate.db
      .from("categories")
      .update({ name: "Renamed by a member" })
      .eq("id", groupFoodId)
      .select("id");
    assert(!renamed || renamed.length === 0, "a member renamed a group category");

    const { data: archived } = await mate.db
      .from("categories")
      .update({ is_archived: true })
      .eq("id", groupFoodId)
      .select("id");
    assert(!archived || archived.length === 0, "a member archived a group category");
  });

  await check("a member cannot delete one", async () => {
    const { data } = await mate.db
      .from("categories")
      .delete()
      .eq("id", groupFoodId)
      .select("id");
    assert(!data || data.length === 0, "a member deleted a group category");

    const still = await categoriesOf(mate, { groupId });
    assert(still.some((c) => c.id === groupFoodId), "the category is gone");
  });

  await check("a member cannot set, change or remove a budget", async () => {
    const { error: insertError } = await mate.db.from("budgets").insert({
      group_id: groupId,
      category_id: groupFoodId,
      amount: 99999,
    });
    assert(insertError, "a member set a group budget");

    const budgetId = (await budgetsOf(mate, { groupId }))[0].id;

    const { data: updated } = await mate.db
      .from("budgets")
      .update({ amount: 1 })
      .eq("id", budgetId)
      .select("id");
    assert(!updated || updated.length === 0, "a member changed a group budget");

    const { data: deleted } = await mate.db
      .from("budgets")
      .delete()
      .eq("id", budgetId)
      .select("id");
    assert(!deleted || deleted.length === 0, "a member deleted a group budget");
  });

  await check("a member can read the group's categories and budgets", async () => {
    const categories = await categoriesOf(mate, { groupId });
    assert(categories.length >= 1, "a member cannot read the group's categories");

    const budgets = await budgetsOf(mate, { groupId });
    assert(budgets.length === 1, "a member cannot read the group's budgets");
    assert(Number(budgets[0].amount) === 500, `amount ${budgets[0].amount}`);
  });

  await check("a stranger cannot read another user's personal categories or budgets", async () => {
    const categories = await categoriesOf(stranger, { userId: owner.id });
    assert(categories.length === 0, "a stranger read someone's personal categories");

    const budgets = await budgetsOf(stranger, { userId: owner.id });
    assert(budgets.length === 0, "a stranger read someone's personal budgets");
  });

  await check("a stranger cannot read a group's categories or budgets", async () => {
    const categories = await categoriesOf(stranger, { groupId });
    assert(categories.length === 0, "a non-member read a group's categories");

    const budgets = await budgetsOf(stranger, { groupId });
    assert(budgets.length === 0, "a non-member read a group's budgets");
  });

  await check("a budget cannot be attached to somebody else's category", async () => {
    const tripsId = findByName(
      await categoriesOf(owner, { userId: owner.id }),
      "Weekend trips",
    ).id;

    // Claiming the budget as their own, over a category that is not.
    const { error } = await stranger.db.from("budgets").insert({
      user_id: stranger.id,
      category_id: tripsId,
      amount: 100,
    });
    assert(error, "a budget was attached to another user's category");
  });

  await check("a group's budget cannot point at another group's category", async () => {
    const { error } = await stranger.db.from("budgets").insert({
      group_id: otherGroupId,
      category_id: groupFoodId,
      amount: 100,
    });
    assert(error, "a budget crossed a group boundary");
  });

  await check("a category cannot be re-owned by an update", async () => {
    await owner.db
      .from("categories")
      .update({ user_id: stranger.id, group_id: null })
      .eq("id", groupFoodId);

    const category = (await categoriesOf(owner, { groupId })).find((c) => c.id === groupFoodId);
    assert(category, "the category was moved out of the group");
    assert(category.group_id === groupId, "group_id was changed");
    assert(category.user_id === null, "user_id was set on a group category");
  });

  await check("a budget cannot be re-owned by an update", async () => {
    const budget = (await budgetsOf(owner, { groupId }))[0];

    await owner.db
      .from("budgets")
      .update({ user_id: owner.id, group_id: null })
      .eq("id", budget.id);

    const after = (await budgetsOf(owner, { groupId })).find((b) => b.id === budget.id);
    assert(after, "the budget was moved out of the group");
    assert(after.group_id === groupId, "group_id was changed");
    assert(after.user_id === null, "user_id was set on a group budget");
  });

  // -------------------------------------------------------------------------
  group("Database constraints");

  await check("a budget amount must be positive", async () => {
    for (const amount of [0, -1]) {
      const { error } = await owner.db.from("budgets").insert({
        group_id: groupId,
        category_id: groupFoodId,
        amount,
        period_month: `${THIS_MONTH}-01`,
      });
      assert(error, `a budget of ${amount} was accepted`);
    }
  });

  await check("a month-specific budget must start on the first of a month", async () => {
    const { error } = await owner.db.from("budgets").insert({
      group_id: groupId,
      category_id: groupFoodId,
      amount: 100,
      period_month: `${THIS_MONTH}-17`,
    });
    assert(error, "a mid-month budget period was accepted");
  });

  await check("a category cannot have two standing budgets", async () => {
    const { error } = await owner.db.from("budgets").insert({
      group_id: groupId,
      category_id: groupFoodId,
      amount: 250,
      period_month: null,
    });
    assert(error, "a second standing budget was accepted");
  });

  await check("a budget cannot belong to both a user and a group", async () => {
    const { error } = await owner.db.from("budgets").insert({
      group_id: groupId,
      user_id: owner.id,
      category_id: groupFoodId,
      amount: 100,
      period_month: `${THIS_MONTH}-01`,
    });
    assert(error, "a budget with two owners was accepted");
  });

  await check("a category cannot belong to both a user and a group", async () => {
    const { error } = await owner.db
      .from("categories")
      .insert({ group_id: groupId, user_id: owner.id, name: "Two owners" });
    assert(error, "a category with two owners was accepted");
  });

  // -------------------------------------------------------------------------
  console.log("\nCleaning up test accounts...");
  await cleanup();

  console.log(`\n${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const failure of failures) {
      console.log(`  ${failure.section} → ${failure.name}`);
      console.log(`    ${failure.message}`);
    }
    process.exit(1);
  }
}

run().catch(async (error) => {
  console.error("\nSuite crashed:", error);
  await cleanup();
  process.exit(1);
});
