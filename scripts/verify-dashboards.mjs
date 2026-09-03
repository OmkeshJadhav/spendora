#!/usr/bin/env node
/**
 * End-to-end test suite for Phase 8, the personal and group dashboards.
 *
 * Two surfaces are exercised, because both are real:
 *
 *   1. The running application over HTTP, as a signed-in browser would use it.
 *      Expenses, categories and budgets are created by submitting the *actual
 *      forms* — hidden Server Action fields and all, the no-JavaScript path —
 *      and every dashboard figure is then read back off the rendered page. So
 *      what is asserted is what a person would see, arithmetic and all.
 *
 *   2. PostgREST directly, with each user's own JWT. That is what somebody
 *      reaches when they skip the UI, so the claim that a dashboard shows
 *      nobody else's money is proved against the database rather than by the
 *      absence of a link.
 *
 *   npm run dev              (in another terminal)
 *   npm run verify:dashboards
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

/** A chart's shortened label, formatted exactly as the application formats it. */
const compactInr = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(amount);

const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const monthLabel = (year, month) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );

const now = new Date();
const TODAY = iso(now);
const THIS_MONTH_KEY = { year: now.getFullYear(), month: now.getMonth() + 1 };
const THIS_MONTH = TODAY.slice(0, 7);

// The 15th, so the day exists in every month and no timezone can move it out
// of the month it was chosen for.
const shiftMonths = (delta) => new Date(now.getFullYear(), now.getMonth() + delta, 15);

const lastMonthDate = shiftMonths(-1);
const LAST_MONTH_DAY = iso(lastMonthDate);
const LAST_MONTH = LAST_MONTH_DAY.slice(0, 7);
const LAST_MONTH_KEY = {
  year: lastMonthDate.getFullYear(),
  month: lastMonthDate.getMonth() + 1,
};

// Outside the six-month trend window, to prove the window is bounded.
const oldDate = shiftMonths(-8);
const OLD_DAY = iso(oldDate);
const OLD_MONTH = OLD_DAY.slice(0, 7);

/** Days of the current month that have happened — what "average daily" divides by. */
const ELAPSED_DAYS = now.getDate();

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

/** A value as React writes it into HTML. */
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
  // A Server Action that redirects answers with a header, not a document. The
  // embedded fallback covers the streamed case, where the destination arrives
  // inside the RSC payload instead.
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

const DASHBOARD = "/dashboard";
const groupDashboardPath = (groupId) => `/groups/${groupId}/dashboard`;
const groupCategoriesPath = (groupId) => `/groups/${groupId}/categories`;

function addCategory(user, path, name) {
  return submitForm(user, path, {
    include: ['name="name"', 'placeholder="Weekend trips"'],
    values: { name },
  });
}

function setBudget(user, path, categoryId, amount) {
  return submitForm(user, path, {
    include: ['name="amount"', `value="${categoryId}"`],
    values: { amount },
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
// Reading figures back off a rendered dashboard
// ---------------------------------------------------------------------------

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

/** The stat card carrying a given title, so a figure is read from its own card. */
function statCard(html, title) {
  const marker = `>${escapeHtml(title)}</p>`;
  const start = html.indexOf(marker);
  assert(start !== -1, `no stat card titled ${JSON.stringify(title)}`);

  const from = html.lastIndexOf("<div", html.lastIndexOf("<div", start));
  const to = html.indexOf("</div></div>", start);
  assert(from !== -1 && to !== -1, `malformed stat card for ${JSON.stringify(title)}`);

  return html.slice(from, to);
}

/**
 * The `<li>` a bar-list row is rendered in, found by its visible label.
 *
 * The row must contain a bar. An expense row also carries its category name —
 * in a badge — so matching on the name alone found the recent-expenses list
 * and reported a category as present in a breakdown it was absent from.
 */
const BAR_MARKER = 'class="mt-1.5 h-2 w-full';

function barRow(html, label) {
  const marker = `>${escapeHtml(label)}</span>`;
  let start = html.indexOf(marker);

  while (start !== -1) {
    const from = html.lastIndexOf("<li", start);
    const to = html.indexOf("</li>", start);

    if (from !== -1 && to !== -1) {
      const row = html.slice(from, to);
      if (row.includes(BAR_MARKER)) return row;
    }

    start = html.indexOf(marker, start + 1);
  }

  throw new Error(`no bar-list row labelled ${JSON.stringify(label)}`);
}

function hasBarRow(html, label) {
  try {
    barRow(html, label);
    return true;
  } catch {
    return false;
  }
}

/** The `<tr>` of the budget-vs-actual table for a given category. */
function budgetRow(html, name) {
  const marker = `>${escapeHtml(name)}`;
  const heads = [...html.matchAll(/<th scope="row"[^>]*>/g)];

  for (const head of heads) {
    const to = html.indexOf("</tr>", head.index);
    const from = html.lastIndexOf("<tr", head.index);
    const row = html.slice(from, to);
    if (row.includes(marker)) return row;
  }

  throw new Error(`no budget table row for ${JSON.stringify(name)}`);
}

/**
 * The `<li>` one column of the trend chart is rendered in.
 *
 * Anchored on the column's own `title`, which is unique to the chart, rather
 * than on its href: the month navigator's back arrow links to the previous
 * month too, sits earlier in the document and is not inside any `<li>` — so
 * searching backwards from it ran past the navigator and into whichever column
 * came first, and measured that one instead.
 */
function column(html, year, month, basePath) {
  const marker = `title="${escapeHtml(monthLabel(year, month))}: `;
  const start = html.indexOf(marker);
  assert(start !== -1, `no trend column for ${monthLabel(year, month)}`);

  // The nearest preceding `<li` is this column's own, because the previous
  // column closed before it.
  const from = html.lastIndexOf("<li", start);
  const to = html.indexOf("</li>", start);
  assert(from !== -1 && to !== -1, `malformed trend column for ${monthLabel(year, month)}`);

  const fragment = html.slice(from, to);
  assertIncludes(fragment, basePath, `the ${monthLabel(year, month)} column`);

  return fragment;
}

/** Percentage height of a column's bar, as the chart wrote it into the style. */
function columnHeight(fragment) {
  const match = fragment.match(/height:\s*([0-9.]+)%/);
  assert(match, "no column height in this fragment");
  return Number(match[1]);
}

/** Percentage width of a bar's fill, as the chart wrote it into the style. */
function barWidth(fragment) {
  const match = fragment.match(/width:\s*([0-9.]+)%/);
  assert(match, "no bar width in this fragment");
  return Number(match[1]);
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

  const owner = await createUser("downer", "Ada Owner");
  const mate = await createUser("dmate", "Rahul Mate");
  const stranger = await createUser("dstranger", "Grace Stranger");

  let groupId = "";
  let otherGroupId = "";

  // -------------------------------------------------------------------------
  group("Empty states");

  await check("a new user's dashboard offers a first expense rather than a blank page", async () => {
    const page = await getPage(owner, DASHBOARD);
    assert(page.status === 200, `GET ${DASHBOARD} returned ${page.status}`);
    assertIncludes(page.html, "No expenses yet", "the empty dashboard");
    assertIncludes(page.html, "/expenses/new", "the empty dashboard");
  });

  await check("the empty dashboard shows no figures it cannot have", async () => {
    const page = await getPage(owner, DASHBOARD);
    assertExcludes(page.html, "Average daily", "the empty dashboard");
    assertExcludes(page.html, "Budget vs actual", "the empty dashboard");
  });

  await check("the dashboard names the month it is showing", async () => {
    const page = await getPage(owner, DASHBOARD);
    assertIncludes(
      page.html,
      monthLabel(THIS_MONTH_KEY.year, THIS_MONTH_KEY.month),
      "the dashboard heading",
    );
  });

  // -------------------------------------------------------------------------
  group("Monthly summary");

  let foodId = "";
  let travelId = "";

  await check("expenses are recorded across two categories and two months", async () => {
    await addCategory(owner, "/categories", "Food");
    await addCategory(owner, "/categories", "Travel");

    const categories = await categoriesOf(owner, { userId: owner.id });
    foodId = findByName(categories, "Food").id;
    travelId = findByName(categories, "Travel").id;

    // This month: 6,200 food + 1,800 travel + 500 uncategorised = 8,500.
    await addPersonalExpense(owner, { itemName: "Groceries", amount: "5000", category: foodId });
    await addPersonalExpense(owner, { itemName: "Restaurant", amount: "1200", category: foodId });
    await addPersonalExpense(owner, { itemName: "Taxi", amount: "1800", category: travelId });
    await addPersonalExpense(owner, { itemName: "Odds and ends", amount: "500" });

    // Last month, and one outside the six-month trend window.
    await addPersonalExpense(owner, {
      itemName: "Old groceries",
      amount: "3000",
      category: foodId,
      expenseDate: LAST_MONTH_DAY,
    });
    await addPersonalExpense(owner, {
      itemName: "Ancient history",
      amount: "999",
      category: foodId,
      expenseDate: OLD_DAY,
    });

    const { data, error } = await owner.db
      .from("expenses")
      .select("id")
      .eq("user_id", owner.id)
      .is("group_id", null);
    assert(!error, error?.message);
    assert(data.length === 6, `expected 6 personal expenses, found ${data.length}`);
  });

  await check("the total spent is this month's expenses only", async () => {
    const page = await getPage(owner, DASHBOARD);
    assertIncludes(statCard(page.html, "Spent"), inr(8500), "the spent card");
  });

  await check("the expense count is this month's expenses only", async () => {
    const page = await getPage(owner, DASHBOARD);
    assertIncludes(statCard(page.html, "Expenses"), ">4</p>", "the expense count card");
  });

  await check("average daily divides by the days elapsed so far", async () => {
    const page = await getPage(owner, DASHBOARD);
    const expected = inr(Math.round((8500 * 100) / ELAPSED_DAYS) / 100);
    assertIncludes(statCard(page.html, "Average daily"), expected, "the average daily card");
  });

  await check("with no budget set, the remaining card says so rather than showing zero", async () => {
    const page = await getPage(owner, DASHBOARD);
    const card = statCard(page.html, "Remaining");
    assertIncludes(card, "No budget", "the remaining card");
    assertExcludes(card, inr(0), "the remaining card");
  });

  // -------------------------------------------------------------------------
  group("Category breakdown");

  await check("each category shows its own total", async () => {
    const page = await getPage(owner, DASHBOARD);
    assertIncludes(barRow(page.html, "Food"), inr(6200), "the Food row");
    assertIncludes(barRow(page.html, "Travel"), inr(1800), "the Travel row");
  });

  await check("shares are of the month's spending and are shown as text", async () => {
    const page = await getPage(owner, DASHBOARD);
    // 6,200 / 8,500 = 73%; 1,800 / 8,500 = 21%; 500 / 8,500 = 6%.
    assertIncludes(barRow(page.html, "Food"), ">73%</span>", "the Food row");
    assertIncludes(barRow(page.html, "Travel"), ">21%</span>", "the Travel row");
    assertIncludes(barRow(page.html, "Uncategorised"), ">6%</span>", "the uncategorised row");
  });

  await check("spending with no category is a row of its own, so the parts add up", async () => {
    const page = await getPage(owner, DASHBOARD);
    assertIncludes(barRow(page.html, "Uncategorised"), inr(500), "the uncategorised row");
  });

  await check("bars are scaled against the largest, not against the total", async () => {
    const page = await getPage(owner, DASHBOARD);
    assert(
      barWidth(barRow(page.html, "Food")) === 100,
      "the largest category's bar should be full width",
    );
    const travel = barWidth(barRow(page.html, "Travel"));
    // 1,800 / 6,200 = 29%.
    assert(
      Math.abs(travel - 29) < 1,
      `the Travel bar should be about 29% of the width, got ${travel}%`,
    );
  });

  await check("a category with nothing spent in it is left off the breakdown", async () => {
    await addCategory(owner, "/categories", "Unused");
    const page = await getPage(owner, DASHBOARD);
    assert(!hasBarRow(page.html, "Unused"), "an unspent category appeared in the breakdown");
  });

  // -------------------------------------------------------------------------
  group("Monthly expenditure");

  await check("the trend covers six months, ending with the one in view", async () => {
    const page = await getPage(owner, DASHBOARD);
    for (let delta = 0; delta < 6; delta += 1) {
      const date = shiftMonths(-delta);
      const label = monthLabel(date.getFullYear(), date.getMonth() + 1);
      assertIncludes(page.html, label, "the trend");
    }
  });

  await check("each column links to its own month", async () => {
    const page = await getPage(owner, DASHBOARD);
    // Read through `column`, so this proves the chart's own links rather than
    // the month navigator's arrows, which point at neighbouring months too.
    for (const [key, month] of [
      [THIS_MONTH, THIS_MONTH_KEY],
      [LAST_MONTH, LAST_MONTH_KEY],
    ]) {
      assertIncludes(
        column(page.html, month.year, month.month, DASHBOARD),
        `href="${DASHBOARD}?month=${key}"`,
        `the ${key} column`,
      );
    }
  });

  await check("a month outside the window is not counted in it", async () => {
    const page = await getPage(owner, DASHBOARD);
    assertExcludes(page.html, `${DASHBOARD}?month=${OLD_MONTH}`, "the trend");
  });

  await check("column heights are proportional to their months", async () => {
    const page = await getPage(owner, DASHBOARD);

    const tallest = columnHeight(
      column(page.html, THIS_MONTH_KEY.year, THIS_MONTH_KEY.month, DASHBOARD),
    );
    const shorter = columnHeight(
      column(page.html, LAST_MONTH_KEY.year, LAST_MONTH_KEY.month, DASHBOARD),
    );

    assert(tallest === 100, `this month is the peak and should be full height, got ${tallest}%`);
    // 3,000 / 8,500 = 35%.
    assert(
      Math.abs(shorter - 35) < 1,
      `last month should be about 35% as tall, got ${shorter}%`,
    );
  });

  await check("a column's value label is shortened, with no trailing zero", async () => {
    // Last month is the selected column in this view, so it carries a label.
    const page = await getPage(owner, `${DASHBOARD}?month=${LAST_MONTH}`);
    const selected = column(
      page.html,
      LAST_MONTH_KEY.year,
      LAST_MONTH_KEY.month,
      DASHBOARD,
    );

    // 3,000 shortens to "₹3K". Currency formatting defaults to two decimal
    // places and a maximum below that clamps the *minimum* up to it rather
    // than allowing none, so the obvious options render "₹3.0K" — and, worse,
    // "₹150.0" for anything under a thousand.
    assertIncludes(
      selected,
      `>${compactInr(3000)}</span>`,
      "the selected column's label",
    );
    assertExcludes(selected, ">₹3.0K</span>", "the selected column's label");
  });

  await check("every column states its month and exact amount as text", async () => {
    const page = await getPage(owner, DASHBOARD);
    const label = monthLabel(LAST_MONTH_KEY.year, LAST_MONTH_KEY.month);
    assertIncludes(page.html, `${label}: ${inr(3000)}`, "the trend");
  });

  // -------------------------------------------------------------------------
  group("Historical months");

  await check("choosing a past month moves every figure to it", async () => {
    const page = await getPage(owner, `${DASHBOARD}?month=${LAST_MONTH}`);
    assert(page.status === 200, `GET last month returned ${page.status}`);

    assertIncludes(
      page.html,
      monthLabel(LAST_MONTH_KEY.year, LAST_MONTH_KEY.month),
      "last month's dashboard",
    );
    assertIncludes(statCard(page.html, "Spent"), inr(3000), "last month's spent card");
    assertIncludes(statCard(page.html, "Expenses"), ">1</p>", "last month's count card");
    assertIncludes(barRow(page.html, "Food"), inr(3000), "last month's Food row");
    assert(
      !hasBarRow(page.html, "Travel"),
      "a category with nothing spent last month appeared in last month's breakdown",
    );
  });

  await check("a completed month divides by its whole length, not by today", async () => {
    const page = await getPage(owner, `${DASHBOARD}?month=${LAST_MONTH}`);
    const days = new Date(LAST_MONTH_KEY.year, LAST_MONTH_KEY.month, 0).getDate();
    const expected = inr(Math.round((3000 * 100) / days) / 100);
    assertIncludes(statCard(page.html, "Average daily"), expected, "last month's average card");
  });

  await check("a month with no expenses says so rather than showing a first-run page", async () => {
    const empty = iso(shiftMonths(-3)).slice(0, 7);
    const page = await getPage(owner, `${DASHBOARD}?month=${empty}`);

    assertIncludes(statCard(page.html, "Spent"), inr(0), "an empty month's spent card");
    assertExcludes(page.html, "No expenses yet", "an empty month");
    // The trend is still shown, because the point of it is the months around.
    assertIncludes(page.html, "Monthly expenditure", "an empty month");
  });

  await check("a nonsense month falls back to the current one", async () => {
    for (const value of ["banana", "2026-13", "1998-01", ""]) {
      const page = await getPage(owner, `${DASHBOARD}?month=${encodeURIComponent(value)}`);
      assert(page.status === 200, `GET ?month=${value} returned ${page.status}`);
      assertIncludes(
        page.html,
        monthLabel(THIS_MONTH_KEY.year, THIS_MONTH_KEY.month),
        `?month=${value}`,
      );
    }
  });

  // -------------------------------------------------------------------------
  group("Budget vs actual on the dashboard");

  await check("a budgeted category reports budget, spent, remaining and percentage", async () => {
    await setBudget(owner, "/categories", foodId, "8000");

    const page = await getPage(owner, DASHBOARD);
    const row = budgetRow(page.html, "Food");

    assertIncludes(row, inr(8000), "the Food budget cell");
    assertIncludes(row, inr(6200), "the Food spent cell");
    assertIncludes(row, inr(1800), "the Food remaining cell");
    assertIncludes(row, ">78%</span>", "the Food utilisation cell");
  });

  await check("the summary totals the budgets that are set", async () => {
    const page = await getPage(owner, DASHBOARD);
    // 8,000 budgeted, 8,500 spent overall — over by 500, and the card says so.
    const card = statCard(page.html, "Over budget");
    assertIncludes(card, inr(500), "the over-budget card");
    assertIncludes(card, `of ${inr(8000)} budgeted`, "the over-budget card");
  });

  await check("status is stated in words, not only in colour", async () => {
    const page = await getPage(owner, DASHBOARD);
    // 6,200 of 8,000 rounds to 78% but is 77.5% exactly, which is below the
    // 80% warning threshold — the state is read from the amounts, not from the
    // rounded figure printed beside it.
    assertIncludes(budgetRow(page.html, "Food"), "On track", "the Food row");
  });

  await check("an overspent category is reported as an amount over", async () => {
    await setBudget(owner, "/categories", travelId, "1000");

    const page = await getPage(owner, DASHBOARD);
    const row = budgetRow(page.html, "Travel");

    assertIncludes(row, "Over budget", "the Travel row");
    assertIncludes(row, `−${inr(800)}`, "the Travel remaining cell");
    assertIncludes(row, ">180%</span>", "the Travel utilisation cell");
  });

  await check("spending no budget covers is called out rather than hidden", async () => {
    const page = await getPage(owner, DASHBOARD);
    assertIncludes(page.html, "was spent with no category", "the dashboard");
    assertIncludes(page.html, inr(500), "the uncovered-spending note");
  });

  await check("a category with neither a budget nor spending is left out of the table", async () => {
    const page = await getPage(owner, DASHBOARD);
    let found = true;
    try {
      budgetRow(page.html, "Unused");
    } catch {
      found = false;
    }
    assert(!found, "an unbudgeted, unspent category appeared in the budget table");
  });

  // -------------------------------------------------------------------------
  group("Group dashboard");

  let groupFoodId = "";

  await check("an admin creates a group, a category and a budget", async () => {
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

    await setBudget(owner, groupCategoriesPath(groupId), groupFoodId, "500");
  });

  await check("a second member joins and both record expenses", async () => {
    // Seated directly: the invitation flow is Phase 5's to prove.
    const { error } = await admin
      .from("group_members")
      .insert({ group_id: groupId, user_id: mate.id, role: "member" });
    assert(!error, `could not seat the member: ${error?.message}`);

    await addGroupExpense(owner, groupId, {
      itemName: "Shack lunch",
      amount: "300",
      category: groupFoodId,
    });
    await addGroupExpense(mate, groupId, {
      itemName: "Dinner",
      amount: "200",
      category: groupFoodId,
    });
    // Recorded by the admin, but paid by the member — attribution follows
    // "Paid by", not who typed it in.
    await addGroupExpense(owner, groupId, {
      itemName: "Boat trip",
      amount: "100",
      paidBy: mate.id,
    });
  });

  await check("the group dashboard totals the group's spending in the group's currency", async () => {
    const page = await getPage(owner, groupDashboardPath(groupId));
    assert(page.status === 200, `GET the group dashboard returned ${page.status}`);

    assertIncludes(statCard(page.html, "Spent"), eur(600), "the group spent card");
    assertIncludes(statCard(page.html, "Expenses"), ">3</p>", "the group count card");
    // The group's currency, not the personal default.
    assertExcludes(statCard(page.html, "Spent"), "₹", "the group spent card");
  });

  await check("the group's monthly summary states budget, spent and remaining", async () => {
    const page = await getPage(owner, groupDashboardPath(groupId));
    assertIncludes(page.html, `${eur(600)} of ${eur(500)}`, "the group summary line");
    assertIncludes(page.html, "Over budget", "the group summary");
    assertIncludes(statCard(page.html, "Over budget"), eur(100), "the group remaining card");
  });

  await check("member spending is attributed to who paid, not to who recorded it", async () => {
    const page = await getPage(owner, groupDashboardPath(groupId));

    // Ada recorded all but one; Rahul paid for 200 + 100 = 300.
    assertIncludes(barRow(page.html, `${owner.name} (You)`), eur(300), "the admin's member row");
    assertIncludes(barRow(page.html, mate.name), eur(300), "the member's row");
  });

  await check("each member's share of the group's spending is shown", async () => {
    const page = await getPage(owner, groupDashboardPath(groupId));
    assertIncludes(barRow(page.html, `${owner.name} (You)`), ">50%</span>", "the admin's row");
    assertIncludes(barRow(page.html, mate.name), ">50%</span>", "the member's row");
  });

  await check("the signed-in user's own row is labelled, not only shaded", async () => {
    const page = await getPage(mate, groupDashboardPath(groupId));
    assertIncludes(page.html, `${mate.name} (You)`, "the member's view of the dashboard");
    assertExcludes(page.html, `${owner.name} (You)`, "the member's view of the dashboard");
  });

  await check("a member who has paid nothing is still listed, at zero", async () => {
    const { error } = await admin
      .from("group_members")
      .insert({ group_id: groupId, user_id: stranger.id, role: "member" });
    assert(!error, `could not seat the third member: ${error?.message}`);

    const page = await getPage(owner, groupDashboardPath(groupId));
    const row = barRow(page.html, stranger.name);
    assertIncludes(row, eur(0), "the non-paying member's row");
    assertIncludes(row, "Nothing paid this month", "the non-paying member's row");

    await admin
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", stranger.id);
  });

  await check("a member sees the whole dashboard, and is told budgets are read-only", async () => {
    const page = await getPage(mate, groupDashboardPath(groupId));
    assert(page.status === 200, `a member got ${page.status} for the group dashboard`);

    assertIncludes(statCard(page.html, "Spent"), eur(600), "the member's spent card");
    assertIncludes(page.html, "Spending by member", "the member's dashboard");
    assertIncludes(page.html, "View budgets", "the member's dashboard");
    assertExcludes(page.html, "Set budgets", "the member's dashboard");
  });

  await check("an admin is offered the budget controls", async () => {
    const page = await getPage(owner, groupDashboardPath(groupId));
    assertIncludes(page.html, "Set budgets", "the admin's dashboard");
  });

  await check("the group dashboard is reachable from the group's other pages", async () => {
    for (const path of [`/groups/${groupId}`, groupCategoriesPath(groupId), `/groups/${groupId}/expenses`]) {
      const page = await getPage(owner, path);
      assertIncludes(page.html, groupDashboardPath(groupId), `the links on ${path}`);
    }
  });

  await check("a past group month is reached the same way as a personal one", async () => {
    await addGroupExpense(owner, groupId, {
      itemName: "Deposit",
      amount: "150",
      category: groupFoodId,
      expenseDate: LAST_MONTH_DAY,
    });

    const page = await getPage(owner, `${groupDashboardPath(groupId)}?month=${LAST_MONTH}`);
    assertIncludes(statCard(page.html, "Spent"), eur(150), "last month's group spent card");
    assertIncludes(statCard(page.html, "Expenses"), ">1</p>", "last month's group count card");
  });

  // -------------------------------------------------------------------------
  group("Authorization, proved against the database");

  await check("a non-member gets a not-found for the group dashboard", async () => {
    const page = await getPage(stranger, groupDashboardPath(groupId));
    assertNotFound(page, "a stranger's request for the group dashboard");
  });

  await check("a signed-out visitor is sent to sign in", async () => {
    const page = await getPage(null, groupDashboardPath(groupId));
    assert(
      page.status === 307 || page.status === 302,
      `expected a redirect, got ${page.status}`,
    );
    assert(page.location?.includes("/sign-in"), `expected /sign-in, got ${page.location}`);
  });

  await check("a stranger's own dashboard shows none of the owner's money", async () => {
    const page = await getPage(stranger, DASHBOARD);
    assertIncludes(page.html, "No expenses yet", "the stranger's dashboard");
    assertExcludes(page.html, inr(8500), "the stranger's dashboard");
    assertExcludes(page.html, "Groceries", "the stranger's dashboard");
  });

  await check("a stranger cannot read the owner's expenses through the API", async () => {
    const { data, error } = await stranger.db
      .from("expenses")
      .select("amount")
      .eq("user_id", owner.id);
    assert(!error, error?.message);
    assert(data.length === 0, `a stranger read ${data.length} of somebody else's expenses`);
  });

  await check("a stranger cannot read the group's expenses through the API", async () => {
    const { data, error } = await stranger.db
      .from("expenses")
      .select("amount, paid_by")
      .eq("group_id", groupId);
    assert(!error, error?.message);
    assert(data.length === 0, `a non-member read ${data.length} of a group's expenses`);
  });

  await check("a stranger cannot read the group's budgets through the API", async () => {
    const { data, error } = await stranger.db
      .from("budgets")
      .select("amount")
      .eq("group_id", groupId);
    assert(!error, error?.message);
    assert(data.length === 0, `a non-member read ${data.length} of a group's budgets`);
  });

  await check("a group's expenses never count towards a personal dashboard", async () => {
    const page = await getPage(owner, DASHBOARD);
    // The personal total is unchanged by everything spent in the group.
    assertIncludes(statCard(page.html, "Spent"), inr(8500), "the personal spent card");
    assert(!hasBarRow(page.html, "Beach food"), "a group category appeared on the personal dashboard");
  });

  await check("a personal expense never counts towards a group dashboard", async () => {
    const page = await getPage(owner, groupDashboardPath(groupId));
    assertIncludes(statCard(page.html, "Spent"), eur(600), "the group spent card");
    assert(!hasBarRow(page.html, "Food"), "a personal category appeared on the group dashboard");
  });

  await check("one group's figures never appear on another's dashboard", async () => {
    const result = await submitForm(stranger, "/groups/new", {
      include: ['name="name"'],
      values: { name: "Someone Else's Group", description: "", currencyCode: "INR" },
    });
    otherGroupId = result.redirect.replace("/groups/", "").split("?")[0];

    await addGroupExpense(stranger, otherGroupId, { itemName: "Private lunch", amount: "77" });

    const page = await getPage(stranger, groupDashboardPath(otherGroupId));
    assertIncludes(statCard(page.html, "Spent"), inr(77), "the other group's spent card");
    assertExcludes(page.html, eur(600), "the other group's dashboard");
    assertExcludes(page.html, owner.name, "the other group's dashboard");
  });

  await check("a member cannot set a budget the dashboard shows them", async () => {
    const { error } = await mate.db
      .from("budgets")
      .insert({ group_id: groupId, category_id: groupFoodId, amount: 999, period_month: null });
    assert(error, "a member was allowed to create a group budget");
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
