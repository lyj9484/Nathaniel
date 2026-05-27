// Phase 4 dogfooding helper: ensure a test user exists, sign in, output session JSON.
// The output JSON is meant to be injected into localStorage at
//   sb-<project-ref>-auth-token
// so the supabase-js client treats us as logged in.
//
// Usage:
//   node playwright-session.js            # create+login, print session JSON
//   node playwright-session.js --cleanup  # delete test user + whitelist entry

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = "pwtest@example.com";
const PASSWORD = "PwTest123!@#";

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function findUser(email) {
  const { data } = await admin.auth.admin.listUsers();
  return data.users.find((u) => u.email === email);
}

async function cleanup() {
  const u = await findUser(EMAIL);
  if (u) {
    // cascading FK on holdings/transactions/etc takes care of data
    await admin.auth.admin.deleteUser(u.id);
  }
  await admin.from("allowed_emails").delete().eq("email", EMAIL);
  console.error("cleaned up", EMAIL);
}

async function provision() {
  await admin.from("allowed_emails").upsert({ email: EMAIL });
  const existing = await findUser(EMAIL);
  if (!existing) {
    const { error } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
  }

  const cli = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await cli.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error) throw error;

  // supabase-js v2 localStorage value shape
  const sessionValue = {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    expires_in: data.session.expires_in,
    token_type: data.session.token_type,
    user: data.session.user,
  };
  process.stdout.write(JSON.stringify(sessionValue));
}

const cmd = process.argv[2];
if (cmd === "--cleanup") {
  cleanup().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  provision().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
