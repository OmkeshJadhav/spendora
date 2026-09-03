#!/usr/bin/env node
/**
 * End-to-end test suite for Phase 6, group expenses.
 *
 * Two surfaces are exercised, because both are real:
 *
 *   1. The running application over HTTP, as a signed-in browser would use it.
 *      Expenses are created, edited, filtered and deleted by submitting the
 *      *actual forms* — hidden Server Action fields and all — which is the
 *      no-JavaScript path, so it runs the Server Actions themselves rather
 *      than a re-implementation of them.
 *
 *   2. PostgREST directly, with each user's own JWT. That is what somebody
 *      reaches when they skip the UI, so every authorization claim is proved
 *      there rather than by the absence of a button.
 *
 *   npm run dev                     (in another terminal)
 *   npm run verify:group-expenses
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
async function submitForm(user, path, { include, exclude = [], values = {}, replace = {} }) {
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

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    // A browser sends Origin on a form POST, and Next compares it to Host as
    // its CSRF check. Sending it keeps the suite on the same path a user is.
    headers: { cookie: cookieHeader(user), origin: BASE_URL },
    body,
    redirect: "manual",
  });

  const text = await response.text();
  const header = response.headers.get("location") ?? response.headers.get("x-action-redirect");
  const embedded = text.match(/"(\/[a-z0-9/[\]-]*\?flash=[a-z-]+)"/i)?.[1];

  return { status: response.status, redirect: header ?? embedded ?? null, text: readable(text) };
}

/** Submits the add-expense form for a group. */
function addExpense(user, groupId, values) {
  return submitForm(user, `/groups/${groupId}/expenses/new`, {
    include: ['name="itemName"'],
    values: {
      itemName: "",
      amount: "",
      paidBy: "",
      expenseDate: "",
      category: "",
      newCategoryName: "",
      paymentMode: "",
      notes: "",
      ...values,
    },
  });
}

/** Submits the edit form for one group expense. */
function editExpense(user, groupId, expenseId, values) {
  return submitForm(user, `/groups/${groupId}/expenses/${expenseId}/edit`, {
    include: ['name="itemName"'],
    values: {
      itemName: "",
      amount: "",
      paidBy: "",
      expenseDate: "",
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

async function groupExpenses(user, groupId) {
  const { data, error } = await user.db
    .from("expenses")
    .select(
      "id, item_name, amount, expense_date, payment_mode, notes, category_id, currency_code, paid_by, user_id, group_id",
    )
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

async function groupCategories(user, groupId) {
  const { data, error } = await user.db
    .from("categories")
    .select("id, name, is_archived, group_id, user_id")
    .eq("group_id", groupId);
  if (error) throw new Error(error.message);
  return data;
}

function findExpense(expenses, itemName) {
  const match = expenses.find((expense) => expense.item_name === itemName);
  assert(match, `no expense named ${JSON.stringify(itemName)}`);
  return match;
}

const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const TODAY = iso(new Date());
const YESTERDAY = iso(new Date(Date.now() - 86_400_000));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

async function run() {
  const probe = await fetch(`${BASE_URL}/sign-in`, { redirect: "manual" }).catch(() => null);
  if (!probe) {
    console.error(`No application at ${BASE_URL}. Start it with: npm run dev`);
    process.exit(1);
  }

  const owner = await createUser("xowner", "Ada Owner");
  const mate = await createUser("xmate", "Rahul Mate");
  const stranger = await createUser("xstranger", "Grace Stranger");

  let groupId = "";
  let otherGroupId = "";

  // -------------------------------------------------------------------------
  group("Setting up a group");

  await check("the admin creates a group in a non-default currency", async () => {
    const result = await submitForm(owner, "/groups/new", {
      include: ['name="name"'],
      values: { name: "Goa Trip 2026", description: "Shared costs", currencyCode: "EUR" },
    });
    assert(result.redirect?.startsWith("/groups/"), `redirected to ${result.redirect}`);
    groupId = result.redirect.split("/groups/")[1].split("?")[0];
    assert(groupId.length === 36, `group id looks wrong: ${groupId}`);
  });

  await check("a second member joins", async () => {
    // Seated directly: the invitation flow is Phase 5's to prove, and this
    // suite is about what happens once people are in a group together.
    const { error } = await admin
      .from("group_members")
      .insert({ group_id: groupId, user_id: mate.id, role: "member" });
    assert(!error, `could not seat the member: ${error?.message}`);

    const { data } = await mate.db
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", mate.id);
    assert(data?.length === 1 && data[0].role === "member", "the member was not seated");
  });

  await check("the stranger creates an unrelated group", async () => {
    const result = await submitForm(stranger, "/groups/new", {
      include: ['name="name"'],
      values: { name: "Someone Else's Group", description: "", currencyCode: "INR" },
    });
    otherGroupId = result.redirect.split("/groups/")[1].split("?")[0];
    assert(otherGroupId.length === 36, `group id looks wrong: ${otherGroupId}`);
  });

  // -------------------------------------------------------------------------
  group("Empty states");

  await check("the group page invites a first expense", async () => {
    const page = await getPage(owner, `/groups/${groupId}`);
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, "No expenses yet", "group page");
    assertIncludes(page.html, "Add expense", "group page");
    assertExcludes(page.html, "coming next", "group page still promises the feature");
  });

  await check("the group expense list has its own empty state", async () => {
    const page = await getPage(mate, `/groups/${groupId}/expenses`);
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, "No expenses yet", "expense list");
    assertIncludes(page.html, "Everyone in the group can see and add", "expense list");
  });

  // -------------------------------------------------------------------------
  group("Creating a group expense");

  await check("the form lists every member as a possible payer", async () => {
    const page = await getPage(mate, `/groups/${groupId}/expenses/new`);
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, 'name="paidBy"', "add form");
    assertIncludes(page.html, `value="${owner.id}"`, "add form: the admin is selectable");
    assertIncludes(page.html, `value="${mate.id}"`, "add form: the member is selectable");
    assertIncludes(page.html, "Rahul Mate (you)", "add form marks the signed-in member");
  });

  await check("a member records an expense paid by somebody else", async () => {
    const result = await addExpense(mate, groupId, {
      itemName: "Beach shack dinner",
      amount: "2450.50",
      paidBy: owner.id,
      expenseDate: TODAY,
      category: "",
      paymentMode: "upi",
      notes: "Table for six",
    });
    assert(
      result.redirect === `/groups/${groupId}/expenses?flash=expense-created`,
      `redirected to ${result.redirect}`,
    );
  });

  await check("every field was stored, with the recorder, payer and group currency", async () => {
    const expense = findExpense(await groupExpenses(mate, groupId), "Beach shack dinner");
    assert(Number(expense.amount) === 2450.5, `amount ${expense.amount}`);
    assert(expense.expense_date === TODAY, `expense_date ${expense.expense_date}`);
    assert(expense.payment_mode === "upi", `payment_mode ${expense.payment_mode}`);
    assert(expense.notes === "Table for six", `notes ${expense.notes}`);
    assert(expense.group_id === groupId, "group_id was not set");
    assert(expense.user_id === mate.id, "user_id should be whoever recorded it");
    assert(expense.paid_by === owner.id, "paid_by should be the person chosen");
    // The currency comes from the group, never from the form or the default.
    assert(expense.currency_code === "EUR", `currency ${expense.currency_code}`);
  });

  await check("the list renders it, in the group's currency, saying who paid", async () => {
    const page = await getPage(mate, `/groups/${groupId}/expenses`);
    assertIncludes(page.html, "Beach shack dinner", "list");
    // EUR is formatted in its own locale: "2.450,50 €", not "€2,450.50".
    assertIncludes(page.html, "2.450,50", "list amount");
    assertIncludes(page.html, "Paid by Ada Owner", "list payer");
    assertIncludes(page.html, "UPI", "list payment mode");
    assertIncludes(page.html, "Table for six", "list notes");
    assertIncludes(page.html, `id="day-${TODAY}"`, "list date grouping");
    assertExcludes(page.html, "₹", "list should not use the default currency");
  });

  await check("the other member sees it on the group page too", async () => {
    const page = await getPage(owner, `/groups/${groupId}`);
    assertIncludes(page.html, "Beach shack dinner", "group page");
    assertIncludes(page.html, "View all expenses", "group page");
  });

  await check("a group expense stays out of personal records", async () => {
    const page = await getPage(mate, "/expenses");
    assertExcludes(page.html, "Beach shack dinner", "personal list");

    const expense = findExpense(await groupExpenses(mate, groupId), "Beach shack dinner");
    const edit = await getPage(mate, `/expenses/${expense.id}/edit`);
    assertNotFound(edit, "personal editor opened a group expense");
  });

  // -------------------------------------------------------------------------
  group("Paid-by is a group member, enforced by the database");

  await check("an outsider cannot be recorded as the payer", async () => {
    const before = (await groupExpenses(mate, groupId)).length;
    const result = await addExpense(mate, groupId, {
      itemName: "Ghost payer",
      amount: "10",
      paidBy: stranger.id,
      expenseDate: TODAY,
    });
    assert(result.redirect === null, `it was accepted and redirected to ${result.redirect}`);
    assertIncludes(result.text, "no longer a member", "the refusal should explain itself");
    const after = (await groupExpenses(mate, groupId)).length;
    assert(after === before, `an expense was created anyway (${before} -> ${after})`);
  });

  await check("a malformed payer id is refused before it reaches the database", async () => {
    const before = (await groupExpenses(mate, groupId)).length;
    const result = await addExpense(mate, groupId, {
      itemName: "Bad payer",
      amount: "10",
      paidBy: "not-a-uuid",
      expenseDate: TODAY,
    });
    assert(result.redirect === null, `it was accepted and redirected to ${result.redirect}`);
    const after = (await groupExpenses(mate, groupId)).length;
    assert(after === before, "an expense was created anyway");
  });

  await check("PostgREST refuses the same thing directly", async () => {
    const { error } = await mate.db.from("expenses").insert({
      user_id: mate.id,
      group_id: groupId,
      paid_by: stranger.id,
      item_name: "Direct ghost payer",
      amount: 10,
      currency_code: "EUR",
      expense_date: TODAY,
    });
    assert(error, "a non-member was accepted as the payer");
  });

  // -------------------------------------------------------------------------
  group("Group categories");

  await check("an admin can create a category while adding an expense", async () => {
    const result = await addExpense(owner, groupId, {
      itemName: "Scooter hire",
      amount: "1200",
      paidBy: owner.id,
      expenseDate: TODAY,
      category: "__create__",
      newCategoryName: "Transport",
      paymentMode: "cash",
    });
    assert(result.redirect?.includes("expense-created"), `redirected to ${result.redirect}`);

    const categories = await groupCategories(owner, groupId);
    const transport = categories.filter((c) => c.name === "Transport");
    assert(transport.length === 1, `expected 1 Transport category, got ${transport.length}`);
    assert(transport[0].user_id === null, "a group category must not have a personal owner");
  });

  await check("a suggested category is created once, not twice", async () => {
    await addExpense(owner, groupId, {
      itemName: "Airport taxi",
      amount: "800",
      paidBy: owner.id,
      expenseDate: TODAY,
      category: "name:Transport",
    });
    const categories = await groupCategories(owner, groupId);
    assert(
      categories.filter((c) => c.name.trim().toLowerCase() === "transport").length === 1,
      "a duplicate category was created",
    );
  });

  await check("a member may use the group's categories", async () => {
    const transport = (await groupCategories(mate, groupId)).find((c) => c.name === "Transport");
    const result = await addExpense(mate, groupId, {
      itemName: "Ferry tickets",
      amount: "600",
      paidBy: mate.id,
      expenseDate: YESTERDAY,
      category: transport.id,
      paymentMode: "cash",
    });
    assert(result.redirect?.includes("expense-created"), `redirected to ${result.redirect}`);
    const expense = findExpense(await groupExpenses(mate, groupId), "Ferry tickets");
    assert(expense.category_id === transport.id, "the category was not applied");
  });

  await check("the member's form does not offer to create one", async () => {
    const page = await getPage(mate, `/groups/${groupId}/expenses/new`);
    assertExcludes(page.html, "Create a new category", "member's add form");
    assertIncludes(page.html, "Only a group admin can add categories", "member's add form");

    const adminPage = await getPage(owner, `/groups/${groupId}/expenses/new`);
    assertIncludes(adminPage.html, "Create a new category", "admin's add form");
  });

  await check("a member trying anyway is refused, and creates nothing", async () => {
    const before = (await groupExpenses(mate, groupId)).length;
    const categoriesBefore = (await groupCategories(mate, groupId)).length;

    const result = await addExpense(mate, groupId, {
      itemName: "Sneaky category",
      amount: "50",
      paidBy: mate.id,
      expenseDate: TODAY,
      category: "__create__",
      newCategoryName: "Members Only",
    });

    assert(result.redirect === null, `it was accepted and redirected to ${result.redirect}`);
    assertIncludes(result.text, "Only a group admin can add categories", "the refusal");
    assert((await groupExpenses(mate, groupId)).length === before, "an expense was created anyway");
    assert(
      (await groupCategories(mate, groupId)).length === categoriesBefore,
      "a category was created anyway",
    );
  });

  await check("PostgREST refuses a member's category insert too", async () => {
    const { error } = await mate.db
      .from("categories")
      .insert({ group_id: groupId, name: "Direct members only" });
    assert(error, "a member created a group category directly");
  });

  await check("a category from another group cannot be used", async () => {
    // The stranger's own group, which this member has never seen.
    const { data: foreign } = await admin
      .from("categories")
      .insert({ group_id: otherGroupId, name: "Foreign" })
      .select("id")
      .single();

    const before = (await groupExpenses(mate, groupId)).length;
    const result = await addExpense(mate, groupId, {
      itemName: "Foreign category",
      amount: "10",
      paidBy: mate.id,
      expenseDate: TODAY,
      category: foreign.id,
    });

    assert(result.redirect === null, `it was accepted and redirected to ${result.redirect}`);
    assertIncludes(result.text, "Choose a category from the list", "the refusal");
    assert((await groupExpenses(mate, groupId)).length === before, "an expense was created anyway");
  });

  await check("a personal category cannot be used on a group expense", async () => {
    const { data: personal } = await mate.db
      .from("categories")
      .insert({ user_id: mate.id, name: "My own" })
      .select("id")
      .single();
    assert(personal, "the member could not create a personal category");

    const before = (await groupExpenses(mate, groupId)).length;
    const result = await addExpense(mate, groupId, {
      itemName: "Personal category",
      amount: "10",
      paidBy: mate.id,
      expenseDate: TODAY,
      category: personal.id,
    });

    assert(result.redirect === null, `it was accepted and redirected to ${result.redirect}`);
    assert((await groupExpenses(mate, groupId)).length === before, "an expense was created anyway");
  });

  // -------------------------------------------------------------------------
  group("Editing and deleting: who may do what");

  await check("a member can edit the expense they recorded", async () => {
    const expense = findExpense(await groupExpenses(mate, groupId), "Ferry tickets");
    const result = await editExpense(mate, groupId, expense.id, {
      itemName: "Ferry tickets (return)",
      amount: "750.25",
      paidBy: mate.id,
      expenseDate: YESTERDAY,
      category: expense.category_id,
      paymentMode: "cash",
      notes: "Both ways",
    });
    assert(
      result.redirect === `/groups/${groupId}/expenses?flash=expense-updated`,
      `redirected to ${result.redirect}`,
    );

    const updated = findExpense(await groupExpenses(mate, groupId), "Ferry tickets (return)");
    assert(Number(updated.amount) === 750.25, `amount ${updated.amount}`);
    assert(updated.notes === "Both ways", `notes ${updated.notes}`);
  });

  await check("a member cannot open the editor for somebody else's expense", async () => {
    const expense = findExpense(await groupExpenses(mate, groupId), "Scooter hire");
    const page = await getPage(mate, `/groups/${groupId}/expenses/${expense.id}/edit`);
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, "You can't edit this expense", "the editor");
    assertExcludes(page.html, 'name="itemName"', "the form was rendered anyway");
  });

  await check("the list offers no edit control for it either", async () => {
    const page = await getPage(mate, `/groups/${groupId}/expenses`);
    assertIncludes(page.html, "Recorded by another member", "the list");
    assertExcludes(page.html, "Edit Scooter hire", "the list offered an edit link");
    assertIncludes(page.html, "Edit Ferry tickets (return)", "the list hid the member's own");
  });

  await check("PostgREST refuses a member's edit of somebody else's expense", async () => {
    const expense = findExpense(await groupExpenses(mate, groupId), "Scooter hire");
    const { data, error } = await mate.db
      .from("expenses")
      .update({ item_name: "Hijacked" })
      .eq("id", expense.id)
      .select("id");
    assert(!error, `unexpected error: ${error?.message}`);
    assert(!data || data.length === 0, "a member edited an expense they did not record");

    const after = findExpense(await groupExpenses(mate, groupId), "Scooter hire");
    assert(after.item_name === "Scooter hire", "the item name changed anyway");
  });

  await check("PostgREST refuses a member's delete of somebody else's expense", async () => {
    const expense = findExpense(await groupExpenses(mate, groupId), "Scooter hire");
    const { data } = await mate.db.from("expenses").delete().eq("id", expense.id).select("id");
    assert(!data || data.length === 0, "a member deleted an expense they did not record");
    findExpense(await groupExpenses(owner, groupId), "Scooter hire");
  });

  await check("a group expense cannot be re-parented into private records", async () => {
    const expense = findExpense(await groupExpenses(mate, groupId), "Ferry tickets (return)");
    await mate.db
      .from("expenses")
      .update({ group_id: null, user_id: mate.id })
      .eq("id", expense.id);

    const after = findExpense(await groupExpenses(mate, groupId), "Ferry tickets (return)");
    assert(after.group_id === groupId, "group_id was changed by an update");

    const page = await getPage(mate, "/expenses");
    assertExcludes(page.html, "Ferry tickets", "personal list");
  });

  await check("an admin can edit any expense in the group", async () => {
    const expense = findExpense(await groupExpenses(owner, groupId), "Ferry tickets (return)");
    const result = await editExpense(owner, groupId, expense.id, {
      itemName: "Ferry tickets (corrected)",
      amount: "700",
      paidBy: owner.id,
      expenseDate: YESTERDAY,
      category: expense.category_id,
      paymentMode: "cash",
      notes: "Corrected by the admin",
    });
    assert(result.redirect?.includes("expense-updated"), `redirected to ${result.redirect}`);

    const updated = findExpense(await groupExpenses(owner, groupId), "Ferry tickets (corrected)");
    assert(Number(updated.amount) === 700, `amount ${updated.amount}`);
    assert(updated.paid_by === owner.id, "the payer was not changed");
    // The recorder is not rewritten by somebody else's edit.
    assert(updated.user_id === mate.id, "user_id changed hands during an edit");
  });

  await check("a member can delete the expense they recorded", async () => {
    const result = await addExpense(mate, groupId, {
      itemName: "Mistake",
      amount: "5",
      paidBy: mate.id,
      expenseDate: TODAY,
    });
    assert(result.redirect?.includes("expense-created"), "the expense was not created");

    const expense = findExpense(await groupExpenses(mate, groupId), "Mistake");
    const deleted = await submitForm(mate, `/groups/${groupId}/expenses`, {
      include: [`value="${expense.id}"`, `value="${groupId}"`],
      values: {},
    });
    assert(
      deleted.redirect === `/groups/${groupId}/expenses?flash=expense-deleted`,
      `redirected to ${deleted.redirect}`,
    );
    assert(
      !(await groupExpenses(mate, groupId)).some((e) => e.item_name === "Mistake"),
      "the expense survived",
    );
  });

  await check("an admin can delete anybody's expense", async () => {
    const expense = findExpense(await groupExpenses(owner, groupId), "Ferry tickets (corrected)");
    const { data } = await owner.db.from("expenses").delete().eq("id", expense.id).select("id");
    assert(data?.length === 1, "the admin's delete was refused");
  });

  // -------------------------------------------------------------------------
  group("Non-members see nothing");

  await check("the group's expense pages are not found for an outsider", async () => {
    for (const path of [
      `/groups/${groupId}/expenses`,
      `/groups/${groupId}/expenses/new`,
    ]) {
      const page = await getPage(stranger, path);
      assertNotFound(page, `outsider GET ${path}`);
    }
  });

  await check("an outsider reads no expenses through PostgREST", async () => {
    const { data, error } = await stranger.db
      .from("expenses")
      .select("id, item_name")
      .eq("group_id", groupId);
    assert(!error, `unexpected error: ${error?.message}`);
    assert((data ?? []).length === 0, `an outsider read ${data.length} expenses`);
  });

  await check("an outsider cannot add an expense to the group", async () => {
    const { error } = await stranger.db.from("expenses").insert({
      user_id: stranger.id,
      group_id: groupId,
      paid_by: stranger.id,
      item_name: "Not mine",
      amount: 10,
      currency_code: "EUR",
      expense_date: TODAY,
    });
    assert(error, "an outsider added an expense to a group they do not belong to");
  });

  await check("the signed-out visitor is sent to sign in", async () => {
    for (const path of [
      `/groups/${groupId}/expenses`,
      `/groups/${groupId}/expenses/new`,
    ]) {
      const page = await getPage(null, path);
      assert(page.status === 307, `${path} returned ${page.status}`);
      assert(page.location?.startsWith("/sign-in?next="), `${path} → ${page.location}`);
    }
  });

  // -------------------------------------------------------------------------
  group("Filtering");

  await check("filtering by category narrows the list", async () => {
    const transport = (await groupCategories(owner, groupId)).find((c) => c.name === "Transport");
    const page = await getPage(owner, `/groups/${groupId}/expenses?category=${transport.id}`);
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, "Scooter hire", "filtered list");
    assertIncludes(page.html, "Airport taxi", "filtered list");
    assertExcludes(page.html, "Beach shack dinner", "filtered list kept an uncategorised expense");
    assertIncludes(page.html, "Clear filters", "filtered list");
  });

  await check("uncategorised expenses can be singled out", async () => {
    const page = await getPage(owner, `/groups/${groupId}/expenses?category=none`);
    assertIncludes(page.html, "Beach shack dinner", "uncategorised filter");
    assertExcludes(page.html, "Scooter hire", "uncategorised filter kept a categorised expense");
  });

  await check("filtering by payer narrows the list", async () => {
    // Something the member actually paid for, so the filter has both sides.
    const created = await addExpense(mate, groupId, {
      itemName: "Snorkel gear",
      amount: "300",
      paidBy: mate.id,
      expenseDate: TODAY,
      paymentMode: "debit_card",
    });
    assert(created.redirect?.includes("expense-created"), "the expense was not created");

    const mine = await getPage(owner, `/groups/${groupId}/expenses?paidBy=${mate.id}`);
    assertIncludes(mine.html, "Snorkel gear", "payer filter");
    assertExcludes(mine.html, "Scooter hire", "payer filter kept an expense the admin paid");

    const theirs = await getPage(owner, `/groups/${groupId}/expenses?paidBy=${owner.id}`);
    assertIncludes(theirs.html, "Scooter hire", "payer filter");
    assertExcludes(theirs.html, "Snorkel gear", "payer filter kept an expense the member paid");
  });

  await check("filtering by payment mode narrows the list", async () => {
    const page = await getPage(owner, `/groups/${groupId}/expenses?paymentMode=upi`);
    assertIncludes(page.html, "Beach shack dinner", "payment filter");
    assertExcludes(page.html, "Scooter hire", "payment filter kept a cash expense");
  });

  await check("filters combine, and an empty result says so", async () => {
    const page = await getPage(
      owner,
      `/groups/${groupId}/expenses?paidBy=${mate.id}&paymentMode=upi`,
    );
    assertIncludes(page.html, "No expenses match these filters", "combined filter");
    assertIncludes(page.html, "Clear filters", "combined filter");
  });

  await check("a nonsense filter value is ignored, not an error", async () => {
    const page = await getPage(
      owner,
      `/groups/${groupId}/expenses?category=not-a-uuid&paymentMode=telepathy&paidBy=%3Cscript%3E`,
    );
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, "Beach shack dinner", "unfiltered fallback");
    assertIncludes(page.html, "Scooter hire", "unfiltered fallback");
  });

  await check("filters cannot widen what an outsider is allowed to see", async () => {
    const page = await getPage(stranger, `/groups/${groupId}/expenses?paidBy=${owner.id}`);
    assertNotFound(page, "outsider with a filter");
  });

  // -------------------------------------------------------------------------
  group("Currency and totals");

  await check("the list totals the group's expenses exactly", async () => {
    const page = await getPage(owner, `/groups/${groupId}/expenses`);
    const expenses = await groupExpenses(owner, groupId);
    const total = expenses.reduce((sum, e) => sum + Math.round(Number(e.amount) * 100), 0);
    const formatted = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(total / 100);
    // The formatter uses a non-breaking space before the symbol; compare the
    // digits, which is what a reader checks.
    assertIncludes(page.html, formatted.replace(/[^\d.,]/g, ""), "list total");
  });

  await check("the settings page reports the currency as locked", async () => {
    const page = await getPage(owner, `/groups/${groupId}/settings`);
    assert(page.status === 200, `status ${page.status}`);
    assertIncludes(page.html, "Locked: this group already has expenses", "settings page");
  });

  await check("the database refuses the currency change even directly", async () => {
    const { error } = await owner.db
      .from("groups")
      .update({ currency_code: "USD" })
      .eq("id", groupId);
    assert(error, "the currency was changed after expenses had been recorded");

    const { data } = await owner.db
      .from("groups")
      .select("currency_code")
      .eq("id", groupId)
      .single();
    assert(data.currency_code === "EUR", `the currency changed to ${data.currency_code}`);
  });

  // -------------------------------------------------------------------------
  group("Validation");

  const countBefore = async () => (await groupExpenses(mate, groupId)).length;

  async function rejects(name, values) {
    await check(name, async () => {
      const before = await countBefore();
      const result = await addExpense(mate, groupId, {
        paidBy: mate.id,
        expenseDate: TODAY,
        ...values,
      });
      assert(result.redirect === null, `it was accepted and redirected to ${result.redirect}`);
      const after = await countBefore();
      assert(after === before, `an expense was created anyway (${before} -> ${after})`);
    });
  }

  await rejects("an empty item name is refused", { itemName: "", amount: "10" });
  await rejects("a zero amount is refused", { itemName: "Free", amount: "0" });
  await rejects("a negative amount is refused", { itemName: "Refund", amount: "-10" });
  await rejects("a non-numeric amount is refused", { itemName: "Wat", amount: "ten" });
  await rejects("three decimal places are refused", { itemName: "Odd", amount: "10.999" });
  await rejects("an invalid date is refused", {
    itemName: "Impossible",
    amount: "10",
    expenseDate: "2026-02-31",
  });
  await rejects("an unknown payment mode is refused", {
    itemName: "Barter",
    amount: "10",
    paymentMode: "goats",
  });

  await check("a member cannot post an expense into a group they left", async () => {
    const { error } = await admin
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", mate.id);
    assert(!error, `could not remove the member: ${error?.message}`);

    const { error: insertError } = await mate.db.from("expenses").insert({
      user_id: mate.id,
      group_id: groupId,
      paid_by: mate.id,
      item_name: "After leaving",
      amount: 10,
      currency_code: "EUR",
      expense_date: TODAY,
    });
    assert(insertError, "a former member added an expense");
  });

  await check("the expenses a departed member recorded stay with the group", async () => {
    const expenses = await groupExpenses(owner, groupId);
    assert(
      expenses.some((e) => e.item_name === "Beach shack dinner"),
      "an expense recorded by the departed member was lost",
    );
    const page = await getPage(owner, `/groups/${groupId}/expenses`);
    assertIncludes(page.html, "Beach shack dinner", "the list after a member left");
  });

  // -------------------------------------------------------------------------
  console.log("\nCleaning up test accounts...");
  await cleanup();

  console.log(
    `\n${passed} passed, ${failures.length} failed`,
  );

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
