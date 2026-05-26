# News + AI Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대시보드 마운트 시 국장/미장/코인 3개 시장 뉴스를 가져오고 보유 종목 영향을 Claude로 분석해 통합 탭 차트 아래에 카드로 표시한다.

**Architecture:** Single endpoint `POST /api/news` → 서버가 Google News RSS 3개를 병렬 fetch → 보유 종목 컨텍스트 포함해 Claude Haiku 4.5 1회 호출 → 1시간 메모리 캐시. 응답은 시장별 `{summary, headlines, impacts[]}` 구조. 프론트는 `NewsSection` 컴포넌트로 3카드(또는 활성 탭 따라 1카드) 렌더.

**Tech Stack:**
- Backend: Node 18+, Express, `rss-parser`, `@anthropic-ai/sdk`, `node-cache`
- Frontend: React 18, Vite, Tailwind v4, `lucide-react`
- Test: Node 내장 `node --test` (zero-dependency)

**Spec:** `docs/superpowers/specs/2026-05-25-news-ai-analysis-design.md`

---

## File Structure

**Backend** (`C:\dev\server\`):
- **Create** `news.js` — Google News RSS 페처 (시장별 URL 매핑 + 헤드라인 추출)
- **Create** `analyze.js` — 캐시 키 생성, 프롬프트 구성, Claude 호출, JSON 파싱
- **Create** `news.test.js` — `news.js`의 순수함수 검증
- **Create** `analyze.test.js` — `analyze.js`의 순수함수 검증
- **Modify** `server.js` — `POST /api/news` 라우트 추가, `node-cache` 인스턴스 재사용
- **Modify** `package.json` — 의존성 + `test` 스크립트
- **Modify** `.env.example` — `ANTHROPIC_API_KEY` 추가

**Frontend** (`C:\dev\client\`):
- **Create** `src/NewsSection.jsx` — 뉴스/분석 섹션 전체
- **Modify** `src/AssetDashboard.jsx` — `NewsSection` import + 통합 탭에 렌더

---

## Task 1: 백엔드 의존성 추가

**Files:**
- Modify: `C:\dev\server\package.json`

- [ ] **Step 1: package.json 수정**

`dependencies`에 두 줄 추가 (알파벳 순서 유지):

```json
{
  "name": "asset-dashboard-server",
  "version": "1.0.0",
  "description": "자산관리 대시보드 백엔드 (Yahoo Finance + KIS Developers)",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "node --test"
  },
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "node-cache": "^5.1.2",
    "rss-parser": "^3.13.0"
  }
}
```

- [ ] **Step 2: 의존성 설치**

```powershell
cd C:\dev\server; npm install
```

Expected: `added N packages, audited M packages`, 에러 없음.

---

## Task 2: 환경변수 템플릿 업데이트

**Files:**
- Modify: `C:\dev\server\.env.example`

- [ ] **Step 1: .env.example 수정**

기존 내용 끝에 `ANTHROPIC_API_KEY` 라인 추가:

```
# 포트 (선택)
PORT=3001

# KIS Developers API (선택)
# 미설정 시 한국 주식도 Yahoo Finance로 폴백 (15분 지연)
# 발급: https://apiportal.koreainvestment.com
KIS_APP_KEY=
KIS_APP_SECRET=

# 모의투자로 테스트하려면 아래 URL로 변경
# KIS_BASE=https://openapivts.koreainvestment.com:29443

# Anthropic Claude API (뉴스 AI 분석)
# 미설정 시 뉴스 섹션이 "ai_disabled" 안내 표시
# 발급: https://console.anthropic.com
ANTHROPIC_API_KEY=
```

---

## Task 3: `news.js` — RSS URL 빌더 테스트 (실패 케이스)

**Files:**
- Create: `C:\dev\server\news.test.js`

- [ ] **Step 1: 테스트 작성**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRssUrl, MARKETS } from "./news.js";

test("buildRssUrl: kr 시장은 한국어 URL", () => {
  const url = buildRssUrl("kr");
  assert.match(url, /news\.google\.com\/rss\/search/);
  assert.match(url, /hl=ko/);
  assert.match(url, /ceid=KR%3Ako|ceid=KR:ko/);
});

test("buildRssUrl: us 시장은 영문 URL", () => {
  const url = buildRssUrl("us");
  assert.match(url, /hl=en-US/);
});

test("buildRssUrl: crypto 시장은 한국어 + crypto 키워드", () => {
  const url = buildRssUrl("crypto");
  assert.match(url, /hl=ko/);
  assert.match(url, /%EB%B9%84%ED%8A%B8%EC%BD%94%EC%9D%B8|비트코인/);
});

test("buildRssUrl: 알 수 없는 시장은 throw", () => {
  assert.throws(() => buildRssUrl("xx"), /unknown market/i);
});

test("MARKETS: 3개 시장 모두 정의", () => {
  assert.deepEqual(Object.keys(MARKETS).sort(), ["crypto", "kr", "us"]);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```powershell
cd C:\dev\server; npm test
```

Expected: `news.js` 모듈을 찾지 못해 모두 실패.

---

## Task 4: `news.js` — 최소 구현

**Files:**
- Create: `C:\dev\server\news.js`

- [ ] **Step 1: 구현**

```js
/* Google News RSS 페처 */
import Parser from "rss-parser";

export const MARKETS = {
  kr: {
    label: "국장",
    query: "코스피 OR 코스닥 OR 한국 증시",
    hl: "ko",
    gl: "KR",
    ceid: "KR:ko",
  },
  us: {
    label: "미장",
    query: "US stock market OR S&P 500 OR Nasdaq",
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  },
  crypto: {
    label: "코인",
    query: "비트코인 OR 이더리움 OR 암호화폐",
    hl: "ko",
    gl: "KR",
    ceid: "KR:ko",
  },
};

export function buildRssUrl(market) {
  const m = MARKETS[market];
  if (!m) throw new Error(`unknown market: ${market}`);
  const params = new URLSearchParams({
    q: m.query,
    hl: m.hl,
    gl: m.gl,
    ceid: m.ceid,
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

const parser = new Parser({ timeout: 8000 });

export async function fetchMarketNews(market, limit = 5) {
  const url = buildRssUrl(market);
  const feed = await parser.parseURL(url);
  return (feed.items || []).slice(0, limit).map((item) => ({
    title: item.title,
    link: item.link,
    source: item.source?._ || item.creator || extractSource(item.title),
    pubDate: item.pubDate,
  }));
}

export async function fetchAllMarketsNews(limit = 5) {
  const entries = Object.keys(MARKETS);
  const results = await Promise.allSettled(
    entries.map((m) => fetchMarketNews(m, limit))
  );
  const out = {};
  entries.forEach((m, i) => {
    const r = results[i];
    out[m] = r.status === "fulfilled" ? r.value : [];
    if (r.status === "rejected") {
      console.warn(`[news] ${m} RSS failed:`, r.reason?.message);
    }
  });
  return out;
}

// Google News 제목 끝 " - 출처명" 형태에서 출처 추출
function extractSource(title) {
  const m = title?.match(/ - ([^-]+)$/);
  return m ? m[1].trim() : null;
}
```

- [ ] **Step 2: 테스트 실행 — 통과 확인**

```powershell
cd C:\dev\server; npm test
```

Expected: 5 tests passing.

---

## Task 5: `analyze.js` — 캐시 키 & 프롬프트 빌더 테스트

**Files:**
- Create: `C:\dev\server\analyze.test.js`

- [ ] **Step 1: 테스트 작성**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCacheKey, buildUserMessage } from "./analyze.js";

test("makeCacheKey: 정렬 무관하게 같은 보유 종목이면 동일 키", () => {
  const a = makeCacheKey([
    { symbol: "AAPL" },
    { symbol: "005930.KS" },
  ]);
  const b = makeCacheKey([
    { symbol: "005930.KS" },
    { symbol: "AAPL" },
  ]);
  assert.equal(a, b);
});

test("makeCacheKey: 종목이 다르면 다른 키", () => {
  const a = makeCacheKey([{ symbol: "AAPL" }]);
  const b = makeCacheKey([{ symbol: "NVDA" }]);
  assert.notEqual(a, b);
});

test("makeCacheKey: 빈 배열도 키 생성", () => {
  const k = makeCacheKey([]);
  assert.match(k, /^news:/);
});

test("buildUserMessage: 시장별 헤드라인 포함", () => {
  const news = {
    kr: [{ title: "코스피 상승", source: "한국경제", pubDate: "2026-05-25" }],
    us: [{ title: "Nasdaq hits new high", source: "Reuters", pubDate: "2026-05-25" }],
    crypto: [{ title: "BTC 신고가", source: "Coindesk", pubDate: "2026-05-25" }],
  };
  const holdings = [
    { symbol: "005930.KS", name: "삼성전자", category: "kr" },
  ];
  const msg = buildUserMessage(news, holdings);
  assert.match(msg, /코스피 상승/);
  assert.match(msg, /Nasdaq hits new high/);
  assert.match(msg, /BTC 신고가/);
  assert.match(msg, /삼성전자/);
  assert.match(msg, /005930\.KS/);
});

test("buildUserMessage: 보유 종목 비어도 정상 생성", () => {
  const news = { kr: [], us: [], crypto: [] };
  const msg = buildUserMessage(news, []);
  assert.ok(msg.length > 0);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```powershell
cd C:\dev\server; npm test
```

Expected: `analyze.js`를 찾지 못해 실패.

---

## Task 6: `analyze.js` — 캐시 키 & 프롬프트 빌더 구현

**Files:**
- Create: `C:\dev\server\analyze.js`

- [ ] **Step 1: 부분 구현 (캐시 키 + 프롬프트 빌더만)**

```js
/* Claude API 호출 + 프롬프트 구성 + 캐시 키 */
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 2048;

const MARKET_LABELS = { kr: "국장 (한국)", us: "미장 (미국)", crypto: "코인" };

const SYSTEM_PROMPT = `당신은 개인 투자자를 위한 시장 분석 어시스턴트입니다.
사용자가 제공하는 시장별 뉴스 헤드라인과 보유 종목 정보를 바탕으로,
시장 동향 요약과 보유 종목별 영향을 분석합니다.

응답은 반드시 아래 형식의 JSON으로만 출력하세요. 다른 텍스트는 절대 포함하지 마세요.

{
  "markets": {
    "kr": {
      "summary": "국장 동향 2~3문장 요약",
      "impacts": [
        { "symbol": "005930.KS", "name": "삼성전자", "direction": "positive", "comment": "한 줄 영향 분석" }
      ]
    },
    "us": { "summary": "...", "impacts": [...] },
    "crypto": { "summary": "...", "impacts": [...] }
  }
}

규칙:
- direction은 "positive", "negative", "neutral" 셋 중 하나.
- impacts에는 그 시장(category)에 보유한 종목만 포함. 보유 종목 없으면 빈 배열.
- summary는 헤드라인을 인용하지 말고 종합 해석으로 작성.
- comment는 한 문장, 50자 내외, 헤드라인과 보유 종목을 연결.
- 시장에 헤드라인이 비어 있으면 summary에 "관련 뉴스 없음"이라 적고 impacts는 빈 배열.
- 한국어로 답변.`;

export function makeCacheKey(holdings) {
  const symbols = holdings.map((h) => h.symbol).sort().join(",");
  const hash = createHash("sha1").update(symbols).digest("hex").slice(0, 8);
  return `news:${hash}`;
}

export function buildUserMessage(news, holdings) {
  const parts = [];
  for (const market of ["kr", "us", "crypto"]) {
    parts.push(`### ${MARKET_LABELS[market]} 최근 뉴스`);
    const items = news[market] || [];
    if (items.length === 0) {
      parts.push("(없음)");
    } else {
      items.forEach((it, idx) => {
        parts.push(
          `${idx + 1}. ${it.title}${it.source ? ` — ${it.source}` : ""}${it.pubDate ? ` (${it.pubDate})` : ""}`
        );
      });
    }
    parts.push("");
  }
  parts.push("### 사용자의 보유 종목");
  if (holdings.length === 0) {
    parts.push("(없음)");
  } else {
    holdings.forEach((h) => {
      parts.push(`- ${h.name} (${h.symbol}, ${h.category})`);
    });
  }
  parts.push("");
  parts.push("위 정보를 바탕으로 JSON 응답을 생성하세요.");
  return parts.join("\n");
}

export function isAiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// 다음 단계에서 추가될 함수의 시그니처 선언만 (export 자리만 잡음)
export async function analyzeNews(news, holdings) {
  throw new Error("analyzeNews not yet implemented");
}
```

- [ ] **Step 2: 테스트 실행 — 통과 확인**

```powershell
cd C:\dev\server; npm test
```

Expected: 10 tests passing (news 5개 + analyze 5개).

---

## Task 7: `analyze.js` — Claude 호출 함수 구현

**Files:**
- Modify: `C:\dev\server\analyze.js`

- [ ] **Step 1: `analyzeNews` 본체 구현**

`analyze.js` 파일 맨 아래의 placeholder `analyzeNews` 함수를 아래로 교체:

```js
let anthropicClient = null;
function getClient() {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      const err = new Error("ai_disabled");
      err.code = "ai_disabled";
      throw err;
    }
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return anthropicClient;
}

function parseJsonResponse(text) {
  // ```json ... ``` 코드블록 제거 시도
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  return JSON.parse(body.trim());
}

export async function analyzeNews(news, holdings) {
  const client = getClient();
  const userMessage = buildUserMessage(news, holdings);

  async function callOnce() {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseJsonResponse(text);
  }

  // 1회 재시도 (JSON 파싱 실패 또는 5xx)
  try {
    return await callOnce();
  } catch (e) {
    console.warn("[analyze] first attempt failed, retrying:", e.message);
    return await callOnce();
  }
}
```

- [ ] **Step 2: 테스트 재실행 (변경 없는지)**

```powershell
cd C:\dev\server; npm test
```

Expected: 10 tests still passing (analyzeNews는 외부 호출이라 단위 테스트 안 함).

---

## Task 8: `server.js` — /api/news 라우트 추가

**Files:**
- Modify: `C:\dev\server\server.js`

- [ ] **Step 1: import 추가**

`server.js` 상단의 import 블록 끝에 두 줄 추가:

```js
import { fetchAllMarketsNews } from "./news.js";
import { analyzeNews, makeCacheKey, isAiConfigured } from "./analyze.js";
```

- [ ] **Step 2: /api/news 라우트 추가**

`app.post("/api/cache/clear", ...)` 라인 **위에** 다음 라우트 블록 삽입:

```js
app.post("/api/news", async (req, res) => {
  const holdings = Array.isArray(req.body?.holdings) ? req.body.holdings : [];
  const force = req.query.force === "1";

  if (!isAiConfigured()) {
    return res.status(503).json({ error: "ai_disabled" });
  }

  const key = makeCacheKey(holdings);
  if (!force) {
    const cached = cache.get(key);
    if (cached) return res.json(cached);
  }

  try {
    const news = await fetchAllMarketsNews(5);
    const analysis = await analyzeNews(news, holdings);

    // 응답: 시장별 summary + impacts (Claude) + headlines (RSS)
    const markets = {};
    for (const m of ["kr", "us", "crypto"]) {
      markets[m] = {
        summary: analysis.markets?.[m]?.summary || "",
        impacts: analysis.markets?.[m]?.impacts || [],
        headlines: news[m] || [],
      };
    }
    const payload = {
      fetchedAt: new Date().toISOString(),
      markets,
    };
    // 뉴스는 1시간 TTL (기본 stdTTL=300은 시세용)
    cache.set(key, payload, 3600);
    res.json(payload);
  } catch (e) {
    console.error("[news]", e);
    if (e.code === "ai_disabled") {
      return res.status(503).json({ error: "ai_disabled" });
    }
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 3: /api/health 응답에 ai 상태 추가**

기존 `/api/health` 라우트를 다음으로 교체:

```js
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    kis: isKisConfigured(),
    ai: isAiConfigured(),
    cacheKeys: cache.keys().length,
    uptime: process.uptime(),
  });
});
```

- [ ] **Step 4: 서버 재시작 후 헬스체크**

서버가 백그라운드로 떠 있다면 종료 후 재시작 필요. 새 셸에서:

```powershell
cd C:\dev\server; npm start
```

다른 셸에서:

```powershell
curl http://localhost:3001/api/health
```

Expected: `{"ok":true,"kis":false,"ai":false,"cacheKeys":0,"uptime":...}` (ai_key 미설정 가정).

- [ ] **Step 5: ai_disabled 경로 검증**

PowerShell에서 JSON body는 `Invoke-RestMethod` 사용이 가장 안전:

```powershell
try {
  Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/news `
    -ContentType "application/json" -Body '{"holdings":[]}'
} catch {
  $_.Exception.Response.StatusCode
  $_.ErrorDetails.Message
}
```

Expected: `ServiceUnavailable` (503), body `{"error":"ai_disabled"}`.

---

## Task 9: 프론트엔드 — `NewsSection.jsx` 컴포넌트

**Files:**
- Create: `C:\dev\client\src\NewsSection.jsx`

- [ ] **Step 1: 컴포넌트 작성**

```jsx
import { useEffect, useState } from "react";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  ExternalLink,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

const MARKET_META = {
  kr: { label: "국장", color: "#60a5fa" },
  us: { label: "미장", color: "#f472b6" },
  crypto: { label: "코인", color: "#fbbf24" },
};

export default function NewsSection({ holdings, activeTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}/api/news${force ? "?force=1" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdings: holdings.map((h) => ({
            symbol: h.symbol,
            name: h.name,
            category: h.category,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(body);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleMarkets =
    activeTab === "all" ? ["kr", "us", "crypto"] : [activeTab];

  return (
    <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm text-slate-300">최근 시장 뉴스 & 영향</h3>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {data?.fetchedAt && (
            <span>
              업데이트 {new Date(data.fetchedAt).toLocaleTimeString("ko-KR")}
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-50 transition"
            title="강제 새로고침"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {error === "ai_disabled" && (
        <div className="text-xs text-amber-400 flex items-center gap-2">
          <AlertCircle size={14} />
          AI 분석이 비활성 상태입니다. <code>server/.env</code> 에{" "}
          <code>ANTHROPIC_API_KEY</code> 를 설정하세요.
        </div>
      )}

      {error && error !== "ai_disabled" && (
        <div className="text-xs text-rose-400 flex items-center gap-2">
          <AlertCircle size={14} />
          분석 실패: {error}
          <button
            onClick={() => load(true)}
            className="ml-2 underline hover:text-rose-300"
          >
            재시도
          </button>
        </div>
      )}

      {!error && (
        <div
          className={`grid gap-4 ${
            visibleMarkets.length === 1
              ? "grid-cols-1"
              : "grid-cols-1 lg:grid-cols-3"
          }`}
        >
          {visibleMarkets.map((m) => (
            <MarketCard
              key={m}
              market={m}
              data={data?.markets?.[m]}
              loading={loading && !data}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MarketCard({ market, data, loading }) {
  const meta = MARKET_META[market];

  if (loading) {
    return (
      <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 animate-pulse">
        <div className="h-4 w-16 bg-slate-800 rounded mb-3" />
        <div className="h-3 w-full bg-slate-800 rounded mb-2" />
        <div className="h-3 w-4/5 bg-slate-800 rounded mb-4" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-3 w-full bg-slate-800/60 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: meta.color }}
        />
        <h4 className="text-sm font-medium text-slate-200">{meta.label}</h4>
      </div>

      <p className="text-xs text-slate-400 italic leading-relaxed mb-4">
        {data.summary || "—"}
      </p>

      {data.headlines?.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            헤드라인
          </div>
          <ul className="space-y-1.5">
            {data.headlines.map((h, i) => (
              <li key={i} className="text-xs leading-snug">
                <a
                  href={h.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-300 hover:text-amber-300 transition inline-flex items-start gap-1"
                >
                  <span>{h.title}</span>
                  <ExternalLink size={10} className="mt-0.5 flex-shrink-0 opacity-60" />
                </a>
                {h.source && (
                  <span className="text-slate-600 ml-1">· {h.source}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.impacts?.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            내 종목 영향
          </div>
          <ul className="space-y-2">
            {data.impacts.map((imp, i) => (
              <ImpactRow key={i} imp={imp} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ImpactRow({ imp }) {
  const dirIcon =
    imp.direction === "positive" ? (
      <TrendingUp size={12} className="text-emerald-400 flex-shrink-0" />
    ) : imp.direction === "negative" ? (
      <TrendingDown size={12} className="text-rose-400 flex-shrink-0" />
    ) : (
      <Minus size={12} className="text-slate-500 flex-shrink-0" />
    );
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="mt-0.5">{dirIcon}</span>
      <div>
        <span className="text-slate-200">{imp.name}</span>{" "}
        <span className="text-slate-600 tabular">{imp.symbol}</span>
        <div className="text-slate-400 leading-relaxed">{imp.comment}</div>
      </div>
    </li>
  );
}
```

---

## Task 10: `AssetDashboard.jsx` — NewsSection 통합

**Files:**
- Modify: `C:\dev\client\src\AssetDashboard.jsx`

- [ ] **Step 1: import 추가**

`AssetDashboard.jsx` 상단의 import 블록에서, lucide-react import **다음 줄**에 추가:

```jsx
import NewsSection from "./NewsSection.jsx";
```

- [ ] **Step 2: 통합 탭 차트 그리드 아래에 NewsSection 삽입**

`AssetDashboard.jsx`에서 "2단: 월별 추이 + 트리맵" 섹션이 닫히는 `</section>` 다음, 그리고 `</> )}` 통합 탭 조건부 블록이 닫히기 **전**에 NewsSection 추가.

찾을 곳: `</section>` 다음 줄에 `</>` `)}` 가 오는 위치. 즉:

```jsx
            </section>
          </>
        )}
```

이 부분을 다음으로 교체:

```jsx
            </section>
          </>
        )}

        {/* 뉴스 + AI 분석 — 어느 탭이든 표시되며 활성 탭에 따라 필터링 */}
        <NewsSection holdings={holdingsRaw} activeTab={tab} />
```

> 디자인은 통합 탭 차트 아래 위치로 했으나, 시장별 탭에서도 해당 시장 카드 하나만 보여주는 게 자연스럽다. 따라서 통합 탭 조건부 블록 **밖**에 두고 `activeTab` prop으로 필터링.

- [ ] **Step 3: dev 서버 자동 HMR 확인**

dev 서버가 떠 있다면 저장 즉시 반영. 브라우저에서 `http://localhost:5173` 열고:
- "최근 시장 뉴스 & 영향" 섹션이 차트 그리드 아래, 보유 종목 위에 보이는지
- AI 키 미설정 상태이므로 "AI 분석이 비활성 상태입니다" 안내가 보이는지

Expected: 안내 메시지 보임, 다른 섹션은 정상 동작.

---

## Task 11: AI 키 설정 + 실제 동작 검증

**Files:**
- (수동) `C:\dev\server\.env`

- [ ] **Step 1: .env 파일 생성/수정**

```powershell
cd C:\dev\server
# .env가 없다면 .env.example을 복사
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

`C:\dev\server\.env` 파일을 편집기로 열고 `ANTHROPIC_API_KEY=<실제 키>` 입력.

- [ ] **Step 2: 백엔드 재시작**

```powershell
# 기존 백엔드 종료 후
cd C:\dev\server; npm start
```

Expected: 시작 로그에 `KIS: ...` 줄. (현재 헬스 체크에서 `ai: true` 확인하려면 다음 단계.)

- [ ] **Step 3: 헬스체크**

```powershell
curl http://localhost:3001/api/health
```

Expected: `"ai": true`.

- [ ] **Step 4: 뉴스 엔드포인트 직접 호출**

```powershell
$body = @{
  holdings = @(
    @{ symbol = "005930.KS"; name = "삼성전자"; category = "kr" },
    @{ symbol = "AAPL"; name = "Apple"; category = "us" }
  )
} | ConvertTo-Json -Depth 5

$r1 = Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/news `
  -ContentType "application/json" -Body $body
$r1 | ConvertTo-Json -Depth 6
```

Expected:
- 응답에 `fetchedAt`, `markets.kr.summary`, `markets.kr.headlines[]`, `markets.kr.impacts[]` 키 존재
- `markets.kr.impacts[0].name == "삼성전자"` (kr 카테고리 종목만 매핑)
- `markets.us.impacts`에는 Apple만 들어가야 함
- `markets.crypto.impacts`는 빈 배열

- [ ] **Step 5: 캐시 동작 검증**

같은 body를 즉시 다시 호출:

```powershell
$r2 = Invoke-RestMethod -Method Post -Uri http://localhost:3001/api/news `
  -ContentType "application/json" -Body $body
$r1.fetchedAt -eq $r2.fetchedAt
```

Expected: `True` (캐시 히트 — 동일 `fetchedAt`). 응답 시간 체감상 즉시.

- [ ] **Step 6: 캐시 무시(force) 검증**

```powershell
$r3 = Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/news?force=1" `
  -ContentType "application/json" -Body $body
$r1.fetchedAt -ne $r3.fetchedAt
```

Expected: `True` (`fetchedAt` 갱신됨). 응답 시간 ~3~6초 (Claude 호출 포함).

- [ ] **Step 7: 브라우저 UI 검증**

`http://localhost:5173` 새로고침:
- 뉴스 섹션 로딩 skeleton → 데이터로 전환
- 통합 탭: 3카드 보임
- 국장 탭 클릭: 국장 카드 1개만 보임
- 우상단 ↻ 버튼: 클릭 시 강제 새로고침되며 spinner 회전
- 각 카드: 시장 요약, 헤드라인 링크(클릭 → 새 탭), 영향 종목 색상별 표시

---

## Self-Review

**Spec coverage:**
- [x] Backend: `news.js` RSS 페처 → Task 3,4
- [x] Backend: `analyze.js` 캐시 키 + 프롬프트 + Claude 호출 → Task 5,6,7
- [x] Backend: `/api/news` POST 라우트 + 캐시 + force 쿼리 → Task 8
- [x] Backend: 에러 매핑 (ai_disabled, RSS 부분 실패, JSON 파싱) → Task 4,6,7,8
- [x] Backend: `.env` 추가 → Task 2
- [x] Backend: `package.json` 의존성 → Task 1
- [x] Frontend: `NewsSection.jsx` 컴포넌트 (skeleton/error/loaded 상태, 헤드라인, impacts) → Task 9
- [x] Frontend: 통합 탭 위치 + activeTab 필터링 → Task 10
- [x] 검증: AI 키 미설정 경로, 캐시 hit/miss, force 새로고침 → Task 8, 11

**Placeholder scan:** "TODO", "TBD", "implement later" 없음. 각 단계에 실제 코드 포함.

**Type consistency:**
- `MARKETS` (news.js): `kr/us/crypto` 키 → 라우트, 프론트, 프롬프트 모두 일치
- `direction`: 항상 `positive | negative | neutral` 셋
- 응답 스키마 `{ fetchedAt, markets: { [m]: { summary, headlines, impacts } } }`: server.js, NewsSection.jsx, analyze.js 일치
- 함수명: `fetchAllMarketsNews`, `analyzeNews`, `makeCacheKey`, `buildUserMessage`, `isAiConfigured` — 호출처와 정의 일치 확인됨

**Spec 변경 사항:**
- 디자인 문서는 "통합 탭 차트 아래" 위치였으나, 시장별 탭에서도 카드 1개를 보여주는 게 자연스러워 통합 탭 조건부 블록 밖에 두고 `activeTab` prop으로 필터. 디자인 의도와 부합 (사용자 선택 옵션 1번 설명: "해당 탭에서만 보이고 국장/미장/코인 탭에서는 그 시장만 필터링").
