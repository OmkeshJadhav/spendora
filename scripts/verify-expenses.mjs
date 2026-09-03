#!/usr/bin/env node
/**
 * End-to-end test suite for Phase 4, personal expense tracking.
 *
 * Everything here goes through the running application over HTTP, as a signed-in
 * browser would: pages are fetched with a real Supabase session cookie, and
 * expenses are created, edited and deleted by submitting the actual forms —
 * hidden Server Action fields and all. That is the no-JavaScript path, so it
 * exercises the Server Actions themselves rather than a re-implementation of
 * them.
 *
 *   npm run dev                       (in another terminal)
 *   node scripts/verify-expenses.mjs  (or: npm run verify:expenses)
 *
 * Needs, in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY   — used only to create and delete the two
 *                                 throwaway accounts. Never read by the app.
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
// Users and sessions
// ---------------------------------------------------------------------------

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const users = [];

/**
 * A throwaway account plus a cookie jar holding its real session.
 *
 * The jar is filled by `@supabase/ssr` itself, so the cookies are byte-for-byte
 * what a browser would hold — no guessing at the storage format.
 */
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
 * React writes `<!-- -->` between adjacent text nodes, so "Welcome, {name}"
 * arrives as "Welcome, <!-- -->Ada". Strip those before matching copy.
 */
function readable(html) {
  return html.replaceAll("<!-- -->", "");
}

async function getPage(user, path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { cookie: cookieHeader(user) },
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
 * True when a route resolved to `notFound()`.
 *
 * The status line cannot be used: Next streams the document shell (and its
 * metadata) before the page finishes, so the 200 is already committed by the
 * time the 404 is thrown. What it does emit is the error-fallback marker and a
 * `noindex` robots tag, which is what this checks — along with the thing that
 * actually matters, that none of the record was rendered.
 */
function assertNotFound(page, what) {
  assert(
    page.raw.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
    `${what}: expected a not-found result, got a rendered page`,
  );
  assert(
    page.raw.includes('name="robots" content="noindex"'),
    `${what}: expected the not-found response to be marked noindex`,
  );
  assert(
    !page.raw.includes('name="itemName"'),
    `${what}: the expense form was rendered anyway`,
  );
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

/** The `<form>` on the page that contains a control with this name. */
function findForm(html, marker) {
  const forms = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find((candidate) => candidate.includes(`name="${marker}"`));
  assert(form, `no form containing a field named ${marker}`);
  return form;
}

/**
 * The hidden inputs Next renders so a form works without JavaScript. They
 * identify the Server Action and carry its bound arguments.
 */
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
 * Returns the redirect the action produced, if any — which is how the flash
 * message and the destination are asserted.
 */
async function submitForm(user, path, marker, values) {
  const page = await getPage(user, path);
  assert(page.status === 200, `GET ${path} returned ${page.status}`);

  const form = findForm(page.html, marker);
  const body = new FormData();

  for (const [name, value] of hiddenFields(form)) body.append(name, value);
  for (const [name, value] of Object.entries(values)) body.append(name, value);

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { cookie: cookieHeader(user) },
    body,
    redirect: "manual",
  });

  const text = await response.text();
  // A no-JS action response carries the redirect as a header on a 303, or
  // inside the RSC payload when Next answers 200.
  const header = response.headers.get("location") ?? response.headers.get("x-action-redirect");
  const embedded = text.match(/"(\/[a-z0-9/[\]-]*\?flash=[a-z-]+)"/i)?.[1];

  return { status: response.status, redirect: header ?? embedded ?? null, text };
}

/** Convenience: submit the add-expense form. */
function addExpense(user, values) {
  return submitForm(user, "/expenses/new", "itemName", {
    itemName: "",
    amount: "",
    expenseDate: "",
    category: "",
    newCategoryName: "",
    paymentMode: "",
    notes: "",
    ...values,
  });
}

async function expensesOf(user) {
  const { data, error } = await user.db
    .from("expenses")
    .select("id, item_name, amount, expense_date, payment_mode, notes, category_id, currency_code, paid_by, user_id, group_id")
    .is("group_id", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

async function categoriesOf(user) {
  const { data, error } = await user.db.from("categories").select("id, name, is_archived");
  if (error) throw new Error(error.message);
  return data;
}

const today = new Date();
const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const TODAY = iso(today);

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

async function run() {
  const probe = await fetch(`${BASE_URL}/sign-in`, { redirect: "manual" }).catch(() => null);
  if (!probe) {
    console.error(`No application at ${BASE_URL}. Start it with: npm run dev`);
    process.exit(1);
  }

  const owner = await createUser("owner", "Ada Owner");
  const other = await createUser("other", "Grace Other");

  // -------------------------------------------------------------------------
  group("Empty states");

  await check("a new user's expense list invites a first expense", async () => {
    const page = await getPage(owner, "/expenses");
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, "No expenses yet", "expense list");
    assertIncludes(page.html, "Add expense", "expense list");
  });

  await check("a new user's dashboard is not blank", async () => {
    const page = await getPage(owner, "/dashboard");
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, "No expenses yet", "dashboard");
    assertIncludes(page.html, "Welcome, Ada Owner", "dashboard");
  });

  // -------------------------------------------------------------------------
  group("Creating an expense");

  await check("the form saves an expense and redirects with a flash", async () => {
    const result = await addExpense(owner, {
      itemName: "Groceries",
      amount: "2450.50",
      expenseDate: TODAY,
      category: "name:Groceries",
      paymentMode: "upi",
      notes: "Weekly shopping",
    });
    assert(
      result.redirect === "/expenses?flash=expense-created",
      `redirected to ${result.redirect}`,
    );
  });

  await check("every field was stored, with the right owner and currency", async () => {
    const [expense] = await expensesOf(owner);
    assert(expense, "no expense was stored");
    assert(expense.item_name === "Groceries", `item_name ${expense.item_name}`);
    assert(Number(expense.amount) === 2450.5, `amount ${expense.amount}`);
    assert(expense.expense_date === TODAY, `expense_date ${expense.expense_date}`);
    assert(expense.payment_mode === "upi", `payment_mode ${expense.payment_mode}`);
    assert(expense.notes === "Weekly shopping", `notes ${expense.notes}`);
    assert(expense.currency_code === "INR", `currency ${expense.currency_code}`);
    assert(expense.group_id === null, "group_id should be null for a personal expense");
    assert(expense.user_id === owner.id, "user_id is not the signed-in user");
    assert(expense.paid_by === owner.id, "paid_by is not the owner");
  });

  await check("choosing a suggested category creates it once", async () => {
    const categories = await categoriesOf(owner);
    const groceries = categories.filter((c) => c.name === "Groceries");
    assert(groceries.length === 1, `expected 1 Groceries category, got ${groceries.length}`);
  });

  await check("the expense appears on the list, fully rendered", async () => {
    const page = await getPage(owner, "/expenses");
    assertIncludes(page.html, "Groceries", "list");
    assertIncludes(page.html, "2,450.50", "list amount");
    assertIncludes(page.html, "UPI", "list payment mode");
    assertIncludes(page.html, "Weekly shopping", "list notes");
    assertIncludes(page.html, `id="day-${TODAY}"`, "list date grouping");
  });

  await check("the dashboard totals it", async () => {
    const page = await getPage(owner, "/dashboard");
    assertIncludes(page.html, "2,450.50", "dashboard total");
    // Phase 8 renamed this card from "Total spent" to "Spent", so the four
    // summary cards read as one row rather than one of them shouting.
    assertIncludes(page.html, "Spent", "dashboard");
    assertExcludes(page.html, "No expenses yet", "dashboard");
  });

  await check("a second expense reuses the existing category", async () => {
    await addExpense(owner, {
      itemName: "Fruit",
      amount: "120",
      expenseDate: TODAY,
      category: "name:Groceries",
    });
    const categories = await categoriesOf(owner);
    assert(
      categories.filter((c) => c.name === "Groceries").length === 1,
      "a duplicate category was created",
    );
  });

  await check("a category name is matched regardless of case", async () => {
    await addExpense(owner, {
      itemName: "Juice",
      amount: "60",
      expenseDate: TODAY,
      category: "__create__",
      newCategoryName: "  gROCERIES  ",
    });
    const categories = await categoriesOf(owner);
    assert(
      categories.filter((c) => c.name.trim().toLowerCase() === "groceries").length === 1,
      "case-different name created a second category",
    );
  });

  await check("a genuinely new category is created", async () => {
    await addExpense(owner, {
      itemName: "Cinema",
      amount: "300",
      expenseDate: TODAY,
      category: "__create__",
      newCategoryName: "Weekend trips",
    });
    const categories = await categoriesOf(owner);
    assert(
      categories.some((c) => c.name === "Weekend trips"),
      "the new category was not created",
    );
  });

  await check("an expense can be saved with no category and no payment mode", async () => {
    const result = await addExpense(owner, {
      itemName: "Misc",
      amount: "10",
      expenseDate: TODAY,
    });
    assert(result.redirect === "/expenses?flash=expense-created", `redirect ${result.redirect}`);
    const expenses = await expensesOf(owner);
    const misc = expenses.find((e) => e.item_name === "Misc");
    assert(misc.category_id === null, "category_id should be null");
    assert(misc.payment_mode === null, "payment_mode should be null");
  });

  // -------------------------------------------------------------------------
  group("Server-side validation");

  const countBefore = async () => (await expensesOf(owner)).length;

  async function rejects(name, values) {
    await check(name, async () => {
      const before = await countBefore();
      const result = await addExpense(owner, { expenseDate: TODAY, ...values });
      assert(result.redirect === null, `it was accepted and redirected to ${result.redirect}`);
      const after = await countBefore();
      assert(after === before, `an expense was created anyway (${before} -> ${after})`);
    });
  }

  await rejects("an empty item name is refused", { itemName: "", amount: "10" });
  await rejects("a blank item name is refused", { itemName: "   ", amount: "10" });
  await rejects("a missing amount is refused", { itemName: "X", amount: "" });
  await rejects("a zero amount is refused", { itemName: "X", amount: "0" });
  await rejects("a negative amount is refused", { itemName: "X", amount: "-50" });
  await rejects("a non-numeric amount is refused", { itemName: "X", amount: "abc" });
  await rejects("three decimal places are refused", { itemName: "X", amount: "10.999" });
  await rejects("an absurd amount is refused", { itemName: "X", amount: "999999999999999" });
  await rejects("a missing date is refused", { itemName: "X", amount: "10", expenseDate: "" });
  await rejects("a malformed date is refused", { itemName: "X", amount: "10", expenseDate: "31-09-2026" });
  await rejects("a date that does not exist is refused", { itemName: "X", amount: "10", expenseDate: "2026-02-31" });
  await rejects("a far-future date is refused", { itemName: "X", amount: "10", expenseDate: "2999-01-01" });
  await rejects("an item name over 120 characters is refused", { itemName: "x".repeat(121), amount: "10" });
  await rejects("notes over 500 characters are refused", { itemName: "X", amount: "10", notes: "x".repeat(501) });
  await rejects("a payment mode outside the list is refused", { itemName: "X", amount: "10", paymentMode: "bitcoin" });
  await rejects("creating a category with a blank name is refused", {
    itemName: "X",
    amount: "10",
    category: "__create__",
    newCategoryName: "   ",
  });

  await check("a category id belonging to another user is refused", async () => {
    await addExpense(other, {
      itemName: "Their lunch",
      amount: "99",
      expenseDate: TODAY,
      category: "__create__",
      newCategoryName: "Their category",
    });
    const theirs = (await categoriesOf(other)).find((c) => c.name === "Their category");
    assert(theirs, "the other user's category was not created");

    const before = await countBefore();
    const result = await addExpense(owner, {
      itemName: "Tampered",
      amount: "10",
      expenseDate: TODAY,
      category: theirs.id,
    });
    assert(result.redirect === null, "a foreign category id was accepted");
    assert((await countBefore()) === before, "an expense was created with a foreign category");
  });

  // -------------------------------------------------------------------------
  group("Editing");

  let target;

  await check("the edit page loads the expense's current values", async () => {
    target = (await expensesOf(owner)).find((e) => e.item_name === "Cinema");
    const page = await getPage(owner, `/expenses/${target.id}/edit`);
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, 'value="Cinema"', "edit form item name");
    assertIncludes(page.html, 'value="300.00"', "edit form amount");
    assertIncludes(page.html, "Weekend trips", "edit form category");
  });

  await check("saving changes updates the expense", async () => {
    const result = await submitForm(owner, `/expenses/${target.id}/edit`, "itemName", {
      itemName: "Cinema tickets",
      amount: "355.25",
      expenseDate: TODAY,
      category: "",
      newCategoryName: "",
      paymentMode: "cash",
      notes: "Two seats",
    });
    assert(
      result.redirect === "/expenses?flash=expense-updated",
      `redirected to ${result.redirect}`,
    );

    const updated = (await expensesOf(owner)).find((e) => e.id === target.id);
    assert(updated.item_name === "Cinema tickets", `item_name ${updated.item_name}`);
    assert(Number(updated.amount) === 355.25, `amount ${updated.amount}`);
    assert(updated.payment_mode === "cash", `payment_mode ${updated.payment_mode}`);
    assert(updated.notes === "Two seats", `notes ${updated.notes}`);
    assert(updated.category_id === null, "the category should have been cleared");
  });

  await check("an edit is rejected the same way a creation is", async () => {
    const result = await submitForm(owner, `/expenses/${target.id}/edit`, "itemName", {
      itemName: "Cinema tickets",
      amount: "-1",
      expenseDate: TODAY,
      category: "",
      newCategoryName: "",
      paymentMode: "",
      notes: "",
    });
    assert(result.redirect === null, "a negative amount was accepted on edit");
    const unchanged = (await expensesOf(owner)).find((e) => e.id === target.id);
    assert(Number(unchanged.amount) === 355.25, `amount became ${unchanged.amount}`);
  });

  await check("another user's expense cannot be opened for editing", async () => {
    const page = await getPage(other, `/expenses/${target.id}/edit`);
    assertNotFound(page, "another user's expense");
  });

  await check("an unknown expense id is a not-found, not an error", async () => {
    const page = await getPage(owner, "/expenses/00000000-0000-4000-8000-000000000000/edit");
    assertNotFound(page, "unknown expense id");
  });

  // -------------------------------------------------------------------------
  group("Deleting");

  await check("deleting removes the expense and flashes", async () => {
    const before = await expensesOf(owner);
    const result = await submitForm(owner, `/expenses/${target.id}/edit`, "id", {});
    assert(
      result.redirect === "/expenses?flash=expense-deleted",
      `redirected to ${result.redirect}`,
    );
    const after = await expensesOf(owner);
    assert(after.length === before.length - 1, `count ${before.length} -> ${after.length}`);
    assert(!after.some((e) => e.id === target.id), "the expense is still there");
  });

  await check("the deleted expense is gone from the list page", async () => {
    const page = await getPage(owner, "/expenses");
    assertExcludes(page.html, "Cinema tickets", "expense list");
  });

  // -------------------------------------------------------------------------
  group("Privacy");

  await check("another user's list does not show these expenses", async () => {
    const page = await getPage(other, "/expenses");
    assert(page.status === 200, `status ${page.status}`);
    assertExcludes(page.html, "Groceries", "other user's list");
    assertExcludes(page.html, "Weekly shopping", "other user's list");
    assertIncludes(page.html, "Their lunch", "other user's own expense");
  });

  await check("another user's dashboard totals only their own spending", async () => {
    const page = await getPage(other, "/dashboard");
    assertIncludes(page.html, "99.00", "other user's total");
    assertExcludes(page.html, "2,450.50", "other user's dashboard");
  });

  await check("signed-out visitors are sent to sign in", async () => {
    for (const path of ["/expenses", "/expenses/new", "/dashboard"]) {
      const response = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
      assert(response.status === 307, `${path} returned ${response.status}`);
      assert(
        (response.headers.get("location") ?? "").includes("/sign-in"),
        `${path} did not redirect to sign in`,
      );
    }
  });

  // -------------------------------------------------------------------------
  group("Money and dates");

  await check("fractional amounts total exactly, without float drift", async () => {
    const fresh = await createUser("money", "Pat Money");
    for (const amount of ["0.10", "0.20", "0.30", "70.07"]) {
      await addExpense(fresh, { itemName: `Item ${amount}`, amount, expenseDate: TODAY });
    }
    // 0.1 + 0.2 + 0.3 + 70.07 is 70.67; in floating point it is 70.67000000000002.
    const page = await getPage(fresh, "/dashboard");
    assertIncludes(page.html, "70.67", "dashboard total");
    assertExcludes(page.html, "70.6700000", "dashboard total");
  });

  await check("a date is displayed as its own calendar day", async () => {
    const fresh = users.find((u) => u.handle === "money");
    await addExpense(fresh, {
      itemName: "Dated item",
      amount: "5",
      expenseDate: "2026-09-10",
    });
    const stored = (await expensesOf(fresh)).find((e) => e.item_name === "Dated item");
    assert(stored.expense_date === "2026-09-10", `stored as ${stored.expense_date}`);

    const page = await getPage(fresh, "/expenses");
    assertIncludes(page.html, "10 Sept 2026", "expense list date heading");
  });

  // -------------------------------------------------------------------------
  group("Pagination");

  await check("a long list is paged at 20 per page", async () => {
    const pager = await createUser("pager", "Sam Pager");
    const rows = Array.from({ length: 25 }, (_, index) => ({
      user_id: pager.id,
      paid_by: pager.id,
      item_name: `Item ${String(index + 1).padStart(2, "0")}`,
      amount: index + 1,
      currency_code: "INR",
      expense_date: TODAY,
    }));
    const { error } = await pager.db.from("expenses").insert(rows);
    assert(!error, `seeding failed: ${error?.message}`);

    const first = await getPage(pager, "/expenses");
    assertIncludes(first.html, "Page 1 of 2", "page 1");
    assertIncludes(first.html, "25 expenses", "page 1 count");

    const second = await getPage(pager, "/expenses?page=2");
    assertIncludes(second.html, "Page 2 of 2", "page 2");

    const third = await getPage(pager, "/expenses?page=abc");
    assertIncludes(third.html, "Page 1 of 2", "a junk page number falls back to page 1");
  });
}

// ---------------------------------------------------------------------------

try {
  await run();
} catch (error) {
  failures.push({ section: "suite", name: "unexpected error", message: error.stack ?? String(error) });
  console.error(`\nThe suite stopped early: ${error.message}`);
} finally {
  console.log("\nCleaning up test accounts...");
  await cleanup();
}

console.log("");
if (failures.length > 0) {
  console.log(`${passed} passed, ${failures.length} failed\n`);
  for (const failure of failures) {
    console.log(`  ${failure.section} — ${failure.name}`);
    console.log(`    ${failure.message}`);
  }
  process.exit(1);
}

console.log(`${passed} passed, 0 failed`);
