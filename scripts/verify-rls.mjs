#!/usr/bin/env node
/**
 * Authorization test suite for the Phase 3 schema.
 *
 * Every assertion is made through PostgREST with a real user's JWT — the same
 * path a browser would take if someone skipped the UI and called Supabase
 * directly. Nothing here trusts the application layer, because in production
 * nothing can.
 *
 *   node scripts/verify-rls.mjs        (or: npm run db:verify-rls)
 *
 * Needs, in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY   — used only to create and then delete the three
 *                                 throwaway accounts. Never read by the app.
 *
 * The test users are deleted at the end, even when assertions fail.
 */

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

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

const missing = [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  console.error("Add them to .env.local. The service role key is under");
  console.error("Project Settings -> API -> service_role. It is server-only.");
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

/** The row was written. Returns it. */
function expectOk({ data, error }, what) {
  if (error) throw new Error(`${what} should have succeeded: ${error.message}`);
  return data;
}

/** The write was refused — by RLS, a constraint or a trigger. */
function expectDenied({ data, error }, what) {
  if (!error) {
    throw new Error(
      `${what} should have been refused but succeeded: ${JSON.stringify(data)}`,
    );
  }
  return error;
}

// ---------------------------------------------------------------------------
// Test users
// ---------------------------------------------------------------------------

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const RUN_ID = randomUUID().slice(0, 8);
const PASSWORD = `Rls-${randomUUID()}`;
const createdUserIds = [];

async function createUser(handle, name) {
  const email = `spendora-rls-${RUN_ID}-${handle}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) throw new Error(`Could not create ${handle}: ${error.message}`);
  createdUserIds.push(data.user.id);

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) {
    throw new Error(`Could not sign in ${handle}: ${signIn.error.message}`);
  }

  return { id: data.user.id, email, name, db: client };
}

async function cleanup() {
  const stuck = [];
  for (const id of createdUserIds) {
    // Everything the user owns is removed by the cascades from auth.users.
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) stuck.push(`${id}: ${error.message}`);
  }
  if (stuck.length > 0) {
    // Never swallow this: a user that will not delete means a cascade or a
    // check constraint is wrong, which is a schema bug worth failing over.
    failures.push({
      section: "Cleanup",
      name: "test accounts could not be deleted",
      message: stuck.join("; "),
    });
    console.log(`\n  FAIL  test accounts could not be deleted\n        ${stuck.join("; ")}`);
  }
}

// The unauthenticated caller: the anon key with no session at all.
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;

function tokenHash() {
  return randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64);
}

function inAnHour() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

async function run() {
  console.log(`Running against ${new URL(SUPABASE_URL).host}`);

  const alice = await createUser("alice", "Alice Admin");
  const bob = await createUser("bob", "Bob Member");
  const mallory = await createUser("mallory", "Mallory Outsider");

  // -- Phase 2 foundation, now that a real database exists --------------------

  group("Profiles");

  await check("sign up created a profile row via the trigger", async () => {
    const { data } = await alice.db.from("profiles").select("*").eq("id", alice.id);
    assert(data?.length === 1, "Alice has no profile row");
    assert(data[0].name === "Alice Admin", `name was ${data?.[0]?.name}`);
    assert(data[0].email === alice.email, "profile email does not match auth");
  });

  await check("a user cannot read another user's profile", async () => {
    const { data } = await mallory.db.from("profiles").select("*").eq("id", alice.id);
    assert(data?.length === 0, "Mallory can read Alice's profile");
  });

  await check("a user can rename themselves", async () => {
    expectOk(
      await alice.db.from("profiles").update({ name: "Alice A" }).eq("id", alice.id).select(),
      "renaming own profile",
    );
    await alice.db.from("profiles").update({ name: "Alice Admin" }).eq("id", alice.id);
  });

  await check("a user cannot rename someone else", async () => {
    const { data } = await mallory.db
      .from("profiles")
      .update({ name: "Owned" })
      .eq("id", alice.id)
      .select();
    assert(!data || data.length === 0, "Mallory renamed Alice");

    const { data: after } = await alice.db.from("profiles").select("name").eq("id", alice.id);
    assert(after[0].name === "Alice Admin", "Alice's name was changed by Mallory");
  });

  // -- Personal data is private ----------------------------------------------

  group("Personal expenses are private");

  const personalCategory = expectOk(
    await alice.db
      .from("categories")
      .insert({ user_id: alice.id, name: "Groceries" })
      .select()
      .single(),
    "creating a personal category",
  );

  const personalExpense = expectOk(
    await alice.db
      .from("expenses")
      .insert({
        user_id: alice.id,
        paid_by: alice.id,
        category_id: personalCategory.id,
        item_name: "Weekly shop",
        amount: 2450.5,
        expense_date: today,
        payment_mode: "upi",
      })
      .select()
      .single(),
    "creating a personal expense",
  );

  await check("the owner can read their personal expense", async () => {
    const { data } = await alice.db.from("expenses").select("*").eq("id", personalExpense.id);
    assert(data?.length === 1, "Alice cannot read her own expense");
    assert(data[0].amount === 2450.5, `amount came back as ${data[0].amount}`);
  });

  await check("another user cannot read it", async () => {
    const { data } = await mallory.db.from("expenses").select("*").eq("id", personalExpense.id);
    assert(data?.length === 0, "Mallory can read Alice's personal expense");
  });

  await check("another user cannot update it", async () => {
    await mallory.db.from("expenses").update({ amount: 1 }).eq("id", personalExpense.id);
    const { data } = await alice.db.from("expenses").select("amount").eq("id", personalExpense.id);
    assert(data[0].amount === 2450.5, "Mallory changed Alice's expense");
  });

  await check("another user cannot delete it", async () => {
    await mallory.db.from("expenses").delete().eq("id", personalExpense.id);
    const { data } = await alice.db.from("expenses").select("id").eq("id", personalExpense.id);
    assert(data?.length === 1, "Mallory deleted Alice's expense");
  });

  await check("a user cannot record an expense as someone else", async () => {
    expectDenied(
      await mallory.db
        .from("expenses")
        .insert({
          user_id: alice.id,
          paid_by: alice.id,
          item_name: "Planted",
          amount: 10,
          expense_date: today,
        })
        .select(),
      "inserting an expense owned by another user",
    );
  });

  await check("a user cannot use another user's personal category", async () => {
    expectDenied(
      await mallory.db
        .from("expenses")
        .insert({
          user_id: mallory.id,
          paid_by: mallory.id,
          category_id: personalCategory.id,
          item_name: "Borrowed category",
          amount: 10,
          expense_date: today,
        })
        .select(),
      "using another user's category",
    );
  });

  await check("a personal expense must be paid by its owner", async () => {
    expectDenied(
      await alice.db
        .from("expenses")
        .insert({
          user_id: alice.id,
          paid_by: bob.id,
          item_name: "Not mine",
          amount: 10,
          expense_date: today,
        })
        .select(),
      "a personal expense paid by someone else",
    );
  });

  // -- Data constraints ------------------------------------------------------

  group("Constraints");

  for (const [label, amount] of [
    ["zero", 0],
    ["negative", -50],
  ]) {
    await check(`an amount of ${label} is rejected`, async () => {
      expectDenied(
        await alice.db
          .from("expenses")
          .insert({
            user_id: alice.id,
            paid_by: alice.id,
            item_name: "Bad amount",
            amount,
            expense_date: today,
          })
          .select(),
        `amount ${amount}`,
      );
    });
  }

  await check("an empty item name is rejected", async () => {
    expectDenied(
      await alice.db
        .from("expenses")
        .insert({
          user_id: alice.id,
          paid_by: alice.id,
          item_name: "   ",
          amount: 10,
          expense_date: today,
        })
        .select(),
      "a blank item name",
    );
  });

  await check("an unknown payment mode is rejected", async () => {
    expectDenied(
      await alice.db
        .from("expenses")
        .insert({
          user_id: alice.id,
          paid_by: alice.id,
          item_name: "Bad mode",
          amount: 10,
          expense_date: today,
          payment_mode: "crypto",
        })
        .select(),
      "payment_mode 'crypto'",
    );
  });

  await check("a duplicate personal category name is rejected", async () => {
    expectDenied(
      await alice.db.from("categories").insert({ user_id: alice.id, name: "groceries" }).select(),
      "a second 'Groceries' category",
    );
  });

  await check("a category cannot belong to both a user and a group", async () => {
    expectDenied(
      await alice.db.from("categories").insert({ name: "Neither" }).select(),
      "a category with no owner",
    );
  });

  // -- Groups ----------------------------------------------------------------

  group("Groups");

  const goa = expectOk(
    await alice.db
      .from("groups")
      .insert({ name: "Goa Trip 2026", currency_code: "INR", created_by: alice.id })
      .select()
      .single(),
    "creating a group",
  );

  await check("the creator becomes admin automatically", async () => {
    const { data } = await alice.db.from("group_members").select("*").eq("group_id", goa.id);
    assert(data?.length === 1, `expected 1 member, got ${data?.length}`);
    assert(data[0].user_id === alice.id && data[0].role === "admin", "creator is not admin");
  });

  await check("a user cannot create a group owned by someone else", async () => {
    expectDenied(
      await mallory.db
        .from("groups")
        .insert({ name: "Impersonated", currency_code: "INR", created_by: alice.id })
        .select(),
      "creating a group as another user",
    );
  });

  await check("a non-member cannot see the group", async () => {
    const { data } = await mallory.db.from("groups").select("*").eq("id", goa.id);
    assert(data?.length === 0, "Mallory can see a group she is not in");
  });

  await check("a non-member cannot see its membership", async () => {
    const { data } = await mallory.db.from("group_members").select("*").eq("group_id", goa.id);
    assert(data?.length === 0, "Mallory can see the member list");
  });

  await check("a non-member cannot join by inserting themselves", async () => {
    expectDenied(
      await mallory.db
        .from("group_members")
        .insert({ group_id: goa.id, user_id: mallory.id, role: "member" })
        .select(),
      "self-adding to a group without an invitation",
    );
  });

  await check("an invalid currency is rejected", async () => {
    expectDenied(
      await alice.db
        .from("groups")
        .insert({ name: "Bad currency", currency_code: "XYZ", created_by: alice.id })
        .select(),
      "currency_code 'XYZ'",
    );
  });

  // -- Invitations -----------------------------------------------------------

  group("Invitations");

  const invitation = expectOk(
    await alice.db
      .from("group_invitations")
      .insert({
        group_id: goa.id,
        email: bob.email.toUpperCase(),
        role: "member",
        token_hash: tokenHash(),
        invited_by: alice.id,
        expires_at: inAnHour(),
      })
      .select()
      .single(),
    "an admin inviting someone",
  );

  await check("the invited email is normalised to lower case", () => {
    assert(invitation.email === bob.email.toLowerCase(), `stored as ${invitation.email}`);
  });

  await check("a non-admin cannot invite", async () => {
    expectDenied(
      await mallory.db
        .from("group_invitations")
        .insert({
          group_id: goa.id,
          email: "someone@example.com",
          token_hash: tokenHash(),
          invited_by: mallory.id,
          expires_at: inAnHour(),
        })
        .select(),
      "a non-member sending an invitation",
    );
  });

  await check("a duplicate pending invitation is rejected", async () => {
    expectDenied(
      await alice.db
        .from("group_invitations")
        .insert({
          group_id: goa.id,
          email: bob.email,
          token_hash: tokenHash(),
          invited_by: alice.id,
          expires_at: inAnHour(),
        })
        .select(),
      "a second pending invitation for the same email",
    );
  });

  await check("an invitation must expire in the future", async () => {
    expectDenied(
      await alice.db
        .from("group_invitations")
        .insert({
          group_id: goa.id,
          email: "later@example.com",
          token_hash: tokenHash(),
          invited_by: alice.id,
          expires_at: new Date(Date.now() - 1000).toISOString(),
        })
        .select(),
      "an invitation that has already expired",
    );
  });

  await check("the invitee can see the invitation addressed to them", async () => {
    const { data } = await bob.db.from("group_invitations").select("*").eq("id", invitation.id);
    assert(data?.length === 1, "Bob cannot see his own invitation");
  });

  await check("an unrelated user cannot see it", async () => {
    const { data } = await mallory.db.from("group_invitations").select("*").eq("id", invitation.id);
    assert(data?.length === 0, "Mallory can read someone else's invitation");
  });

  await check("the invitee still cannot see the group before joining", async () => {
    const { data } = await bob.db.from("groups").select("*").eq("id", goa.id);
    assert(data?.length === 0, "Bob can see the group before accepting");
  });

  await check("the invitee cannot upgrade themselves to admin while joining", async () => {
    expectDenied(
      await bob.db
        .from("group_members")
        .insert({ group_id: goa.id, user_id: bob.id, role: "admin" })
        .select(),
      "joining as admin on a member invitation",
    );
  });

  await check("the invitee can join in the role they were invited to", async () => {
    expectOk(
      await bob.db
        .from("group_members")
        .insert({ group_id: goa.id, user_id: bob.id, role: "member" })
        .select(),
      "accepting the invitation",
    );
  });

  await check("joining closes the invitation", async () => {
    const { data } = await alice.db.from("group_invitations").select("*").eq("id", invitation.id);
    assert(data[0].status === "accepted", `status is ${data[0].status}`);
    assert(data[0].accepted_by === bob.id, "accepted_by was not recorded");
  });

  await check("a second join attempt is rejected", async () => {
    expectDenied(
      await bob.db
        .from("group_members")
        .insert({ group_id: goa.id, user_id: bob.id, role: "member" })
        .select(),
      "joining the same group twice",
    );
  });

  await check("someone already in the group cannot be re-invited", async () => {
    expectDenied(
      await alice.db
        .from("group_invitations")
        .insert({
          group_id: goa.id,
          email: bob.email,
          token_hash: tokenHash(),
          invited_by: alice.id,
          expires_at: inAnHour(),
        })
        .select(),
      "inviting an existing member",
    );
  });

  await check("members can now see each other's names", async () => {
    const { data } = await bob.db.from("profiles").select("id, name").eq("id", alice.id);
    assert(data?.length === 1 && data[0].name === "Alice Admin", "Bob cannot see Alice's name");

    const { data: outsider } = await mallory.db.from("profiles").select("id").eq("id", alice.id);
    assert(outsider?.length === 0, "Mallory can see Alice's profile");
  });

  // -- Group categories and budgets are admin-managed -------------------------

  group("Categories and budgets");

  const groupCategory = expectOk(
    await alice.db.from("categories").insert({ group_id: goa.id, name: "Food" }).select().single(),
    "an admin creating a group category",
  );

  await check("a member can read group categories", async () => {
    const { data } = await bob.db.from("categories").select("*").eq("group_id", goa.id);
    assert(data?.length === 1, "Bob cannot read the group's categories");
  });

  await check("a member cannot create a group category", async () => {
    expectDenied(
      await bob.db.from("categories").insert({ group_id: goa.id, name: "Snacks" }).select(),
      "a member creating a group category",
    );
  });

  await check("a member cannot rename a group category", async () => {
    await bob.db.from("categories").update({ name: "Renamed" }).eq("id", groupCategory.id);
    const { data } = await alice.db.from("categories").select("name").eq("id", groupCategory.id);
    assert(data[0].name === "Food", "a member renamed a group category");
  });

  await check("a non-member cannot read group categories", async () => {
    const { data } = await mallory.db.from("categories").select("*").eq("group_id", goa.id);
    assert(data?.length === 0, "Mallory can read the group's categories");
  });

  const budget = expectOk(
    await alice.db
      .from("budgets")
      .insert({ group_id: goa.id, category_id: groupCategory.id, amount: 8000 })
      .select()
      .single(),
    "an admin setting a budget",
  );

  await check("a member can read budgets", async () => {
    const { data } = await bob.db.from("budgets").select("*").eq("id", budget.id);
    assert(data?.length === 1, "Bob cannot read the budget");
  });

  await check("a member cannot change a budget", async () => {
    await bob.db.from("budgets").update({ amount: 1 }).eq("id", budget.id);
    const { data } = await alice.db.from("budgets").select("amount").eq("id", budget.id);
    assert(data[0].amount === 8000, `budget is now ${data[0].amount}`);
  });

  await check("a member cannot delete a budget", async () => {
    await bob.db.from("budgets").delete().eq("id", budget.id);
    const { data } = await alice.db.from("budgets").select("id").eq("id", budget.id);
    assert(data?.length === 1, "a member deleted a budget");
  });

  await check("only one standing budget per category", async () => {
    expectDenied(
      await alice.db
        .from("budgets")
        .insert({ group_id: goa.id, category_id: groupCategory.id, amount: 9000 })
        .select(),
      "a second standing budget",
    );
  });

  await check("a month-specific budget can override the standing one", async () => {
    const override = expectOk(
      await alice.db
        .from("budgets")
        .insert({
          group_id: goa.id,
          category_id: groupCategory.id,
          amount: 12000,
          period_month: monthStart,
        })
        .select()
        .single(),
      "a month-specific budget",
    );
    await alice.db.from("budgets").delete().eq("id", override.id);
  });

  await check("a budget period must be the first of a month", async () => {
    expectDenied(
      await alice.db
        .from("budgets")
        .insert({
          group_id: goa.id,
          category_id: groupCategory.id,
          amount: 500,
          period_month: `${today.slice(0, 7)}-17`,
        })
        .select(),
      "a mid-month budget period",
    );
  });

  await check("a group budget cannot point at a personal category", async () => {
    expectDenied(
      await alice.db
        .from("budgets")
        .insert({ group_id: goa.id, category_id: personalCategory.id, amount: 500 })
        .select(),
      "a group budget on a personal category",
    );
  });

  // -- Group expenses --------------------------------------------------------

  group("Group expenses");

  const bobExpense = expectOk(
    await bob.db
      .from("expenses")
      .insert({
        user_id: bob.id,
        group_id: goa.id,
        paid_by: alice.id,
        category_id: groupCategory.id,
        item_name: "Beach shack dinner",
        amount: 3200,
        currency_code: "INR",
        expense_date: today,
        payment_mode: "cash",
      })
      .select()
      .single(),
    "a member recording a group expense paid by another member",
  );

  await check("every member can read it", async () => {
    const { data } = await alice.db.from("expenses").select("*").eq("id", bobExpense.id);
    assert(data?.length === 1, "the admin cannot read a member's group expense");
  });

  await check("a non-member cannot read it", async () => {
    const { data } = await mallory.db.from("expenses").select("*").eq("id", bobExpense.id);
    assert(data?.length === 0, "Mallory can read a group expense");
  });

  await check("a non-member cannot add a group expense", async () => {
    expectDenied(
      await mallory.db
        .from("expenses")
        .insert({
          user_id: mallory.id,
          group_id: goa.id,
          paid_by: mallory.id,
          item_name: "Gatecrash",
          amount: 10,
          currency_code: "INR",
          expense_date: today,
        })
        .select(),
      "a non-member adding a group expense",
    );
  });

  await check("paid_by must be a member of the group", async () => {
    expectDenied(
      await bob.db
        .from("expenses")
        .insert({
          user_id: bob.id,
          group_id: goa.id,
          paid_by: mallory.id,
          item_name: "Paid by an outsider",
          amount: 10,
          currency_code: "INR",
          expense_date: today,
        })
        .select(),
      "paid_by pointing at a non-member",
    );
  });

  await check("a group expense must use the group's currency", async () => {
    expectDenied(
      await bob.db
        .from("expenses")
        .insert({
          user_id: bob.id,
          group_id: goa.id,
          paid_by: bob.id,
          item_name: "Wrong currency",
          amount: 10,
          currency_code: "USD",
          expense_date: today,
        })
        .select(),
      "a USD expense in an INR group",
    );
  });

  await check("a group expense cannot use a personal category", async () => {
    expectDenied(
      await bob.db
        .from("expenses")
        .insert({
          user_id: bob.id,
          group_id: goa.id,
          paid_by: bob.id,
          category_id: personalCategory.id,
          item_name: "Wrong category",
          amount: 10,
          currency_code: "INR",
          expense_date: today,
        })
        .select(),
      "a group expense in someone's personal category",
    );
  });

  await check("the author can edit their own group expense", async () => {
    expectOk(
      await bob.db.from("expenses").update({ amount: 3500 }).eq("id", bobExpense.id).select(),
      "the author editing their expense",
    );
  });

  await check("the admin can edit any group expense", async () => {
    expectOk(
      await alice.db.from("expenses").update({ notes: "Split later" }).eq("id", bobExpense.id).select(),
      "the admin editing a member's expense",
    );
  });

  const aliceGroupExpense = expectOk(
    await alice.db
      .from("expenses")
      .insert({
        user_id: alice.id,
        group_id: goa.id,
        paid_by: alice.id,
        item_name: "Taxi",
        amount: 900,
        currency_code: "INR",
        expense_date: today,
      })
      .select()
      .single(),
    "the admin recording a group expense",
  );

  await check("a member cannot delete another member's expense", async () => {
    await bob.db.from("expenses").delete().eq("id", aliceGroupExpense.id);
    const { data } = await alice.db.from("expenses").select("id").eq("id", aliceGroupExpense.id);
    assert(data?.length === 1, "a member deleted the admin's expense");
  });

  await check("a member cannot move a group expense into their private records", async () => {
    await bob.db.from("expenses").update({ group_id: null }).eq("id", bobExpense.id);
    const { data } = await alice.db.from("expenses").select("group_id").eq("id", bobExpense.id);
    assert(data[0].group_id === goa.id, "a group expense was moved out of the group");
  });

  await check("a member cannot reassign an expense to another owner", async () => {
    await bob.db.from("expenses").update({ user_id: alice.id }).eq("id", bobExpense.id);
    const { data } = await alice.db.from("expenses").select("user_id").eq("id", bobExpense.id);
    assert(data[0].user_id === bob.id, "the recorder of an expense was rewritten");
  });

  await check("archived categories cannot be used for new expenses", async () => {
    await alice.db.from("categories").update({ is_archived: true }).eq("id", groupCategory.id);
    expectDenied(
      await bob.db
        .from("expenses")
        .insert({
          user_id: bob.id,
          group_id: goa.id,
          paid_by: bob.id,
          category_id: groupCategory.id,
          item_name: "Archived category",
          amount: 10,
          currency_code: "INR",
          expense_date: today,
        })
        .select(),
      "an expense in an archived category",
    );
    await alice.db.from("categories").update({ is_archived: false }).eq("id", groupCategory.id);
  });

  // -- Admin-only group settings ---------------------------------------------

  group("Group administration");

  await check("a member cannot rename the group", async () => {
    await bob.db.from("groups").update({ name: "Bob's Trip" }).eq("id", goa.id);
    const { data } = await alice.db.from("groups").select("name").eq("id", goa.id);
    assert(data[0].name === "Goa Trip 2026", "a member renamed the group");
  });

  await check("a member cannot change the group currency", async () => {
    await bob.db.from("groups").update({ currency_code: "USD" }).eq("id", goa.id);
    const { data } = await alice.db.from("groups").select("currency_code").eq("id", goa.id);
    assert(data[0].currency_code === "INR", "a member changed the currency");
  });

  await check("the currency cannot change once expenses exist", async () => {
    expectDenied(
      await alice.db.from("groups").update({ currency_code: "USD" }).eq("id", goa.id).select(),
      "changing currency with expenses recorded",
    );
  });

  await check("a member cannot promote themselves to admin", async () => {
    await bob.db
      .from("group_members")
      .update({ role: "admin" })
      .eq("group_id", goa.id)
      .eq("user_id", bob.id);
    const { data } = await alice.db
      .from("group_members")
      .select("role")
      .eq("group_id", goa.id)
      .eq("user_id", bob.id);
    assert(data[0].role === "member", "a member promoted themselves");
  });

  await check("a member cannot remove the admin", async () => {
    await bob.db.from("group_members").delete().eq("group_id", goa.id).eq("user_id", alice.id);
    const { data } = await alice.db
      .from("group_members")
      .select("id")
      .eq("group_id", goa.id)
      .eq("user_id", alice.id);
    assert(data?.length === 1, "a member removed the admin");
  });

  await check("a member cannot delete the group", async () => {
    await bob.db.from("groups").delete().eq("id", goa.id);
    const { data } = await alice.db.from("groups").select("id").eq("id", goa.id);
    assert(data?.length === 1, "a member deleted the group");
  });

  await check("the last admin cannot leave the group", async () => {
    expectDenied(
      await alice.db
        .from("group_members")
        .delete()
        .eq("group_id", goa.id)
        .eq("user_id", alice.id)
        .select(),
      "the only admin leaving",
    );
  });

  await check("a member can leave of their own accord", async () => {
    expectOk(
      await bob.db
        .from("group_members")
        .delete()
        .eq("group_id", goa.id)
        .eq("user_id", bob.id)
        .select(),
      "a member leaving",
    );
    const { data } = await bob.db.from("expenses").select("id").eq("group_id", goa.id);
    assert(data?.length === 0, "a former member can still read group expenses");

    const { data: kept } = await alice.db.from("expenses").select("id").eq("id", bobExpense.id);
    assert(kept?.length === 1, "leaving deleted the expenses the member had recorded");
  });

  // -- Unauthenticated -------------------------------------------------------

  group("Unauthenticated access");

  for (const table of [
    "profiles",
    "groups",
    "group_members",
    "group_invitations",
    "categories",
    "budgets",
    "expenses",
  ]) {
    await check(`anon cannot read ${table}`, async () => {
      const { data, error } = await anon.from(table).select("*").limit(1);
      assert(error !== null || (data?.length ?? 0) === 0, `anon read rows from ${table}`);
    });
  }

  await check("anon cannot write", async () => {
    expectDenied(
      await anon
        .from("expenses")
        .insert({
          user_id: alice.id,
          paid_by: alice.id,
          item_name: "Anonymous",
          amount: 10,
          expense_date: today,
        })
        .select(),
      "an unauthenticated insert",
    );
  });

  // -- Cascades --------------------------------------------------------------

  group("Cleanup behaviour");

  await check("an admin can delete a group that has expenses", async () => {
    expectOk(await alice.db.from("groups").delete().eq("id", goa.id).select(), "deleting the group");
    const { data } = await alice.db.from("expenses").select("id").eq("id", bobExpense.id);
    assert(data?.length === 0, "group expenses outlived the group");
  });

  await check("deleting a category leaves its expenses uncategorised", async () => {
    await alice.db.from("categories").delete().eq("id", personalCategory.id);
    const { data } = await alice.db.from("expenses").select("id, category_id").eq("id", personalExpense.id);
    assert(data?.length === 1, "deleting a category deleted the expense");
    assert(data[0].category_id === null, "category_id was not cleared");
  });
}

// ---------------------------------------------------------------------------

try {
  await run();
} catch (error) {
  failures.push({ section: section || "setup", name: "suite aborted", message: error.message });
  console.error(`\nSuite aborted: ${error.message}`);
} finally {
  await cleanup();
}

console.log(`\n${passed} passed, ${failures.length} failed`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) {
    console.log(`  [${failure.section}] ${failure.name}\n    ${failure.message}`);
  }
  process.exit(1);
}
