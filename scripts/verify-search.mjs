#!/usr/bin/env node
/**
 * End-to-end test suite for Phase 9 — search, filters and history.
 *
 * Two surfaces are exercised, because both are real:
 *
 *   1. The running application over HTTP, as a signed-in browser would use it.
 *      Every filter is applied the way a person applies it — by requesting a
 *      URL, which is the whole point of putting filters in the query string —
 *      and the rows are then read back out of the rendered list itself rather
 *      than out of the page at large.
 *
 *   2. PostgREST directly, with each user's own JWT. A filter narrows what is
 *      shown; it must never widen what is readable, and that claim belongs
 *      against the database rather than against the absence of a link.
 *
 *   npm run dev          (in another terminal)
 *   npm run verify:search
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

const money = (locale, currency) => (amount) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

const inr = money("en-IN", "INR");
const eur = money("de-DE", "EUR");

const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const monthLabel = (year, month) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );

const dayLabel = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
};

const now = new Date();
const THIS_MONTH_KEY = { year: now.getFullYear(), month: now.getMonth() + 1 };
const THIS_MONTH = `${THIS_MONTH_KEY.year}-${String(THIS_MONTH_KEY.month).padStart(2, "0")}`;

// The 10th and the 20th, so both days exist in every month and no timezone can
// move either out of the month it was chosen for.
const dayOfThisMonth = (day) => iso(new Date(now.getFullYear(), now.getMonth(), day));

const EARLY_DAY = dayOfThisMonth(10);
const LATE_DAY = dayOfThisMonth(20);

const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
const LAST_MONTH_DAY = iso(lastMonthDate);
const LAST_MONTH_KEY = {
  year: lastMonthDate.getFullYear(),
  month: lastMonthDate.getMonth() + 1,
};
const LAST_MONTH = LAST_MONTH_DAY.slice(0, 7);

const olderDate = new Date(now.getFullYear(), now.getMonth() - 4, 15);
const OLDER_DAY = iso(olderDate);

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

/**
 * The rendered document, ready to match against.
 *
 * React writes `<!-- -->` between adjacent text nodes, and Next inlines the
 * RSC payload in `<script>` tags — which repeats every href, class and style of
 * the page as escaped JSON, *before* the markup they belong to. Matching
 * against that found the right link and then the wrong element after it. The
 * scripts go, so an assertion can only ever see what was actually rendered.
 */
function readable(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    .replaceAll("<!-- -->", "");
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

/** Submits a form the way a browser with no JavaScript would. */
async function submitForm(user, path, { include, exclude = [], values = {} }) {
  const page = await getPage(user, path);
  assert(page.status === 200, `GET ${path} returned ${page.status}`);

  const form = findForm(page.html, include, exclude);
  const body = new FormData();

  for (const [name, value] of hiddenFields(form)) body.append(name, value);
  for (const [name, value] of Object.entries(values)) body.append(name, value);

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    // A browser sends Origin on a form POST, and Next compares it to Host as
    // its CSRF check. Sending it keeps the suite on the same path a user is.
    headers: { cookie: cookieHeader(user), origin: BASE_URL },
    body,
    redirect: "manual",
  });

  const text = await response.text();
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

const EXPENSES = "/expenses";
const groupExpensesPath = (groupId) => `/groups/${groupId}/expenses`;

function addCategory(user, path, name) {
  return submitForm(user, path, {
    include: ['name="name"', 'placeholder="Weekend trips"'],
    values: { name },
  });
}

function addPersonalExpense(user, values) {
  return submitForm(user, "/expenses/new", {
    include: ['name="itemName"'],
    values: {
      itemName: "",
      amount: "",
      expenseDate: EARLY_DAY,
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
      expenseDate: EARLY_DAY,
      category: "",
      newCategoryName: "",
      paymentMode: "",
      notes: "",
      ...values,
    },
  });
}

async function categoriesOf(user, filter) {
  let query = user.db.from("categories").select("id, name");
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

// ---------------------------------------------------------------------------
// Reading a filtered list back off the page
//
// Anchored to the list itself rather than to the document. A search term is
// echoed in the search box, a category name appears in the filter dropdown and
// a member's name appears in "Paid by" — so "the page mentions Groceries" is
// no evidence at all that a row for Groceries was returned. Phase 8 learned
// this the hard way; these helpers only ever read the `<ul>` of rows.
// ---------------------------------------------------------------------------

const ROW_LIST = /<ul class="divide-y divide-border[^"]*">[\s\S]*?<\/ul>/g;

/** Every expense row on the page, concatenated. Empty when the list is empty. */
function rows(html) {
  return (html.match(ROW_LIST) ?? []).join("\n");
}

/** The item names the list actually rendered, in order. */
function itemNames(html) {
  const names = [];
  for (const match of rows(html).matchAll(/<span class="font-medium">([^<]*)<\/span>/g)) {
    names.push(decodeEntities(match[1]));
  }
  return names;
}

function assertRows(html, expected, what) {
  const found = itemNames(html);
  const sort = (list) => [...list].sort();
  assert(
    JSON.stringify(sort(found)) === JSON.stringify(sort(expected)),
    `${what}: expected rows ${JSON.stringify(sort(expected))}, got ${JSON.stringify(sort(found))}`,
  );
}

/**
 * The "N matching expenses, totalling X." line above the list.
 *
 * Matched by `data-slot`, not by the class list: this assertion is about the
 * summary being present and correct, and it should not fail because the line
 * was restyled.
 */
function summary(html) {
  const match = html.match(
    /<p [^>]*data-slot="page-description"[^>]*>([^<]*)<\/p>/,
  );
  assert(match, "no summary line above the list");
  return decodeEntities(match[1]);
}

/** A `<a href="...">` exists on the page. */
function hasLink(html, href) {
  return html.includes(`href="${href}"`) || html.includes(`href="${href}&`);
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

async function run() {
  const probe = await fetch(`${BASE_URL}/sign-in`, { redirect: "manual" }).catch(() => null);
  if (!probe) {
    console.error(`No application at ${BASE_URL}. Start it with: npm run dev`);
    process.exit(1);
  }

  const owner = await createUser("sowner", "Ada Owner");
  const mate = await createUser("smate", "Rahul Mate");
  const stranger = await createUser("sstranger", "Grace Stranger");

  let foodId = "";
  let travelId = "";
  let groupId = "";
  let groupFoodId = "";

  // -------------------------------------------------------------------------
  group("Nothing to narrow");

  await check("an empty list offers a first expense rather than a filter bar", async () => {
    const page = await getPage(owner, EXPENSES);
    assert(page.status === 200, `GET ${EXPENSES} returned ${page.status}`);
    assertIncludes(page.html, "No expenses yet", "the empty list");
    assertExcludes(page.html, "Search and filter expenses", "the empty list");
  });

  // -------------------------------------------------------------------------
  group("Seeding");

  await check("personal expenses are recorded across categories, modes and months", async () => {
    await addCategory(owner, "/categories", "Food");
    await addCategory(owner, "/categories", "Travel");

    const categories = await categoriesOf(owner, { userId: owner.id });
    foodId = findByName(categories, "Food").id;
    travelId = findByName(categories, "Travel").id;

    await addPersonalExpense(owner, {
      itemName: "Weekly groceries",
      amount: "1200",
      category: foodId,
      paymentMode: "upi",
      notes: "Big shop at the market",
      expenseDate: EARLY_DAY,
    });
    await addPersonalExpense(owner, {
      itemName: "Airport taxi",
      amount: "800",
      category: travelId,
      paymentMode: "cash",
      notes: "Early flight",
      expenseDate: LATE_DAY,
    });
    await addPersonalExpense(owner, {
      itemName: "Odds and ends",
      amount: "300",
      paymentMode: "cash",
      expenseDate: LATE_DAY,
    });
    await addPersonalExpense(owner, {
      itemName: "Last month rent",
      amount: "9000",
      category: foodId,
      paymentMode: "bank_transfer",
      expenseDate: LAST_MONTH_DAY,
    });
    await addPersonalExpense(owner, {
      itemName: "Ancient book",
      amount: "150",
      expenseDate: OLDER_DAY,
    });

    const { data, error } = await owner.db
      .from("expenses")
      .select("id")
      .eq("user_id", owner.id)
      .is("group_id", null);
    assert(!error, error?.message);
    assert(data.length === 5, `expected 5 personal expenses, found ${data.length}`);
  });

  await check("the unfiltered list is all time, not just this month", async () => {
    const page = await getPage(owner, EXPENSES);
    assertRows(
      page.html,
      ["Weekly groceries", "Airport taxi", "Odds and ends", "Last month rent", "Ancient book"],
      "the unfiltered list",
    );
  });

  await check("the filter bar appears once there is something to narrow", async () => {
    const page = await getPage(owner, EXPENSES);
    assertIncludes(page.html, "Search and filter expenses", "the list");
    const form = findForm(page.html, ['name="q"']);
    assertIncludes(form, 'name="category"', "the filter bar");
    assertIncludes(form, 'name="paymentMode"', "the filter bar");
    assertIncludes(form, 'name="from"', "the filter bar");
    assertIncludes(form, 'name="to"', "the filter bar");
  });

  await check("a personal list has no Paid by control, having one payer", async () => {
    const page = await getPage(owner, EXPENSES);
    const form = findForm(page.html, ['name="q"']);
    assertExcludes(form, 'name="paidBy"', "the personal filter bar");
  });

  // -------------------------------------------------------------------------
  group("Search");

  await check("search matches the item name", async () => {
    const page = await getPage(owner, `${EXPENSES}?q=taxi`);
    assertRows(page.html, ["Airport taxi"], "a search for taxi");
  });

  await check("search matches the notes as well as the name", async () => {
    const page = await getPage(owner, `${EXPENSES}?q=market`);
    assertRows(page.html, ["Weekly groceries"], "a search for a word only in the notes");
  });

  await check("search is case-insensitive", async () => {
    const page = await getPage(owner, `${EXPENSES}?q=AIRPORT`);
    assertRows(page.html, ["Airport taxi"], "an upper-case search");
  });

  await check("search matches part of a word", async () => {
    const page = await getPage(owner, `${EXPENSES}?q=grocer`);
    assertRows(page.html, ["Weekly groceries"], "a partial search");
  });

  await check("a search that matches nothing shows an empty state, not an error", async () => {
    const page = await getPage(owner, `${EXPENSES}?q=zzzznothing`);
    assert(page.status === 200, `a fruitless search returned ${page.status}`);
    assertRows(page.html, [], "a fruitless search");
    assertIncludes(page.html, "No expenses match your search", "a fruitless search");
    assertIncludes(page.html, `href="${EXPENSES}"`, "a fruitless search");
  });

  await check("a search term is echoed back into the box", async () => {
    const page = await getPage(owner, `${EXPENSES}?q=taxi`);
    const form = findForm(page.html, ['name="q"']);
    assertIncludes(form, 'value="taxi"', "the search box");
  });

  await check("a percent sign is searched for literally, not as a wildcard", async () => {
    // Were it passed through unescaped, `%` would match every row.
    const page = await getPage(owner, `${EXPENSES}?q=%25`);
    assertRows(page.html, [], "a search for a literal percent sign");
  });

  await check("an underscore is searched for literally, not as a wildcard", async () => {
    const page = await getPage(owner, `${EXPENSES}?q=_`);
    assertRows(page.html, [], "a search for a literal underscore");
  });

  await check("a comma does not break the query it travels in", async () => {
    // PostgREST separates `or(...)` operands with commas; an unquoted term
    // containing one would be read as two half-filters, or rejected outright.
    const page = await getPage(owner, `${EXPENSES}?q=${encodeURIComponent("taxi,groceries")}`);
    assert(page.status === 200, `a search containing a comma returned ${page.status}`);
    assertRows(page.html, [], "a search for a phrase containing a comma");
  });

  await check("quotes and parentheses do not break the query either", async () => {
    for (const term of ['"', "()", "\\", "*", "."]) {
      const page = await getPage(owner, `${EXPENSES}?q=${encodeURIComponent(term)}`);
      assert(page.status === 200, `a search for ${JSON.stringify(term)} returned ${page.status}`);
    }
  });

  await check("a search reports the matching count and total, not the whole list's", async () => {
    const page = await getPage(owner, `${EXPENSES}?q=taxi`);
    assertIncludes(summary(page.html), "1 matching expense", "the summary line");
    assertIncludes(summary(page.html), inr(800), "the summary line");
  });

  // -------------------------------------------------------------------------
  group("Field filters");

  await check("the category filter keeps only that category", async () => {
    const page = await getPage(owner, `${EXPENSES}?category=${travelId}`);
    assertRows(page.html, ["Airport taxi"], "a filter on Travel");
  });

  await check("the uncategorised sentinel finds rows with no category", async () => {
    const page = await getPage(owner, `${EXPENSES}?category=none`);
    assertRows(page.html, ["Odds and ends", "Ancient book"], "a filter on Uncategorised");
  });

  await check("the payment mode filter keeps only that mode", async () => {
    const page = await getPage(owner, `${EXPENSES}?paymentMode=cash`);
    assertRows(page.html, ["Airport taxi", "Odds and ends"], "a filter on Cash");
  });

  await check("filters combine rather than replace one another", async () => {
    const page = await getPage(owner, `${EXPENSES}?category=none&paymentMode=cash`);
    assertRows(page.html, ["Odds and ends"], "two filters at once");
  });

  await check("search combines with a filter", async () => {
    const page = await getPage(owner, `${EXPENSES}?q=a&category=${foodId}`);
    assertRows(page.html, ["Weekly groceries", "Last month rent"], "a search within a category");
  });

  await check("a nonsense filter value is ignored rather than rejected", async () => {
    const page = await getPage(
      owner,
      `${EXPENSES}?category=not-a-uuid&paymentMode=telepathy&paidBy=nonsense&month=2026-13&from=oops`,
    );
    assert(page.status === 200, `a stale link returned ${page.status}`);
    assertRows(
      page.html,
      ["Weekly groceries", "Airport taxi", "Odds and ends", "Last month rent", "Ancient book"],
      "a link full of unreadable values",
    );
  });

  await check("a category belonging to somebody else matches nothing", async () => {
    await addCategory(stranger, "/categories", "Secret");
    const theirs = await categoriesOf(stranger, { userId: stranger.id });
    const secretId = findByName(theirs, "Secret").id;

    const page = await getPage(owner, `${EXPENSES}?category=${secretId}`);
    assertRows(page.html, [], "a filter on another user's category");
  });

  // -------------------------------------------------------------------------
  group("Date range");

  await check("a from date keeps everything on or after it", async () => {
    const page = await getPage(owner, `${EXPENSES}?from=${LATE_DAY}`);
    assertRows(page.html, ["Airport taxi", "Odds and ends"], "a from-date filter");
  });

  await check("a to date keeps everything on or before it", async () => {
    const page = await getPage(owner, `${EXPENSES}?to=${LAST_MONTH_DAY}`);
    assertRows(page.html, ["Last month rent", "Ancient book"], "a to-date filter");
  });

  await check("both ends are inclusive", async () => {
    const page = await getPage(owner, `${EXPENSES}?from=${EARLY_DAY}&to=${LATE_DAY}`);
    assertRows(
      page.html,
      ["Weekly groceries", "Airport taxi", "Odds and ends"],
      "a closed date range",
    );
  });

  await check("a range typed backwards is read as the range it describes", async () => {
    const page = await getPage(owner, `${EXPENSES}?from=${LATE_DAY}&to=${EARLY_DAY}`);
    assertRows(
      page.html,
      ["Weekly groceries", "Airport taxi", "Odds and ends"],
      "a reversed date range",
    );
  });

  await check("the scope navigator names the custom range in view", async () => {
    const page = await getPage(owner, `${EXPENSES}?from=${EARLY_DAY}&to=${LATE_DAY}`);
    assertIncludes(
      page.html,
      `${dayLabel(EARLY_DAY)} – ${dayLabel(LATE_DAY)}`,
      "the scope navigator",
    );
    assertIncludes(page.html, "Clear dates", "the scope navigator");
  });

  // -------------------------------------------------------------------------
  group("Month scope and history");

  await check("a month scopes the list to that month", async () => {
    const page = await getPage(owner, `${EXPENSES}?month=${THIS_MONTH}`);
    assertRows(
      page.html,
      ["Weekly groceries", "Airport taxi", "Odds and ends"],
      "this month's list",
    );
  });

  await check("a previous month shows that month's records", async () => {
    const page = await getPage(owner, `${EXPENSES}?month=${LAST_MONTH}`);
    assertRows(page.html, ["Last month rent"], "last month's list");
  });

  await check("the month in view is named on the page", async () => {
    const page = await getPage(owner, `${EXPENSES}?month=${LAST_MONTH}`);
    assertIncludes(
      page.html,
      monthLabel(LAST_MONTH_KEY.year, LAST_MONTH_KEY.month),
      "the month navigator",
    );
  });

  await check("a month with no records says so by name", async () => {
    // The month before the oldest expense: certain to be empty for this user.
    const emptyDate = new Date(olderDate.getFullYear(), olderDate.getMonth() - 1, 15);
    const emptyMonth = iso(emptyDate).slice(0, 7);
    const label = monthLabel(emptyDate.getFullYear(), emptyDate.getMonth() + 1);

    const page = await getPage(owner, `${EXPENSES}?month=${emptyMonth}`);
    assertRows(page.html, [], "an empty month");
    assertIncludes(page.html, `No expenses recorded for ${label}`, "the empty month");
  });

  await check("the month arrows carry the other filters across", async () => {
    const page = await getPage(owner, `${EXPENSES}?month=${THIS_MONTH}&paymentMode=cash`);
    assertRows(page.html, ["Airport taxi", "Odds and ends"], "a filtered month");
    assertIncludes(
      page.html,
      "paymentMode=cash&amp;month=",
      "the month navigator's links",
    );
  });

  await check("an explicit range wins over a month, and the navigator agrees", async () => {
    const page = await getPage(owner, `${EXPENSES}?month=${LAST_MONTH}&from=${LATE_DAY}`);
    assertRows(page.html, ["Airport taxi", "Odds and ends"], "a range beside a month");
    assertExcludes(
      page.html,
      monthLabel(LAST_MONTH_KEY.year, LAST_MONTH_KEY.month),
      "the scope navigator while a range is in force",
    );
  });

  await check("the dashboard links its month through to the list", async () => {
    const page = await getPage(owner, `/dashboard?month=${LAST_MONTH}`);
    assert(
      hasLink(page.html, `/expenses?month=${LAST_MONTH}`),
      "the dashboard did not link to its month's expenses",
    );
  });

  await check("clearing everything returns the whole list", async () => {
    const page = await getPage(owner, EXPENSES);
    assertRows(
      page.html,
      ["Weekly groceries", "Airport taxi", "Odds and ends", "Last month rent", "Ancient book"],
      "the cleared list",
    );
    assertIncludes(page.html, "All time", "the cleared scope navigator");
  });

  // -------------------------------------------------------------------------
  group("Paging a filtered list");

  await check("filters survive a page change", async () => {
    // 21 cash rows in one month: one more than a page holds.
    for (let index = 0; index < 21; index += 1) {
      await addPersonalExpense(mate, {
        itemName: `Bulk item ${String(index).padStart(2, "0")}`,
        amount: "10",
        paymentMode: "wallet",
        expenseDate: EARLY_DAY,
      });
    }
    await addPersonalExpense(mate, {
      itemName: "Not in the filter",
      amount: "10",
      paymentMode: "cash",
      expenseDate: EARLY_DAY,
    });

    const first = await getPage(mate, `${EXPENSES}?paymentMode=wallet`);
    assert(itemNames(first.html).length === 20, "the first page was not full");
    assertIncludes(summary(first.html), "21 matching expenses", "the summary line");

    const second = await getPage(mate, `${EXPENSES}?paymentMode=wallet&page=2`);
    const names = itemNames(second.html);
    assert(names.length === 1, `expected 1 row on page 2, got ${names.length}`);
    assertExcludes(names.join("|"), "Not in the filter", "page 2 of a filtered list");
  });

  await check("the next-page link keeps the filters", async () => {
    const page = await getPage(mate, `${EXPENSES}?paymentMode=wallet`);
    assert(
      page.html.includes("paymentMode=wallet&amp;page=2"),
      "the pagination link dropped the filter",
    );
  });

  // -------------------------------------------------------------------------
  group("Group lists");

  await check("a group is created and seeded with expenses from two members", async () => {
    const result = await submitForm(owner, "/groups/new", {
      include: ['name="name"'],
      values: { name: "Goa Trip 2026", description: "Shared costs", currencyCode: "EUR" },
    });
    groupId = result.redirect.replace("/groups/", "").split("?")[0];

    const { error } = await admin
      .from("group_members")
      .insert({ group_id: groupId, user_id: mate.id, role: "member" });
    assert(!error, error?.message);

    await addCategory(owner, `/groups/${groupId}/categories`, "Group Food");
    const categories = await categoriesOf(owner, { groupId });
    groupFoodId = findByName(categories, "Group Food").id;

    await addGroupExpense(owner, groupId, {
      itemName: "Beach dinner",
      amount: "120",
      category: groupFoodId,
      paymentMode: "upi",
      notes: "Sunset place",
      expenseDate: EARLY_DAY,
    });
    await addGroupExpense(mate, groupId, {
      itemName: "Boat tickets",
      amount: "200",
      paymentMode: "cash",
      expenseDate: LATE_DAY,
    });
    await addGroupExpense(owner, groupId, {
      itemName: "Old hotel deposit",
      amount: "300",
      paymentMode: "cash",
      expenseDate: LAST_MONTH_DAY,
    });

    const page = await getPage(owner, groupExpensesPath(groupId));
    assertRows(
      page.html,
      ["Beach dinner", "Boat tickets", "Old hotel deposit"],
      "the group's unfiltered list",
    );
  });

  await check("a group list searches names and notes too", async () => {
    const page = await getPage(mate, `${groupExpensesPath(groupId)}?q=sunset`);
    assertRows(page.html, ["Beach dinner"], "a group search on the notes");
  });

  await check("the Paid by filter keeps only that member's expenses", async () => {
    const page = await getPage(mate, `${groupExpensesPath(groupId)}?paidBy=${mate.id}`);
    assertRows(page.html, ["Boat tickets"], "a filter on one member");
  });

  await check("a group list offers a Paid by control listing the members", async () => {
    const page = await getPage(owner, groupExpensesPath(groupId));
    const form = findForm(page.html, ['name="q"']);
    assertIncludes(form, 'name="paidBy"', "the group filter bar");
    assertIncludes(form, mate.name, "the group filter bar");
  });

  await check("a group list scopes to a month and totals in the group's currency", async () => {
    const page = await getPage(owner, `${groupExpensesPath(groupId)}?month=${LAST_MONTH}`);
    assertRows(page.html, ["Old hotel deposit"], "the group's last month");
    assertIncludes(summary(page.html), eur(300), "the group summary line");
  });

  await check("a group's date range filter behaves like the personal one", async () => {
    const page = await getPage(mate, `${groupExpensesPath(groupId)}?from=${LATE_DAY}`);
    assertRows(page.html, ["Boat tickets"], "a group date range");
  });

  await check("the group dashboard links its month through to the group's list", async () => {
    const page = await getPage(owner, `/groups/${groupId}/dashboard?month=${LAST_MONTH}`);
    assert(
      hasLink(page.html, `/groups/${groupId}/expenses?month=${LAST_MONTH}`),
      "the group dashboard did not link to its month's expenses",
    );
  });

  // -------------------------------------------------------------------------
  group("A filter narrows, it never widens");

  await check("no filter shows another user their neighbour's personal expenses", async () => {
    for (const query of [
      "",
      "?q=groceries",
      "?category=none",
      "?paymentMode=cash",
      `?month=${THIS_MONTH}`,
      `?from=${OLDER_DAY}&to=${LATE_DAY}`,
      `?paidBy=${owner.id}`,
    ]) {
      const page = await getPage(stranger, `${EXPENSES}${query}`);
      assertRows(page.html, [], `the stranger's list with ${JSON.stringify(query)}`);
    }
  });

  await check("a non-member cannot reach a group's filtered list", async () => {
    const page = await getPage(stranger, `${groupExpensesPath(groupId)}?q=dinner`);
    assert(
      page.raw.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
      "a non-member was shown a group's filtered list",
    );
  });

  await check("a filter cannot pull another user's rows out of PostgREST", async () => {
    const { data, error } = await stranger.db
      .from("expenses")
      .select("id, item_name")
      .ilike("item_name", "%groceries%");
    assert(!error, error?.message);
    assert(data.length === 0, `a stranger read ${data.length} rows by searching for them`);
  });

  await check("a non-member cannot filter a group's expenses in PostgREST either", async () => {
    const { data, error } = await stranger.db
      .from("expenses")
      .select("id")
      .eq("group_id", groupId)
      .eq("payment_mode", "cash");
    assert(!error, error?.message);
    assert(data.length === 0, `a non-member read ${data.length} of a group's rows`);
  });

  await check("a member filtering their group sees the group, not their own money", async () => {
    const page = await getPage(mate, `${groupExpensesPath(groupId)}?paymentMode=wallet`);
    assertRows(page.html, [], "a group filter that matches only personal rows");
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
