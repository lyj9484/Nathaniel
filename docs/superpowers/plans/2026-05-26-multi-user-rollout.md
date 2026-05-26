# 자산관리 대시보드 멀티유저 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1인 localStorage 기반 대시보드를 가족·친구 5~30명이 쓸 수 있는 Supabase 인증·DB 기반 멀티유저 웹앱으로 전환한다.

**Architecture:** 클라이언트는 supabase-js로 사용자 데이터 직접 CRUD(RLS로 격리), AI/시세 호출만 기존 Express에 JWT 검증 후 프록시. Supabase Auth(Google·Kakao), Postgres, RLS·트리거로 보안. Vercel + Railway + Supabase Cloud 배포.

**Tech Stack:**
- Backend: Node 18+, Express, `jose`(JWT 검증), `zod`(입력 검증), `helmet`, `express-rate-limit`, `@supabase/supabase-js`(service_role)
- Frontend: React 18, Vite, `@supabase/supabase-js`, `vite-plugin-pwa`, 기존 recharts/lucide-react
- DB: Supabase Postgres + RLS + 트리거
- Test: 내장 `node --test`, Playwright(E2E), `scripts/security-smoke.js`(RLS 검증)

**Spec:** `docs/superpowers/specs/2026-05-26-multi-user-rollout-design.md`

---

## File Structure

**신규 (Server)**
- `server/lib/supabaseAdmin.js` — service_role 키 사용하는 Supabase admin client 싱글톤
- `server/lib/usage.js` — `chargeAiUsage(userId, limit)` 헬퍼, atomic RPC 호출
- `server/lib/errors.js` — `RateLimitError`, 공통 에러 변환 함수
- `server/middleware/auth.js` — JWT HS256 검증 → `req.user` 주입
- `server/validators.js` — zod 스키마(`StockSymbolSchema`, `NewsBodySchema`)
- `server/.env.example` — 갱신

**수정 (Server)**
- `server/server.js` — helmet/cors origin/express-rate-limit/auth 미들웨어/에러 핸들러 추가
- `server/analyze.js` — `analyzeNews(news, holdings, userId)` / `analyzeStock({...}, userId)` 시그니처에 `userId` 추가, 캐시 hit이 아닌 경우에만 `chargeAiUsage`
- `server/package.json` — `jose`, `zod`, `helmet`, `express-rate-limit`, `@supabase/supabase-js` 추가

**신규 (Client)**
- `client/src/lib/supabase.js` — anon key로 만든 supabase 싱글톤
- `client/src/lib/api.js` — `apiPost(path, body)` 헬퍼 + `RateLimitError`
- `client/src/lib/db/holdings.js` — `listHoldings`, `addHolding`, `removeHolding`
- `client/src/lib/db/transactions.js` — `listTransactions`, `addTransaction`, `updateTransaction`, `deleteTransaction`
- `client/src/lib/db/userSettings.js` — `getSettings`, `updateTarget`, `updateFxRate`
- `client/src/lib/useRemoteState.js` — `useHoldings`, `useTransactions`, `useSettings` 훅
- `client/src/AuthProvider.jsx` — 세션 구독, React context
- `client/src/AuthGate.jsx` — 세션 분기
- `client/src/LoginPage.jsx` — Google·Kakao OAuth 버튼
- `client/.env.example` — 신규

**수정 (Client)**
- `client/src/AssetDashboard.jsx` — `useLocalStorage` 4곳 → 원격 훅, `fetch('/api/...')` 4~5곳 → `apiPost`, `STORAGE_PREFIX`/`SAMPLE_*`/`useLocalStorage` 제거
- `client/src/main.jsx` — `<AuthProvider><AuthGate>...</AuthGate></AuthProvider>` 감싸기
- `client/vite.config.js` — `vite-plugin-pwa` 등록
- `client/package.json` — `@supabase/supabase-js`, `vite-plugin-pwa` 추가

**신규 (DB / Scripts)**
- `supabase/migrations/0001_init.sql` — 스키마 + RLS + 정책 + 트리거 + 함수
- `scripts/security-smoke.js` — 8가지 보안 시나리오 자동 검증
- `scripts/add-allowed-email.js` — `node scripts/add-allowed-email.js <email>` (운영 헬퍼)

---

## Phase 0: 인프라 (수동, 약 1일)

### Task 0.1: Supabase 프로젝트 생성

**Files:** (외부 작업, 코드 변경 없음)

- [ ] **Step 1: Supabase 프로젝트 생성**

브라우저에서 https://supabase.com/dashboard 접속 → "New project" → 이름 `asset-dashboard`, region `ap-northeast-2 (Seoul)`, DB password 강력하게 생성.

- [ ] **Step 2: API 키 복사 (4개)**

Dashboard → Settings → API 메뉴에서 4개 값을 안전한 곳에 임시 저장:
- `Project URL` → `SUPABASE_URL`
- `anon public key` → `VITE_SUPABASE_ANON_KEY`
- `service_role secret key` → `SUPABASE_SERVICE_ROLE_KEY` ★ 절대 노출 금지
- Settings → API → JWT Settings → `JWT Secret` → `SUPABASE_JWT_SECRET`

- [ ] **Step 3: Google OAuth provider 등록**

Google Cloud Console → APIs & Services → Credentials → "Create credentials" → "OAuth client ID" → Web application.
- Authorized redirect URIs에 `https://<프로젝트>.supabase.co/auth/v1/callback` 추가.
- Client ID/Secret 복사.
- Supabase Dashboard → Authentication → Providers → Google → enable + Client ID/Secret 붙여넣기.

- [ ] **Step 4: Kakao OAuth provider 등록**

Kakao Developers (https://developers.kakao.com) → 내 애플리케이션 → 추가하기.
- 카카오 로그인 → 활성화. Redirect URI에 `https://<프로젝트>.supabase.co/auth/v1/callback` 추가.
- 동의항목: 닉네임, 카카오계정(이메일) 필수 동의.
- REST API 키 + Client Secret 코드 생성.
- Supabase Dashboard → Authentication → Providers → Kakao → enable + 키 붙여넣기.

- [ ] **Step 5: Email/Password provider disable**

Authentication → Providers → Email → "Enable Email provider" 토글 OFF (OAuth만 허용).

- [ ] **Step 6: 환경변수 메모**

이후 task에서 사용할 5개 값이 모두 손에 있는지 확인:
- `SUPABASE_URL`
- `SUPABASE_JWT_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`(클라이언트용 `VITE_SUPABASE_ANON_KEY`로도 사용)
- DB password (Supabase Dashboard → Settings → Database)

**커밋 없음** (외부 작업)

---

### Task 0.2: Railway·Vercel 빈 프로젝트 생성

- [ ] **Step 1: Vercel 계정 + 빈 프로젝트**

https://vercel.com 가입 → "Add New" → "Project" → GitHub 저장소가 아직 없으면 빈 프로젝트만 생성하고 Project Settings → Environment Variables 자리만 확인.

- [ ] **Step 2: Railway 계정 + 빈 프로젝트**

https://railway.app 가입 → "New Project" → "Empty Project" → 이름 `asset-dashboard-api`.

배포는 Phase 5에서. 지금은 dashboard 접근만.

**커밋 없음**

---

### Task 0.3: Supabase CLI 설치 (로컬 마이그레이션 적용용)

- [ ] **Step 1: CLI 설치 (Windows)**

PowerShell:
```powershell
scoop install supabase
# 또는
npm install -g supabase
```

- [ ] **Step 2: 로그인 + 프로젝트 링크**

```powershell
supabase login
# 브라우저 인증 완료 후
cd C:\dev
supabase init
supabase link --project-ref <프로젝트-ref>
```

`<프로젝트-ref>`는 Supabase Dashboard URL의 `https://supabase.com/dashboard/project/<여기>` 부분.

- [ ] **Step 3: 연결 확인**

```powershell
supabase projects list
```

Expected: 방금 만든 `asset-dashboard` 프로젝트가 보임.

**커밋:**
```powershell
git add supabase/config.toml supabase/.gitignore
git commit -m "chore: init supabase CLI link"
```

(`supabase/.gitignore`에 `.branches/`, `.temp/`가 자동 추가됨)

---

## Phase 1: DB 스키마 + 보안 (1일)

### Task 1.1: 마이그레이션 SQL 작성 — 스키마

**Files:**
- Create: `C:\dev\supabase\migrations\20260526000001_init.sql`

- [ ] **Step 1: 마이그레이션 디렉터리 확인**

```powershell
ls C:\dev\supabase\migrations
```

없으면 `supabase init` 다시 실행.

- [ ] **Step 2: 스키마 SQL 작성**

`C:\dev\supabase\migrations\20260526000001_init.sql`:

```sql
-- 1) holdings
create table public.holdings (
  id          bigint generated by default as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  category    text not null check (category in ('kr','us','crypto')),
  symbol      text not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, symbol)
);
create index holdings_user_id_idx on public.holdings (user_id);

-- 2) transactions
create table public.transactions (
  id          bigint generated by default as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  holding_id  bigint not null references public.holdings(id) on delete cascade,
  type        text not null check (type in ('buy','sell')),
  quantity    numeric not null check (quantity > 0),
  price       numeric not null check (price >= 0),
  date        date not null,
  fee         numeric not null default 0 check (fee >= 0),
  created_at  timestamptz not null default now()
);
create index transactions_user_id_idx  on public.transactions (user_id);
create index transactions_holding_idx on public.transactions (holding_id);

-- 3) user_settings (1:1)
create table public.user_settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  target      jsonb not null default '{"kr":30,"us":50,"crypto":20}',
  fx_rate     numeric not null default 1380 check (fx_rate > 0),
  updated_at  timestamptz not null default now()
);

-- 4) ai_usage (서버가 service_role로만 갱신)
create table public.ai_usage (
  user_id     uuid not null references auth.users(id) on delete cascade,
  usage_date  date not null,
  count       integer not null default 0,
  primary key (user_id, usage_date)
);

-- 5) allowed_emails (초대제)
create table public.allowed_emails (
  email       text primary key,
  invited_by  uuid references auth.users(id),
  created_at  timestamptz default now()
);
```

- [ ] **Step 3: 적용 + 검증**

```powershell
supabase db push
```

Expected: "Applying migration 20260526000001_init.sql..." → 성공.

Supabase Dashboard → Database → Tables에서 5개 테이블이 보이는지 확인.

- [ ] **Step 4: 커밋**

```powershell
git add supabase/migrations/20260526000001_init.sql
git commit -m "feat(db): add schema (holdings, transactions, user_settings, ai_usage, allowed_emails)"
```

---

### Task 1.2: 마이그레이션 SQL — RLS 정책

**Files:**
- Create: `C:\dev\supabase\migrations\20260526000002_rls.sql`

- [ ] **Step 1: RLS 활성화 + 권한 회수 SQL**

`C:\dev\supabase\migrations\20260526000002_rls.sql`:

```sql
-- RLS enable + FORCE (postgres role bypass도 차단)
alter table public.holdings        enable row level security;
alter table public.transactions    enable row level security;
alter table public.user_settings   enable row level security;
alter table public.ai_usage        enable row level security;
alter table public.allowed_emails  enable row level security;

alter table public.holdings        force row level security;
alter table public.transactions    force row level security;
alter table public.user_settings   force row level security;
alter table public.ai_usage        force row level security;
alter table public.allowed_emails  force row level security;

-- 권한 회수
revoke all on public.holdings, public.transactions,
              public.user_settings, public.ai_usage, public.allowed_emails
  from public, anon;

-- 최소 권한
grant select, insert, update, delete
  on public.holdings, public.transactions, public.user_settings
  to authenticated;
grant select on public.ai_usage to authenticated;
-- allowed_emails는 service_role만 (authenticated에도 grant 안 함)
```

- [ ] **Step 2: 정책 SQL (동작별 분리)**

같은 파일에 이어서:

```sql
-- holdings
create policy holdings_select on public.holdings
  for select to authenticated using (user_id = auth.uid());

create policy holdings_insert on public.holdings
  for insert to authenticated with check (user_id = auth.uid());

create policy holdings_update on public.holdings
  for update to authenticated
  using       (user_id = auth.uid())
  with check  (user_id = auth.uid());

create policy holdings_delete on public.holdings
  for delete to authenticated using (user_id = auth.uid());

-- transactions: 본인 + holding 소유권 검증
create policy tx_select on public.transactions
  for select to authenticated using (user_id = auth.uid());

create policy tx_insert on public.transactions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.holdings h
      where h.id = holding_id and h.user_id = auth.uid()
    )
  );

create policy tx_update on public.transactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.holdings h
      where h.id = holding_id and h.user_id = auth.uid()
    )
  );

create policy tx_delete on public.transactions
  for delete to authenticated using (user_id = auth.uid());

-- user_settings (DELETE 정책 의도적 미작성 → 차단됨)
create policy us_select on public.user_settings
  for select to authenticated using (user_id = auth.uid());

create policy us_insert on public.user_settings
  for insert to authenticated with check (user_id = auth.uid());

create policy us_update on public.user_settings
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ai_usage: SELECT만 허용, 갱신은 service_role
create policy au_select on public.ai_usage
  for select to authenticated using (user_id = auth.uid());
```

- [ ] **Step 3: 적용 + 검증**

```powershell
supabase db push
```

Dashboard → Database → Policies에서 11개 정책이 보이는지 확인 (holdings 4 + tx 4 + us 3 + au 1 = 12. ai_usage 정책은 1개만 정상).

- [ ] **Step 4: 커밋**

```powershell
git add supabase/migrations/20260526000002_rls.sql
git commit -m "feat(db): enable RLS with strict per-action policies"
```

---

### Task 1.3: 마이그레이션 SQL — 트리거 + 함수

**Files:**
- Create: `C:\dev\supabase\migrations\20260526000003_triggers.sql`

- [ ] **Step 1: 위변조 차단 트리거 함수 작성**

`C:\dev\supabase\migrations\20260526000003_triggers.sql`:

```sql
-- INSERT 시 user_id·created_at 서버 강제 주입
create function public.set_user_id_from_jwt()
returns trigger language plpgsql security invoker as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  return new;
end $$;

create trigger holdings_set_user_id
  before insert on public.holdings
  for each row execute function public.set_user_id_from_jwt();

create trigger transactions_set_user_id
  before insert on public.transactions
  for each row execute function public.set_user_id_from_jwt();

-- user_settings: created_at 칼럼 없고 updated_at만 있어서 user_id만 주입
create function public.set_user_id_only()
returns trigger language plpgsql security invoker as $$
begin
  new.user_id := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create trigger user_settings_set_user_id
  before insert on public.user_settings
  for each row execute function public.set_user_id_only();

-- UPDATE 시 user_id / created_at 변경 차단 (trigger로 복원)
create function public.prevent_immutable_changes()
returns trigger language plpgsql security invoker as $$
begin
  new.user_id    := old.user_id;
  new.created_at := old.created_at;
  return new;
end $$;

create trigger holdings_prevent_immutable
  before update on public.holdings
  for each row execute function public.prevent_immutable_changes();

create trigger transactions_prevent_immutable
  before update on public.transactions
  for each row execute function public.prevent_immutable_changes();

-- user_settings UPDATE: user_id 변경 차단 + updated_at 자동 갱신
create function public.prevent_user_settings_changes()
returns trigger language plpgsql security invoker as $$
begin
  new.user_id := old.user_id;
  new.updated_at := now();
  return new;
end $$;

create trigger user_settings_prevent_immutable
  before update on public.user_settings
  for each row execute function public.prevent_user_settings_changes();
```

- [ ] **Step 2: ai_usage atomic 증가 함수**

같은 파일에 이어서:

```sql
create function public.increment_ai_usage(p_user_id uuid, p_date date)
returns table(count int)
language plpgsql security definer set search_path = public as $$
begin
  return query
  insert into public.ai_usage (user_id, usage_date, count)
    values (p_user_id, p_date, 1)
    on conflict (user_id, usage_date)
    do update set count = ai_usage.count + 1
    returning ai_usage.count;
end $$;

-- service_role과 authenticated만 호출 가능
revoke all on function public.increment_ai_usage from public, anon;
grant execute on function public.increment_ai_usage to service_role;
```

- [ ] **Step 3: 화이트리스트 enforce 트리거**

같은 파일에 이어서:

```sql
create function public.enforce_invite_only()
returns trigger language plpgsql security definer
set search_path = public, auth as $$
begin
  if not exists (select 1 from public.allowed_emails where email = new.email) then
    raise exception 'Email not in invite list: %', new.email
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger users_invite_check
  before insert on auth.users
  for each row execute function public.enforce_invite_only();
```

- [ ] **Step 4: 적용**

```powershell
supabase db push
```

- [ ] **Step 5: 커밋**

```powershell
git add supabase/migrations/20260526000003_triggers.sql
git commit -m "feat(db): triggers for tamper-proofing, atomic AI usage RPC, invite-only enforcement"
```

---

### Task 1.4: 본인 이메일을 화이트리스트에 추가

**Files:** (외부 작업, SQL 1회 실행)

- [ ] **Step 1: 본인 이메일 추가**

Supabase Dashboard → SQL Editor → New query:

```sql
insert into public.allowed_emails (email) values ('<본인-이메일>');
```

`<본인-이메일>`은 Google 또는 Kakao 계정 이메일.

> Kakao는 동의항목에서 이메일을 받아오므로 그 이메일을 넣어야 함.

- [ ] **Step 2: 확인**

```sql
select * from public.allowed_emails;
```

본인 이메일 1행 확인.

**커밋 없음** (DB 데이터)

---

### Task 1.5: Security smoke test 스크립트

**Files:**
- Create: `C:\dev\scripts\security-smoke.js`
- Create: `C:\dev\scripts\package.json` (별도 npm root, 또는 server/와 공유)

- [ ] **Step 1: scripts/ 디렉터리 + npm 초기화**

```powershell
mkdir C:\dev\scripts
cd C:\dev\scripts
npm init -y
npm install @supabase/supabase-js dotenv
```

`scripts/package.json`에 `"type": "module"` 추가.

- [ ] **Step 2: .env에 키 채우기**

`C:\dev\scripts\.env`:
```
SUPABASE_URL=https://<프로젝트>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
SMOKE_USER_A_EMAIL=smoke-a@example.com
SMOKE_USER_B_EMAIL=smoke-b@example.com
```

`<프로젝트>`와 키는 Phase 0에서 메모해둔 값.

`.gitignore`에 `scripts/.env` 포함되어 있는지 확인 (없으면 추가).

- [ ] **Step 3: 헬퍼 함수와 8개 체크 작성**

`C:\dev\scripts\security-smoke.js`:

```javascript
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
```

- [ ] **Step 4: Email/Password provider 임시 활성화 (테스트용)**

Supabase Dashboard → Authentication → Providers → Email → "Enable" ON (smoke test 동안만).
> 본격 운영 전(Phase 4 직전)에 다시 OFF.

- [ ] **Step 5: 실행 + 8개 모두 통과 확인**

```powershell
cd C:\dev\scripts
node security-smoke.js
```

Expected:
```
✓ 1) A sees only own rows
✓ 2) INSERT with foreign user_id → rewritten by trigger
✓ 3) UPDATE user_id → reverted by trigger
✓ 4) Cross-user holding_id INSERT rejected: <msg>
✓ 5) ai_usage UPDATE blocked
✓ 6) Non-allowlisted email rejected: <msg>
✓ 7) anon SELECT returns 0 rows
ℹ 8) bundle scan deferred to Phase 3
All security checks passed ✓
```

- [ ] **Step 6: 커밋**

```powershell
cd C:\dev
git add scripts/package.json scripts/security-smoke.js .gitignore
git commit -m "test(security): smoke test for RLS, triggers, invite-only"
```

---

## Phase 2: 서버 변경 (1일)

### Task 2.1: 신규 패키지 설치

**Files:** `server/package.json`

- [ ] **Step 1: 의존성 추가**

```powershell
cd C:\dev\server
npm install jose zod helmet express-rate-limit @supabase/supabase-js
```

- [ ] **Step 2: 설치 확인**

`server/package.json`의 `dependencies`에 `jose`, `zod`, `helmet`, `express-rate-limit`, `@supabase/supabase-js`가 추가됨을 확인.

- [ ] **Step 3: 커밋**

```powershell
git add server/package.json server/package-lock.json
git commit -m "chore(server): add jose, zod, helmet, express-rate-limit, supabase-js"
```

---

### Task 2.2: errors.js — RateLimitError + 공통 변환

**Files:**
- Create: `C:\dev\server\lib\errors.js`

- [ ] **Step 1: errors.js 작성**

`C:\dev\server\lib\errors.js`:

```javascript
export class RateLimitError extends Error {
  constructor({ used, limit, resetAt }) {
    super("rate_limit");
    this.code = "rate_limit";
    this.used = used;
    this.limit = limit;
    this.resetAt = resetAt;
  }
}

export class ValidationError extends Error {
  constructor(details) {
    super("validation_error");
    this.code = "validation_error";
    this.details = details;
  }
}

// Express 에러 핸들러: 모든 throw를 일관된 JSON으로
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof RateLimitError) {
    return res.status(429).json({
      error: "rate_limit",
      message: `오늘 AI 분석 한도(${err.limit}회)를 초과했습니다`,
      details: { used: err.used, limit: err.limit, resetAt: err.resetAt },
    });
  }
  if (err instanceof ValidationError) {
    return res.status(400).json({
      error: "validation_error",
      message: "입력 검증 실패",
      details: err.details,
    });
  }
  if (err.code === "ai_disabled") {
    return res.status(503).json({ error: "ai_disabled", message: "AI 기능 비활성" });
  }
  console.error("[unhandled]", err);
  res.status(500).json({ error: "internal_error", message: "서버 오류" });
}
```

- [ ] **Step 2: 커밋**

```powershell
git add server/lib/errors.js
git commit -m "feat(server): centralized error types and handler"
```

---

### Task 2.3: supabaseAdmin.js — service_role 싱글톤

**Files:**
- Create: `C:\dev\server\lib\supabaseAdmin.js`

- [ ] **Step 1: 작성**

`C:\dev\server\lib\supabaseAdmin.js`:

```javascript
import { createClient } from "@supabase/supabase-js";

let client = null;

export function supabaseAdmin() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
```

- [ ] **Step 2: 커밋**

```powershell
git add server/lib/supabaseAdmin.js
git commit -m "feat(server): supabase admin client singleton"
```

---

### Task 2.4: usage.js — chargeAiUsage 헬퍼 (TDD)

**Files:**
- Create: `C:\dev\server\lib\usage.js`
- Create: `C:\dev\server\lib\usage.test.js`

- [ ] **Step 1: 순수 헬퍼(todayUTC) 테스트 작성**

`C:\dev\server\lib\usage.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { todayUTC } from "./usage.js";

test("todayUTC: returns YYYY-MM-DD in UTC", () => {
  const s = todayUTC(new Date("2026-05-26T14:30:00Z"));
  assert.equal(s, "2026-05-26");
});

test("todayUTC: handles KST evening near UTC midnight", () => {
  // KST 2026-05-27 08:00 = UTC 2026-05-26 23:00
  const s = todayUTC(new Date("2026-05-26T23:00:00Z"));
  assert.equal(s, "2026-05-26");
  const s2 = todayUTC(new Date("2026-05-27T00:30:00Z"));
  assert.equal(s2, "2026-05-27");
});
```

- [ ] **Step 2: 테스트 실패 확인**

```powershell
cd C:\dev\server
node --test lib/usage.test.js
```

Expected: FAIL with "Cannot find module './usage.js'".

- [ ] **Step 3: usage.js 작성**

`C:\dev\server\lib\usage.js`:

```javascript
import { supabaseAdmin } from "./supabaseAdmin.js";
import { RateLimitError } from "./errors.js";

export function todayUTC(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export async function chargeAiUsage(userId, dailyLimit = 20) {
  const today = todayUTC();
  const { data, error } = await supabaseAdmin().rpc("increment_ai_usage", {
    p_user_id: userId,
    p_date: today,
  });
  if (error) {
    const err = new Error("usage_error");
    err.code = "usage_error";
    err.cause = error;
    throw err;
  }
  // data는 [{ count: <int> }] 형태
  const count = Array.isArray(data) ? data[0]?.count : data?.count;
  if (count == null) {
    throw new Error("usage_error: unexpected response");
  }
  if (count > dailyLimit) {
    throw new RateLimitError({
      used: count,
      limit: dailyLimit,
      resetAt: `${today}T23:59:59Z`,
    });
  }
  return count;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```powershell
node --test lib/usage.test.js
```

Expected: PASS (2/2).

- [ ] **Step 5: 커밋**

```powershell
git add server/lib/usage.js server/lib/usage.test.js
git commit -m "feat(server): chargeAiUsage with atomic Postgres RPC"
```

---

### Task 2.5: validators.js — zod 스키마 (TDD)

**Files:**
- Create: `C:\dev\server\validators.js`
- Create: `C:\dev\server\validators.test.js`

- [ ] **Step 1: 테스트 작성**

`C:\dev\server\validators.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { StockSymbolSchema, NewsBodySchema, StockAnalysisBodySchema } from "./validators.js";

test("StockSymbolSchema: valid US/KR/crypto symbols", () => {
  assert.doesNotThrow(() => StockSymbolSchema.parse("AAPL"));
  assert.doesNotThrow(() => StockSymbolSchema.parse("005930.KS"));
  assert.doesNotThrow(() => StockSymbolSchema.parse("BTC-USD"));
});

test("StockSymbolSchema: rejects script injection", () => {
  assert.throws(() => StockSymbolSchema.parse("<script>"));
  assert.throws(() => StockSymbolSchema.parse("a; drop table"));
  assert.throws(() => StockSymbolSchema.parse(""));
  assert.throws(() => StockSymbolSchema.parse("A".repeat(16)));
});

test("NewsBodySchema: holdings array", () => {
  const ok = NewsBodySchema.parse({
    holdings: [{ symbol: "AAPL", name: "Apple", category: "us" }],
  });
  assert.equal(ok.holdings.length, 1);
});

test("NewsBodySchema: rejects >50 holdings", () => {
  const big = { holdings: Array(51).fill({ symbol: "AAPL", name: "Apple", category: "us" }) };
  assert.throws(() => NewsBodySchema.parse(big));
});

test("StockAnalysisBodySchema: valid", () => {
  const ok = StockAnalysisBodySchema.parse({
    name: "Apple", category: "us",
    currentPrice: 188.5, avgPrice: 150, quantity: 10,
  });
  assert.equal(ok.category, "us");
});
```

- [ ] **Step 2: 실행 → FAIL**

```powershell
node --test validators.test.js
```

- [ ] **Step 3: validators.js 작성**

`C:\dev\server\validators.js`:

```javascript
import { z } from "zod";

export const StockSymbolSchema = z
  .string()
  .min(1)
  .max(15)
  .regex(/^[A-Z0-9.\-]+$/, "invalid symbol");

export const CategorySchema = z.enum(["kr", "us", "crypto"]);

export const HoldingSummarySchema = z.object({
  symbol: StockSymbolSchema,
  name: z.string().max(50),
  category: CategorySchema,
});

export const NewsBodySchema = z.object({
  holdings: z.array(HoldingSummarySchema).max(50),
});

export const StockAnalysisBodySchema = z.object({
  name: z.string().max(50).optional(),
  category: CategorySchema.optional(),
  currentPrice: z.number().positive().nullable().optional(),
  avgPrice: z.number().nonnegative().nullable().optional(),
  quantity: z.number().nonnegative().nullable().optional(),
});

export function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const { ValidationError } = require("./lib/errors.js");
    throw new ValidationError(result.error.flatten());
  }
  return result.data;
}
```

> CJS `require`를 ESM에 섞으면 안 됨. 위의 `parseBody`는 ESM 환경에서 동적 import가 필요해 깔끔하지 않다. 대신 `parseBody`는 호출부에서 직접 zod + throw 처리하도록 제거하고, validators는 스키마만 export하는 게 단순.

수정 — `parseBody` 함수 제거:

```javascript
import { z } from "zod";

export const StockSymbolSchema = z
  .string()
  .min(1)
  .max(15)
  .regex(/^[A-Z0-9.\-]+$/, "invalid symbol");

export const CategorySchema = z.enum(["kr", "us", "crypto"]);

export const HoldingSummarySchema = z.object({
  symbol: StockSymbolSchema,
  name: z.string().max(50),
  category: CategorySchema,
});

export const NewsBodySchema = z.object({
  holdings: z.array(HoldingSummarySchema).max(50),
});

export const StockAnalysisBodySchema = z.object({
  name: z.string().max(50).optional(),
  category: CategorySchema.optional(),
  currentPrice: z.number().positive().nullable().optional(),
  avgPrice: z.number().nonnegative().nullable().optional(),
  quantity: z.number().nonnegative().nullable().optional(),
});
```

- [ ] **Step 4: 테스트 통과**

```powershell
node --test validators.test.js
```

Expected: PASS (5/5).

- [ ] **Step 5: 커밋**

```powershell
git add server/validators.js server/validators.test.js
git commit -m "feat(server): zod input validators with tests"
```

---

### Task 2.6: middleware/auth.js — JWT 검증

**Files:**
- Create: `C:\dev\server\middleware\auth.js`
- Create: `C:\dev\server\middleware\auth.test.js`

- [ ] **Step 1: 테스트 작성 (jose로 토큰 생성→검증)**

`C:\dev\server\middleware\auth.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { authMiddleware } from "./auth.js";

const SECRET = "test-secret-1234567890";
process.env.SUPABASE_JWT_SECRET = SECRET;
process.env.SUPABASE_URL = "https://proj.supabase.co";

async function makeToken({ sub = "user-123", email = "a@b.com", expiresIn = "1h", issuer } = {}) {
  return new SignJWT({ sub, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer ?? "https://proj.supabase.co/auth/v1")
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(SECRET));
}

function mockReq(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}
function mockRes() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(body)   { this.body = body; return this; },
  };
}

test("auth: valid token sets req.user", async () => {
  const token = await makeToken();
  const req = mockReq(token);
  let nextCalled = false;
  await authMiddleware(req, mockRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.id, "user-123");
  assert.equal(req.user.email, "a@b.com");
});

test("auth: missing Authorization → 401 no_token", async () => {
  const res = mockRes();
  await authMiddleware(mockReq(null), res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "no_token");
});

test("auth: expired token → 401 invalid_token", async () => {
  const token = await makeToken({ expiresIn: "-1m" }); // already expired
  const res = mockRes();
  await authMiddleware(mockReq(token), res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "invalid_token");
});

test("auth: wrong issuer → 401", async () => {
  const token = await makeToken({ issuer: "https://evil.example.com" });
  const res = mockRes();
  await authMiddleware(mockReq(token), res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 401);
});

test("auth: tampered signature → 401", async () => {
  const token = (await makeToken()).slice(0, -3) + "XYZ";
  const res = mockRes();
  await authMiddleware(mockReq(token), res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 401);
});
```

- [ ] **Step 2: 실행 → FAIL**

```powershell
node --test middleware/auth.test.js
```

- [ ] **Step 3: auth.js 작성**

`C:\dev\server\middleware\auth.js`:

```javascript
import { jwtVerify } from "jose";

let secretKey = null;
function getSecret() {
  if (!secretKey) {
    const s = process.env.SUPABASE_JWT_SECRET;
    if (!s) throw new Error("SUPABASE_JWT_SECRET missing");
    secretKey = new TextEncoder().encode(s);
  }
  return secretKey;
}

export async function authMiddleware(req, res, next) {
  const h = req.headers?.authorization;
  if (!h || !h.startsWith("Bearer ")) {
    return res.status(401).json({ error: "no_token", message: "인증 토큰이 없습니다" });
  }
  const token = h.slice(7);
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: `${process.env.SUPABASE_URL}/auth/v1`,
      algorithms: ["HS256"],
    });
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token", message: "토큰이 유효하지 않습니다" });
  }
}
```

- [ ] **Step 4: 테스트 통과**

```powershell
node --test middleware/auth.test.js
```

Expected: PASS (5/5).

- [ ] **Step 5: 커밋**

```powershell
git add server/middleware/auth.js server/middleware/auth.test.js
git commit -m "feat(server): JWT auth middleware (HS256 local verify)"
```

---

### Task 2.7: analyze.js — userId 인자 + chargeAiUsage 통합

**Files:**
- Modify: `C:\dev\server\analyze.js`

- [ ] **Step 1: analyzeNews 시그니처 확장**

`C:\dev\server\analyze.js`의 `analyzeNews` 변경:

```javascript
import { chargeAiUsage } from "./lib/usage.js";

const DAILY_LIMIT = Number(process.env.DAILY_AI_LIMIT) || 20;

export async function analyzeNews(news, holdings, userId) {
  if (userId) await chargeAiUsage(userId, DAILY_LIMIT);
  const client = getClient();
  const userMessage = buildUserMessage(news, holdings);

  async function callOnce() {
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });
    const text = resp.choices?.[0]?.message?.content || "";
    return JSON.parse(text);
  }

  try {
    return await callOnce();
  } catch (e) {
    console.warn("[analyze] first attempt failed, retrying:", e.message);
    return await callOnce();
  }
}
```

- [ ] **Step 2: analyzeStock 시그니처 확장**

같은 파일의 `analyzeStock`:

```javascript
export async function analyzeStock({ holding, stats, points, analyst }, userId) {
  if (userId) await chargeAiUsage(userId, DAILY_LIMIT);
  const client = getClient();
  const recentPoints = points.slice(-30);
  const userMessage = buildStockUserMessage({ holding, stats, recentPoints, analyst });
  // ... 이하 기존 동일
  async function callOnce() {
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: STOCK_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });
    const text = resp.choices?.[0]?.message?.content || "";
    return JSON.parse(text);
  }
  try {
    return await callOnce();
  } catch (e) {
    console.warn("[analyzeStock] first attempt failed, retrying:", e.message);
    return await callOnce();
  }
}
```

> `userId`가 없으면(=호환성 폴백 또는 기존 테스트) charge를 건너뜀. 운영에선 항상 전달.

- [ ] **Step 3: 기존 analyze.test.js가 깨지지 않는지 확인**

```powershell
node --test analyze.test.js
```

> userId를 안 넘기는 경우 charge 안 함이라 통과해야 함.

- [ ] **Step 4: 커밋**

```powershell
git add server/analyze.js
git commit -m "feat(server): per-user AI usage charge in analyze functions"
```

---

### Task 2.8: server.js — 미들웨어 + 라우트 보호 + 에러 핸들러

**Files:**
- Modify: `C:\dev\server\server.js`

- [ ] **Step 1: import 추가 및 보안 미들웨어 등록**

`server/server.js` 상단:

```javascript
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import NodeCache from "node-cache";

import {
  fetchYahooPrice,
  fetchYahooHistorical,
  fetchYahooAnalyst,
} from "./yahoo.js";
import { fetchKisPrice, isKoreanSymbol, isKisConfigured } from "./kis.js";
import { fetchAllMarketsNews } from "./news.js";
import {
  analyzeNews,
  makeCacheKey,
  isAiConfigured,
  computeStats,
  analyzeStock,
} from "./analyze.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorHandler, ValidationError } from "./lib/errors.js";
import { NewsBodySchema, StockSymbolSchema, StockAnalysisBodySchema } from "./validators.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",").map((s) => s.trim());

app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: false }));
app.use(express.json({ limit: "10kb" }));
app.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));
```

- [ ] **Step 2: /api 전체에 auth 부착, /api/health는 공개**

```javascript
// health는 인증 없이
app.get("/api/health", (req, res) => {
  res.json({ ok: true, ai: isAiConfigured(), uptime: process.uptime() });
});

// 이하 모든 /api/* 라우트 보호
app.use("/api", authMiddleware);
```

> Express에서 `app.use("/api", auth)` 등록 뒤에 정의되는 모든 `/api/*` 라우트가 보호됨. 그 전에 정의된 `/api/health`는 영향 없음.

- [ ] **Step 3: /api/news 핸들러 — zod 검증 + userId 전달**

기존 `/api/news` 핸들러를 다음으로 교체:

```javascript
app.post("/api/news", async (req, res, next) => {
  try {
    const parsed = NewsBodySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError(parsed.error.flatten());
    const { holdings } = parsed.data;
    const force = req.query.force === "1";

    if (!isAiConfigured()) {
      return res.status(503).json({ error: "ai_disabled" });
    }

    const key = makeCacheKey(holdings);
    if (!force) {
      const cached = cache.get(key);
      if (cached) return res.json(cached);          // ★ 캐시 hit → charge 안 함
    }

    const news = await fetchAllMarketsNews(5);
    const analysis = await analyzeNews(news, holdings, req.user.id);   // ★ userId

    const markets = {};
    for (const m of ["kr", "us", "crypto"]) {
      markets[m] = {
        summary: analysis.markets?.[m]?.summary || "",
        impacts: analysis.markets?.[m]?.impacts || [],
        headlines: news[m] || [],
      };
    }
    const payload = { fetchedAt: new Date().toISOString(), markets };
    cache.set(key, payload, 3600);
    res.json(payload);
  } catch (e) {
    next(e);
  }
});
```

- [ ] **Step 4: /api/stock/:symbol/analysis 핸들러 — zod + userId**

기존 핸들러를 다음으로 교체:

```javascript
app.post("/api/stock/:symbol/analysis", async (req, res, next) => {
  try {
    const symbolParse = StockSymbolSchema.safeParse(req.params.symbol);
    if (!symbolParse.success) throw new ValidationError({ symbol: "invalid" });
    const symbol = symbolParse.data;

    const bodyParse = StockAnalysisBodySchema.safeParse(req.body || {});
    if (!bodyParse.success) throw new ValidationError(bodyParse.error.flatten());

    const holding = {
      symbol,
      name: bodyParse.data.name || symbol,
      category: bodyParse.data.category || "us",
      currentPrice: bodyParse.data.currentPrice ?? null,
      avgPrice: bodyParse.data.avgPrice ?? null,
      quantity: bodyParse.data.quantity ?? null,
    };
    const force = req.query.force === "1";
    const period = CHART_PERIODS[req.query.period] ? req.query.period : "daily";

    if (!isAiConfigured()) {
      return res.status(503).json({ error: "ai_disabled" });
    }

    const aiKey = `stock-ai:${symbol}`;
    const chartKey = `stock-chart:${symbol}:${period}`;

    let aiPart = force ? null : cache.get(aiKey);
    let chartPart = force ? null : cache.get(chartKey);

    if (!aiPart) {
      const [histRes, analystRes] = await Promise.allSettled([
        fetchYahooHistorical(symbol, "6mo", "1d"),
        fetchYahooAnalyst(symbol),
      ]);
      if (histRes.status !== "fulfilled") {
        throw new Error(`historical fetch failed: ${histRes.reason?.message}`);
      }
      const { points } = histRes.value;
      const analyst = analystRes.status === "fulfilled" ? analystRes.value : null;
      const current = holding.currentPrice ?? points[points.length - 1]?.close;
      if (current == null) {
        return res.status(422).json({ error: "no price data available" });
      }
      const stats = computeStats(points, current);
      const analysisResult = await analyzeStock(
        { holding: { ...holding, currentPrice: current }, stats, points, analyst },
        req.user.id                                                      // ★ userId
      );
      aiPart = { stats, analyst, analysis: analysisResult.analysis };
      cache.set(aiKey, aiPart, 3600);
    }

    if (!chartPart) {
      const { range, interval, label } = CHART_PERIODS[period];
      const { points, currency } = await fetchYahooHistorical(symbol, range, interval);
      chartPart = { period: label, periodKey: period, currency, points };
      cache.set(chartKey, chartPart, 3600);
    }

    res.json({
      fetchedAt: new Date().toISOString(),
      chart: chartPart,
      stats: aiPart.stats,
      analyst: aiPart.analyst,
      analysis: aiPart.analysis,
    });
  } catch (e) {
    next(e);
  }
});
```

- [ ] **Step 5: 에러 핸들러를 마지막에 등록**

`app.listen` 직전에:

```javascript
app.use(errorHandler);
```

- [ ] **Step 6: 시세 라우트는 charge 없이, auth만 적용됨**

`/api/price/:symbol`, `/api/prices`, `/api/fx/usdkrw`는 이미 `app.use("/api", authMiddleware)` 아래라 자동 보호. 변경 불필요.

- [ ] **Step 7: 서버 부팅 + 보호 확인**

```powershell
cd C:\dev\server
npm start
```

다른 PowerShell 창:
```powershell
# health는 토큰 없이 OK
curl http://localhost:3001/api/health

# 보호된 라우트는 401
curl -X POST http://localhost:3001/api/news -H "Content-Type: application/json" -d '{}'
```

Expected: health 응답 OK, news는 `{"error":"no_token",...}` 401.

- [ ] **Step 8: 커밋**

```powershell
git add server/server.js
git commit -m "feat(server): JWT-protect /api routes, zod validation, central error handler"
```

---

### Task 2.9: server/.env.example 갱신

**Files:**
- Modify: `C:\dev\server\.env.example`

- [ ] **Step 1: 갱신**

```
PORT=3001
OPENAI_API_KEY=sk-...
KIS_APP_KEY=
KIS_APP_SECRET=
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_JWT_SECRET=...
SUPABASE_SERVICE_ROLE_KEY=...
ALLOWED_ORIGINS=http://localhost:5173
DAILY_AI_LIMIT=20
```

- [ ] **Step 2: 실제 `server/.env`에도 값 채우기**

Phase 0에서 메모해둔 값으로 본인 .env 채움 (커밋하지 않음).

- [ ] **Step 3: 커밋**

```powershell
git add server/.env.example
git commit -m "chore(server): document required env vars for multi-user"
```

---

## Phase 3: 클라이언트 변경 (1~2일)

### Task 3.1: 의존성 추가

**Files:** `client/package.json`

- [ ] **Step 1: 설치**

```powershell
cd C:\dev\client
npm install @supabase/supabase-js
npm install -D vite-plugin-pwa
```

- [ ] **Step 2: 커밋**

```powershell
git add client/package.json client/package-lock.json
git commit -m "chore(client): add supabase-js, vite-plugin-pwa"
```

---

### Task 3.2: lib/supabase.js — 싱글톤

**Files:**
- Create: `C:\dev\client\src\lib\supabase.js`

- [ ] **Step 1: 작성**

```javascript
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing");
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
```

- [ ] **Step 2: 커밋**

```powershell
git add client/src/lib/supabase.js
git commit -m "feat(client): supabase client singleton"
```

---

### Task 3.3: lib/api.js — apiPost + RateLimitError

**Files:**
- Create: `C:\dev\client\src\lib\api.js`

- [ ] **Step 1: 작성**

```javascript
import { supabase } from "./supabase.js";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export class RateLimitError extends Error {
  constructor({ used, limit, resetAt }) {
    super("rate_limit");
    this.code = "rate_limit";
    this.used = used;
    this.limit = limit;
    this.resetAt = resetAt;
  }
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authenticated");
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function apiGet(path) {
  const headers = await authHeaders();
  const res = await fetch(API_BASE + path, { headers });
  return handle(res);
}

export async function apiPost(path, body) {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers,
    body: body == null ? null : JSON.stringify(body),
  });
  return handle(res);
}

async function handle(res) {
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new RateLimitError(body.details || {});
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    const err = new Error(body.message || body.error || `HTTP ${res.status}`);
    err.code = body.error;
    err.status = res.status;
    throw err;
  }
  return res.json();
}
```

- [ ] **Step 2: 커밋**

```powershell
git add client/src/lib/api.js
git commit -m "feat(client): Express API helper with auth + 429 handling"
```

---

### Task 3.4: lib/db/holdings.js

**Files:**
- Create: `C:\dev\client\src\lib\db\holdings.js`

- [ ] **Step 1: 작성**

```javascript
import { supabase } from "../supabase.js";

export async function listHoldings() {
  const { data, error } = await supabase
    .from("holdings")
    .select("id, category, symbol, name, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function addHolding({ category, symbol, name }) {
  // user_id는 트리거가 auth.uid()로 강제 주입
  const { data, error } = await supabase
    .from("holdings")
    .insert({ category, symbol, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeHolding(id) {
  const { error } = await supabase.from("holdings").delete().eq("id", id);
  if (error) throw error;
}

export async function updateHoldingName(id, name) {
  const { data, error } = await supabase
    .from("holdings").update({ name }).eq("id", id).select().single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 2: 커밋**

```powershell
git add client/src/lib/db/holdings.js
git commit -m "feat(client): holdings DB layer"
```

---

### Task 3.5: lib/db/transactions.js

**Files:**
- Create: `C:\dev\client\src\lib\db\transactions.js`

- [ ] **Step 1: 작성**

```javascript
import { supabase } from "../supabase.js";

export async function listTransactions() {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, holding_id, type, quantity, price, date, fee, created_at")
    .order("date", { ascending: false });
  if (error) throw error;
  // client 측 호환을 위해 holdingId 별칭 추가
  return data.map((t) => ({ ...t, holdingId: t.holding_id }));
}

export async function addTransaction({ holdingId, type, quantity, price, date, fee = 0 }) {
  const { data, error } = await supabase
    .from("transactions")
    .insert({ holding_id: holdingId, type, quantity, price, date, fee })
    .select()
    .single();
  if (error) throw error;
  return { ...data, holdingId: data.holding_id };
}

export async function updateTransaction(id, patch) {
  const dbPatch = {
    ...(patch.type !== undefined && { type: patch.type }),
    ...(patch.quantity !== undefined && { quantity: patch.quantity }),
    ...(patch.price !== undefined && { price: patch.price }),
    ...(patch.date !== undefined && { date: patch.date }),
    ...(patch.fee !== undefined && { fee: patch.fee }),
  };
  const { data, error } = await supabase
    .from("transactions").update(dbPatch).eq("id", id).select().single();
  if (error) throw error;
  return { ...data, holdingId: data.holding_id };
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: 커밋**

```powershell
git add client/src/lib/db/transactions.js
git commit -m "feat(client): transactions DB layer with holdingId alias"
```

---

### Task 3.6: lib/db/userSettings.js

**Files:**
- Create: `C:\dev\client\src\lib\db\userSettings.js`

- [ ] **Step 1: 작성**

```javascript
import { supabase } from "../supabase.js";

const DEFAULT_TARGET = { kr: 30, us: 50, crypto: 20 };
const DEFAULT_FX = 1380;

export async function getSettings() {
  const { data, error } = await supabase
    .from("user_settings").select("target, fx_rate").maybeSingle();
  if (error) throw error;
  if (!data) {
    // 첫 호출이면 insert (트리거가 user_id 주입)
    const { data: ins, error: e2 } = await supabase
      .from("user_settings").insert({}).select().single();
    if (e2) throw e2;
    return { target: ins.target, fxRate: Number(ins.fx_rate) };
  }
  return { target: data.target, fxRate: Number(data.fx_rate) };
}

export async function updateTarget(target) {
  const { data, error } = await supabase
    .from("user_settings").update({ target }).select().single();
  if (error) throw error;
  return data.target;
}

export async function updateFxRate(fxRate) {
  const { data, error } = await supabase
    .from("user_settings").update({ fx_rate: fxRate }).select().single();
  if (error) throw error;
  return Number(data.fx_rate);
}

export const DEFAULTS = { target: DEFAULT_TARGET, fxRate: DEFAULT_FX };
```

- [ ] **Step 2: 커밋**

```powershell
git add client/src/lib/db/userSettings.js
git commit -m "feat(client): user_settings DB layer with lazy-init"
```

---

### Task 3.7: lib/useRemoteState.js — React 훅

**Files:**
- Create: `C:\dev\client\src\lib\useRemoteState.js`

- [ ] **Step 1: 작성**

```javascript
import { useEffect, useState, useCallback } from "react";
import * as H from "./db/holdings.js";
import * as T from "./db/transactions.js";
import * as S from "./db/userSettings.js";

export function useHoldings() {
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const data = await H.listHoldings();
      setHoldings(data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (h) => {
    const created = await H.addHolding(h);
    setHoldings((prev) => [...prev, created]);
    return created;
  }, []);

  const remove = useCallback(async (id) => {
    await H.removeHolding(id);
    setHoldings((prev) => prev.filter((h) => h.id !== id));
  }, []);

  return { holdings, loading, error, add, remove, reload };
}

export function useTransactions() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const data = await T.listTransactions();
      setTransactions(data);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const add = useCallback(async (t) => {
    const created = await T.addTransaction(t);
    setTransactions((prev) => [created, ...prev]);
    return created;
  }, []);

  const update = useCallback(async (id, patch) => {
    const updated = await T.updateTransaction(id, patch);
    setTransactions((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }, []);

  const remove = useCallback(async (id) => {
    await T.deleteTransaction(id);
    setTransactions((prev) => prev.filter((x) => x.id !== id));
  }, []);

  return { transactions, loading, error, add, update, remove, reload };
}

export function useSettings() {
  const [target, setTarget] = useState(S.DEFAULTS.target);
  const [fxRate, setFxRate] = useState(S.DEFAULTS.fxRate);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    S.getSettings().then(({ target, fxRate }) => {
      setTarget(target);
      setFxRate(fxRate);
    }).finally(() => setLoading(false));
  }, []);

  async function saveTarget(t) {
    const next = await S.updateTarget(t);
    setTarget(next);
  }
  async function saveFxRate(r) {
    const next = await S.updateFxRate(r);
    setFxRate(next);
  }
  return { target, fxRate, loading, saveTarget, saveFxRate };
}
```

- [ ] **Step 2: 커밋**

```powershell
git add client/src/lib/useRemoteState.js
git commit -m "feat(client): remote state hooks (holdings, transactions, settings)"
```

---

### Task 3.8: AuthProvider.jsx

**Files:**
- Create: `C:\dev\client\src\AuthProvider.jsx`

- [ ] **Step 1: 작성**

```jsx
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";

const AuthCtx = createContext({ session: null, user: null, loading: true });

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  const value = { session, user: session?.user ?? null, loading };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() { return useContext(AuthCtx); }

export async function signOut() {
  await supabase.auth.signOut();
}
```

- [ ] **Step 2: 커밋**

```powershell
git add client/src/AuthProvider.jsx
git commit -m "feat(client): AuthProvider with supabase session subscription"
```

---

### Task 3.9: LoginPage.jsx

**Files:**
- Create: `C:\dev\client\src\LoginPage.jsx`

- [ ] **Step 1: 작성**

```jsx
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";

export default function LoginPage() {
  const [error, setError] = useState(null);

  useEffect(() => {
    // OAuth 콜백 후 화이트리스트 거부 등 에러를 URL hash에서 감지
    const params = new URLSearchParams(window.location.hash.slice(1));
    const desc = params.get("error_description");
    if (desc) {
      setError(decodeURIComponent(desc));
      // hash 정리
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function signInWith(provider) {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) setError(error.message);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-8">
        <h1 className="text-2xl font-bold mb-2">자산관리 대시보드</h1>
        <p className="text-sm text-slate-500 mb-6">초대받은 분만 이용 가능</p>
        <button
          onClick={() => signInWith("google")}
          className="w-full mb-3 py-3 rounded-xl border border-slate-300 hover:bg-slate-50 font-medium"
        >
          Google로 시작
        </button>
        <button
          onClick={() => signInWith("kakao")}
          className="w-full py-3 rounded-xl bg-yellow-300 hover:bg-yellow-400 font-medium"
        >
          카카오로 시작
        </button>
        {error && (
          <div className="mt-6 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
            {error.includes("invite list")
              ? "초대받은 분만 사용할 수 있어요. 호스트에게 문의해주세요."
              : error}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```powershell
git add client/src/LoginPage.jsx
git commit -m "feat(client): LoginPage with Google/Kakao OAuth"
```

---

### Task 3.10: AuthGate.jsx

**Files:**
- Create: `C:\dev\client\src\AuthGate.jsx`

- [ ] **Step 1: 작성**

```jsx
import { useAuth } from "./AuthProvider.jsx";
import LoginPage from "./LoginPage.jsx";
import AssetDashboard from "./AssetDashboard.jsx";

export default function AuthGate() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        로딩 중…
      </div>
    );
  }
  return session ? <AssetDashboard /> : <LoginPage />;
}
```

- [ ] **Step 2: 커밋**

```powershell
git add client/src/AuthGate.jsx
git commit -m "feat(client): AuthGate routes to LoginPage or Dashboard"
```

---

### Task 3.11: main.jsx — AuthProvider로 감싸기

**Files:**
- Modify: `C:\dev\client\src\main.jsx`

- [ ] **Step 1: 현재 내용 확인**

```powershell
type C:\dev\client\src\main.jsx
```

- [ ] **Step 2: AuthProvider + AuthGate 적용**

`client/src/main.jsx` 전체를 다음으로 교체 (기존 `<AssetDashboard />`를 `<AuthGate />`로):

```jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AuthProvider } from "./AuthProvider.jsx";
import AuthGate from "./AuthGate.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  </StrictMode>,
);
```

- [ ] **Step 3: 커밋**

```powershell
git add client/src/main.jsx
git commit -m "feat(client): wrap app with AuthProvider + AuthGate"
```

---

### Task 3.12: AssetDashboard.jsx — useLocalStorage 4곳 교체

**Files:**
- Modify: `C:\dev\client\src\AssetDashboard.jsx`

- [ ] **Step 1: import 변경**

`AssetDashboard.jsx` 상단의 import에 추가:

```jsx
import { useHoldings, useTransactions, useSettings } from "./lib/useRemoteState.js";
import { signOut, useAuth } from "./AuthProvider.jsx";
import { apiPost, RateLimitError } from "./lib/api.js";
```

- [ ] **Step 2: useLocalStorage 4줄 → 원격 훅**

기존 (line 226~229):

```jsx
const [holdingsRaw, setHoldingsRaw] = useLocalStorage("holdings", SAMPLE_HOLDINGS);
const [transactions, setTransactions] = useLocalStorage("transactions", SAMPLE_TRANSACTIONS);
const [target, setTarget] = useLocalStorage("target", DEFAULT_TARGET);
const [fxRate, setFxRate] = useLocalStorage("fxRate", 1380);
```

교체:

```jsx
const { user } = useAuth();
const {
  holdings: holdingsRaw,
  loading: holdingsLoading,
  add: addHoldingRemote,
  remove: removeHoldingRemote,
} = useHoldings();
const {
  transactions,
  add: addTransactionRemote,
  update: updateTransactionRemote,
  remove: removeTransactionRemote,
} = useTransactions();
const { target, fxRate, saveTarget, saveFxRate } = useSettings();
```

- [ ] **Step 3: 기존 호출부 식별 + 적응**

`AssetDashboard.jsx` 내 다음 함수 호출들의 시그니처가 바뀌므로 수정 필요:

| 기존 | 신규 |
|---|---|
| `setHoldingsRaw([...holdingsRaw, newH])` | `addHoldingRemote(newH)` |
| `setHoldingsRaw(holdingsRaw.filter(...))` | `removeHoldingRemote(id)` |
| `setTransactions([...transactions, newT])` | `addTransactionRemote(newT)` |
| `setTransactions(transactions.map(updateFn))` | `updateTransactionRemote(id, patch)` |
| `setTransactions(transactions.filter(...))` | `removeTransactionRemote(id)` |
| `setTarget({ ...target, kr: 40 })` | `saveTarget({ ...target, kr: 40 })` |
| `setFxRate(1400)` | `saveFxRate(1400)` |

각 호출을 grep으로 찾아 수정.

```powershell
grep -n "setHoldingsRaw\|setTransactions\|setTarget\|setFxRate" client/src/AssetDashboard.jsx
```

각 위치에서 위 표에 따라 신규 함수로 변경.

> 일부 setter는 함수형 업데이트(`prev => ...`)를 사용할 수 있는데, 신규 add/update/remove는 단발성 호출이라 prev를 받지 않는다. 호출 컨텍스트에서 직접 차이값을 계산해 전달.

- [ ] **Step 4: useLocalStorage 훅 + STORAGE_PREFIX + SAMPLE_* 제거**

`AssetDashboard.jsx`에서 다음 블록 제거:
- `STORAGE_PREFIX` 상수 (line 44)
- `SAMPLE_HOLDINGS` (line 52~59)
- `SAMPLE_TRANSACTIONS` (line 61~68)
- `DEFAULT_TARGET` (line 70) — `useSettings`가 default 처리
- `useLocalStorage` 훅 정의 (line 72~94)
- localStorage 키 enumeration 코드 (line 405~408 부근의 `Object.keys(localStorage).filter`)
- "전체 초기화" 버튼이 localStorage를 비우는 부분 — DB DELETE로 변경하거나 일단 버튼 자체 비활성:

```jsx
async function resetAll() {
  if (!confirm("정말 모든 데이터를 삭제할까요?")) return;
  // 모든 holdings 삭제 → CASCADE로 transactions도 삭제됨
  for (const h of holdingsRaw) await removeHoldingRemote(h.id);
  await saveTarget({ kr: 30, us: 50, crypto: 20 });
  await saveFxRate(1380);
}
```

- [ ] **Step 5: 로그아웃 버튼 추가**

상단 헤더 영역(메뉴 끝)에 버튼 추가:

```jsx
{user && (
  <button
    onClick={signOut}
    className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 hover:bg-slate-50"
  >
    {user.email} · 로그아웃
  </button>
)}
```

- [ ] **Step 6: 로딩 가드**

대시보드 본문 진입 전에:

```jsx
if (holdingsLoading) {
  return <div className="p-8 text-slate-500">데이터 로딩 중…</div>;
}
```

- [ ] **Step 7: 빌드/실행 확인**

```powershell
cd C:\dev\client
npm run dev
```

브라우저에서 http://localhost:5173 → 로그인 화면 → Google 클릭 → 콜백 후 빈 대시보드 (홀딩 없음). 종목 추가 1개 → 새로고침 → 보존 확인.

- [ ] **Step 8: 커밋**

```powershell
git add client/src/AssetDashboard.jsx
git commit -m "feat(client): switch AssetDashboard from localStorage to Supabase hooks"
```

---

### Task 3.13: AssetDashboard.jsx — fetch → apiPost 교체

**Files:**
- Modify: `C:\dev\client\src\AssetDashboard.jsx`

- [ ] **Step 1: 기존 fetch 호출 grep**

```powershell
grep -n "fetch(" client/src/AssetDashboard.jsx
```

예상되는 곳: `/api/news`, `/api/stock/.../analysis`, `/api/price`, `/api/prices`, `/api/fx/usdkrw`.

- [ ] **Step 2: 각 호출을 apiPost / apiGet으로**

예) news:

```jsx
// before
const res = await fetch("/api/news", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ holdings }),
});
const json = await res.json();

// after
import { apiPost, RateLimitError } from "./lib/api.js";
try {
  const json = await apiPost("/api/news", { holdings });
  // ...
} catch (e) {
  if (e instanceof RateLimitError) {
    alert(`오늘 AI 분석 한도(${e.limit}회)를 초과했습니다`);
  } else throw e;
}
```

가격 fetch는 `apiGet`:

```jsx
const data = await apiGet(`/api/prices?symbols=${syms}`);
```

- [ ] **Step 3: VITE_API_BASE 환경 변수 사용 확인**

apiPost는 이미 `import.meta.env.VITE_API_BASE`를 prefix로 붙이므로 호출부에선 `/api/...`만 쓰면 됨. 기존 `fetch("/api/...")`도 호환되지만 명시적으로 절대 경로 전달하려면 VITE_API_BASE 사용. **VITE_API_BASE는 다음 task에서 .env에 추가**.

- [ ] **Step 4: 실제 테스트**

브라우저에서 News 새로고침 → 정상 응답 또는 Authorization 문제 시 콘솔 확인. 종목 분석 모달 열기 → AI 분석 정상.

- [ ] **Step 5: 커밋**

```powershell
git add client/src/AssetDashboard.jsx
git commit -m "feat(client): use apiPost/apiGet with JWT for /api calls"
```

---

### Task 3.14: client/.env.example + .env.local

**Files:**
- Create: `C:\dev\client\.env.example`
- Create: `C:\dev\client\.env.local` (gitignored)

- [ ] **Step 1: .env.example 작성**

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_API_BASE=http://localhost:3001
```

- [ ] **Step 2: .env.local에 실제 값 채우기**

Phase 0 메모에서 가져와 채움. 커밋하지 않음.

- [ ] **Step 3: .gitignore 확인**

`client/.gitignore`에 `.env.local`이 포함되어 있는지 확인. Vite 기본 템플릿엔 있음.

- [ ] **Step 4: 커밋**

```powershell
git add client/.env.example
git commit -m "chore(client): document required Vite env vars"
```

---

### Task 3.15: PWA 설정

**Files:**
- Modify: `C:\dev\client\vite.config.js`
- Create: `C:\dev\client\public\icon-192.png`, `icon-512.png` (간단히 색 박스로 자동 생성 가능)

- [ ] **Step 1: 아이콘 준비**

192x192, 512x512 PNG 두 장. 일단 단색 placeholder로 시작 (Phase 4에서 실제 아이콘으로 교체):

PowerShell로 임시 생성 — 또는 Figma/Canva에서 만들고 `client/public/`에 저장.

- [ ] **Step 2: vite.config.js에 PWA 플러그인 추가**

기존 `vite.config.js`를 다음으로 확장:

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "자산관리 대시보드",
        short_name: "자산",
        description: "보유 종목·뉴스·차트 AI 분석",
        theme_color: "#0f172a",
        background_color: "#f8fafc",
        display: "standalone",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // 정적 자산만 캐시. API 응답은 항상 네트워크.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
});
```

- [ ] **Step 3: 빌드 + 검증**

```powershell
cd C:\dev\client
npm run build
npm run preview
```

브라우저에서 dev tools → Application → Manifest 확인. "Install app" 버튼이 주소창에 표시되는지.

- [ ] **Step 4: 커밋**

```powershell
git add client/vite.config.js client/public/icon-192.png client/public/icon-512.png
git commit -m "feat(client): PWA manifest and service worker"
```

---

### Task 3.16: 클라이언트 번들에서 service_role 노출 검증

**Files:** (검증, 코드 변경 없음)

- [ ] **Step 1: 프로덕션 빌드**

```powershell
cd C:\dev\client
npm run build
```

- [ ] **Step 2: 빌드 산출물 grep**

```powershell
grep -r "service_role\|SUPABASE_JWT_SECRET\|SUPABASE_SERVICE_ROLE_KEY" client/dist
```

Expected: 빈 결과 (0 matches).

> 만약 매치되면 변수명에 `VITE_` 접두사가 잘못 붙은 곳이 있는 것. 즉시 수정.

- [ ] **Step 3: 결과 기록**

`scripts/security-smoke.js`의 §8 항목을 표시:

```javascript
// 8) 클라이언트 빌드 산출물에 service_role 미포함 (수동 실행 후 확인)
console.log("ℹ 8) Run `npm run build` in client/ then grep dist for 'service_role' — must be 0 matches");
```

기록만, 커밋 변경 없음.

---

## Phase 4: 본인 dogfooding (1~3일)

### Task 4.1: 로컬에서 end-to-end 검증

- [ ] **Step 1: 서버 + 클라이언트 동시 기동**

```powershell
# Terminal 1
cd C:\dev\server; npm start
# Terminal 2
cd C:\dev\client; npm run dev
```

- [ ] **Step 2: 로그인 + CRUD 검증**

브라우저에서:
1. http://localhost:5173 접속 → LoginPage
2. Google로 로그인 (본인 계정, 화이트리스트에 있어야 함)
3. 종목 3개 추가 (KR/US/Crypto 각 1개)
4. 거래 5개 추가
5. 새로고침 → 모든 데이터 보존 확인
6. 뉴스 새로고침 → AI 분석 정상
7. 종목 클릭 → 차트 모달 → AI 분석 정상
8. Supabase Dashboard에서 ai_usage 테이블 → count 증가 확인

- [ ] **Step 3: rate limit 검증**

같은 종목 분석을 force=1로 21회 반복 (캐시 우회):

```powershell
# 21회 호출 스크립트는 브라우저 콘솔에서:
# for (let i=0;i<21;i++) await fetch('/api/news?force=1', ...)
```

21번째 호출에서 429 응답 + 모달 노출 확인.

- [ ] **Step 4: DAILY_AI_LIMIT 조정**

실측 결과를 보고 `server/.env`의 `DAILY_AI_LIMIT`를 조정 (기본 20, 너무 적거나 많으면 변경).

- [ ] **Step 5: 비용 확인**

OpenAI 대시보드(https://platform.openai.com/usage)에서 dogfooding 한 동안 사용량/금액 확인. 가족·친구 30명 추정 비용과 비교.

- [ ] **Step 6: 커밋 (DAILY_AI_LIMIT 조정한 경우)**

```powershell
git add server/.env.example
git commit -m "chore(server): tune DAILY_AI_LIMIT based on dogfooding"
```

---

### Task 4.2: Email/Password provider 다시 비활성화

- [ ] **Step 1: Supabase Dashboard**

Authentication → Providers → Email → "Enable" OFF.

> Task 1.5의 smoke test가 끝났으므로 운영 단계에선 OAuth만 허용.

**커밋 없음**

---

## Phase 5: 배포 + 초대 (1~2일)

### Task 5.1: 도메인 발급 + DNS

- [ ] **Step 1: 도메인 구매**

가비아·Namecheap 등에서 도메인 구매 (예: `mydashboard.app`). 약 $15/년.

- [ ] **Step 2: DNS 레코드**

도메인 관리 콘솔에서 다음 레코드 추가 (실제 값은 다음 step에서):

```
dashboard.<도메인>   CNAME   cname.vercel-dns.com
api.<도메인>         CNAME   <railway-제공>.railway.app
```

DNS 전파 대기 (수 분~수 시간).

**커밋 없음**

---

### Task 5.2: Railway에 서버 배포

- [ ] **Step 1: GitHub 저장소 push (없으면 생성)**

> 현재 프로젝트는 git 저장소 아님. 멀티유저 배포에 git 필요.

```powershell
cd C:\dev
git init   # 이미 했으면 skip
gh repo create asset-dashboard --private --source=. --remote=origin
git add .
git commit -m "init: multi-user rollout"
git push -u origin main
```

> 또는 GitHub UI로 새 private repo 만들고 remote 추가.

- [ ] **Step 2: Railway에서 서버 배포**

Railway Dashboard → 기존 `asset-dashboard-api` 프로젝트 열기 → "New" → "GitHub Repo" → 방금 push한 repo 선택. Root directory를 `server/`로 지정.

- [ ] **Step 3: 환경변수 설정**

Railway → 프로젝트 → Variables 탭에 추가:

```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://...
SUPABASE_JWT_SECRET=...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ALLOWED_ORIGINS=https://dashboard.<도메인>
DAILY_AI_LIMIT=20
PORT=3001
```

- [ ] **Step 4: Custom domain**

Settings → Networking → "Custom Domain" → `api.<도메인>` 등록 → Railway가 알려주는 CNAME 값을 Task 5.1의 DNS에 반영.

- [ ] **Step 5: 헬스체크**

```powershell
curl https://api.<도메인>/api/health
```

Expected: `{"ok":true,...}`.

**커밋 없음** (배포 설정)

---

### Task 5.3: Vercel에 클라이언트 배포

- [ ] **Step 1: Vercel에 repo 연결**

Vercel Dashboard → 빈 프로젝트 → "Import" → GitHub repo 선택. Root directory `client/`. Framework preset Vite.

- [ ] **Step 2: 환경변수**

Settings → Environment Variables에:

```
VITE_SUPABASE_URL=https://...
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_API_BASE=https://api.<도메인>
```

- [ ] **Step 3: Custom domain**

Settings → Domains → `dashboard.<도메인>` 등록 → DNS 자동 검증.

- [ ] **Step 4: Supabase에 redirect URL 등록**

Supabase Dashboard → Authentication → URL Configuration → "Site URL"에 `https://dashboard.<도메인>` 등록. "Additional Redirect URLs"에도 동일.

- [ ] **Step 5: 프로덕션 로그인 검증**

브라우저 → https://dashboard.<도메인> → Google로 로그인 → 본인 데이터 보임 확인.

**커밋 없음**

---

### Task 5.4: 가족·친구 초대 (점진)

- [ ] **Step 1: 첫 가족 1명 추가**

`scripts/add-allowed-email.js` 작성:

```javascript
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const email = process.argv[2];
if (!email) { console.error("Usage: node add-allowed-email.js <email>"); process.exit(1); }
const { error } = await admin.from("allowed_emails").upsert({ email });
if (error) { console.error(error); process.exit(1); }
console.log(`✓ Added ${email}`);
```

실행:
```powershell
cd C:\dev\scripts
node add-allowed-email.js family@example.com
```

- [ ] **Step 2: 안내 메시지 전송**

> 자산관리 대시보드를 만들었어. 한번 써봐:
> https://dashboard.<도메인>
> Google 또는 카카오로 로그인하면 돼. 데이터는 본인 계정 안에만 저장되고 다른 사람은 못 봐.

- [ ] **Step 3: 사용 피드백 받고 다음 1명 추가**

피드백 → 버그/UX 이슈 → 수정 → 다음 사람.

- [ ] **Step 4: 커밋 (헬퍼 스크립트만)**

```powershell
cd C:\dev
git add scripts/add-allowed-email.js
git commit -m "chore(scripts): allow-list helper"
git push
```

---

## Verification Checklist

구현 완료 후 다음 항목들을 수동 확인:

- [ ] `node --test` (server) — 모든 단위 테스트 통과
- [ ] `node scripts/security-smoke.js` — 8개 보안 체크 통과
- [ ] `client/dist`에 service_role 키 미포함 (grep)
- [ ] dashboard.<도메인>으로 본인 계정 로그인 가능
- [ ] 화이트리스트에 없는 이메일로 로그인 시도 → 거부
- [ ] 본인 계정으로 종목/거래 CRUD 정상
- [ ] AI 뉴스·종목 분석 정상
- [ ] 21회째 AI 호출에서 429
- [ ] PWA "설치" 가능 (Chrome 주소창)
- [ ] 새 가족 1명 화이트리스트 추가 → 로그인 → 본인 데이터만 보임 (다른 가족 데이터 안 보임)

---

## 알려진 위험 / 주의

- **Supabase Free tier 한도**: DB 500MB, MAU 50k. 가족·친구 30명은 여유. 한도 가까워지면 Pro($25/월).
- **Railway Hobby**: 사용량 기반. 월 $5 크레딧 안에서 동작. 트래픽 증가 시 Pro 검토.
- **OpenAI 키 보안**: 노출 시 즉시 https://platform.openai.com/api-keys 에서 회전. .env 절대 커밋 금지.
- **JWT revocation 지연**: 화이트리스트에서 사용자 제거해도 기존 발급된 JWT는 최대 1h까지 유효. 확장 시 `supabase.auth.getUser` 방식으로 전환 검토 (관련 메모리 항목 존재).

---

## Self-Review 결과 (실시간 점검)

**Spec coverage**
- §1 결정 사항 → Phase 0~5 모두 매핑됨
- §2 아키텍처 → Phase 2(서버), Phase 3(클라이언트), Phase 5(배포)
- §3 데이터 모델 → Task 1.1
- §4 보안 RLS → Task 1.2, 1.3, 1.5
- §5 인증 흐름 → Task 3.8~3.11
- §6 서버 변경 → Task 2.1~2.9
- §7 클라이언트 변경 → Task 3.1~3.15
- §8 배포 → Task 5.1~5.3
- §9 테스트 → Task 1.5 (security smoke), Task 2.4~2.6 (단위), Task 4.1 (수동 E2E)
- §10 롤아웃 → Phase 0~5 순서 그대로
- §11 스코프 외 → 메모리(`project_multi_user_security_deferred.md`) + 본 문서 "알려진 위험"에 기록

**Placeholder scan**
- `<도메인>`, `<프로젝트>`, `<프로젝트-ref>`, `<본인-이메일>` 4종은 의도된 사용자 입력 자리 (Phase 0에서 본인이 결정).
- TBD/TODO 없음.

**Type consistency**
- `addHolding`·`removeHolding` 시그니처가 client/lib과 useRemoteState에서 일치
- `analyzeNews(news, holdings, userId)` / `analyzeStock({...}, userId)` 시그니처가 analyze.js와 server.js 호출부에서 일치
- `chargeAiUsage(userId, limit)` 시그니처가 usage.js·analyze.js에서 일치
- `RateLimitError({ used, limit, resetAt })` 시그니처가 server/lib/errors.js와 client/lib/api.js에서 동일 필드

**모호함**
- "캐시 hit는 charge 안 함" → Task 2.8 Step 3에 "cache.get 후 hit면 return, miss일 때만 analyzeNews(userId) 호출" 명시
- "rate limit은 핸들러 안 chargeAiUsage가 throw" → Task 2.7에 `analyzeNews` 진입 시 호출, 미들웨어로 등록하지 않음 명시

---

## 다음

이 plan 실행 방식 선택:
1. **Subagent-Driven** — task별로 fresh subagent 디스패치, 각 task 후 리뷰 (권장)
2. **Inline Execution** — 본 세션에서 batch 실행 + 체크포인트 리뷰
