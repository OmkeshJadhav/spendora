#!/usr/bin/env node
/**
 * End-to-end test suite for Phase 10 — export.
 *
 * Three surfaces, because an export is a file rather than a page and each
 * layer can be wrong on its own:
 *
 *   1. The rendered list, over HTTP as a signed-in browser. The export links
 *      are ordinary anchors carrying the filters in force, so what the suite
 *      checks there is that the link a person would click is the link that
 *      describes what they are looking at.
 *
 *   2. The downloaded file itself — headers, filename, and every cell. A CSV
 *      is parsed back with a real RFC 4180 reader rather than split on commas,
 *      and an XLSX is opened with a ZIP reader written here, independently of
 *      the writer under test. A file that only the code that wrote it can read
 *      is not evidence of anything.
 *
 *   3. PostgREST directly, with each user's own JWT. An export is a new way to
 *      ask the database for rows; the claim worth testing is that it is not a
 *      way to ask a *wider* question than the list it came from.
 *
 *   npm run dev          (in another terminal)
 *   npm run verify:export
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
import { inflateRawSync } from "node:zlib";
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

function assertEqual(actual, expected, what) {
  assert(
    actual === expected,
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

// ---------------------------------------------------------------------------
// Dates, computed the way the application computes them
// ---------------------------------------------------------------------------

const iso = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const monthLabel = (year, month) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1),
  );

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

/** The month slug the filename should carry, e.g. `september-2026`. */
const monthSlug = ({ year, month }) =>
  monthLabel(year, month).toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Excel counts days from 30 December 1899 — see `xlsx.ts` for why the 30th. */
const excelSerial = (value) => {
  const [year, month, day] = value.split("-").map(Number);
  return Math.round(
    (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000,
  );
};

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

/** Strips the RSC payload, which repeats every href before the real markup. */
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

/** A download: headers plus the raw bytes, so a binary body survives. */
async function download(user, path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: user ? { cookie: cookieHeader(user) } : {},
    redirect: "manual",
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type") ?? "",
    disposition: response.headers.get("content-disposition") ?? "",
    cacheControl: response.headers.get("cache-control") ?? "",
    bytes,
    text: bytes.toString("utf8"),
    filename:
      (response.headers.get("content-disposition") ?? "").match(
        /filename="([^"]*)"/,
      )?.[1] ?? "",
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

function findForm(html, include, exclude = []) {
  const forms = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? [];
  const form = forms.find(
    (candidate) =>
      include.every((needle) => candidate.includes(needle)) &&
      exclude.every((needle) => !candidate.includes(needle)),
  );
  assert(form, `no form matching ${JSON.stringify(include)}`);
  return form;
}

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

async function submitForm(user, path, { include, exclude = [], values = {} }) {
  const page = await getPage(user, path);
  assert(page.status === 200, `GET ${path} returned ${page.status}`);

  const form = findForm(page.html, include, exclude);
  const body = new FormData();

  for (const [name, value] of hiddenFields(form)) body.append(name, value);
  for (const [name, value] of Object.entries(values)) body.append(name, value);

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
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
// Reading a CSV back
//
// A real RFC 4180 reader rather than a split on commas: half the point of the
// writer is that a note containing a comma, a quote or a newline survives the
// round trip, and a naive parser would agree with a broken writer.
// ---------------------------------------------------------------------------

const BOM = "﻿";

function parseCsv(text) {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (quoted) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" && body[index + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** The CSV as objects keyed by header, which is how the assertions read it. */
function csvRecords(text) {
  const [header, ...body] = parseCsv(text);
  assert(header, "the CSV had no header row");
  return body.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i]])));
}

// ---------------------------------------------------------------------------
// Reading an XLSX back
//
// A ZIP reader written from the format's own description, working backwards
// from the end-of-central-directory record the way any reader does. Written
// here rather than shared with `zip.ts` on purpose: a file only its own writer
// can open proves nothing, so the reader has to be a second opinion.
// ---------------------------------------------------------------------------

function unzip(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert(end !== -1, "no end-of-central-directory record: not a ZIP archive");

  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const parts = new Map();

  for (let index = 0; index < count; index += 1) {
    assertEqual(
      bytes.readUInt32LE(offset),
      0x02014b50,
      `central directory entry ${index} signature`,
    );

    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);

    assertEqual(
      bytes.readUInt32LE(localOffset),
      0x04034b50,
      `local header signature for ${name}`,
    );

    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);

    parts.set(name, method === 8 ? inflateRawSync(data).toString("utf8") : data.toString("utf8"));

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return parts;
}

/** Every `<c>` in the sheet, keyed by cell reference. */
function sheetCells(sheetXml) {
  const cells = new Map();

  for (const match of sheetXml.matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
    const [, ref, attributes, body] = match;
    const inline = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
    const value = body.match(/<v>([\s\S]*?)<\/v>/);

    cells.set(ref, {
      style: attributes.match(/\bs="(\d+)"/)?.[1] ?? "0",
      type: attributes.match(/\bt="([^"]*)"/)?.[1] ?? "",
      text: inline ? decodeEntities(inline[1]) : null,
      number: value ? Number(value[1]) : null,
    });
  }

  return cells;
}

// ---------------------------------------------------------------------------
// Form shorthands
// ---------------------------------------------------------------------------

const EXPENSES = "/expenses";
const PERSONAL_EXPORT = "/api/expenses/export";
const groupExpensesPath = (id) => `/groups/${id}/expenses`;
const groupExportPath = (id) => `/api/groups/${id}/expenses/export`;

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

/**
 * A `<a href="...">` exists on the page.
 *
 * The expected href is entity-encoded before matching, because React writes an
 * ampersand in an attribute as `&amp;` — so a link carrying two parameters is
 * never in the markup in the form it was written in.
 */
function hasLink(html, href) {
  const encoded = href.replaceAll("&", "&amp;");
  return html.includes(`href="${encoded}"`) || html.includes(`href="${encoded}&amp;`);
}

const EXPECTED_HEADERS = [
  "Date",
  "Item",
  "Amount",
  "Currency",
  "Paid by",
  "Category",
  "Payment mode",
  "Notes",
  "Created",
];

// The awkward text every writer has to survive: a formula, a comma, a quote,
// an ampersand, an angle bracket and a non-ASCII character all in one row.
const AWKWARD_ITEM = "=SUM(A1:A9)";
const AWKWARD_NOTES = 'Split 3 ways, "evenly" & <fairly> — café';

// ---------------------------------------------------------------------------
// The suite
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

  let foodId = "";
  let groupId = "";
  let groupFoodId = "";

  // -------------------------------------------------------------------------
  group("Nothing to export");

  await check("an empty list offers no export links", async () => {
    const page = await getPage(owner, EXPENSES);
    assertEqual(page.status, 200, `GET ${EXPENSES}`);
    assertIncludes(page.html, "No expenses yet", "the empty list");
    assertExcludes(page.html, PERSONAL_EXPORT, "the empty list");
  });

  // -------------------------------------------------------------------------
  group("Seeding");

  await check("personal expenses are recorded across two months", async () => {
    await addCategory(owner, "/categories", "Food");
    foodId = findByName(await categoriesOf(owner, { userId: owner.id }), "Food").id;

    await addPersonalExpense(owner, {
      itemName: "Groceries",
      amount: "2450.50",
      category: foodId,
      paymentMode: "upi",
      notes: "Weekly shopping",
      expenseDate: EARLY_DAY,
    });
    await addPersonalExpense(owner, {
      itemName: AWKWARD_ITEM,
      amount: "99.05",
      paymentMode: "cash",
      notes: AWKWARD_NOTES,
      expenseDate: LATE_DAY,
    });
    // Deliberately without a category or a payment mode, to prove an
    // unrecorded optional field exports as a blank rather than as a word.
    await addPersonalExpense(owner, {
      itemName: "Old bill",
      amount: "500",
      expenseDate: LAST_MONTH_DAY,
    });

    const { data, error } = await owner.db.from("expenses").select("id");
    assert(!error, error?.message);
    assertEqual(data.length, 3, "seeded personal expenses");
  });

  await check("a group with a second member and its own currency is created", async () => {
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
    groupFoodId = findByName(await categoriesOf(owner, { groupId }), "Group Food").id;

    await addGroupExpense(owner, groupId, {
      itemName: "Beach dinner",
      amount: "120.25",
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
      itemName: "Airport taxi",
      amount: "60",
      paymentMode: "cash",
      expenseDate: LAST_MONTH_DAY,
    });

    const { data, error: readError } = await owner.db
      .from("expenses")
      .select("id")
      .eq("group_id", groupId);
    assert(!readError, readError?.message);
    assertEqual(data.length, 3, "seeded group expenses");
  });

  // -------------------------------------------------------------------------
  group("The export controls");

  await check("a list with expenses offers both formats", async () => {
    const page = await getPage(owner, EXPENSES);
    assertIncludes(page.html, "Export these expenses", "the list");
    assert(hasLink(page.html, `${PERSONAL_EXPORT}?format=csv`), "no CSV link");
    assert(hasLink(page.html, `${PERSONAL_EXPORT}?format=xlsx`), "no Excel link");
  });

  await check("the export links carry the filters in force", async () => {
    const page = await getPage(owner, `${EXPENSES}?month=${THIS_MONTH}&paymentMode=cash`);
    assert(
      hasLink(page.html, `${PERSONAL_EXPORT}?paymentMode=cash&month=${THIS_MONTH}&format=csv`),
      "the CSV link did not carry the month and the payment mode",
    );
  });

  await check("a group list offers its own export links", async () => {
    const page = await getPage(owner, groupExpensesPath(groupId));
    assert(hasLink(page.html, `${groupExportPath(groupId)}?format=csv`), "no group CSV link");
    assert(hasLink(page.html, `${groupExportPath(groupId)}?format=xlsx`), "no group Excel link");
  });

  // -------------------------------------------------------------------------
  group("The CSV file");

  await check("it is served as a download, uncached, with the right type", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=csv`);
    assertEqual(file.status, 200, "GET the personal CSV");
    assertIncludes(file.contentType, "text/csv", "the content type");
    assertIncludes(file.contentType, "charset=utf-8", "the content type");
    assertIncludes(file.disposition, "attachment;", "the disposition");
    assertIncludes(file.cacheControl, "no-store", "the cache-control header");
  });

  await check("CSV is what a link with no format asks for", async () => {
    const file = await download(owner, PERSONAL_EXPORT);
    assertIncludes(file.contentType, "text/csv", "the default format");
    assert(file.filename.endsWith(".csv"), `the default filename was ${file.filename}`);
  });

  await check("an unreadable format falls back rather than failing", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=pdf`);
    assertEqual(file.status, 200, "GET with an unknown format");
    assertIncludes(file.contentType, "text/csv", "the fallback format");
  });

  await check("it begins with a UTF-8 BOM, so Excel reads it as UTF-8", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=csv`);
    assertEqual(file.bytes[0], 0xef, "the first BOM byte");
    assertEqual(file.bytes[1], 0xbb, "the second BOM byte");
    assertEqual(file.bytes[2], 0xbf, "the third BOM byte");
  });

  await check("its rows end with CRLF, as RFC 4180 says", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=csv`);
    assertIncludes(file.text, "Created\r\n", "the header row's ending");
  });

  await check("it carries the nine columns the specification lists, in order", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=csv`);
    const [header] = parseCsv(file.text);
    assertEqual(
      JSON.stringify(header),
      JSON.stringify(EXPECTED_HEADERS),
      "the header row",
    );
  });

  await check("every seeded expense is in it, oldest first", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=csv`);
    const records = csvRecords(file.text);
    assertEqual(records.length, 3, "the number of exported rows");
    assertEqual(
      JSON.stringify(records.map((r) => r.Item)),
      JSON.stringify(["Old bill", "Groceries", AWKWARD_ITEM.replace("=", "'=")]),
      "the exported items, oldest first",
    );
  });

  await check("each cell holds what the expense holds", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=csv`);
    const row = csvRecords(file.text).find((r) => r.Item === "Groceries");
    assert(row, "the Groceries row was not exported");

    assertEqual(row.Date, EARLY_DAY, "the date");
    assertEqual(row.Amount, "2450.50", "the amount");
    assertEqual(row.Currency, "INR", "the currency");
    assertEqual(row["Paid by"], "Ada Owner", "the payer's name, not their id");
    assertEqual(row.Category, "Food", "the category");
    assertEqual(row["Payment mode"], "UPI", "the payment mode's label");
    assertEqual(row.Notes, "Weekly shopping", "the notes");
    assert(
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(row.Created),
      `the created timestamp was ${JSON.stringify(row.Created)}`,
    );
  });

  await check("an amount is a plain number, not a formatted one", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=csv`);
    for (const row of csvRecords(file.text)) {
      assert(
        /^\d+\.\d{2}$/.test(row.Amount),
        `the amount ${JSON.stringify(row.Amount)} is not a plain two-decimal number`,
      );
    }
    assertExcludes(file.text, "₹", "the CSV");
  });

  await check("an optional field that was never recorded is a blank cell", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=csv`);
    const row = csvRecords(file.text).find((r) => r.Item === "Old bill");
    assertEqual(row.Category, "", "the missing category");
    assertEqual(row["Payment mode"], "", "the missing payment mode");
    assertEqual(row.Notes, "", "the missing notes");
  });

  await check("a comma, a quote and an accent survive the round trip", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=csv`);
    const row = csvRecords(file.text).find((r) => r.Notes.includes("evenly"));
    assert(row, "the awkward row was not exported");
    assertEqual(row.Notes, AWKWARD_NOTES, "the awkward notes");
  });

  await check("a value that looks like a formula is neutralised", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=csv`);
    assertExcludes(file.text, `,${AWKWARD_ITEM}`, "the CSV");
    assertIncludes(file.text, `,'${AWKWARD_ITEM}`, "the CSV");
  });

  // -------------------------------------------------------------------------
  group("The Excel file");

  await check("it is served as a spreadsheet, uncached", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=xlsx`);
    assertEqual(file.status, 200, "GET the personal XLSX");
    assertIncludes(file.contentType, "spreadsheetml.sheet", "the content type");
    assertIncludes(file.cacheControl, "no-store", "the cache-control header");
    assert(file.filename.endsWith(".xlsx"), `the filename was ${file.filename}`);
  });

  await check("it is a ZIP holding the six parts a workbook needs", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=xlsx`);
    assertEqual(file.bytes.toString("utf8", 0, 2), "PK", "the archive's magic bytes");

    const parts = unzip(file.bytes);
    for (const name of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]) {
      assert(parts.has(name), `the workbook is missing ${name}`);
    }
  });

  await check("its header row is the same nine columns as the CSV's", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=xlsx`);
    const cells = sheetCells(unzip(file.bytes).get("xl/worksheets/sheet1.xml"));
    const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

    assertEqual(
      JSON.stringify(letters.map((letter) => cells.get(`${letter}1`)?.text)),
      JSON.stringify(EXPECTED_HEADERS),
      "the spreadsheet's header row",
    );
  });

  await check("an amount is a number cell, so it can be summed", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=xlsx`);
    const cells = sheetCells(unzip(file.bytes).get("xl/worksheets/sheet1.xml"));

    // Row 2 is the oldest expense: "Old bill", 500.
    assertEqual(cells.get("C2").type, "", "the amount cell's type (blank means numeric)");
    assertEqual(cells.get("C2").number, 500, "the amount cell's value");
    assertEqual(cells.get("C3").number, 2450.5, "the second amount cell's value");
  });

  await check("a date is a date cell, not a string", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=xlsx`);
    const cells = sheetCells(unzip(file.bytes).get("xl/worksheets/sheet1.xml"));

    assertEqual(cells.get("A2").number, excelSerial(LAST_MONTH_DAY), "the first date cell");
    assertEqual(cells.get("A3").number, excelSerial(EARLY_DAY), "the second date cell");
  });

  await check("the amount column carries a currency format", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=xlsx`);
    const styles = unzip(file.bytes).get("xl/styles.xml");
    assertIncludes(styles, "&quot;₹&quot;#,##0.00", "the personal currency format");
  });

  await check("a group's own currency formats its amounts", async () => {
    const file = await download(owner, `${groupExportPath(groupId)}?format=xlsx`);
    const styles = unzip(file.bytes).get("xl/styles.xml");
    assertIncludes(styles, "&quot;€&quot;#,##0.00", "the group's currency format");
    assertExcludes(styles, "₹", "the group's styles");
  });

  await check("a formula reaches the sheet as text, never as a formula", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=xlsx`);
    const sheet = unzip(file.bytes).get("xl/worksheets/sheet1.xml");
    const cells = sheetCells(sheet);
    const cell = [...cells.values()].find((c) => c.text === AWKWARD_ITEM);

    assert(cell, "the formula-shaped item was not in the sheet");
    assertEqual(cell.type, "inlineStr", "its cell type");
    assertExcludes(sheet, "<f>", "the sheet");
  });

  await check("awkward text is escaped rather than breaking the XML", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=xlsx`);
    const cells = sheetCells(unzip(file.bytes).get("xl/worksheets/sheet1.xml"));
    const cell = [...cells.values()].find((c) => c.text?.includes("evenly"));

    assert(cell, "the awkward notes were not in the sheet");
    assertEqual(cell.text, AWKWARD_NOTES, "the awkward notes");
  });

  await check("the sheet is named after what it holds", async () => {
    const file = await download(owner, `${groupExportPath(groupId)}?format=xlsx&month=${THIS_MONTH}`);
    const workbook = unzip(file.bytes).get("xl/workbook.xml");
    assertIncludes(
      workbook,
      `name="Goa Trip 2026 ${monthLabel(THIS_MONTH_KEY.year, THIS_MONTH_KEY.month)}"`,
      "the sheet name",
    );
  });

  // -------------------------------------------------------------------------
  group("The filename");

  await check("a month-scoped personal export is named for the month", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?month=${THIS_MONTH}&format=csv`);
    assertEqual(
      file.filename,
      `personal-${monthSlug(THIS_MONTH_KEY)}-expenses.csv`,
      "the filename",
    );
  });

  await check("a group export is named for the group, slugged", async () => {
    const file = await download(owner, `${groupExportPath(groupId)}?month=${THIS_MONTH}&format=csv`);
    assertEqual(
      file.filename,
      `goa-trip-2026-${monthSlug(THIS_MONTH_KEY)}-expenses.csv`,
      "the filename",
    );
  });

  await check("a previous month names that month, not this one", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?month=${LAST_MONTH}&format=csv`);
    assertEqual(
      file.filename,
      `personal-${monthSlug(LAST_MONTH_KEY)}-expenses.csv`,
      "the filename",
    );
  });

  await check("an unscoped export says so rather than naming a month", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?format=csv`);
    assertEqual(file.filename, "personal-all-time-expenses.csv", "the filename");
  });

  await check("a date range is named by its ends", async () => {
    const file = await download(
      owner,
      `${PERSONAL_EXPORT}?from=${EARLY_DAY}&to=${LATE_DAY}&format=csv`,
    );
    assertEqual(
      file.filename,
      `personal-${EARLY_DAY}-to-${LATE_DAY}-expenses.csv`,
      "the filename",
    );
  });

  await check("the extension follows the format", async () => {
    const file = await download(owner, `${groupExportPath(groupId)}?format=xlsx`);
    assertEqual(file.filename, "goa-trip-2026-all-time-expenses.xlsx", "the filename");
  });

  // -------------------------------------------------------------------------
  group("The export is the list");

  await check("a month scope exports that month and no other", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?month=${THIS_MONTH}&format=csv`);
    const records = csvRecords(file.text);
    assertEqual(records.length, 2, "the rows in this month");
    assertExcludes(
      JSON.stringify(records.map((r) => r.Item)),
      "Old bill",
      "this month's export",
    );
  });

  await check("a month with nothing in it exports a header and no rows", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?month=2001-01&format=csv`);
    assertEqual(file.status, 200, "GET an empty month");
    assertEqual(csvRecords(file.text).length, 0, "the rows in an empty month");
    assertIncludes(file.text, "Date,Item,Amount", "the empty export");
  });

  await check("an empty month still produces an openable workbook", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?month=2001-01&format=xlsx`);
    const cells = sheetCells(unzip(file.bytes).get("xl/worksheets/sheet1.xml"));
    assertEqual(cells.get("A1").text, "Date", "the header of an empty workbook");
    assertEqual(cells.get("A2"), undefined, "an empty workbook has no data rows");
  });

  await check("a search narrows the export the same way it narrows the list", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?q=groceries&format=csv`);
    const records = csvRecords(file.text);
    assertEqual(records.length, 1, "the rows matching the search");
    assertEqual(records[0].Item, "Groceries", "the matching row");
  });

  await check("a payment-mode filter narrows the export", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?paymentMode=cash&format=csv`);
    const records = csvRecords(file.text);
    assertEqual(records.length, 1, "the rows paid in cash");
    assertEqual(records[0]["Payment mode"], "Cash", "the matching row");
  });

  await check("a date range narrows the export, inclusively at both ends", async () => {
    const file = await download(
      owner,
      `${PERSONAL_EXPORT}?from=${EARLY_DAY}&to=${LATE_DAY}&format=csv`,
    );
    const dates = csvRecords(file.text).map((r) => r.Date);
    assertEqual(JSON.stringify(dates), JSON.stringify([EARLY_DAY, LATE_DAY]), "the dates");
  });

  await check("an unreadable filter is ignored, as it is on the list", async () => {
    const file = await download(owner, `${PERSONAL_EXPORT}?category=not-a-uuid&format=csv`);
    assertEqual(file.status, 200, "GET with an unreadable filter");
    assertEqual(csvRecords(file.text).length, 3, "the rows with the filter dropped");
  });

  await check("a group export names its members and uses its currency", async () => {
    const file = await download(owner, `${groupExportPath(groupId)}?format=csv`);
    const records = csvRecords(file.text);
    assertEqual(records.length, 3, "the group's rows");

    const boat = records.find((r) => r.Item === "Boat tickets");
    assertEqual(boat["Paid by"], "Rahul Mate", "the member who paid");
    assertEqual(boat.Currency, "EUR", "the group's currency");
  });

  // -------------------------------------------------------------------------
  group("An export never widens what is readable");

  await check("a signed-out visitor is sent to sign in, not given a file", async () => {
    const file = await download(null, `${PERSONAL_EXPORT}?format=csv`);
    assert(file.status >= 300 && file.status < 400, `expected a redirect, got ${file.status}`);
    assertIncludes(file.location ?? "", "/sign-in", "the redirect");
  });

  await check("a signed-out visitor cannot reach a group export either", async () => {
    const file = await download(null, `${groupExportPath(groupId)}?format=csv`);
    assert(file.status >= 300 && file.status < 400, `expected a redirect, got ${file.status}`);
  });

  await check("a stranger's export holds their own rows, which is none", async () => {
    const file = await download(stranger, `${PERSONAL_EXPORT}?format=csv`);
    assertEqual(file.status, 200, "GET a stranger's export");
    assertEqual(csvRecords(file.text).length, 0, "a stranger's rows");
    assertExcludes(file.text, "Groceries", "a stranger's export");
  });

  await check("a stranger cannot search another user's expenses into a file", async () => {
    for (const query of [
      "q=groceries",
      `category=${foodId}`,
      "paymentMode=upi",
      `from=${LAST_MONTH_DAY}&to=${LATE_DAY}`,
      `month=${THIS_MONTH}`,
    ]) {
      const file = await download(stranger, `${PERSONAL_EXPORT}?${query}&format=csv`);
      assertEqual(csvRecords(file.text).length, 0, `a stranger's export with ${query}`);
    }
  });

  await check("a non-member gets 404 from a group export, not an empty file", async () => {
    const file = await download(stranger, `${groupExportPath(groupId)}?format=csv`);
    assertEqual(file.status, 404, "a non-member's group export");
  });

  await check("a group that does not exist answers the same way", async () => {
    const file = await download(
      owner,
      `/api/groups/00000000-0000-4000-8000-000000000000/expenses/export?format=csv`,
    );
    assertEqual(file.status, 404, "a missing group's export");
  });

  await check("a member exports the group, and only the group", async () => {
    const file = await download(mate, `${groupExportPath(groupId)}?format=csv`);
    assertEqual(file.status, 200, "a member's group export");
    assertEqual(csvRecords(file.text).length, 3, "the group's rows");
    assertExcludes(file.text, "Groceries", "the group export");
  });

  await check("a member's personal export does not contain the group's rows", async () => {
    const file = await download(mate, `${PERSONAL_EXPORT}?format=csv`);
    assertEqual(csvRecords(file.text).length, 0, "a member's personal rows");
    assertExcludes(file.text, "Boat tickets", "a member's personal export");
  });

  await check("the same filters cannot pull the rows out of PostgREST either", async () => {
    const { data, error } = await stranger.db
      .from("expenses")
      .select("id")
      .or("item_name.ilike.%groceries%,notes.ilike.%groceries%");
    assert(!error, error?.message);
    assertEqual(data.length, 0, "rows a stranger read directly");
  });

  await check("a non-member cannot read the group's expenses directly", async () => {
    const { data, error } = await stranger.db
      .from("expenses")
      .select("id")
      .eq("group_id", groupId);
    assert(!error, error?.message);
    assertEqual(data.length, 0, "group rows a non-member read directly");
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
