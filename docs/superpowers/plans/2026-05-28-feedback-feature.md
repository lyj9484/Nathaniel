# 피드백 기능 구현 계획 (2026-05-28)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 초대받은 사용자가 대시보드 하단 버튼을 통해 피드백을 5개 카테고리(디자인/UI/UX/시세 오류/기타) 중 하나와 자유 텍스트로 제출하면 Supabase `feedback` 테이블에 저장, 개발자(ADMIN_EMAILS env에 등록된 이메일)는 `#/admin/feedback` 페이지에서 카테고리별로 조회할 수 있다.

**Architecture:**
- DB: `feedback` 테이블 + RLS (사용자는 자기 것만 INSERT/SELECT), service_role로 admin이 전체 SELECT.
- Server: `POST /api/feedback`(인증된 사용자) + `GET /api/admin/feedback`(`requireAdmin` 미들웨어).
- Client: 대시보드 footer 위 버튼 → `FeedbackModal` → 제출. 별도 admin 라우트(`#/admin/feedback`) → `AdminFeedbackPage`.

**Tech Stack:** Supabase Postgres + RLS, Express + zod + jose, React 18 + Vite + lucide-react.

**Spec:** [`docs/superpowers/specs/2026-05-28-feedback-feature-design.md`](../specs/2026-05-28-feedback-feature-design.md)

---

## Task 1: DB 마이그레이션 + 수동 실행

**Files:**
- Create: `supabase/migrations/20260528000001_feedback.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- feedback 테이블: 카테고리 + 본문 + 메타데이터
create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  category    text not null check (category in
              ('design','ui','ux','price_data','other')),
  body        text not null check (char_length(body) between 1 and 2000),
  user_agent  text,
  page_url    text,
  created_at  timestamptz not null default now()
);

create index feedback_category_created_at_idx
  on public.feedback (category, created_at desc);
create index feedback_user_id_idx
  on public.feedback (user_id);

-- RLS
alter table public.feedback enable row level security;
alter table public.feedback force row level security;

create policy feedback_insert_own on public.feedback
  for insert with check (auth.uid() = user_id);

create policy feedback_select_own on public.feedback
  for select using (auth.uid() = user_id);

-- user_id 자동 주입 (003+004 가드 함수 재사용)
create trigger feedback_set_user_id
  before insert on public.feedback
  for each row execute function public.set_user_id_from_jwt();
```

- [ ] **Step 2: Supabase Dashboard SQL Editor에서 수동 실행**

Supabase Dashboard → SQL Editor → 위 SQL 붙여넣기 → Run. 에러 없으면 통과.

- [ ] **Step 3: 검증 쿼리**

SQL Editor에서 실행:
```sql
select policyname from pg_policies where tablename = 'feedback';
-- 기대: feedback_insert_own, feedback_select_own (2개)

select count(*) from pg_indexes where tablename = 'feedback';
-- 기대: 3 (pk + 2개 index)
```

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20260528000001_feedback.sql
git commit -m "feat(db): feedback 테이블 + RLS 마이그레이션"
```

---

## Task 2: server requireAdmin 미들웨어 + 단위 테스트

**Files:**
- Create: `server/middleware/requireAdmin.js`
- Create: `server/middleware/requireAdmin.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/middleware/requireAdmin.test.js`:

```js
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// 매 테스트 전에 env 초기화 후 동적 import (모듈 캐시 무효화는 동적 require가 안 되니
// requireAdmin이 process.env를 매 호출마다 읽도록 구현함)
import { requireAdmin } from "./requireAdmin.js";

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
});

test("requireAdmin: ADMIN_EMAILS 빈 값 → 503", () => {
  const req = { user: { email: "anyone@example.com" } };
  const res = mockRes();
  requireAdmin(req, res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "admin_disabled");
});

test("requireAdmin: non-admin user → 403", () => {
  process.env.ADMIN_EMAILS = "admin@example.com";
  const req = { user: { email: "user@example.com" } };
  const res = mockRes();
  requireAdmin(req, res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "forbidden");
});

test("requireAdmin: admin user → next()", () => {
  process.env.ADMIN_EMAILS = "admin@example.com";
  const req = { user: { email: "admin@example.com" } };
  const res = mockRes();
  let called = false;
  requireAdmin(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.statusCode, 200); // 변경 없음
});

test("requireAdmin: 대소문자 무시 매칭", () => {
  process.env.ADMIN_EMAILS = "Admin@Example.com";
  const req = { user: { email: "ADMIN@example.COM" } };
  const res = mockRes();
  let called = false;
  requireAdmin(req, res, () => { called = true; });
  assert.equal(called, true);
});

test("requireAdmin: 다수 이메일 등록 시 부분 일치", () => {
  process.env.ADMIN_EMAILS = "a@x.com, b@x.com ,c@x.com";
  const req = { user: { email: "b@x.com" } };
  const res = mockRes();
  let called = false;
  requireAdmin(req, res, () => { called = true; });
  assert.equal(called, true);
});

test("requireAdmin: req.user 없음 → 403", () => {
  process.env.ADMIN_EMAILS = "admin@example.com";
  const req = {}; // authMiddleware가 안 거쳐진 비정상 흐름
  const res = mockRes();
  requireAdmin(req, res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 403);
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd C:/dev/server
node --test middleware/requireAdmin.test.js
```
기대: `Cannot find module './requireAdmin.js'` 또는 import error로 모두 실패.

- [ ] **Step 3: 미들웨어 구현**

`server/middleware/requireAdmin.js`:

```js
// admin 라우트 게이트. ADMIN_EMAILS env (쉼표 구분, 대소문자 무시) 매칭.
// 빈 값이면 503 (오타로 모두 admin 되는 사고 방지).
//
// 매 호출마다 env를 읽어 테스트에서 동적으로 토글 가능하게 함.
export function requireAdmin(req, res, next) {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) {
    return res.status(503).json({ error: "admin_disabled" });
  }
  const email = req.user?.email?.toLowerCase();
  if (!email || !list.includes(email)) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd C:/dev/server
node --test middleware/requireAdmin.test.js
```
기대: `pass 6 / fail 0`.

- [ ] **Step 5: 커밋**

```bash
git add server/middleware/requireAdmin.js server/middleware/requireAdmin.test.js
git commit -m "feat(server): requireAdmin 미들웨어 + 단위 테스트"
```

---

## Task 3: validator + POST /api/feedback 라우트

**Files:**
- Modify: `server/validators.js` (끝에 추가)
- Modify: `server/server.js` (import + 라우트 추가)
- Modify: `server/.env.example` (ADMIN_EMAILS 추가)

- [ ] **Step 1: validator 스키마 추가**

`server/validators.js` 마지막에 추가:

```js
export const FeedbackCategorySchema = z.enum([
  "design", "ui", "ux", "price_data", "other",
]);

export const FeedbackBodySchema = z.object({
  category: FeedbackCategorySchema,
  body: z.string().min(1).max(2000),
  page_url: z.string().max(500).optional(),
});

export const AdminFeedbackQuerySchema = z.object({
  category: FeedbackCategorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
```

- [ ] **Step 2: server.js에 import 추가**

`server/server.js` 24번째 줄의 validators import 라인을 다음으로 교체:

```js
import {
  NewsBodySchema, StockSymbolSchema, StockAnalysisBodySchema,
  FeedbackBodySchema, AdminFeedbackQuerySchema,
} from "./validators.js";
import { supabaseAdmin } from "./lib/supabaseAdmin.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
```

- [ ] **Step 3: POST /api/feedback 라우트 + 전용 rate limiter 추가**

`server/server.js`에서 `app.post("/api/cache/clear", ...)` 직전(약 237번째 줄)에 추가:

```js
// 사용자 1명당 분당 1건 피드백 (글로벌 60/min과 별개)
const feedbackLimiter = rateLimit({
  windowMs: 60_000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `feedback:${req.user?.id || req.ip}`,
  message: { error: "rate_limit", message: "1분에 1건만 제출할 수 있습니다" },
});

app.post("/api/feedback", feedbackLimiter, async (req, res, next) => {
  try {
    const parsed = FeedbackBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten());

    const userAgent = (req.headers["user-agent"] || "").slice(0, 1000);
    const { category, body, page_url } = parsed.data;

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("feedback")
      .insert({
        user_id: req.user.id,
        email: req.user.email,
        category,
        body,
        user_agent: userAgent || null,
        page_url: page_url || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    res.status(201).json({ id: data.id });
  } catch (e) {
    next(e);
  }
});

app.get("/api/admin/feedback", requireAdmin, async (req, res, next) => {
  try {
    const parsed = AdminFeedbackQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten());
    const { category, limit, offset } = parsed.data;

    const sb = supabaseAdmin();

    // items: category 필터 + created_at desc + 페이지네이션
    let query = sb
      .from("feedback")
      .select("id, email, category, body, user_agent, page_url, created_at")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (category) query = query.eq("category", category);
    const itemsRes = await query;
    if (itemsRes.error) throw itemsRes.error;

    // counts: 카테고리별 전체 개수 (group by 결과를 5개 키로 펼침)
    const { data: countsRaw, error: countsErr } = await sb
      .from("feedback")
      .select("category", { count: "exact", head: false });
    if (countsErr) throw countsErr;
    const counts = { design: 0, ui: 0, ux: 0, price_data: 0, other: 0, total: 0 };
    for (const row of countsRaw) {
      counts[row.category] = (counts[row.category] || 0) + 1;
      counts.total += 1;
    }

    res.json({ items: itemsRes.data, counts });
  } catch (e) {
    next(e);
  }
});
```

- [ ] **Step 4: .env.example에 ADMIN_EMAILS 추가**

`server/.env.example` 마지막 줄 다음에 추가:

```
ADMIN_EMAILS=colri25@gmail.com
```

- [ ] **Step 5: 로컬 .env에도 ADMIN_EMAILS 추가**

`server/.env`에 동일하게 추가 (git에는 안 들어감).

- [ ] **Step 6: 기존 테스트 회귀 확인**

```bash
cd C:/dev/server
node --test
```
기대: 모든 기존 테스트 + requireAdmin 6건 통과.

- [ ] **Step 7: 커밋**

```bash
git add server/validators.js server/server.js server/.env.example
git commit -m "feat(server): POST /api/feedback + GET /api/admin/feedback 라우트"
```

---

## Task 4: 클라이언트 공용 lib (카테고리 + hash route + API)

**Files:**
- Create: `client/src/lib/feedback.js`
- Create: `client/src/lib/useHashRoute.js`
- Modify: `client/.env.example` (VITE_ADMIN_EMAILS 추가)

- [ ] **Step 1: 카테고리 + 제출 함수 lib**

`client/src/lib/feedback.js`:

```js
import { apiPost, apiGet } from "./api.js";

export const FEEDBACK_CATEGORIES = [
  { key: "design",     label: "디자인" },
  { key: "ui",         label: "UI" },
  { key: "ux",         label: "UX" },
  { key: "price_data", label: "시세 오류" },
  { key: "other",      label: "기타" },
];

export const FEEDBACK_LABEL = Object.fromEntries(
  FEEDBACK_CATEGORIES.map((c) => [c.key, c.label])
);

export function submitFeedback({ category, body }) {
  return apiPost("/api/feedback", {
    category,
    body,
    page_url: window.location.href.slice(0, 500),
  });
}

export function listFeedback({ category, limit = 50, offset = 0 } = {}) {
  const qs = new URLSearchParams();
  if (category) qs.set("category", category);
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  return apiGet(`/api/admin/feedback?${qs.toString()}`);
}

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
```

- [ ] **Step 2: hash route hook**

`client/src/lib/useHashRoute.js`:

```js
import { useEffect, useState } from "react";

// 해시 라우터: #/admin/feedback → "/admin/feedback"
// 빈 해시 또는 "#" → "/"
export function useHashRoute() {
  const [path, setPath] = useState(parseHash());
  useEffect(() => {
    const onHash = () => setPath(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return path;
}

function parseHash() {
  const h = window.location.hash || "#/";
  return h.startsWith("#") ? h.slice(1) || "/" : "/";
}

export function navigate(path) {
  window.location.hash = path;
}
```

- [ ] **Step 3: .env.example에 VITE_ADMIN_EMAILS 추가**

`client/.env.example` 마지막 줄 다음에 추가:

```
VITE_ADMIN_EMAILS=colri25@gmail.com
```

- [ ] **Step 4: 로컬 .env.local에도 추가**

`client/.env.local`에 동일하게 추가.

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/feedback.js client/src/lib/useHashRoute.js client/.env.example
git commit -m "feat(client): 피드백 카테고리·API·해시 라우터 lib"
```

---

## Task 5: FeedbackModal 컴포넌트

**Files:**
- Create: `client/src/FeedbackModal.jsx`

- [ ] **Step 1: 모달 컴포넌트 구현**

`client/src/FeedbackModal.jsx`:

```jsx
import { useState } from "react";
import { X, Send, Check } from "lucide-react";
import { FEEDBACK_CATEGORIES, submitFeedback } from "./lib/feedback.js";

const MAX_LEN = 2000;

export default function FeedbackModal({ onClose }) {
  const [category, setCategory] = useState(null);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const trimmed = body.trim();
  const canSend = category && trimmed.length > 0 && trimmed.length <= MAX_LEN && !submitting;

  async function handleSend() {
    if (!canSend) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitFeedback({ category, body: trimmed });
      setSuccess(true);
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      setError(e.message || "전송에 실패했습니다");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">피드백 보내기</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="p-10 flex flex-col items-center gap-3 text-emerald-600">
            <Check size={32} />
            <p className="text-sm">감사합니다, 잘 받았습니다!</p>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div>
              <div className="text-xs text-slate-600 mb-2">카테고리</div>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK_CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCategory(c.key)}
                    className={
                      "px-3 py-1.5 rounded-full border text-sm transition " +
                      (category === c.key
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-700 border-slate-300 hover:border-slate-500")
                    }
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">
                {error}
              </div>
            )}

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-slate-600">내용</label>
                <span
                  className={
                    "text-[11px] " +
                    (trimmed.length > MAX_LEN ? "text-red-600" : "text-slate-400")
                  }
                >
                  {trimmed.length} / {MAX_LEN}
                </span>
              </div>
              <textarea
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="어떤 점이 불편하셨나요? 자유롭게 적어주세요."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none focus:outline-none focus:border-slate-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50"
              >
                취소
              </button>
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={14} />
                {submitting ? "전송 중…" : "SEND"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 확인 (lint/syntax)**

```bash
cd C:/dev/client
npm run build
```
기대: 에러 없이 빌드 성공.

- [ ] **Step 3: 커밋**

```bash
git add client/src/FeedbackModal.jsx
git commit -m "feat(client): FeedbackModal — 카테고리 라디오 + 본문 + SEND"
```

---

## Task 6: AssetDashboard에 피드백 버튼 통합

**Files:**
- Modify: `client/src/AssetDashboard.jsx`

- [ ] **Step 1: import 추가 + state**

`client/src/AssetDashboard.jsx` 상단 import 블록(현재 33번째 줄 `History` 다음)에 `MessageSquare` 추가:

```jsx
import {
  Plus, RefreshCw, Trash2, TrendingUp, TrendingDown, Target, Wallet,
  X, AlertCircle, CheckCircle2, Download, Upload, RotateCcw, Pencil,
  ArrowDownCircle, ArrowUpCircle, History,
  MessageSquare,
} from "lucide-react";
```

같은 import 블록 부근에 추가:

```jsx
import FeedbackModal from "./FeedbackModal.jsx";
import { isAdminEmail } from "./lib/feedback.js";
import { navigate } from "./lib/useHashRoute.js";
```

- [ ] **Step 2: state 변수 추가**

`AssetDashboard` 함수 안의 다른 `useState` 호출들 옆에 추가 (대략 다른 modal toggle state 근처):

```jsx
const [showFeedback, setShowFeedback] = useState(false);
```

- [ ] **Step 3: 헤더에 Admin 링크 추가**

`client/src/AssetDashboard.jsx` 약 573-581번째 줄의 로그아웃 버튼 블록을 다음으로 교체:

```jsx
{user && (
  <>
    {isAdminEmail(user.email) && (
      <button
        onClick={() => navigate("/admin/feedback")}
        className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-amber-500 text-amber-600 hover:bg-amber-50 text-xs transition"
        title="피드백 관리"
      >
        Admin
      </button>
    )}
    <button
      onClick={signOut}
      className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-slate-700 hover:border-slate-500 text-xs transition"
      title="로그아웃"
    >
      {user.email} · 로그아웃
    </button>
  </>
)}
```

- [ ] **Step 4: footer 위에 피드백 버튼 추가**

약 905-913번째 줄, `</section>` 다음, `<footer>` 직전에 추가:

```jsx
<div className="flex justify-center mb-6">
  <button
    onClick={() => setShowFeedback(true)}
    className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm transition"
  >
    <MessageSquare size={14} />
    피드백 보내기
  </button>
</div>
```

- [ ] **Step 5: 모달 렌더 추가**

`</div>` 닫는 wrapper 안, 다른 모달들(`{showAdd && <AddModal ... />}` 등) 근처에 추가:

```jsx
{showFeedback && (
  <FeedbackModal onClose={() => setShowFeedback(false)} />
)}
```

- [ ] **Step 6: 빌드 확인**

```bash
cd C:/dev/client
npm run build
```
기대: 에러 없이 빌드.

- [ ] **Step 7: 커밋**

```bash
git add client/src/AssetDashboard.jsx
git commit -m "feat(client): 대시보드 footer 위 피드백 버튼 + Admin 링크"
```

---

## Task 7: AdminFeedbackPage 컴포넌트

**Files:**
- Create: `client/src/AdminFeedbackPage.jsx`

- [ ] **Step 1: admin 페이지 구현**

`client/src/AdminFeedbackPage.jsx`:

```jsx
import { useEffect, useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { useAuth } from "./AuthProvider.jsx";
import { listFeedback, isAdminEmail, FEEDBACK_CATEGORIES, FEEDBACK_LABEL } from "./lib/feedback.js";
import { navigate } from "./lib/useHashRoute.js";

const PAGE_SIZE = 50;

export default function AdminFeedbackPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState(null); // null = 전체
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({
    design: 0, ui: 0, ux: 0, price_data: 0, other: 0, total: 0,
  });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isAdminEmail(user?.email)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 flex-col gap-3">
        <p>권한이 없습니다.</p>
        <button
          onClick={() => navigate("/")}
          className="px-4 py-2 rounded-full bg-slate-900 text-white text-sm"
        >
          대시보드로
        </button>
      </div>
    );
  }

  async function load(reset = false) {
    setLoading(true);
    setError(null);
    try {
      const next = reset ? 0 : offset;
      const res = await listFeedback({ category, limit: PAGE_SIZE, offset: next });
      setItems(reset ? res.items : [...items, ...res.items]);
      setCounts(res.counts);
      setOffset(next + res.items.length);
    } catch (e) {
      setError(e.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    // category 변경 시 리셋
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900 text-sm"
          >
            <ArrowLeft size={14} />
            대시보드로
          </button>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <MessageSquare size={18} />
            피드백 관리
          </h1>
          <span className="w-20" /> {/* spacer */}
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <CategoryTab active={category === null} onClick={() => setCategory(null)} label="전체" count={counts.total} />
          {FEEDBACK_CATEGORIES.map((c) => (
            <CategoryTab
              key={c.key}
              active={category === c.key}
              onClick={() => setCategory(c.key)}
              label={c.label}
              count={counts[c.key]}
            />
          ))}
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded mb-4">{error}</div>
        )}

        {items.length === 0 && !loading ? (
          <p className="text-sm text-slate-500 text-center py-12">아직 피드백이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 mb-2">
                  <span className="font-medium text-slate-700">{item.email}</span>
                  <span>·</span>
                  <time>{formatDate(item.created_at)}</time>
                  <span>·</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    {FEEDBACK_LABEL[item.category] || item.category}
                  </span>
                </div>
                {(item.user_agent || item.page_url) && (
                  <div className="text-[11px] text-slate-400 mb-2 truncate">
                    {item.user_agent && <span title={item.user_agent}>{item.user_agent.slice(0, 80)}</span>}
                    {item.user_agent && item.page_url && " · "}
                    {item.page_url && <span>{item.page_url}</span>}
                  </div>
                )}
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{item.body}</p>
              </li>
            ))}
          </ul>
        )}

        {items.length < (category ? counts[category] : counts.total) && (
          <div className="text-center mt-6">
            <button
              onClick={() => load(false)}
              disabled={loading}
              className="px-4 py-2 rounded-full border border-slate-300 text-sm hover:bg-white disabled:opacity-50"
            >
              {loading ? "불러오는 중…" : "더 보기"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryTab({ active, onClick, label, count }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition " +
        (active
          ? "bg-slate-900 text-white"
          : "bg-white border border-slate-300 text-slate-700 hover:border-slate-500")
      }
    >
      {label}
      <span
        className={
          "px-1.5 py-0.5 rounded-full text-[11px] " +
          (active ? "bg-white/20" : "bg-slate-100 text-slate-600")
        }
      >
        {count}
      </span>
    </button>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd C:/dev/client
npm run build
```
기대: 에러 없이 빌드.

- [ ] **Step 3: 커밋**

```bash
git add client/src/AdminFeedbackPage.jsx
git commit -m "feat(client): AdminFeedbackPage — 카테고리 탭 + 페이지네이션"
```

---

## Task 8: main.jsx에서 admin 라우트 분기

**Files:**
- Modify: `client/src/main.jsx`
- Modify: `client/src/AuthGate.jsx`

- [ ] **Step 1: AuthGate에 라우트 분기 추가**

`client/src/AuthGate.jsx` 전체를 다음으로 교체:

```jsx
import { useAuth } from "./AuthProvider.jsx";
import LoginPage from "./LoginPage.jsx";
import AssetDashboard from "./AssetDashboard.jsx";
import AdminFeedbackPage from "./AdminFeedbackPage.jsx";
import { useHashRoute } from "./lib/useHashRoute.js";

export default function AuthGate() {
  const { session, loading } = useAuth();
  const route = useHashRoute();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        로딩 중…
      </div>
    );
  }
  if (!session) return <LoginPage />;
  if (route === "/admin/feedback") return <AdminFeedbackPage />;
  return <AssetDashboard />;
}
```

- [ ] **Step 2: 빌드 확인**

```bash
cd C:/dev/client
npm run build
```
기대: 에러 없이 빌드.

- [ ] **Step 3: 커밋**

```bash
git add client/src/AuthGate.jsx
git commit -m "feat(client): AuthGate에 #/admin/feedback 라우트 분기"
```

---

## Task 9: dogfood.js에 피드백 시나리오 추가

**Files:**
- Modify: `scripts/dogfood.js`

- [ ] **Step 1: 피드백 시나리오 추가**

`scripts/dogfood.js` 끝부분 — `await browser.close();` 직전에 추가:

```js
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
  await admin.from("allowed_emails").upsert({ email: adminEmail });
  let adminUser = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === adminEmail);
  if (!adminUser) {
    const { data: created } = await admin.auth.admin.createUser({
      email: adminEmail, password: "AdminTest1!@#", email_confirm: true,
    });
    adminUser = created.user;
  }
  const cli = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: sess, error: sessErr } = await cli.auth.signInWithPassword({
    email: adminEmail, password: "AdminTest1!@#",
  });
  if (sessErr) {
    log("admin sign-in failed — skipping admin GET check:", sessErr.message);
  } else {
    const adminGet = await fetch(`${API_URL}/api/admin/feedback?category=ui&limit=10`, {
      headers: { Authorization: `Bearer ${sess.session.access_token}` },
    });
    if (adminGet.status === 200) {
      const body = await adminGet.json();
      if (body.items.length >= 1 && body.counts.ui >= 1) {
        ok(`admin GET returns items.length=${body.items.length}, counts.ui=${body.counts.ui}`);
      } else {
        fail(`admin GET shape unexpected: ${JSON.stringify(body).slice(0, 200)}`);
      }
    } else {
      fail(`admin GET expected 200, got ${adminGet.status}`);
    }
    // admin 사용자도 정리
    await admin.from("feedback").delete().eq("user_id", adminUser.id);
    await admin.auth.admin.deleteUser(adminUser.id);
    await admin.from("allowed_emails").delete().eq("email", adminEmail);
  }
}

// pwtest 피드백 청소
await admin.from("feedback").delete().eq("user_id", userId);
```

- [ ] **Step 2: 빌드 확인 없음 (스크립트), 실행 전 server·client 기동 필요**

이 task의 통합 실행은 다음 Verify 단계에서.

- [ ] **Step 3: 커밋**

```bash
git add scripts/dogfood.js
git commit -m "test(scripts): dogfood에 피드백 + admin 시나리오 추가"
```

---

## Task 10: 통합 검증 (verify)

**Files:**
- 없음 (실행만)

- [ ] **Step 1: server + client 기동**

```bash
cd C:/dev/server && npm start &
cd C:/dev/client && npm run dev &
```
`GET /api/health` 200 + `http://localhost:5173` 응답 확인.

- [ ] **Step 2: Email provider 임시 ON (dogfood 위해)**

Supabase Dashboard → Authentication → Providers → Email → Enable. dogfood 끝나면 OFF.

- [ ] **Step 3: dogfood 실행**

```bash
cd C:/dev/scripts
node dogfood.js
```
기대 출력에 다음 추가 항목 통과:
```
  ✓ POST /api/feedback returned 201
  ✓ rate limit (분당 1건) triggers 429
  ✓ non-admin user → 403 on /api/admin/feedback
  ✓ admin GET returns items.length=1, counts.ui=1
```

- [ ] **Step 4: UI 수동 검증 — 일반 사용자 흐름**

1. Playwright MCP 또는 사용자 브라우저로 `http://localhost:5173` 접속, Google OAuth 로그인
2. 대시보드 가장 아래로 스크롤 → "피드백 보내기" 버튼 클릭
3. 카테고리 "UI" 선택 → 본문 "verify 테스트" 입력 → SEND 클릭
4. "감사합니다, 잘 받았습니다!" 1.5초 표시 후 모달 자동 close 확인
5. 헤더에 "Admin" 링크 노출 확인 (admin email인 경우)

- [ ] **Step 5: UI 수동 검증 — admin 흐름**

1. 헤더 "Admin" 클릭 → `#/admin/feedback` 이동
2. 카테고리 탭에 count 배지 정확한지 확인
3. UI 탭 클릭 → 방금 제출한 피드백 표시 확인
4. "대시보드로" 클릭 → `#/` 복귀 확인
5. 비-admin 사용자로 직접 `#/admin/feedback` 접근 → "권한이 없습니다" 표시

- [ ] **Step 6: 정리 (Email provider OFF, 더미 데이터 제거)**

Supabase Dashboard에서 Email provider OFF로 복귀. dogfood가 자동 정리하지만 수동 검증으로 남긴 피드백은:

```sql
delete from public.feedback where email = 'colri25@gmail.com' and body like 'verify%';
```

- [ ] **Step 7: 워킹 트리 클린 확인 + 커밋 안 함 (이미 모든 단계가 커밋됨)**

```bash
git status
git log --oneline -12
```
기대: 워킹 트리 클린, 마지막 ~10개 커밋이 이 plan의 단계들.

---

## Self-review note

스펙 커버리지:
- 데이터 모델 + RLS + 트리거 → Task 1
- 서버 `/api/feedback` + `/api/admin/feedback` + requireAdmin → Task 2, 3
- 카테고리 라벨 매핑 → Task 4 (`feedback.js`)
- FeedbackModal → Task 5
- 대시보드 버튼 + Admin 링크 → Task 6
- AdminFeedbackPage + 해시 라우터 → Task 7, 8
- 클라이언트/서버 env vars → Task 3 (server), Task 4 (client)
- 단위 테스트 (requireAdmin) → Task 2
- 통합 검증 (dogfood) → Task 9, 10
- 수동 verify (UI) → Task 10

YAGNI / 스코프 밖 항목은 spec의 [Out of scope](../specs/2026-05-28-feedback-feature-design.md#out-of-scope-yagni) 그대로.
