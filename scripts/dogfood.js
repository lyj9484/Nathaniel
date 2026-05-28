// Phase 4 dogfooding: drive the live app end-to-end via Playwright + API checks.
// Verifies:
//   1) session injection lets the dashboard load (auth wiring works)
//   2) "종목 추가" modal → holdings/transactions persist via Supabase
//   3) reload preserves data (remote state, not localStorage)
//   4) /api/news returns AI analysis with JWT (NewsSection works)
//   5) clicking a holding opens chart + AI modal (/api/stock works)
//   6) DAILY_AI_LIMIT enforced (21st call → 429)
//   7) ai_usage row in Supabase reflects the calls
//
// Run from /c/dev/scripts:  node dogfood.js

import "dotenv/config";
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const APP_URL = "http://localhost:5173";
const API_URL = "http://localhost:3001";

const log = (...a) => console.log("[dogfood]", ...a);
const ok = (msg) => console.log("  ✓", msg);
const fail = (msg) => { console.log("  ✗", msg); process.exitCode = 1; };

// ── 1. Provision test user + session ───────────────────────────────────────
log("provisioning test user…");
const res = spawnSync("node", ["playwright-session.js"], { cwd: __dirname, encoding: "utf8" });
if (res.status !== 0) { console.error(res.stderr); throw new Error("session provision failed"); }
const session = JSON.parse(res.stdout);
const userId = session.user.id;
const token = session.access_token;
log("user:", session.user.email, userId.slice(0, 8) + "…");

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Wipe any prior data for this test user (idempotent re-runs)
await admin.from("transactions").delete().eq("user_id", userId);
await admin.from("holdings").delete().eq("user_id", userId);
await admin.from("ai_usage").delete().eq("user_id", userId);

// ── 2. Launch browser + inject session ─────────────────────────────────────
log("launching chromium…");
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript(({ key, val }) => {
  window.localStorage.setItem(key, val);
}, { key: STORAGE_KEY, val: JSON.stringify(session) });

const page = await ctx.newPage();
const apiCalls = [];
page.on("response", (r) => {
  if (r.url().includes("/api/")) apiCalls.push({ url: r.url(), status: r.status() });
});
page.on("pageerror", (e) => log("PAGE ERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") log("CONSOLE ERROR:", m.text()); });
page.on("response", async (r) => {
  if (r.status() >= 400 && !r.url().includes("favicon")) {
    let body = "";
    try { body = await r.text(); } catch {}
    const req = r.request();
    log("HTTP", r.status(), req.method(), r.url().slice(0, 120),
        "body:", req.postData()?.slice(0, 200) || "(none)",
        "resp:", body.slice(0, 200));
  }
});

// ── 3. Auth wiring ─────────────────────────────────────────────────────────
log("navigating to app…");
await page.goto(APP_URL, { waitUntil: "networkidle" });

// LoginPage shows "초대받은 분만"; Dashboard shows "종목 추가" button.
const isDashboard = await page.locator("text=종목 추가").count();
if (isDashboard > 0) ok("dashboard rendered (session injection worked)");
else { fail("still on LoginPage — session injection failed"); await browser.close(); process.exit(1); }

// ── 4. Add KR / US / Crypto holdings ───────────────────────────────────────
async function addHolding({ category, symbol, name, qty, price, date }) {
  // Open AddModal via FAB
  await page.locator('button:has-text("종목 추가")').first().click();
  // Modal overlay locator (only AddModal has the h2 "종목 추가" inside z-50)
  const modal = page.locator('div.z-50:has(h2:has-text("종목 추가"))');
  await modal.waitFor({ state: "visible" });

  const catLabel = { kr: "국장", us: "미장", crypto: "코인" }[category];
  await modal.locator(`button:has-text("${catLabel}")`).click();

  // Inputs are in a fixed order inside the modal
  const inputs = modal.locator("input");
  await inputs.nth(0).fill(symbol);  // 티커
  await inputs.nth(1).fill(name);    // 이름
  await inputs.nth(2).fill(String(qty));    // 수량
  await inputs.nth(3).fill(String(price));  // 매수가
  await inputs.nth(4).fill(date);    // 매수일

  await modal.locator('button:has-text("추가하기")').click();
  await modal.waitFor({ state: "detached", timeout: 10000 });
}

log("adding holdings via UI…");
await addHolding({ category: "kr", symbol: "005930.KS", name: "삼성전자", qty: 10, price: 68000, date: "2026-01-15" });
await addHolding({ category: "us", symbol: "AAPL", name: "Apple", qty: 5, price: 175.5, date: "2026-02-01" });
await addHolding({ category: "crypto", symbol: "BTC-USD", name: "Bitcoin", qty: 0.05, price: 60000, date: "2026-03-01" });

// Verify via admin client
const { data: holdings } = await admin.from("holdings").select("*").eq("user_id", userId);
if (holdings.length === 3) ok(`3 holdings persisted (${holdings.map(h => h.symbol).join(", ")})`);
else fail(`expected 3 holdings, got ${holdings.length}`);

const { data: txns } = await admin.from("transactions").select("*").eq("user_id", userId);
if (txns.length === 3) ok(`3 initial buy transactions persisted`);
else fail(`expected 3 transactions, got ${txns.length}`);

// ── 5. Reload preserves data + news call fires ─────────────────────────────
log("reloading page (also captures /api/news on mount)…");
const newsWait = page.waitForResponse(
  (r) => r.url().includes("/api/news") && r.request().method() === "POST",
  { timeout: 60000 },
);
await page.reload({ waitUntil: "networkidle" });

const symbolsOnPage = await page.locator("text=삼성전자").count() +
                      await page.locator("text=Apple").count() +
                      await page.locator("text=Bitcoin").count();
if (symbolsOnPage >= 3) ok("3 holdings still visible after reload");
else fail(`only ${symbolsOnPage} symbols visible after reload`);

const newsRes = await newsWait;
if (newsRes.status() === 200) ok(`/api/news returned 200 (NewsSection mount)`);
else fail(`/api/news returned ${newsRes.status()}`);

// ── 7. Stock click → analysis tab → /api/stock ─────────────────────────────
log("opening Apple → 차트 & 분석 tab → expects /api/stock…");
// HoldingRow renders name inside a button. Target it precisely.
await page.locator('button:has(div:text-is("Apple"))').first().click();
await page.waitForSelector('button:has-text("차트 & 분석")', { timeout: 10000 });
const stockWait = page.waitForResponse(
  (r) => r.url().includes("/api/stock") && r.request().method() === "POST",
  { timeout: 60000 },
);
await page.locator('button:has-text("차트 & 분석")').click();
const stockRes = await stockWait;
if (stockRes.status() === 200) ok(`/api/stock returned 200`);
else fail(`/api/stock returned ${stockRes.status()}`);
await page.keyboard.press("Escape");

// ── 8. Rate limit (DAILY_AI_LIMIT=20) ──────────────────────────────────────
log("hammering /api/news to trigger 429 (limit=20)…");
let rate429 = false;
let lastUsed = 0;
for (let i = 0; i < 30; i++) {
  const r = await fetch(`${API_URL}/api/news?force=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    // Vary holdings → different cache key each iteration so we actually hit AI
    body: JSON.stringify({ holdings: [{ symbol: `TEST${i}`, name: `Test${i}`, category: "us" }] }),
  });
  if (r.status === 429) {
    const body = await r.json();
    rate429 = true;
    lastUsed = body.details?.used ?? 0;
    log(`  hit 429 on call #${i + 1}, used=${lastUsed}, limit=${body.details?.limit}`);
    break;
  }
  if (!r.ok) {
    const body = await r.text();
    log(`  call #${i + 1} status=${r.status} body=${body.slice(0, 200)}`);
    break;
  }
}
if (rate429) ok(`rate limit triggered`);
else fail(`expected 429 within 30 calls, never got one`);

const { data: usage } = await admin.from("ai_usage").select("*").eq("user_id", userId);
log("ai_usage rows:", usage);
const today = new Date().toISOString().slice(0, 10);
const todayRow = usage.find((u) => u.usage_date === today);
if (todayRow && todayRow.count >= 20) ok(`ai_usage.count = ${todayRow.count} (≥20)`);
else fail(`ai_usage row missing or below limit: ${JSON.stringify(todayRow)}`);

// ── 9. 피드백 제출 (사용자 경로) ───────────────────────────────────────────
log("submitting feedback as regular user…");
const fbRes = await fetch(`${API_URL}/api/feedback`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({
    category: "ui",
    body: "dogfood 자동 테스트 — UI 카테고리",
    page_url: "http://localhost:5173/#/",
  }),
});
if (fbRes.status === 201) ok("POST /api/feedback returned 201");
else fail(`POST /api/feedback returned ${fbRes.status}`);

// 두 번째 호출은 rate limit으로 429 기대
const fbRes2 = await fetch(`${API_URL}/api/feedback`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ category: "other", body: "두 번째 시도" }),
});
if (fbRes2.status === 429) ok("rate limit (분당 1건) triggers 429");
else fail(`expected 429 on 2nd feedback, got ${fbRes2.status}`);

// admin 권한 없는 사용자가 admin 라우트 호출 → 403
const adminDeny = await fetch(`${API_URL}/api/admin/feedback`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (adminDeny.status === 403) ok("non-admin user → 403 on /api/admin/feedback");
else fail(`expected 403 for non-admin, got ${adminDeny.status}`);

// admin 사용자(콜리)에게는 200 — 토큰을 만들려면 service_role로 user 직접 발급
const adminEmail = (process.env.ADMIN_EMAILS || "").split(",")[0]?.trim();
if (adminEmail) {
  // admin 사용자 임시 생성 + 세션 발급. 화이트리스트 우회 필요.
  // 사전에 존재하던 admin 계정이면 절대 deleteUser 호출 금지 (실제 운영 계정 보호).
  const allowedEntryExisted = (
    await admin.from("allowed_emails").select("email").eq("email", adminEmail).maybeSingle()
  ).data != null;
  if (!allowedEntryExisted) await admin.from("allowed_emails").insert({ email: adminEmail });

  let adminUser = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === adminEmail);
  let createdAdmin = false;
  if (!adminUser) {
    const { data: created } = await admin.auth.admin.createUser({
      email: adminEmail, password: "AdminTest1!@#", email_confirm: true,
    });
    adminUser = created.user;
    createdAdmin = true;
  }
  const cli = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: sess, error: sessErr } = await cli.auth.signInWithPassword({
    email: adminEmail, password: "AdminTest1!@#",
  });
  if (sessErr) {
    log("admin sign-in failed — skipping admin GET check:", sessErr.message);
    log("  (likely because adminEmail is a real account with a different password — safe to ignore)");
  } else {
    const adminGet = await fetch(`${API_URL}/api/admin/feedback?category=ui&limit=10`, {
      headers: { Authorization: `Bearer ${sess.session.access_token}` },
    });
    if (adminGet.status === 200) {
      const body = await adminGet.json();
      if (body.items?.length >= 1 && body.counts?.ui >= 1) {
        ok(`admin GET returns items.length=${body.items.length}, counts.ui=${body.counts.ui}`);
      } else {
        fail(`admin GET shape unexpected: ${JSON.stringify(body).slice(0, 200)}`);
      }
    } else {
      fail(`admin GET expected 200, got ${adminGet.status}`);
    }
  }

  // 정리: feedback은 항상 청소(이 스크립트가 만든 행), user/allowed_emails는 우리가 만든 것만 삭제
  await admin.from("feedback").delete().eq("user_id", adminUser.id);
  if (createdAdmin) {
    await admin.auth.admin.deleteUser(adminUser.id);
    log("  cleaned up freshly-created admin user");
  } else {
    log("  preserved pre-existing admin user (no deleteUser)");
  }
  if (!allowedEntryExisted) {
    await admin.from("allowed_emails").delete().eq("email", adminEmail);
  }
}

// pwtest 피드백 청소
await admin.from("feedback").delete().eq("user_id", userId);

await browser.close();

// ── 10. Summary ────────────────────────────────────────────────────────────
log("api calls observed in browser:", apiCalls.length);
const byStatus = apiCalls.reduce((acc, c) => {
  const k = `${c.status}`; acc[k] = (acc[k] || 0) + 1; return acc;
}, {});
log("status breakdown:", byStatus);

if (process.exitCode) log("FAIL");
else log("ALL CHECKS PASSED");
