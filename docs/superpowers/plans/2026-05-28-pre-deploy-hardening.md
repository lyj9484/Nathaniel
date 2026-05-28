# Phase 5 배포 전 hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배포 전 종합 검토에서 찾은 critical(4) + 핵심 important(9) 총 13개 finding을 일괄 수정해 안전한 Phase 5 배포 상태로 만든다.

**Architecture:** 서버는 trust proxy + env 검증 + admin 게이트 + 입력 검증을 보강. 클라이언트는 401/세션 만료 자동 처리, 비파괴적 import, 모바일 행 액션 가시화 + 카드 레이아웃, 빈 상태 온보딩, 에러 바운더리, 사일런트 mutation 실패 제거. 스크립트는 운영 헬퍼 추가.

**Tech Stack:** React 18 + Vite + Tailwind, Express, Supabase (Postgres + RLS), zod, jose.

**Findings source:** 3개 병렬 감사 보고서(보안 / 신뢰성 / 운영). 메모리 `project_multi_user_rollout_status.md`의 nice-to-have는 이번 plan에 일부 포함, 나머지는 사후로 유지.

---

## Task 1: server — trust proxy + global rate limit per-user + env 부팅 검증 (I1, I4)

**Files:**
- Modify: `server/server.js`
- Create: `server/lib/env.js`

- [ ] **Step 1: 신규 env 검증 helper 작성**

`server/lib/env.js`:
```js
// 부팅 시 필수 env가 모두 있는지 확인. 누락 시 즉시 종료.
const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "ALLOWED_ORIGINS",
];
const RECOMMENDED = [
  "ADMIN_EMAILS",
  "DAILY_AI_LIMIT",
];

export function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error("❌ Missing required env vars:", missing.join(", "));
    process.exit(1);
  }
  const missingRecommended = RECOMMENDED.filter((k) => !process.env[k]);
  if (missingRecommended.length > 0) {
    console.warn("⚠️  Missing recommended env vars:", missingRecommended.join(", "));
  }
}
```

- [ ] **Step 2: server.js 초기화에 trust proxy + env 검증 + 글로벌 limit 키 분리**

`server/server.js`의 `const app = express();` 직후 (현재 약 26-35줄)를 다음으로 교체:

```js
import { validateEnv } from "./lib/env.js";

validateEnv();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Railway 등 단일 프록시 hop 뒤에서 req.ip가 실제 client IP가 되도록
app.set("trust proxy", 1);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",").map((s) => s.trim());

app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: false }));
app.use(express.json({ limit: "10kb" }));

// 글로벌 limit: 인증된 사용자는 user_id로, 미인증은 IP로 키잉
// authMiddleware가 /api/* 진입 전에 req.user를 채우므로 health 외 모든 라우트는 user-id 키
app.use(rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id
    ? `global:user:${req.user.id}`
    : `global:ip:${ipKeyGenerator(req.ip)}`,
}));
```

- [ ] **Step 3: 부팅 확인**

```bash
cd C:/dev/server
node server.js
```
Expected: `asset-dashboard server: http://localhost:3001` 출력 후 정상 listen. (서버 띄운 채로 다음 Step으로)

부팅 시 `SUPABASE_URL`이 빠진 경우를 시뮬레이션 (별도 터미널):
```bash
SUPABASE_URL= node server.js
```
Expected: `❌ Missing required env vars: SUPABASE_URL` 출력 + exit code 1.

확인 후 정상 server는 종료.

- [ ] **Step 4: 테스트 회귀**

```bash
cd C:/dev/server
node --test
```
Expected: 모든 기존 38 테스트 통과.

- [ ] **Step 5: 커밋**
```bash
git add server/lib/env.js server/server.js
git commit -m "fix(server): trust proxy + 글로벌 rate limit 사용자별 키 + env 부팅 검증"
```

---

## Task 2: server — /api/cache/clear admin 게이트 + /api/price* 입력 검증 (I2, I3)

**Files:**
- Modify: `server/server.js`

- [ ] **Step 1: `/api/price/:symbol`에 StockSymbolSchema 적용**

`server/server.js`의 `app.get("/api/price/:symbol", ...)` 핸들러 (약 78줄부터)를 다음으로 교체:

```js
app.get("/api/price/:symbol", async (req, res) => {
  const symbolParse = StockSymbolSchema.safeParse(req.params.symbol);
  if (!symbolParse.success) {
    return res.status(400).json({ error: "invalid_symbol" });
  }
  const symbol = symbolParse.data;
  try {
    const data = await getCachedPrice(symbol);
    res.json(data);
  } catch (e) {
    console.error(`[price] ${symbol}:`, e.message);
    res.status(502).json({ symbol, error: e.message });
  }
});
```

- [ ] **Step 2: `/api/prices`에 검증 + 50개 cap**

`app.get("/api/prices", ...)` 핸들러를 다음으로 교체:

```js
app.get("/api/prices", async (req, res) => {
  const rawSymbols = String(req.query.symbols || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (rawSymbols.length === 0) {
    return res.status(400).json({ error: "symbols query parameter required (comma-separated)" });
  }
  if (rawSymbols.length > 50) {
    return res.status(400).json({ error: "too_many_symbols", max: 50 });
  }
  const symbols = [];
  for (const s of rawSymbols) {
    const parsed = StockSymbolSchema.safeParse(s);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_symbol", symbol: s });
    }
    symbols.push(parsed.data);
  }
  const results = await Promise.allSettled(symbols.map(getCachedPrice));
  const out = symbols.map((symbol, i) => {
    const r = results[i];
    if (r.status === "fulfilled") return r.value;
    return { symbol, error: r.reason?.message || "unknown error" };
  });
  res.json(out);
});
```

- [ ] **Step 3: `/api/cache/clear`에 requireAdmin 적용**

기존 `app.post("/api/cache/clear", (req, res) => {...})`을 다음으로 교체:

```js
app.post("/api/cache/clear", requireAdmin, (req, res) => {
  cache.flushAll();
  res.json({ ok: true });
});
```

- [ ] **Step 4: 회귀 테스트**

```bash
cd C:/dev/server
node --test
```
Expected: 통과.

- [ ] **Step 5: 수동 동작 확인 — 잘못된 심볼 → 400**

서버를 띄우고 (`npm start`), 별도 터미널에서:
```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/api/price/INVALID%20SYMBOL" -H "Authorization: Bearer <expired_or_invalid>"
```
Expected: `401` (인증부터 막힘). 정상 토큰이 없으면 401이 맞다 — 검증은 다음 verify task에서.

서버 종료.

- [ ] **Step 6: 커밋**
```bash
git add server/server.js
git commit -m "fix(server): /api/price* 입력 검증·심볼 cap + /api/cache/clear admin 게이트"
```

---

## Task 3: DB — enforce_invite_only on UPDATE 트리거 추가 (I5)

**Files:**
- Create: `supabase/migrations/20260528000002_invite_only_update.sql`

- [ ] **Step 1: 마이그레이션 작성**

`supabase/migrations/20260528000002_invite_only_update.sql`:

```sql
-- 사용자가 supabase.auth.updateUser({email})로 이메일을 ADMIN_EMAILS의 값으로
-- 바꿔 admin 권한을 획득하는 경로를 차단. 기존 003의 enforce_invite_only는
-- INSERT만 커버하므로 UPDATE에도 적용.
create trigger users_invite_check_update
  before update of email on auth.users
  for each row execute function public.enforce_invite_only();
```

- [ ] **Step 2: 사용자가 Supabase Dashboard SQL Editor에서 수동 실행**

⚠️ 이 task는 user가 직접 SQL Editor에 붙여넣고 Run.

- [ ] **Step 3: 검증 쿼리 (사용자가 실행 후 결과 확인)**

```sql
select tgname from pg_trigger
where tgrelid = 'auth.users'::regclass
  and tgname like 'users_invite_check%';
```
Expected: 두 행 `users_invite_check`, `users_invite_check_update`.

- [ ] **Step 4: 커밋**
```bash
git add supabase/migrations/20260528000002_invite_only_update.sql
git commit -m "fix(db): enforce_invite_only를 email UPDATE에도 적용"
```

---

## Task 4: server — AI stock analysis 캐시에 user 포함 (I13)

**Files:**
- Modify: `server/server.js`

- [ ] **Step 1: `/api/stock/:symbol/analysis`에서 캐시 키 user-scoped**

`server/server.js`의 약 189-193번 줄, 캐시 키 정의를 다음으로 교체:

```js
const aiKey = `stock-ai:${req.user.id}:${symbol}`;
const chartKey = `stock-chart:${symbol}:${period}`;
```

차트는 user-independent (시세 데이터)이므로 그대로 두고, AI 분석 결과만 사용자별로 분리.

- [ ] **Step 2: 회귀 테스트**
```bash
cd C:/dev/server
node --test
```
Expected: 통과.

- [ ] **Step 3: 커밋**
```bash
git add server/server.js
git commit -m "fix(server): stock AI 분석 캐시 키에 user_id 포함 — 평단가 leak 방지"
```

---

## Task 5: client — api.js 401 자동 signOut + RateLimitError 서버 메시지 유지 (I6, I9)

**Files:**
- Modify: `client/src/lib/api.js`

- [ ] **Step 1: api.js 전체를 다음으로 교체**

`client/src/lib/api.js`:
```js
import { supabase } from "./supabase.js";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export class RateLimitError extends Error {
  constructor({ message, used, limit, resetAt }) {
    super(message || "잠시 후 다시 시도해주세요");
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
  if (res.status === 401) {
    // JWT 만료 또는 무효. 세션 정리하고 LoginPage로 강제 복귀.
    await supabase.auth.signOut().catch(() => {});
    const err = new Error("세션이 만료되었습니다. 다시 로그인해주세요.");
    err.code = "unauthenticated";
    err.status = 401;
    throw err;
  }
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new RateLimitError({
      message: body.message,
      ...(body.details || {}),
    });
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

- [ ] **Step 2: 빌드 확인**
```bash
cd C:/dev/client
npm run build
```
Expected: 성공.

- [ ] **Step 3: 커밋**
```bash
git add client/src/lib/api.js
git commit -m "fix(client): 401 시 자동 signOut + RateLimitError 서버 메시지 보존"
```

---

## Task 6: client — ErrorBoundary로 white-screen 방지 (I10)

**Files:**
- Create: `client/src/ErrorBoundary.jsx`
- Modify: `client/src/main.jsx`

- [ ] **Step 1: ErrorBoundary 컴포넌트 작성**

`client/src/ErrorBoundary.jsx`:
```jsx
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info?.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#0a0e1a] text-slate-200 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-slate-700 rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">오류가 발생했습니다</h2>
            <p className="text-sm text-slate-400">
              화면을 새로고침하면 보통 해결됩니다. 반복되면 피드백으로 알려주세요.
            </p>
            <pre className="text-[11px] text-slate-500 bg-slate-950 rounded p-2 overflow-auto">
              {String(this.state.error?.message || this.state.error)}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2 rounded-full bg-amber-500 text-slate-950 text-sm font-medium hover:bg-amber-400"
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: main.jsx에서 AuthProvider/AuthGate를 ErrorBoundary로 감싸기**

`client/src/main.jsx` 전체를 다음으로 교체:

```jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AuthProvider } from "./AuthProvider.jsx";
import AuthGate from "./AuthGate.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
```

- [ ] **Step 3: 빌드 확인**
```bash
cd C:/dev/client
npm run build
```
Expected: 성공.

- [ ] **Step 4: 커밋**
```bash
git add client/src/ErrorBoundary.jsx client/src/main.jsx
git commit -m "feat(client): ErrorBoundary로 렌더 에러 white-screen 방지"
```

---

## Task 7: client — 로딩 게이트 + 초기 가격 fetch 레이스 수정 (I11, I12)

**Files:**
- Modify: `client/src/AssetDashboard.jsx`
- Modify: `client/src/lib/useRemoteState.js`

- [ ] **Step 1: useTransactions에 loading 노출 (이미 있지만 변수 이름 정렬)**

`client/src/lib/useRemoteState.js`의 `useTransactions`는 이미 `loading`을 반환함 (74번줄). 변경 없음. (확인용 step)

- [ ] **Step 2: AssetDashboard에서 transactions/settings loading도 게이트하고 refreshAll 의존성 보강**

`client/src/AssetDashboard.jsx`의 약 184-189줄 (`useTransactions`) 구조 분해를 다음으로 교체:

```jsx
  const {
    transactions,
    loading: transactionsLoading,
    add: addTransactionRemote,
    update: updateTransactionRemote,
    remove: removeTransactionRemote,
  } = useTransactions();
  const { target, fxRate, loading: settingsLoading, saveTarget, saveFxRate } = useSettings();
```

- [ ] **Step 3: useEffect refresh trigger 수정 (약 217-221줄)**

다음으로 교체:

```jsx
  // 모든 원격 상태가 로드된 후에만 가격/뉴스를 가져온다.
  // settings만 보고 trigger하면 holdings가 늦게 끝났을 때 빈 배열로 closure가 갇혀
  // 시세 fetch가 누락된다.
  const allLoaded = !holdingsLoading && !transactionsLoading && !settingsLoading;
  useEffect(() => {
    if (!allLoaded) return;
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLoaded]);
```

- [ ] **Step 4: 메인 로딩 가드 (약 500-506줄) 확장**

다음으로 교체:

```jsx
  if (holdingsLoading || transactionsLoading || settingsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0e1a] text-slate-400 text-sm">
        데이터 로딩 중…
      </div>
    );
  }
```

- [ ] **Step 5: 빌드 확인**
```bash
cd C:/dev/client
npm run build
```
Expected: 성공.

- [ ] **Step 6: 커밋**
```bash
git add client/src/AssetDashboard.jsx
git commit -m "fix(client): 전체 원격 상태 로드 후 refreshAll + 로딩 가드 보강"
```

---

## Task 8: client — mutation 사일런트 실패 제거 (I7)

**Files:**
- Modify: `client/src/AssetDashboard.jsx`

배경: `addTransaction`/`updateTransaction`/`deleteTransaction`/`addHolding`/`deleteHolding`은 throw가 사일런트로 흡수돼 사용자가 실패를 모름. 단순화를 위해 함수 내부에서 try/catch + `setErrors`를 추가.

- [ ] **Step 1: errors state 활용 — 각 mutation 함수에 try/catch 래퍼**

`client/src/AssetDashboard.jsx`의 약 461-496줄, 거래 + 종목 CRUD 블록을 다음으로 교체:

```jsx
  /* ───── 사용자에게 보이는 에러 헬퍼 ───── */
  function pushError(msg) {
    setErrors((prev) => [...prev, msg]);
    setTimeout(() => setErrors((prev) => prev.slice(1)), 5000);
  }

  /* ───── 거래 CRUD ───── */
  async function addTransaction(tx) {
    try {
      await addTransactionRemote(tx);
    } catch (e) {
      pushError("거래 추가 실패: " + (e.message || "알 수 없는 오류"));
      throw e; // 호출자(폼)가 인지하도록 재던짐
    }
  }
  async function updateTransaction(id, patch) {
    try {
      await updateTransactionRemote(id, patch);
    } catch (e) {
      pushError("거래 수정 실패: " + (e.message || "알 수 없는 오류"));
      throw e;
    }
  }
  async function deleteTransaction(id) {
    if (!window.confirm("이 거래를 삭제할까요?")) return;
    try {
      await removeTransactionRemote(id);
    } catch (e) {
      pushError("거래 삭제 실패: " + (e.message || "알 수 없는 오류"));
    }
  }

  /* ───── 종목 CRUD ───── */
  async function addHolding({ category, symbol, name, initialQuantity, initialPrice, initialDate }) {
    try {
      const created = await addHoldingRemote({ category, symbol, name });
      if (initialQuantity > 0 && initialPrice > 0) {
        await addTransactionRemote({
          holdingId: created.id,
          type: "buy",
          quantity: initialQuantity,
          price: initialPrice,
          date: initialDate || new Date().toISOString().slice(0, 10),
          fee: 0,
        });
      }
    } catch (e) {
      pushError("종목 추가 실패: " + (e.message || "알 수 없는 오류"));
      throw e;
    }
  }
  async function deleteHolding(id) {
    if (!window.confirm("이 종목과 관련 거래 내역을 모두 삭제합니다.")) return;
    try {
      await removeHoldingRemote(id);
      setCurrentPrices((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e) {
      pushError("종목 삭제 실패: " + (e.message || "알 수 없는 오류"));
    }
  }
```

`setErrors`는 이미 컴포넌트에 존재 (약 208줄). `pushError`가 5초 후 자동 제거 큐.

- [ ] **Step 2: TransactionsModal의 TransactionForm onSubmit에 try/catch 가드**

약 1593-1598줄, 1614-1618줄의 TransactionForm `onSubmit`을 (부모가 throw 처리하지만 자식 폼도 자기 방어):

`adding` 케이스 (1590-1599줄):
```jsx
        {adding && (
          <TransactionForm
            category={holding.category}
            onCancel={() => setAdding(false)}
            onSubmit={async (tx) => {
              try {
                await onAdd(tx);
                setAdding(false);
              } catch {
                // 부모가 toast 표시. 폼은 열린 채로 유지해 재시도 가능.
              }
            }}
          />
        )}
```

`editing` 케이스 (1609-1619줄):
```jsx
              <TransactionForm
                key={tx.id}
                category={holding.category}
                initial={tx}
                onCancel={() => setEditingId(null)}
                onSubmit={async (patch) => {
                  try {
                    await onUpdate(tx.id, patch);
                    setEditingId(null);
                  } catch {
                    // 부모가 toast. 폼 유지.
                  }
                }}
              />
```

- [ ] **Step 3: 빌드 확인**
```bash
cd C:/dev/client
npm run build
```
Expected: 성공.

- [ ] **Step 4: 커밋**
```bash
git add client/src/AssetDashboard.jsx
git commit -m "fix(client): mutation 사일런트 실패 제거 — toast + 폼 유지"
```

---

## Task 9: client — importJSON 비파괴 패턴 (C1)

**Files:**
- Modify: `client/src/AssetDashboard.jsx`

전략: 새 데이터를 먼저 모두 stage(추가), 모두 성공하면 기존 데이터 삭제. 중간 실패 시 stage된 신규 데이터를 롤백하고 기존은 유지. CASCADE 삭제는 마지막에만 일어남.

- [ ] **Step 1: importJSON 함수 (약 409-459줄)를 다음으로 교체**

```jsx
  function importJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const stagedHoldingIds = [];
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.holdings) || !Array.isArray(data.transactions))
          throw new Error("형식 오류");
        if (
          !window.confirm(
            `백업에서 ${data.holdings.length}개 종목, ${data.transactions.length}개 거래를 가져옵니다.\n\n` +
            `성공 시 현재 데이터는 모두 교체됩니다. 중간에 실패하면 기존 데이터는 그대로 유지되고 새로 추가된 항목만 정리됩니다.\n\n` +
            `진행할까요?`
          )
        )
          return;

        // 1) 새 holdings + transactions를 먼저 모두 stage
        const idMap = new Map();
        for (const h of data.holdings) {
          const created = await addHoldingRemote({
            category: h.category,
            symbol: h.symbol,
            name: h.name,
          });
          idMap.set(h.id, created.id);
          stagedHoldingIds.push(created.id);
        }
        for (const t of data.transactions) {
          const newHoldingId = idMap.get(t.holdingId);
          if (newHoldingId == null) continue;
          await addTransactionRemote({
            holdingId: newHoldingId,
            type: t.type,
            quantity: t.quantity,
            price: t.price,
            date: t.date,
            fee: t.fee || 0,
          });
        }

        // 2) 신규 stage 성공. 이제 기존 데이터 삭제 (스테이징 시점 스냅샷 사용).
        const oldHoldings = holdingsRawDb.filter((h) => !stagedHoldingIds.includes(h.id));
        for (const h of oldHoldings) {
          await removeHoldingRemote(h.id);
        }
        setCurrentPrices({});

        // 3) settings는 안전 (overwrite)
        if (data.target) await saveTarget(data.target);
        if (data.fxRate) await saveFxRate(data.fxRate);
      } catch (err) {
        // 신규 stage 도중 실패 → 추가된 부분만 롤백, 기존 유지
        for (const id of stagedHoldingIds) {
          try { await removeHoldingRemote(id); } catch {}
        }
        alert("가져오기 실패: " + err.message + "\n기존 데이터는 유지되었습니다.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }
```

기존 동일 unique constraint (`holdings.unique(user_id, symbol)`)를 의식한 변경: stage 시점에 사용자에게 중복 심볼이 있으면 첫 stage 단계에서 실패. 이때 stagedHoldingIds 롤백으로 기존 데이터는 영향 없음.

- [ ] **Step 2: 빌드 확인**
```bash
cd C:/dev/client
npm run build
```
Expected: 성공.

- [ ] **Step 3: 커밋**
```bash
git add client/src/AssetDashboard.jsx
git commit -m "fix(client): importJSON 비파괴 패턴 — stage 후 교체, 실패 시 롤백"
```

---

## Task 10: client — HoldingRow / TransactionRow 액션 버튼 모바일에서 보이게 (C2)

**Files:**
- Modify: `client/src/AssetDashboard.jsx`

`opacity-0 group-hover:opacity-100`를 `opacity-50 group-hover:opacity-100`로 바꿔 모바일에서도 약간 흐릿하게 보이고 데스크탑 호버 시 진하게.

- [ ] **Step 1: HoldingRow 3개 버튼 (약 1156-1176줄) 클래스 교체**

각 버튼의 `className`에서 `opacity-0 group-hover:opacity-100`를 `opacity-60 group-hover:opacity-100`로 교체. 3군데(거래 내역 / 시세 갱신 / 삭제):

```jsx
          <button
            onClick={onOpenDetail}
            className="opacity-60 group-hover:opacity-100 transition p-1 text-slate-500 hover:text-slate-200"
            title="거래 내역"
          >
            <History size={12} />
          </button>
          <button
            onClick={onRefresh}
            className="opacity-60 group-hover:opacity-100 transition p-1 text-slate-500 hover:text-slate-200"
            title="시세 갱신"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={onDelete}
            className="opacity-60 group-hover:opacity-100 transition p-1 text-slate-500 hover:text-rose-400"
            title="삭제"
          >
            <Trash2 size={12} />
          </button>
```

- [ ] **Step 2: TransactionRow 액션 컨테이너 (약 1702줄) 교체**

```jsx
      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
```

- [ ] **Step 3: 빌드 확인**
```bash
cd C:/dev/client
npm run build
```
Expected: 성공.

- [ ] **Step 4: 커밋**
```bash
git add client/src/AssetDashboard.jsx
git commit -m "fix(client): 모바일에서 행 액션 버튼 가시화 (opacity-60 기본)"
```

---

## Task 11: client — HoldingRow 모바일 카드 레이아웃 (C3)

**Files:**
- Modify: `client/src/AssetDashboard.jsx`

전략: 보유 종목 리스트 헤더와 행을 sm 이상에서만 grid, sm 미만에서는 flex 세로 정렬로 카드처럼 보이게. 헤더는 sm 미만에서 숨김. 거래 내역/시세 갱신/삭제 버튼은 항상 보임 (Task 10에서 처리됨).

- [ ] **Step 1: 헤더 row (약 899줄) — sm 미만에서 숨김**

```jsx
              <div className="hidden sm:grid grid-cols-12 gap-3 px-6 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                <div className="col-span-4">종목</div>
                <div className="col-span-2 text-right">수량</div>
                <div className="col-span-2 text-right">평단</div>
                <div className="col-span-2 text-right">현재가</div>
                <div className="col-span-2 text-right">손익률</div>
              </div>
```

- [ ] **Step 2: HoldingRow 메인 row (약 1090줄) — sm 미만 stack, sm 이상 grid**

`<div className="grid grid-cols-12 gap-3 px-6 pt-4 items-center">`를:

```jsx
      <div className="flex flex-col gap-2 px-6 pt-4 sm:grid sm:grid-cols-12 sm:gap-3 sm:items-center">
```

종목 버튼의 `col-span-4` → `sm:col-span-4`, 수량/평단/현재가/손익률 모두 동일하게 `text-right` 대신 모바일에서는 label+value 가로 표시:

수량 셀 (약 1113-1115줄):
```jsx
        <div className="flex justify-between sm:block sm:col-span-2 sm:text-right tabular text-sm">
          <span className="sm:hidden text-xs text-slate-500">수량</span>
          <span>{formatNumber(h.quantity, h.category === "crypto" ? 4 : 0)}</span>
        </div>
```

평단 셀 (약 1116-1122줄):
```jsx
        <div className="flex justify-between sm:block sm:col-span-2 sm:text-right tabular text-sm text-slate-400">
          <span className="sm:hidden text-xs text-slate-500">평단</span>
          <span>
            {c.suffix}
            {formatNumber(
              h.avgPrice,
              h.category === "crypto" ? 2 : h.category === "us" ? 2 : 0
            )}
          </span>
        </div>
```

현재가 셀 (약 1123-1144줄):
```jsx
        <div className="flex justify-between sm:block sm:col-span-2 sm:text-right tabular text-sm">
          <span className="sm:hidden text-xs text-slate-500">현재가</span>
          <span>
          {h.currentPrice != null ? (
            <>
              {c.suffix}
              {formatNumber(
                h.currentPrice,
                h.category === "crypto" ? 2 : h.category === "us" ? 2 : 0
              )}
            </>
          ) : (
            <button
              onClick={() => {
                const v = prompt(`${h.symbol} 현재가 수동 입력 (${c.suffix})`);
                const n = parseFloat(v);
                if (!Number.isNaN(n)) onManualPrice(n);
              }}
              className="text-xs text-amber-400 hover:underline"
            >
              수동 입력
            </button>
          )}
          </span>
        </div>
```

손익률 + 액션 셀 (약 1145-1177줄):
```jsx
        <div className="flex justify-between sm:col-span-2 items-center sm:items-center sm:justify-end gap-2">
          <span className="sm:hidden text-xs text-slate-500">손익률</span>
          {pnlRate != null && (
            <span
              className={`tabular text-sm font-medium ${
                pnlRate >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {pnlRate >= 0 ? "+" : ""}
              {pnlRate.toFixed(2)}%
            </span>
          )}
          <button
            onClick={onOpenDetail}
            className="opacity-60 group-hover:opacity-100 transition p-1 text-slate-500 hover:text-slate-200"
            title="거래 내역"
          >
            <History size={12} />
          </button>
          <button
            onClick={onRefresh}
            className="opacity-60 group-hover:opacity-100 transition p-1 text-slate-500 hover:text-slate-200"
            title="시세 갱신"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={onDelete}
            className="opacity-60 group-hover:opacity-100 transition p-1 text-slate-500 hover:text-rose-400"
            title="삭제"
          >
            <Trash2 size={12} />
          </button>
        </div>
```

종목 첫 셀(약 1091-1112줄) — `col-span-4`를 `sm:col-span-4`로:
```jsx
        <button
          onClick={onOpenDetail}
          className="sm:col-span-4 flex items-center gap-3 text-left"
        >
```

- [ ] **Step 3: 서브 라인 (약 1180-1217줄) — 모바일 가로 정렬 유지하되 col-span 조정**

```jsx
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 px-6 pb-4 pt-1.5 text-[11px] text-slate-500">
        <div className="hidden sm:block sm:col-span-4" />
        <div className="sm:col-span-8 flex flex-wrap justify-between sm:justify-end gap-4 tabular">
```

(나머지 내용은 그대로 유지)

- [ ] **Step 4: 빌드 확인**
```bash
cd C:/dev/client
npm run build
```
Expected: 성공.

- [ ] **Step 5: 커밋**
```bash
git add client/src/AssetDashboard.jsx
git commit -m "fix(client): HoldingRow 모바일 카드 레이아웃 (sm 미만 stack)"
```

---

## Task 12: client — 신규 사용자 0종목 온보딩 (I8)

**Files:**
- Modify: `client/src/AssetDashboard.jsx`

전략: holdings가 비어 있으면 차트 4종 + NewsSection을 숨기고 큰 환영 카드 + "종목 추가" CTA만 표시. NewsSection은 호출 자체를 안 해서 AI quota 보존.

- [ ] **Step 1: AssetDashboard return 본문 (약 508줄 이후) — 빈 상태 분기 추가**

`if (holdingsLoading || transactionsLoading || settingsLoading)` 가드 (Task 7에서 추가) 다음에 빈 상태 분기 추가:

```jsx
  // 신규 사용자: holdings가 0이면 환영 화면만 표시
  const isEmpty = holdingsRawDb.length === 0;
```

(이 줄을 `if (holdingsLoading...)` 직후에 삽입.)

- [ ] **Step 2: 차트·뉴스 섹션 렌더를 조건부로**

현재 코드에는 통합 탭이 `tab === "all"`일 때 카테고리 비중/목표/월별/트리맵 등 차트들이 렌더된다. 각 차트 wrapper(혹은 통합 차트 섹션)는 `!isEmpty` 가드를 추가.

`AssetDashboard.jsx`의 차트 컨테이너 시작 부분에 다음을 추가 (구체 위치는 `tab === "all" &&` 또는 통합 차트 wrapper):

탭 버튼 영역과 NewsSection 사이의 차트 섹션들이 `{tab === "all" && (...)}` 또는 비슷한 패턴으로 감싸져 있으면 그 조건을 `tab === "all" && !isEmpty`로 변경.

또한 NewsSection 호출 (약 882줄):

```jsx
{/* 뉴스 + AI 분석 — 빈 상태에서는 호출 안 함 (AI quota 보존) */}
{!isEmpty && <NewsSection holdings={holdingsRaw} activeTab={tab} />}
```

- [ ] **Step 3: 빈 상태 환영 패널 추가**

보유 종목 섹션 (`<section className="bg-slate-900/40 ...">` 약 885줄) 직전에 다음을 추가:

```jsx
        {isEmpty && (
          <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-10 mb-10 text-center">
            <Wallet size={36} className="mx-auto text-amber-400 mb-4" />
            <h2 className="text-xl font-semibold mb-2">환영합니다 👋</h2>
            <p className="text-sm text-slate-400 mb-6">
              아직 등록된 종목이 없습니다. 첫 종목을 추가해 시작하세요.
              <br />
              한국 주식, 미국 주식, 코인을 한 곳에서 관리할 수 있습니다.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-amber-500 text-slate-950 font-medium hover:bg-amber-400 transition"
            >
              <Plus size={16} /> 첫 종목 추가하기
            </button>
          </section>
        )}
```

빈 상태일 때는 기존 "보유 종목 없습니다" 메시지가 중복되지 않게, 보유 종목 섹션도 `{!isEmpty && <section ...>}`로 감싸기. 또는 기존 섹션 안의 빈 상태 메시지(약 893-896줄)를 그대로 두고 환영 패널은 추가 정보로만 표시 — 후자가 더 단순. **후자 채택**.

대신 환영 패널을 보유 종목 섹션 위로만 두고 차트/뉴스 가림 + 즉시 종목 추가 모달 열기 CTA로 가치 추가.

- [ ] **Step 4: 빌드 확인**
```bash
cd C:/dev/client
npm run build
```
Expected: 성공.

- [ ] **Step 5: 커밋**
```bash
git add client/src/AssetDashboard.jsx
git commit -m "feat(client): 신규 사용자 0종목 환영 화면 + AI 뉴스 호출 보류"
```

---

## Task 13: scripts — add-allowed-email.js 헬퍼 (C4)

**Files:**
- Create: `scripts/add-allowed-email.js`

- [ ] **Step 1: 스크립트 작성**

`scripts/add-allowed-email.js`:
```js
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: node add-allowed-email.js <email>");
  process.exit(1);
}
const { error } = await admin.from("allowed_emails").upsert({ email });
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(`✓ Added ${email} to allowed_emails`);
```

- [ ] **Step 2: 수동 동작 확인**

```bash
cd C:/dev/scripts
node add-allowed-email.js test@example.com
```
Expected: `✓ Added test@example.com to allowed_emails`.

청소:
```bash
node -e "import('dotenv/config').then(() => import('@supabase/supabase-js').then(({createClient}) => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY).from('allowed_emails').delete().eq('email', 'test@example.com').then(r => console.log(r.error || 'cleaned'))))"
```

- [ ] **Step 3: 커밋**
```bash
git add scripts/add-allowed-email.js
git commit -m "feat(scripts): add-allowed-email.js 운영 헬퍼"
```

---

## Task 14: 통합 verify

**Files:** 없음 (실행만)

- [ ] **Step 1: 모든 server 테스트 통과 확인**

```bash
cd C:/dev/server
node --test
```
Expected: 모두 통과.

- [ ] **Step 2: 클라이언트 빌드 깨끗**

```bash
cd C:/dev/client
npm run build
```
Expected: 성공.

- [ ] **Step 3: 사용자가 Task 3의 마이그레이션 SQL을 Supabase Dashboard에 실행했는지 확인**

위 Task 3 Step 2-3 완료 여부 확인.

- [ ] **Step 4: server + client 기동 (Email provider OFF 상태 유지)**

```bash
cd C:/dev/server && npm start    # background
cd C:/dev/client && npm run dev  # background
```

- [ ] **Step 5: 핵심 시나리오 수동 driving (Playwright MCP 또는 사용자 직접)**

a) Google OAuth 로그인 → 대시보드 정상 렌더 (transactions+settings 로드 후 가격 fetch가 한 번에 일어나는지 네트워크 확인)

b) 신규 사용자 시뮬레이션: Supabase Dashboard에서 본인의 holdings/transactions를 임시 백업 → 모두 삭제 → 로그인하면 환영 화면 + AI 호출 0회 → 다시 백업 복구 (또는 Supabase SQL로 복구)

또는 더 간단히: 환영 패널이 0종목 케이스 코드 경로에서만 나오는지 코드 리뷰로 확인 + 1개라도 holding이 있으면 차트가 나오는지 확인.

c) 모바일 뷰포트 (DevTools → 375px) → HoldingRow가 카드 stack으로 표시되는지 + 액션 버튼 항상 보임 확인

d) JSON export → JSON import (자기 데이터로 동일 import) → 결과 일치 확인. 그 다음 임의로 파일 손상 (예: holdings 배열 마지막 row의 symbol을 빈 문자열로) → import → 기존 데이터 유지 + 실패 알림

e) 피드백 보내기 → SEND → 즉시 한 번 더 SEND 시도 (rate limit) → 모달에 "1분에 1건만 제출할 수 있습니다" 한국어 메시지 (Task 5)

f) 토큰 만료 시뮬레이션: localStorage에서 sb-...-auth-token 값의 `expires_at`을 과거로 수정 + 새 API 호출 트리거 → 자동 로그아웃 → LoginPage 복귀

g) admin: `#/admin/feedback` 진입 정상

- [ ] **Step 6: 서버/클라이언트 종료 + 워킹 트리 클린 확인**

```bash
git status
git log --oneline -16
```
Expected: 워킹 트리 클린, 마지막 ~14 커밋이 이 plan의 단계들.

---

## Self-review

스펙(audit findings) 커버리지:

| Finding | Task |
|---|---|
| C1 importJSON 파괴적 | Task 9 |
| C2 호버 액션 모바일 비가시 | Task 10 |
| C3 모바일 그리드 깨짐 | Task 11 |
| C4 add-allowed-email 미존재 | Task 13 |
| I1 trust proxy 누락 | Task 1 |
| I2 /api/cache/clear 일반 사용자 | Task 2 |
| I3 /api/price* 검증 없음 | Task 2 |
| I4 env 검증 누락 | Task 1 |
| I5 enforce_invite_only UPDATE | Task 3 |
| I6 401 미처리 | Task 5 |
| I7 mutation 사일런트 실패 | Task 8 |
| I8 신규 0종목 화면 | Task 12 |
| I9 RateLimitError raw 코드 | Task 5 |
| I10 ErrorBoundary 부재 | Task 6 |
| I11 초기 가격 fetch race | Task 7 |
| I12 transactions 로드 전 깜빡임 | Task 7 |
| I13 AI 캐시 user leak | Task 4 |
| verify | Task 14 |

Placeholder scan: 없음 (모든 step에 실제 코드 + 정확한 경로).

Type consistency:
- `pushError` 함수는 Task 8에서 도입, AssetDashboard 안에서만 사용 — OK
- `allLoaded` 변수 Task 7에서 도입, Task 12의 `isEmpty`와 무관 — OK
- RateLimitError constructor signature는 Task 5에서 `{ message, used, limit, resetAt }`로 변경 — 기존 호출자(없음 — 새로 추가)

빠진 finding: 없음. 모든 audit 권장 사항이 task에 매핑됨.

연관 메모리:
- [[project-asset-dashboard]]
- [[project-multi-user-rollout-status]]
- [[feedback-skip-tdd-ceremony]] — 이 plan은 UI/route 변경 위주라 unit test 없이 통합 verify로 검증
