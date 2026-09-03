#!/usr/bin/env node
/**
 * End-to-end test suite for Phase 5, groups and invitations.
 *
 * Two surfaces are exercised, because both are real:
 *
 *   1. The running application over HTTP, as a signed-in browser would use it.
 *      Groups are created, invitations sent, accepted and revoked, and members
 *      promoted and removed by submitting the *actual forms* — hidden Server
 *      Action fields and all — which is the no-JavaScript path, so it runs the
 *      Server Actions themselves rather than a re-implementation of them.
 *
 *   2. PostgREST directly, with each user's own JWT. That is what an attacker
 *      reaches when they skip the UI, so every authorization claim is proved
 *      there rather than by the absence of a button.
 *
 *   npm run dev                     (in another terminal)
 *   npm run verify:groups
 *
 * Needs, in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY   — used only to create and delete the throwaway
 *                                 accounts, and to age one invitation past its
 *                                 expiry, which no policy allows a user to do.
 *
 * Set BASE_URL to test something other than http://localhost:3000.
 *
 * The test users and all their data are deleted at the end, even on failure.
 */

import { createHash, randomBytes } from "node:crypto";
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

/**
 * The `<form>` matching every string in `include` and none in `exclude`.
 * A group page carries several forms, some sharing a field name, so they are
 * picked apart by the values they carry rather than by position.
 */
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

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

/**
 * The token from an invite the application just created.
 *
 * When no email provider is configured — or the provider rejects the message —
 * the action hands the one-time link back, and that is the real token to test
 * with. When the mail actually goes out there is nothing to intercept: only
 * the hash was stored, by design. In that case the invitation is re-issued
 * with a token this suite chose, so the acceptance path is still exercised
 * end to end without the result depending on how mail is configured.
 */
async function tokenFromInvite(result, { groupId, email, role, invitedBy }) {
  const match = result.text.match(/(https?:\/\/[^"\\ ]+\/invite\/[A-Za-z0-9_-]+)/);

  if (match) {
    return { token: match[1].split("/invite/")[1], fromLink: true };
  }

  const token = randomBytes(32).toString("base64url");

  const { error: revokeError } = await admin
    .from("group_invitations")
    .update({ status: "revoked" })
    .eq("group_id", groupId)
    .eq("email", email)
    .eq("status", "pending");
  if (revokeError) throw new Error(`re-issue (revoke): ${revokeError.message}`);

  const { error } = await admin.from("group_invitations").insert({
    group_id: groupId,
    email,
    role,
    token_hash: sha256(token),
    invited_by: invitedBy,
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  if (error) throw new Error(`re-issue (insert): ${error.message}`);

  return { token, fromLink: false };
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

  const owner = await createUser("gowner", "Ada Owner");
  const mate = await createUser("gmate", "Rahul Mate");
  const stranger = await createUser("gstranger", "Grace Stranger");

  let groupId = "";
  let inviteToken = "";
  let tokenCameFromLink = false;

  // -------------------------------------------------------------------------
  group("Empty state");

  await check("a user with no groups is invited to create one", async () => {
    const page = await getPage(owner, "/groups");
    assert(page.status === 200, `expected 200, got ${page.status}`);
    assertIncludes(page.html, "You haven&#x27;t joined any groups yet", "empty state");
    assertIncludes(page.html, "/groups/new", "empty state offers the create link");
  });

  // -------------------------------------------------------------------------
  group("Creating a group");

  await check("the create form saves a group and redirects to it", async () => {
    const result = await submitForm(owner, "/groups/new", {
      include: ['name="name"'],
      values: {
        name: "Goa Trip 2026",
        description: "Shared costs for the September trip.",
        currencyCode: "INR",
      },
    });

    assert(result.redirect, `no redirect; response began ${result.text.slice(0, 200)}`);
    assert(
      result.redirect.includes("flash=group-created"),
      `unexpected redirect: ${result.redirect}`,
    );
    groupId = result.redirect.replace("/groups/", "").split("?")[0];
    assert(/^[0-9a-f-]{36}$/.test(groupId), `unexpected group id: ${groupId}`);
  });

  await check("the creator is stored as the group's admin", async () => {
    const { data, error } = await owner.db
      .from("group_members")
      .select("user_id, role")
      .eq("group_id", groupId);
    assert(!error, error?.message);
    assert(data.length === 1, `expected 1 member, got ${data.length}`);
    assert(data[0].user_id === owner.id, "the creator is not the member");
    assert(data[0].role === "admin", `expected admin, got ${data[0].role}`);
  });

  await check("the group stores the chosen currency as its ISO code", async () => {
    const { data } = await owner.db
      .from("groups")
      .select("name, description, currency_code")
      .eq("id", groupId)
      .single();
    assert(data.currency_code === "INR", `expected INR, got ${data.currency_code}`);
    assert(data.name === "Goa Trip 2026", `unexpected name: ${data.name}`);
    assert(
      data.description === "Shared costs for the September trip.",
      `unexpected description: ${data.description}`,
    );
  });

  await check("an empty name is rejected", async () => {
    const result = await submitForm(owner, "/groups/new", {
      include: ['name="name"'],
      values: { name: "   ", description: "", currencyCode: "INR" },
    });
    assert(!result.redirect, "an empty name was accepted");
    assertIncludes(result.text, "Group name is required", "validation message");
  });

  await check("a currency outside the list is rejected", async () => {
    const result = await submitForm(owner, "/groups/new", {
      include: ['name="name"'],
      values: { name: "Bad currency", description: "", currencyCode: "XYZ" },
    });
    assert(!result.redirect, "an unknown currency was accepted");
    assertIncludes(result.text, "Choose a currency from the list", "validation message");
  });

  await check("the group page shows its name, currency and member", async () => {
    const page = await getPage(owner, `/groups/${groupId}`);
    assert(page.status === 200, `expected 200, got ${page.status}`);
    assertIncludes(page.html, "Goa Trip 2026", "group name");
    assertIncludes(page.html, "Indian Rupee (INR)", "currency context");
    assertIncludes(page.html, "Ada Owner", "member name");
  });

  await check("the group appears in the creator's list", async () => {
    const page = await getPage(owner, "/groups");
    assertIncludes(page.html, "Goa Trip 2026", "group list");
    assertIncludes(page.html, "1 member", "member count");
  });

  await check("a non-member cannot see the group at all", async () => {
    const page = await getPage(stranger, `/groups/${groupId}`);
    assertNotFound(page, "stranger on the group page");
    assertExcludes(page.raw, "Goa Trip 2026", "stranger's response");

    const { data } = await stranger.db.from("groups").select("id").eq("id", groupId);
    assert(data.length === 0, "PostgREST returned the group to a non-member");
  });

  await check("a non-member cannot see the group in their own list", async () => {
    const page = await getPage(stranger, "/groups");
    assertExcludes(page.html, "Goa Trip 2026", "stranger's group list");
  });

  // -------------------------------------------------------------------------
  group("Invitations");

  await check("an admin can invite by email", async () => {
    const result = await submitForm(owner, `/groups/${groupId}`, {
      include: ['name="email"'],
      values: { email: mate.email.toUpperCase(), role: "member" },
    });

    assert(
      result.text.includes("has been invited"),
      `unexpected invite result: ${result.text.slice(0, 300)}`,
    );

    const resolved = await tokenFromInvite(result, {
      groupId,
      email: mate.email.toLowerCase(),
      role: "member",
      invitedBy: owner.id,
    });
    inviteToken = resolved.token;
    tokenCameFromLink = resolved.fromLink;
  });

  await check("the invitation is stored pending, with the email normalised", async () => {
    const { data } = await owner.db
      .from("group_invitations")
      .select("email, role, status, expires_at, invited_by")
      .eq("group_id", groupId)
      .eq("status", "pending");
    assert(data.length === 1, `expected 1 pending invitation, got ${data.length}`);
    assert(data[0].email === mate.email.toLowerCase(), `unexpected email: ${data[0].email}`);
    assert(data[0].role === "member", `unexpected role: ${data[0].role}`);
    assert(data[0].invited_by === owner.id, "invited_by is not the admin");
    assert(
      new Date(data[0].expires_at).getTime() > Date.now(),
      "the invitation is already expired",
    );
  });

  await check("only the token's hash is stored, never the token", async () => {
    const { data } = await admin
      .from("group_invitations")
      .select("token_hash")
      .eq("group_id", groupId)
      .eq("status", "pending")
      .single();
    assert(/^[0-9a-f]{64}$/.test(data.token_hash), `not a sha-256 hex: ${data.token_hash}`);
    assert(data.token_hash === sha256(inviteToken), "the stored hash is not the token's hash");
    assert(data.token_hash !== inviteToken, "the token itself was stored");
    if (!tokenCameFromLink) {
      console.log("        (email was delivered, so the token was re-issued by the suite)");
    }
  });

  await check("the token never appears on the group page", async () => {
    const page = await getPage(owner, `/groups/${groupId}`);
    assertExcludes(page.raw, inviteToken, "group page HTML");
    assertIncludes(page.html, mate.email.toLowerCase(), "pending invitation is listed");
  });

  await check("a second invitation to the same address is refused", async () => {
    const result = await submitForm(owner, `/groups/${groupId}`, {
      include: ['name="email"'],
      values: { email: mate.email, role: "member" },
    });
    assertIncludes(result.text, "already has a pending invitation", "duplicate message");

    const { count } = await owner.db
      .from("group_invitations")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupId)
      .eq("status", "pending");
    assert(count === 1, `expected 1 pending invitation after the duplicate, got ${count}`);
  });

  await check("an admin cannot invite themselves", async () => {
    const result = await submitForm(owner, `/groups/${groupId}`, {
      include: ['name="email"'],
      values: { email: owner.email, role: "member" },
    });
    assertIncludes(result.text, "already in this group", "self-invite message");
  });

  await check("a malformed email is rejected", async () => {
    const result = await submitForm(owner, `/groups/${groupId}`, {
      include: ['name="email"'],
      values: { email: "not-an-email", role: "member" },
    });
    assertIncludes(result.text, "Enter a valid email address", "validation message");
  });

  await check("a non-admin cannot create an invitation through PostgREST", async () => {
    const { error } = await stranger.db.from("group_invitations").insert({
      group_id: groupId,
      email: "someone@example.test",
      token_hash: "a".repeat(64),
      invited_by: stranger.id,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    assert(error, "a non-member created an invitation");
  });

  await check("a non-member cannot read a group's invitations", async () => {
    const { data } = await stranger.db
      .from("group_invitations")
      .select("id, email")
      .eq("group_id", groupId);
    assert(data.length === 0, "a non-member read the invitations");
  });

  // -------------------------------------------------------------------------
  group("Invitation links");

  await check("the invitation page names the group and the inviter", async () => {
    const page = await getPage(mate, `/invite/${inviteToken}`);
    assert(page.status === 200, `expected 200, got ${page.status}`);
    assertIncludes(page.html, "Goa Trip 2026", "group name");
    assertIncludes(page.html, "Ada Owner", "inviter name");
    assertIncludes(page.html, "Indian Rupee (INR)", "currency");
  });

  await check("the invitation page is marked noindex", async () => {
    const page = await getPage(mate, `/invite/${inviteToken}`);
    assertIncludes(page.raw, "noindex", "robots meta");
  });

  await check("a link for someone else does not disclose the address", async () => {
    const page = await getPage(stranger, `/invite/${inviteToken}`);
    assert(page.status === 200, `expected 200, got ${page.status}`);
    assertIncludes(page.html, "sent to a different address", "wrong-account copy");
    assertExcludes(page.html, mate.email.toLowerCase(), "the invited address in the clear");
    assertIncludes(page.html, "•••@", "masked address");
  });

  await check("a made-up token is handled as an invalid link", async () => {
    const page = await getPage(mate, "/invite/notarealtokenatall12345");
    assert(page.status === 200, `expected 200, got ${page.status}`);
    assertIncludes(page.html, "isn&#x27;t valid", "invalid link copy");
  });

  await check("an anonymous visitor is sent to sign in and back again", async () => {
    const page = await getPage(null, `/invite/${inviteToken}`);
    assert(page.status === 307, `expected a redirect, got ${page.status}`);
    assert(
      page.location?.includes(`next=%2Finvite%2F${inviteToken}`),
      `unexpected redirect: ${page.location}`,
    );
  });

  await check("the wrong account cannot accept the invitation", async () => {
    const { error } = await stranger.db.from("group_members").insert({
      group_id: groupId,
      user_id: stranger.id,
      role: "member",
    });
    assert(error, "a stranger joined a group they were not invited to");

    const { data } = await stranger.db
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", stranger.id);
    assert(data.length === 0, "the stranger's membership was created anyway");
  });

  await check("an invitee cannot upgrade themselves to admin while accepting", async () => {
    const { error } = await mate.db.from("group_members").insert({
      group_id: groupId,
      user_id: mate.id,
      // The invitation grants "member"; the policy insists the roles agree.
      role: "admin",
    });
    assert(error, "an invitee joined as an admin against a member invitation");
  });

  await check("the invitee cannot see the group before accepting", async () => {
    const page = await getPage(mate, `/groups/${groupId}`);
    assertNotFound(page, "invitee on the group page before accepting");

    const { data } = await mate.db.from("groups").select("id").eq("id", groupId);
    assert(data.length === 0, "an unaccepted invitee could read the group");
  });

  await check("the invitee accepts and becomes a member", async () => {
    const result = await submitForm(mate, `/invite/${inviteToken}`, {
      include: ['name="token"'],
    });
    assert(
      result.redirect?.includes("flash=invitation-accepted"),
      `unexpected result: ${result.redirect ?? result.text.slice(0, 200)}`,
    );

    const { data } = await mate.db
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", mate.id);
    assert(data.length === 1, "the membership was not created");
    assert(data[0].role === "member", `unexpected role: ${data[0].role}`);
  });

  await check("accepting closes the invitation", async () => {
    const { data } = await owner.db
      .from("group_invitations")
      .select("status, accepted_at, accepted_by")
      .eq("group_id", groupId)
      .eq("status", "accepted")
      .single();
    assert(data.status === "accepted", `unexpected status: ${data.status}`);
    assert(data.accepted_at, "accepted_at was not recorded");
    assert(data.accepted_by === mate.id, "accepted_by is not the invitee");
  });

  await check("the same link cannot be used twice", async () => {
    const page = await getPage(mate, `/invite/${inviteToken}`);
    assertIncludes(page.html, "already in", "already-a-member copy");
  });

  await check("the new member can now see the group and its members", async () => {
    const page = await getPage(mate, `/groups/${groupId}`);
    assert(page.status === 200, `expected 200, got ${page.status}`);
    assertIncludes(page.html, "Goa Trip 2026", "group name");
    assertIncludes(page.html, "Ada Owner", "the admin's name");
    assertIncludes(page.html, "Rahul Mate", "their own name");
  });

  await check("inviting an address that already belongs to a member is refused", async () => {
    const result = await submitForm(owner, `/groups/${groupId}`, {
      include: ['name="email"'],
      values: { email: mate.email, role: "member" },
    });
    assertIncludes(result.text, "already a member", "duplicate membership message");
  });

  // -------------------------------------------------------------------------
  group("In-app invitations");

  let inboxInvitationId = "";

  await check("an invitation appears in the invitee's in-app list", async () => {
    const result = await submitForm(owner, `/groups/${groupId}`, {
      include: ['name="email"'],
      values: { email: stranger.email, role: "member" },
    });
    assertIncludes(result.text, "has been invited", "invite result");

    const page = await getPage(stranger, "/invitations");
    assert(page.status === 200, `expected 200, got ${page.status}`);
    assertIncludes(page.html, "Goa Trip 2026", "group name in the inbox");
    assertIncludes(page.html, "Ada Owner", "inviter name in the inbox");
    assertIncludes(page.html, "Accept", "accept control");
    assertIncludes(page.html, "Decline", "decline control");
  });

  await check("the header shows a notification count", async () => {
    const page = await getPage(stranger, "/dashboard");
    assertIncludes(page.html, "Invitations, 1 waiting", "notification bell label");
  });

  await check("nobody else sees that invitation in their own list", async () => {
    const page = await getPage(mate, "/invitations");
    assertExcludes(page.html, "Goa Trip 2026", "another user's inbox");
    assertIncludes(page.html, "No invitations waiting", "empty state");

    const { data } = await mate.db.rpc("my_pending_invitations");
    assert((data ?? []).length === 0, "my_pending_invitations leaked a row");
  });

  await check("the in-app list never exposes a token", async () => {
    const page = await getPage(stranger, "/invitations");
    assertExcludes(page.raw, "token_hash", "invitations page");
    assert(
      !/\/invite\/[A-Za-z0-9_-]{16,}/.test(page.raw),
      "an invitation link appeared on the in-app page",
    );
  });

  await check("the invitee can decline in the app", async () => {
    const { data: rows } = await stranger.db.rpc("my_pending_invitations");
    assert((rows ?? []).length === 1, `expected 1 invitation, got ${rows?.length}`);
    inboxInvitationId = rows[0].invitation_id;

    const result = await submitForm(stranger, "/invitations", {
      include: [`value="${inboxInvitationId}"`, "Decline"],
      values: {},
    });
    assert(
      result.redirect?.includes("flash=invitation-declined"),
      `unexpected result: ${result.redirect ?? result.text.slice(0, 200)}`,
    );

    const { data } = await admin
      .from("group_invitations")
      .select("status")
      .eq("id", inboxInvitationId)
      .single();
    assert(data.status === "declined", `unexpected status: ${data.status}`);
  });

  await check("declining does not join the group", async () => {
    const { data } = await admin
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", stranger.id);
    assert(data.length === 0, "declining created a membership");

    const page = await getPage(stranger, `/groups/${groupId}`);
    assertNotFound(page, "declined invitee on the group page");
  });

  await check("a declined invitation can no longer be accepted", async () => {
    const { error } = await stranger.db.from("group_members").insert({
      group_id: groupId,
      user_id: stranger.id,
      role: "member",
    });
    assert(error, "a declined invitation was accepted");
  });

  await check("the admin sees it as declined", async () => {
    const page = await getPage(owner, `/groups/${groupId}`);
    assertIncludes(page.html, "Declined", "declined badge");
    assertIncludes(page.html, "invite them again", "re-invite hint");
  });

  await check("declining cannot promote the invitee or extend the deadline", async () => {
    const before = await admin
      .from("group_invitations")
      .select("role, expires_at")
      .eq("id", inboxInvitationId)
      .single();

    // A crafted PostgREST write, which is what the policy actually has to hold
    // against — the form is not the boundary.
    await stranger.db
      .from("group_invitations")
      .update({ role: "admin", expires_at: "2099-01-01T00:00:00Z" })
      .eq("id", inboxInvitationId);

    const after = await admin
      .from("group_invitations")
      .select("role, expires_at, status")
      .eq("id", inboxInvitationId)
      .single();

    assert(after.data.role === before.data.role, `role changed to ${after.data.role}`);
    assert(
      after.data.expires_at === before.data.expires_at,
      `expires_at changed to ${after.data.expires_at}`,
    );
  });

  await check("an invitee cannot revoke, accept or re-open their own invitation", async () => {
    const { data: fresh } = await admin
      .from("group_invitations")
      .insert({
        group_id: groupId,
        email: stranger.email.toLowerCase(),
        role: "member",
        token_hash: sha256(randomBytes(32).toString("base64url")),
        invited_by: owner.id,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();

    for (const status of ["revoked", "expired", "accepted"]) {
      const { data } = await stranger.db
        .from("group_invitations")
        .update({ status })
        .eq("id", fresh.id)
        .select("id");
      assert(!data || data.length === 0, `an invitee set status to ${status}`);
    }

    const { data: after } = await admin
      .from("group_invitations")
      .select("status")
      .eq("id", fresh.id)
      .single();
    assert(after.status === "pending", `status became ${after.status}`);

    // Tidy up so the "one pending per email" slot is free for later checks.
    await admin.from("group_invitations").delete().eq("id", fresh.id);
  });

  await check("the invitee accepts a fresh invitation from the app", async () => {
    const result = await submitForm(owner, `/groups/${groupId}`, {
      include: ['name="email"'],
      values: { email: stranger.email, role: "member" },
    });
    assertIncludes(result.text, "has been invited", "re-invite result");

    const { data: rows } = await stranger.db.rpc("my_pending_invitations");
    assert((rows ?? []).length === 1, `expected 1 invitation, got ${rows?.length}`);

    const accept = await submitForm(stranger, "/invitations", {
      include: [`value="${rows[0].invitation_id}"`, "Accept"],
      values: {},
    });
    assert(
      accept.redirect?.includes("flash=invitation-accepted"),
      `unexpected result: ${accept.redirect ?? accept.text.slice(0, 200)}`,
    );

    const { data } = await stranger.db
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", stranger.id);
    assert(data.length === 1, "the membership was not created");
    assert(data[0].role === "member", `unexpected role: ${data[0].role}`);
  });

  await check("the inbox and the badge empty out once accepted", async () => {
    const page = await getPage(stranger, "/invitations");
    assertIncludes(page.html, "No invitations waiting", "empty state");
    assertExcludes(page.html, "Invitations, 1 waiting", "stale notification count");
  });

  await check("the accepted member is removed again for the checks that follow", async () => {
    const { data: membership } = await admin
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", stranger.id)
      .single();

    const { error } = await admin.from("group_members").delete().eq("id", membership.id);
    assert(!error, error?.message);
  });

  // -------------------------------------------------------------------------
  group("Expired and revoked invitations");

  let expiredToken = "";

  await check("an expired invitation cannot be accepted", async () => {
    // Written directly, with the service role and dates in the past. An
    // existing invitation cannot simply be aged: `expires_at > created_at` is
    // a check constraint, so an expired one has to be born that way — and no
    // policy lets a user back-date one, which is the point.
    expiredToken = randomBytes(32).toString("base64url");

    const { error: insertError } = await admin.from("group_invitations").insert({
      group_id: groupId,
      email: stranger.email.toLowerCase(),
      role: "member",
      token_hash: sha256(expiredToken),
      invited_by: owner.id,
      created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      expires_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
    assert(!insertError, insertError?.message);

    const { error } = await stranger.db.from("group_members").insert({
      group_id: groupId,
      user_id: stranger.id,
      role: "member",
    });
    assert(error, "an expired invitation was accepted");
  });

  await check("the invitation page says it has expired", async () => {
    const page = await getPage(stranger, `/invite/${expiredToken}`);
    assertIncludes(page.html, "has expired", "expired copy");
  });

  await check("the admin sees it as expired and can re-invite", async () => {
    const page = await getPage(owner, `/groups/${groupId}`);
    assertIncludes(page.html, "Expired", "expired badge");

    const result = await submitForm(owner, `/groups/${groupId}`, {
      include: ['name="email"'],
      values: { email: stranger.email, role: "member" },
    });
    assertIncludes(result.text, "has been invited", "re-invite result");
  });

  await check("a revoked invitation cannot be accepted", async () => {
    const { data: pending } = await owner.db
      .from("group_invitations")
      .select("id")
      .eq("group_id", groupId)
      .eq("status", "pending")
      .single();

    const result = await submitForm(owner, `/groups/${groupId}`, {
      include: [`value="${pending.id}"`],
      values: {},
    });
    assert(
      result.redirect?.includes("flash=invitation-revoked"),
      `unexpected result: ${result.redirect ?? result.text.slice(0, 200)}`,
    );

    const { error } = await stranger.db.from("group_members").insert({
      group_id: groupId,
      user_id: stranger.id,
      role: "member",
    });
    assert(error, "a revoked invitation was accepted");
  });

  await check("a member cannot revoke invitations", async () => {
    const { data: invitation } = await admin
      .from("group_invitations")
      .select("id")
      .eq("group_id", groupId)
      .limit(1)
      .single();

    const { data } = await mate.db
      .from("group_invitations")
      .update({ status: "revoked" })
      .eq("id", invitation.id)
      .select("id");
    assert(!data || data.length === 0, "a member revoked an invitation");
  });

  // -------------------------------------------------------------------------
  group("Roles and permissions");

  await check("a member does not see admin controls", async () => {
    const page = await getPage(mate, `/groups/${groupId}`);
    assertExcludes(page.html, "Invite people", "invite panel shown to a member");
    assertExcludes(page.html, "Group settings", "settings link shown to a member");
  });

  await check("a member cannot open group settings", async () => {
    const page = await getPage(mate, `/groups/${groupId}/settings`);
    assertNotFound(page, "member on the settings page");
  });

  await check("an admin can open group settings", async () => {
    const page = await getPage(owner, `/groups/${groupId}/settings`);
    assert(page.status === 200, `expected 200, got ${page.status}`);
    assertIncludes(page.html, "Delete this group", "danger zone");
  });

  await check("a member cannot rename the group", async () => {
    const { data } = await mate.db
      .from("groups")
      .update({ name: "Hijacked" })
      .eq("id", groupId)
      .select("id");
    assert(!data || data.length === 0, "a member renamed the group");

    const { data: after } = await mate.db
      .from("groups")
      .select("name")
      .eq("id", groupId)
      .single();
    assert(after.name === "Goa Trip 2026", `the name changed to ${after.name}`);
  });

  await check("a member cannot change the group's currency", async () => {
    const { data } = await mate.db
      .from("groups")
      .update({ currency_code: "USD" })
      .eq("id", groupId)
      .select("id");
    assert(!data || data.length === 0, "a member changed the currency");
  });

  await check("a member cannot promote themselves", async () => {
    const { data: membership } = await mate.db
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", mate.id)
      .single();

    const { data } = await mate.db
      .from("group_members")
      .update({ role: "admin" })
      .eq("id", membership.id)
      .select("id");
    assert(!data || data.length === 0, "a member promoted themselves");

    const { data: after } = await mate.db
      .from("group_members")
      .select("role")
      .eq("id", membership.id)
      .single();
    assert(after.role === "member", `the role changed to ${after.role}`);
  });

  await check("a member cannot remove the admin", async () => {
    const { data: adminMembership } = await mate.db
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", owner.id)
      .single();

    const { data } = await mate.db
      .from("group_members")
      .delete()
      .eq("id", adminMembership.id)
      .select("id");
    assert(!data || data.length === 0, "a member removed the admin");
  });

  await check("a member cannot delete the group", async () => {
    const { data } = await mate.db.from("groups").delete().eq("id", groupId).select("id");
    assert(!data || data.length === 0, "a member deleted the group");
  });

  await check("an admin can update the group's details", async () => {
    const result = await submitForm(owner, `/groups/${groupId}/settings`, {
      include: ['name="name"'],
      values: {
        name: "Goa Trip 2026 ✈",
        description: "Updated description.",
        currencyCode: "USD",
      },
    });
    assert(
      result.redirect?.includes("flash=group-updated"),
      `unexpected result: ${result.redirect ?? result.text.slice(0, 200)}`,
    );

    const { data } = await owner.db
      .from("groups")
      .select("name, description, currency_code")
      .eq("id", groupId)
      .single();
    assert(data.name === "Goa Trip 2026 ✈", `unexpected name: ${data.name}`);
    assert(data.currency_code === "USD", `unexpected currency: ${data.currency_code}`);
  });

  await check("an admin can promote a member to admin", async () => {
    const { data: membership } = await owner.db
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", mate.id)
      .single();

    await submitForm(owner, `/groups/${groupId}`, {
      include: [`value="${membership.id}"`, 'name="role"'],
      values: { role: "admin" },
    });

    const { data } = await owner.db
      .from("group_members")
      .select("role")
      .eq("id", membership.id)
      .single();
    assert(data.role === "admin", `expected admin, got ${data.role}`);
  });

  await check("the promoted member now sees admin controls", async () => {
    const page = await getPage(mate, `/groups/${groupId}`);
    assertIncludes(page.html, "Invite people", "invite panel");
    assertIncludes(page.html, "Group settings", "settings link");
  });

  await check("an admin can demote another admin back to member", async () => {
    const { data: membership } = await owner.db
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", mate.id)
      .single();

    await submitForm(owner, `/groups/${groupId}`, {
      include: [`value="${membership.id}"`, 'name="role"'],
      values: { role: "member" },
    });

    const { data } = await owner.db
      .from("group_members")
      .select("role")
      .eq("id", membership.id)
      .single();
    assert(data.role === "member", `expected member, got ${data.role}`);
  });

  await check("the last admin cannot be demoted", async () => {
    const { data: membership } = await owner.db
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", owner.id)
      .single();

    const { error } = await owner.db
      .from("group_members")
      .update({ role: "member" })
      .eq("id", membership.id);
    assert(error, "the sole admin demoted themselves");
    assert(
      error.message.includes("at least one admin"),
      `unexpected error: ${error.message}`,
    );
  });

  await check("the sole admin is not offered a way to leave", async () => {
    const page = await getPage(owner, `/groups/${groupId}`);
    assertIncludes(page.html, "You&#x27;re the only admin", "sole-admin explanation");
  });

  await check("an admin can remove a member", async () => {
    const { data: membership } = await owner.db
      .from("group_members")
      .select("id")
      .eq("group_id", groupId)
      .eq("user_id", mate.id)
      .single();

    const result = await submitForm(owner, `/groups/${groupId}`, {
      include: [`value="${membership.id}"`],
      exclude: ['name="role"'],
      values: {},
    });
    assert(
      result.redirect?.includes("flash=member-removed"),
      `unexpected result: ${result.redirect ?? result.text.slice(0, 200)}`,
    );

    const { data } = await owner.db
      .from("group_members")
      .select("id")
      .eq("group_id", groupId);
    assert(data.length === 1, `expected 1 member left, got ${data.length}`);
  });

  await check("a removed member loses access immediately", async () => {
    const page = await getPage(mate, `/groups/${groupId}`);
    assertNotFound(page, "removed member on the group page");

    const { data } = await mate.db.from("groups").select("id").eq("id", groupId);
    assert(data.length === 0, "a removed member could still read the group");
  });

  // -------------------------------------------------------------------------
  group("Leaving and deleting");

  await check("a member can leave a group of their own accord", async () => {
    const second = await submitForm(owner, "/groups/new", {
      include: ['name="name"'],
      values: { name: "Flat Expenses", description: "", currencyCode: "INR" },
    });
    const secondId = second.redirect.replace("/groups/", "").split("?")[0];

    // Promote a second admin so the founder is not the last one standing.
    const { error: joinError } = await admin.from("group_members").insert({
      group_id: secondId,
      user_id: mate.id,
      role: "admin",
    });
    assert(!joinError, joinError?.message);

    const result = await submitForm(owner, `/groups/${secondId}`, {
      include: [`name="groupId"`],
      values: {},
    });
    assert(
      result.redirect?.includes("flash=group-left"),
      `unexpected result: ${result.redirect ?? result.text.slice(0, 200)}`,
    );

    const page = await getPage(owner, `/groups/${secondId}`);
    assertNotFound(page, "the group they left");
  });

  await check("an admin can delete a group", async () => {
    const result = await submitForm(owner, `/groups/${groupId}/settings`, {
      include: ['name="groupId"'],
      values: {},
    });
    assert(
      result.redirect?.includes("flash=group-deleted"),
      `unexpected result: ${result.redirect ?? result.text.slice(0, 200)}`,
    );

    const { data } = await admin.from("groups").select("id").eq("id", groupId);
    assert(data.length === 0, "the group survived deletion");
  });

  await check("deleting a group takes its members and invitations with it", async () => {
    const { data: members } = await admin
      .from("group_members")
      .select("id")
      .eq("group_id", groupId);
    assert(members.length === 0, "memberships outlived the group");

    const { data: invitations } = await admin
      .from("group_invitations")
      .select("id")
      .eq("group_id", groupId);
    assert(invitations.length === 0, "invitations outlived the group");
  });

  // -------------------------------------------------------------------------
  group("Unauthenticated access");

  await check("the group pages require a session", async () => {
    for (const path of ["/groups", "/groups/new", `/groups/${groupId}`]) {
      const page = await getPage(null, path);
      assert(page.status === 307, `${path}: expected 307, got ${page.status}`);
      assert(page.location?.includes("/sign-in"), `${path}: unexpected ${page.location}`);
    }
  });

  await check("anon cannot read invitations or call the preview function", async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data } = await anon.from("group_invitations").select("id");
    assert(!data || data.length === 0, "anon read invitations");

    const { error } = await anon.rpc("invitation_preview", {
      p_token_hash: "a".repeat(64),
    });
    assert(error, "anon called invitation_preview");
  });
}

// ---------------------------------------------------------------------------

try {
  await run();
} catch (error) {
  failures.push({ section: section || "setup", name: "suite", message: error.stack ?? String(error) });
  console.error(`\nThe suite stopped early: ${error.message}`);
} finally {
  console.log("\nCleaning up test accounts...");
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
