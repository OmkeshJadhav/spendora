#!/usr/bin/env node
/**
 * TEMPORARY — delete this script when the email service lands in Phase 5.
 *
 * No email provider is wired up yet, so Supabase sends confirmation links that
 * never arrive, and `signInWithPassword` refuses every account with
 * `email_not_confirmed`. That makes the application impossible to use.
 *
 * This marks every unconfirmed account as confirmed, so development can carry
 * on. It is a stopgap, not a feature:
 *
 *   - Nothing in `src/` calls it. The application still has no idea whether an
 *     address is real, and none of the authentication code has been weakened.
 *   - It needs `SUPABASE_SERVICE_ROLE_KEY`, which never reaches the browser.
 *   - It is a development convenience against a development project. Do not run
 *     it against anything holding real users.
 *
 * The proper switch is the project's own `Confirm email` setting. See
 * `supabase/README.md` and the Phase 3 notes in `project-progress.md` for what
 * has to be undone before this ships.
 *
 *   npm run db:confirm-users
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`Project: ${new URL(SUPABASE_URL).host}`);
console.log("Temporary measure — remove once the email service is integrated.\n");

const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });

if (error) {
  console.error(`Could not list users: ${error.message}`);
  process.exit(1);
}

const unconfirmed = data.users.filter((user) => !user.email_confirmed_at);

if (unconfirmed.length === 0) {
  console.log("Every account is already confirmed. Nothing to do.");
  process.exit(0);
}

let failed = 0;

for (const user of unconfirmed) {
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    email_confirm: true,
  });

  if (updateError) {
    failed += 1;
    console.log(`  failed   ${user.email} — ${updateError.message}`);
  } else {
    console.log(`  confirmed ${user.email}`);
  }
}

console.log(
  `\n${unconfirmed.length - failed} of ${unconfirmed.length} account(s) confirmed.`,
);

if (failed > 0) process.exit(1);
