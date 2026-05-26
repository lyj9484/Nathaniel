import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const A_EMAIL = process.env.SMOKE_USER_A_EMAIL;
const B_EMAIL = process.env.SMOKE_USER_B_EMAIL;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function createTestUser(email) {
  await admin.from("allowed_emails").upsert({ email });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "TestPass123!@#",
    email_confirm: true,
  });
  if (error && !error.message.includes("already")) throw error;
  return data?.user || (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email);
}

async function clientForUser(email) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;
  // user의 access token 발급 (service role의 admin API)
  const { data: sess } = await admin.auth.admin.createSession?.({ user_id: data.user.id }).catch(() => ({ data: null }));
  // fallback: password 로그인
  const cli = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: signin, error: e2 } = await cli.auth.signInWithPassword({
    email,
    password: "TestPass123!@#",
  });
  if (e2) throw e2;
  return cli;
}

async function cleanup() {
  const users = await admin.auth.admin.listUsers();
  for (const u of users.data.users) {
    if (u.email === A_EMAIL || u.email === B_EMAIL) {
      await admin.auth.admin.deleteUser(u.id);
    }
  }
  await admin.from("allowed_emails").delete().in("email", [A_EMAIL, B_EMAIL]);
}

async function main() {
  await cleanup();

  const a = await createTestUser(A_EMAIL);
  const b = await createTestUser(B_EMAIL);
  const cliA = await clientForUser(A_EMAIL);
  const cliB = await clientForUser(B_EMAIL);

  // Seed: A·B에 각 1개 holding
  const { data: aHolding } = await admin.from("holdings").insert({
    user_id: a.id, category: "us", symbol: "AAPL", name: "Apple",
  }).select().single();
  const { data: bHolding } = await admin.from("holdings").insert({
    user_id: b.id, category: "us", symbol: "NVDA", name: "NVIDIA",
  }).select().single();

  // 1) A는 본인 데이터만 SELECT
  const { data: aRows } = await cliA.from("holdings").select("*");
  assert.equal(aRows.length, 1);
  assert.equal(aRows[0].symbol, "AAPL");
  console.log("✓ 1) A sees only own rows");

  // 2) A가 user_id=B로 INSERT 시도
  const { data: ins2, error: ins2err } = await cliA.from("holdings").insert({
    user_id: b.id, category: "us", symbol: "TSLA", name: "Tesla",
  }).select().single();
  // 트리거가 user_id를 auth.uid()로 덮어씀 → A의 row로 들어가야 함
  assert.equal(ins2?.user_id, a.id, "trigger should rewrite user_id to A");
  console.log("✓ 2) INSERT with foreign user_id → rewritten by trigger");
  await admin.from("holdings").delete().eq("symbol", "TSLA");

  // 3) A가 UPDATE로 user_id 변경 시도
  const { data: upd } = await cliA.from("holdings")
    .update({ user_id: b.id })
    .eq("id", aHolding.id)
    .select().single();
  assert.equal(upd?.user_id, a.id, "user_id must not change");
  console.log("✓ 3) UPDATE user_id → reverted by trigger");

  // 4) A가 B의 holding_id로 transaction INSERT
  const { error: txErr } = await cliA.from("transactions").insert({
    user_id: a.id, holding_id: bHolding.id, type: "buy",
    quantity: 1, price: 100, date: "2026-01-01",
  });
  assert.ok(txErr, "must fail RLS");
  console.log("✓ 4) Cross-user holding_id INSERT rejected:", txErr.message);

  // 5) ai_usage UPDATE 시도
  await admin.from("ai_usage").insert({ user_id: a.id, usage_date: "2026-01-01", count: 5 });
  const { error: auErr } = await cliA.from("ai_usage").update({ count: 0 }).eq("user_id", a.id);
  assert.ok(auErr, "ai_usage UPDATE must be blocked");
  console.log("✓ 5) ai_usage UPDATE blocked");

  // 6) 화이트리스트 거부
  const { error: signupErr } = await admin.auth.admin.createUser({
    email: "not-invited@example.com",
    password: "x",
    email_confirm: true,
  });
  assert.ok(signupErr, "must raise: not in invite list");
  console.log("✓ 6) Non-allowlisted email rejected:", signupErr.message);

  // 7) anon으로 SELECT
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: anonRows } = await anon.from("holdings").select("*");
  assert.equal(anonRows?.length ?? 0, 0);
  console.log("✓ 7) anon SELECT returns 0 rows");

  // 8) 클라이언트 빌드 산출물 스캔은 Phase 3에서 별도 task로
  console.log("ℹ 8) bundle scan deferred to Phase 3");

  await cleanup();
  console.log("\nAll security checks passed ✓");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
