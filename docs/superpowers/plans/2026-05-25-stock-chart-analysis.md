# Stock Chart + AI Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 종목 행 클릭 시 거래 모달에 "차트 & 분석" 탭을 추가해 6개월 일봉 차트, 통계, 애널리스트 컨센서스, OpenAI 자체 목표가/과열도/진입 시점 분석을 한 화면에 보여준다.

**Architecture:** 단일 endpoint `POST /api/stock/:symbol/analysis`가 Yahoo historical + analyst를 병렬 fetch, 서버에서 통계 계산, OpenAI 1회 호출. 종목별 1h 캐시. 프론트는 기존 `TransactionsModal`에 탭을 추가하고 새 `StockAnalysis.jsx` 컴포넌트로 차트/분석 렌더.

**Tech Stack:**
- Backend: Node 18+, Express, `openai`, `node-cache`. 신규 의존성 없음.
- Frontend: React 18, Vite, Tailwind v4, `recharts` (LineChart), `lucide-react`. 신규 의존성 없음.
- Test: 내장 `node --test`

**Spec:** `docs/superpowers/specs/2026-05-25-stock-chart-analysis-design.md`

---

## File Structure

**Backend** (`C:\dev\server\`):
- **Modify** `yahoo.js` — `fetchYahooHistorical`, `fetchYahooAnalyst`, `extractChartPoints` 추가
- **Create** `yahoo.test.js` — `extractChartPoints` 단위 테스트
- **Modify** `analyze.js` — `computeStats`, `analyzeStock` 추가. 시스템 프롬프트(주식 분석용) 추가
- **Modify** `analyze.test.js` — `computeStats` 테스트 추가
- **Modify** `server.js` — `POST /api/stock/:symbol/analysis` 라우트

**Frontend** (`C:\dev\client\`):
- **Create** `src/StockAnalysis.jsx` — 차트 + 통계 + 애널리스트 + AI 분석 카드 컴포넌트
- **Modify** `src/AssetDashboard.jsx` — `TransactionsModal`에 탭 추가, `StockAnalysis` 호출

---

## Task 1: `yahoo.js` — `extractChartPoints` 헬퍼 TDD

**Files:**
- Create: `C:\dev\server\yahoo.test.js`
- Modify: `C:\dev\server\yahoo.js`

- [ ] **Step 1: 테스트 작성**

`C:\dev\server\yahoo.test.js` 생성:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractChartPoints } from "./yahoo.js";

const MOCK_RESPONSE = {
  chart: {
    result: [
      {
        meta: { currency: "USD", regularMarketPrice: 188.5 },
        timestamp: [1700438400, 1700524800, 1700611200],
        indicators: {
          quote: [
            { close: [180.0, 182.5, 185.0] },
          ],
        },
      },
    ],
  },
};

test("extractChartPoints: 정상 응답에서 {date, close} 배열 추출", () => {
  const pts = extractChartPoints(MOCK_RESPONSE);
  assert.equal(pts.length, 3);
  assert.equal(pts[0].close, 180.0);
  assert.match(pts[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

test("extractChartPoints: null close는 필터링", () => {
  const resp = {
    chart: {
      result: [
        {
          meta: { currency: "USD" },
          timestamp: [1700438400, 1700524800, 1700611200],
          indicators: { quote: [{ close: [180.0, null, 185.0] }] },
        },
      ],
    },
  };
  const pts = extractChartPoints(resp);
  assert.equal(pts.length, 2);
});

test("extractChartPoints: result 비어있으면 빈 배열", () => {
  assert.deepEqual(extractChartPoints({ chart: { result: [] } }), []);
});

test("extractChartPoints: 잘못된 응답이면 throw", () => {
  assert.throws(() => extractChartPoints(null), /invalid yahoo response/i);
});
```

- [ ] **Step 2: 실패 확인**

```powershell
cd C:\dev\server; npm test
```

Expected: 4 새 테스트 실패 (extractChartPoints 미정의).

- [ ] **Step 3: `yahoo.js`에 함수 추가**

`C:\dev\server\yahoo.js` 파일 맨 끝에 (마지막 줄 `}` 이후) 다음을 추가:

```js
/* ───── Historical chart 데이터 파싱 헬퍼 (테스트용으로 export) ───── */
export function extractChartPoints(response) {
  if (!response || !response.chart) {
    throw new Error("invalid yahoo response");
  }
  const result = response.chart.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const points = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    points.push({ date, close });
  }
  return points;
}
```

- [ ] **Step 4: 통과 확인**

```powershell
cd C:\dev\server; npm test
```

Expected: 4 추가 테스트 모두 통과 (총 14/14).

---

## Task 2: `yahoo.js` — `fetchYahooHistorical`

**Files:**
- Modify: `C:\dev\server\yahoo.js`

- [ ] **Step 1: 함수 추가**

`C:\dev\server\yahoo.js`의 `extractChartPoints` 함수 **위에**, `fetchYahooPrice` 함수 끝(`}`) 이후에 추가:

```js
/* ───── Historical (6M 일봉) ───── */
export async function fetchYahooHistorical(symbol, range = "6mo") {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1d&range=${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AssetDashboard/1.0; +https://localhost)",
    },
  });
  if (!res.ok) throw new Error(`Yahoo historical HTTP ${res.status}`);
  const data = await res.json();
  const points = extractChartPoints(data);
  const currency = data.chart?.result?.[0]?.meta?.currency || "USD";
  return { points, currency };
}
```

- [ ] **Step 2: 테스트 재실행 (변경 없음 확인)**

```powershell
cd C:\dev\server; npm test
```

Expected: 14/14 통과.

---

## Task 3: `yahoo.js` — `fetchYahooAnalyst`

**Files:**
- Modify: `C:\dev\server\yahoo.js`

- [ ] **Step 1: 함수 추가**

`C:\dev\server\yahoo.js`에 `fetchYahooHistorical` 함수 끝(`}`) 이후에 추가:

```js
/* ───── 애널리스트 컨센서스 ───── */
export async function fetchYahooAnalyst(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=financialData,recommendationTrend`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AssetDashboard/1.0; +https://localhost)",
      },
    });
    if (!res.ok) return null; // 401/403/404 등은 데이터 없는 것으로 취급
    const data = await res.json();
    const fd = data.quoteSummary?.result?.[0]?.financialData;
    if (!fd) return null;
    const numAnalysts = fd.numberOfAnalystOpinions?.raw;
    if (!numAnalysts) return null; // 애널리스트 없는 종목은 null
    return {
      targetMean: fd.targetMeanPrice?.raw ?? null,
      targetHigh: fd.targetHighPrice?.raw ?? null,
      targetLow: fd.targetLowPrice?.raw ?? null,
      numAnalysts,
      recommendation: fd.recommendationKey ?? null,
    };
  } catch (e) {
    console.warn(`[yahoo] analyst fetch failed for ${symbol}:`, e.message);
    return null;
  }
}
```

- [ ] **Step 2: 변경 없음 확인**

```powershell
cd C:\dev\server; npm test
```

Expected: 14/14 통과.

---

## Task 4: `analyze.js` — `computeStats` TDD

**Files:**
- Modify: `C:\dev\server\analyze.test.js`
- Modify: `C:\dev\server\analyze.js`

- [ ] **Step 1: 테스트 추가**

`C:\dev\server\analyze.test.js` 파일 맨 끝에 다음 테스트를 추가 (기존 import 라인에 `computeStats`도 추가):

기존 첫 줄을:
```js
import { makeCacheKey, buildUserMessage } from "./analyze.js";
```

다음으로 변경:
```js
import { makeCacheKey, buildUserMessage, computeStats } from "./analyze.js";
```

그리고 파일 끝에 다음 테스트 5개 추가:

```js
test("computeStats: MA20/MA60/return 정상 계산", () => {
  // 100개 일봉, 각 100 → 199 선형 증가
  const points = Array.from({ length: 100 }, (_, i) => ({
    date: `2025-${String(Math.floor(i / 30) + 1).padStart(2, "0")}-01`,
    close: 100 + i,
  }));
  const s = computeStats(points, 199);
  assert.equal(s.current, 199);
  // MA20 = avg of last 20: (180+...+199)/20 = 189.5
  assert.ok(Math.abs(s.ma20 - 189.5) < 0.001);
  // MA60 = avg of last 60: (140+...+199)/60 = 169.5
  assert.ok(Math.abs(s.ma60 - 169.5) < 0.001);
  assert.equal(s.high6m, 199);
  assert.equal(s.low6m, 100);
});

test("computeStats: 1W/1M/3M/6M 수익률", () => {
  const points = Array.from({ length: 130 }, (_, i) => ({
    date: "2025-01-01",
    close: 100 + i, // 100→229
  }));
  const s = computeStats(points, 229);
  // 1W = 5 trading days ago = points[125-5] = 100+124 = 224
  // return1w = (229 - 224) / 224 ≈ 0.02232
  assert.ok(Math.abs(s.return1w - (229 - 224) / 224) < 0.0001);
  // 1M = 21 days ago = points[125-21] = 100+108 = 208
  assert.ok(Math.abs(s.return1m - (229 - 208) / 208) < 0.0001);
});

test("computeStats: 데이터 부족 시 부분 결과 (MA60 null)", () => {
  // 10개 점만
  const points = Array.from({ length: 10 }, (_, i) => ({
    date: "2025-01-01",
    close: 100 + i,
  }));
  const s = computeStats(points, 109);
  assert.equal(s.current, 109);
  assert.ok(s.ma20 == null);
  assert.ok(s.ma60 == null);
  assert.ok(s.return6m == null);
});

test("computeStats: 빈 배열은 모두 null", () => {
  const s = computeStats([], 100);
  assert.equal(s.current, 100);
  assert.equal(s.ma20, null);
  assert.equal(s.high6m, null);
  assert.equal(s.return1w, null);
});

test("computeStats: high/low는 모든 점에서 계산", () => {
  const points = [
    { date: "2025-01-01", close: 50 },
    { date: "2025-02-01", close: 200 },
    { date: "2025-03-01", close: 100 },
  ];
  const s = computeStats(points, 100);
  assert.equal(s.high6m, 200);
  assert.equal(s.low6m, 50);
});
```

- [ ] **Step 2: 실패 확인**

```powershell
cd C:\dev\server; npm test
```

Expected: 5 새 테스트 실패 (`computeStats` 미정의).

- [ ] **Step 3: `analyze.js`에 함수 추가**

`C:\dev\server\analyze.js`의 `buildUserMessage` 함수 끝(`}`) 이후, `isAiConfigured` 함수 **위에** 추가:

```js
/* ───── 통계 계산 (서버에서 미리 계산, AI도 사용, 프론트도 사용) ───── */
export function computeStats(points, current) {
  const n = points.length;
  const avg = (arr) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  const last = (k) => (n >= k ? avg(points.slice(n - k).map((p) => p.close)) : null);

  const ma20 = last(20);
  const ma60 = last(60);

  const closes = points.map((p) => p.close);
  const high6m = closes.length > 0 ? Math.max(...closes) : null;
  const low6m = closes.length > 0 ? Math.min(...closes) : null;

  const returnAt = (offsetTradingDays) => {
    if (n <= offsetTradingDays) return null;
    const past = points[n - 1 - offsetTradingDays].close;
    return past > 0 ? (current - past) / past : null;
  };

  return {
    current,
    ma20,
    ma60,
    high6m,
    low6m,
    return1w: returnAt(5),
    return1m: returnAt(21),
    return3m: returnAt(63),
    return6m: n > 0 ? (current - points[0].close) / points[0].close : null,
  };
}
```

- [ ] **Step 4: 통과 확인**

```powershell
cd C:\dev\server; npm test
```

Expected: 5 추가 테스트 통과 (총 19/19).

---

## Task 5: `analyze.js` — `analyzeStock` 함수

**Files:**
- Modify: `C:\dev\server\analyze.js`

- [ ] **Step 1: 시스템 프롬프트 + 함수 추가**

`C:\dev\server\analyze.js`의 `analyzeNews` 함수 끝(파일 마지막 `}`) 이후에 추가:

```js
/* ───── 종목 분석 ───── */
const STOCK_SYSTEM_PROMPT = `당신은 개인 투자자를 위한 종목 분석 어시스턴트입니다.
사용자가 제공하는 종목 기본 정보, 가격 시계열 통계, 최근 30일 일봉, 그리고 (있으면) 애널리스트 데이터를 바탕으로
추세 / 목표가 / 과열도 / 진입 시점을 분석합니다.

응답은 반드시 아래 형식의 JSON으로만 출력하세요.

{
  "analysis": {
    "trend": "추세 한 줄 (방향 + 기간 + 변동률)",
    "targetPrice": {
      "low": <숫자>,
      "mid": <숫자>,
      "high": <숫자>,
      "rationale": "근거 한 문장"
    },
    "valuation": "overheated" | "neutral" | "undervalued",
    "valuationComment": "한 문장",
    "entry": "buy_now" | "wait" | "sell",
    "entryComment": "한 문장"
  }
}

규칙:
- 한국어로 답변.
- targetPrice의 숫자는 현재가와 같은 통화 단위로 작성 (소수점은 USD만, KRW는 정수).
- valuation은 fair value 대비 과열/정상/저평가 판단.
- entry는 지금 시점에서 매수 권장/관망/매도 권장.
- 애널리스트 컨센서스가 있으면 그것과 자체 분석을 비교해 rationale에 언급.
- 코인은 펀더멘털 대신 기술적 흐름·모멘텀·변동성 중심으로 평가.
- 모든 코멘트는 50자 내외 한 문장.`;

function formatPercent(v) {
  if (v == null) return "—";
  const pct = v * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function buildStockUserMessage({ holding, stats, recentPoints, analyst }) {
  const curSuffix = holding.category === "kr" ? "₩" : "$";
  const fmt = (n) =>
    n == null
      ? "—"
      : `${curSuffix}${n.toLocaleString("ko-KR", {
          maximumFractionDigits: holding.category === "kr" ? 0 : 2,
        })}`;
  const lines = [];
  lines.push(`### 종목 정보`);
  lines.push(`이름: ${holding.name} (${holding.symbol}, ${holding.category})`);
  lines.push(`현재가: ${fmt(stats.current)}`);
  if (holding.avgPrice) lines.push(`보유 평단: ${fmt(holding.avgPrice)}`);
  lines.push("");
  lines.push(`### 통계 (6M)`);
  lines.push(`MA20: ${fmt(stats.ma20)} · MA60: ${fmt(stats.ma60)}`);
  lines.push(`6M 고: ${fmt(stats.high6m)} · 6M 저: ${fmt(stats.low6m)}`);
  lines.push(
    `1W ${formatPercent(stats.return1w)} · 1M ${formatPercent(stats.return1m)} · 3M ${formatPercent(stats.return3m)} · 6M ${formatPercent(stats.return6m)}`
  );
  lines.push("");
  lines.push(`### 최근 30일 일봉 (close)`);
  recentPoints.forEach((p) => {
    lines.push(`${p.date}: ${fmt(p.close)}`);
  });
  lines.push("");
  lines.push(`### 애널리스트 컨센서스`);
  if (analyst) {
    lines.push(
      `목표가 평균: ${fmt(analyst.targetMean)} (range ${fmt(analyst.targetLow)} ~ ${fmt(analyst.targetHigh)})`
    );
    lines.push(`애널리스트 수: ${analyst.numAnalysts} · 추천: ${analyst.recommendation || "—"}`);
  } else {
    lines.push("(데이터 없음)");
  }
  lines.push("");
  lines.push("위 정보를 바탕으로 JSON 응답을 생성하세요.");
  return lines.join("\n");
}

export async function analyzeStock({ holding, stats, points, analyst }) {
  const client = getClient();
  const recentPoints = points.slice(-30); // 최근 30일만 raw로
  const userMessage = buildStockUserMessage({ holding, stats, recentPoints, analyst });

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

- [ ] **Step 2: 테스트 재실행 (analyzeStock은 단위 테스트 안 함)**

```powershell
cd C:\dev\server; npm test
```

Expected: 19/19 통과.

---

## Task 6: `server.js` — `POST /api/stock/:symbol/analysis` 라우트

**Files:**
- Modify: `C:\dev\server\server.js`

- [ ] **Step 1: import 확장**

`C:\dev\server\server.js`의 yahoo import 라인을 찾아:
```js
import { fetchYahooPrice } from "./yahoo.js";
```

다음으로 교체:
```js
import {
  fetchYahooPrice,
  fetchYahooHistorical,
  fetchYahooAnalyst,
} from "./yahoo.js";
```

그리고 analyze import 라인을 찾아:
```js
import { analyzeNews, makeCacheKey, isAiConfigured } from "./analyze.js";
```

다음으로 교체:
```js
import {
  analyzeNews,
  makeCacheKey,
  isAiConfigured,
  computeStats,
  analyzeStock,
} from "./analyze.js";
```

- [ ] **Step 2: 라우트 추가**

`server.js`의 `app.post("/api/news", ...)` 라우트 **끝(`});`)** 이후, `// 캐시 비우기` 주석 **위**에 다음 블록 삽입:

```js
app.post("/api/stock/:symbol/analysis", async (req, res) => {
  const { symbol } = req.params;
  const holding = {
    symbol,
    name: req.body?.name || symbol,
    category: req.body?.category || "us",
    currentPrice: Number(req.body?.currentPrice) || null,
    avgPrice: Number(req.body?.avgPrice) || null,
    quantity: Number(req.body?.quantity) || null,
  };
  const force = req.query.force === "1";

  if (!isAiConfigured()) {
    return res.status(503).json({ error: "ai_disabled" });
  }

  const key = `stock:${symbol}`;
  if (!force) {
    const cached = cache.get(key);
    if (cached) return res.json(cached);
  }

  try {
    // 병렬 fetch
    const [histRes, analystRes] = await Promise.allSettled([
      fetchYahooHistorical(symbol, "6mo"),
      fetchYahooAnalyst(symbol),
    ]);

    if (histRes.status !== "fulfilled") {
      throw new Error(`historical fetch failed: ${histRes.reason?.message}`);
    }
    const { points, currency } = histRes.value;
    const analyst = analystRes.status === "fulfilled" ? analystRes.value : null;

    // currentPrice 누락 시 마지막 종가 사용
    const current = holding.currentPrice ?? points[points.length - 1]?.close;
    const stats = computeStats(points, current);

    const analysisResult = await analyzeStock({
      holding: { ...holding, currentPrice: current },
      stats,
      points,
      analyst,
    });

    const payload = {
      fetchedAt: new Date().toISOString(),
      chart: { period: "6M", currency, points },
      stats,
      analyst,
      analysis: analysisResult.analysis,
    };
    cache.set(key, payload, 3600);
    res.json(payload);
  } catch (e) {
    console.error("[stock]", e);
    if (e.code === "ai_disabled") {
      return res.status(503).json({ error: "ai_disabled" });
    }
    res.status(500).json({ error: e.message });
  }
});

```

- [ ] **Step 3: 변경 없음 확인**

```powershell
cd C:\dev\server; npm test
```

Expected: 19/19 통과.

- [ ] **Step 4: 백엔드 재시작**

기존 백엔드를 종료하고 다시 띄움. PowerShell:

```powershell
$pid_ = (Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue).OwningProcess
if ($pid_) { Stop-Process -Id $pid_ -Force }
```

그리고 새 셸 또는 백그라운드로:

```powershell
cd C:\dev\server; npm start
```

- [ ] **Step 5: 엔드포인트 확인**

```powershell
$body = @{ name = "삼성전자"; category = "kr"; currentPrice = 68500; avgPrice = 68000; quantity = 50 } | ConvertTo-Json
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$r = Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/stock/005930.KS/analysis" -ContentType "application/json; charset=utf-8" -Body $bodyBytes
"fetchedAt: $($r.fetchedAt)"
"chart points: $($r.chart.points.Count)"
"stats.current: $($r.stats.current) · MA20: $($r.stats.ma20)"
"analyst: $(if ($r.analyst) { 'present' } else { 'null' })"
"trend: $($r.analysis.trend)"
"targetPrice mid: $($r.analysis.targetPrice.mid)"
"valuation: $($r.analysis.valuation) · entry: $($r.analysis.entry)"
```

Expected:
- `chart.points.Count` ≈ 120~125
- `stats.current` ≈ 68500
- `analysis.trend`, `analysis.valuation`, `analysis.entry` 모두 채워짐

---

## Task 7: 프론트엔드 — `StockAnalysis.jsx` 컴포넌트

**Files:**
- Create: `C:\dev\client\src\StockAnalysis.jsx`

- [ ] **Step 1: 파일 생성**

다음 내용으로 `C:\dev\client\src\StockAnalysis.jsx` 생성:

```jsx
import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  RefreshCw,
  AlertCircle,
  TrendingUp,
  Target,
  Thermometer,
  MapPin,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

const CATEGORY_COLORS = {
  kr: "#60a5fa",
  us: "#f472b6",
  crypto: "#fbbf24",
};

const VALUATION_LABEL = {
  overheated: { ko: "과열", color: "text-rose-400 bg-rose-500/10 border-rose-500/30" },
  neutral: { ko: "중립", color: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
  undervalued: { ko: "저평가", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
};

const ENTRY_LABEL = {
  buy_now: { ko: "매수 권장", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
  wait: { ko: "관망", color: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
  sell: { ko: "매도 고려", color: "text-rose-400 bg-rose-500/10 border-rose-500/30" },
};

function formatPrice(n, currency) {
  if (n == null) return "—";
  const symbol = currency === "KRW" ? "₩" : "$";
  return symbol + n.toLocaleString("ko-KR", {
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  });
}

function formatPercent(v) {
  if (v == null) return "—";
  const pct = v * 100;
  const sign = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? "text-emerald-400" : "text-rose-400";
  return <span className={color}>{sign}{pct.toFixed(2)}%</span>;
}

export default function StockAnalysis({ holding }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}/api/stock/${encodeURIComponent(holding.symbol)}/analysis${force ? "?force=1" : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: holding.name,
          category: holding.category,
          currentPrice: holding.currentPrice,
          avgPrice: holding.avgPrice,
          quantity: holding.quantity,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
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
  }, [holding.symbol]);

  if (error === "ai_disabled") {
    return (
      <div className="text-xs text-amber-400 flex items-center gap-2 py-8">
        <AlertCircle size={14} />
        AI 분석이 비활성 상태입니다. <code>server/.env</code>에 <code>OPENAI_API_KEY</code>를 설정하세요.
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-rose-400 flex items-center gap-2 py-8">
        <AlertCircle size={14} />
        분석 실패: {error}
        <button onClick={() => load(true)} className="ml-2 underline hover:text-rose-300">
          재시도
        </button>
      </div>
    );
  }

  const color = CATEGORY_COLORS[holding.category] || "#94a3b8";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2 text-xs text-slate-500 -mb-2">
        {data?.fetchedAt && (
          <span>업데이트 {new Date(data.fetchedAt).toLocaleTimeString("ko-KR")}</span>
        )}
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-50"
          title="강제 새로고침"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {!data ? (
        <div className="space-y-3">
          <div className="h-48 bg-slate-800/40 rounded-lg animate-pulse" />
          <div className="h-20 bg-slate-800/40 rounded-lg animate-pulse" />
          <div className="h-32 bg-slate-800/40 rounded-lg animate-pulse" />
        </div>
      ) : (
        <>
          <ChartCard chart={data.chart} stats={data.stats} color={color} />
          <StatsBlock stats={data.stats} currency={data.chart.currency} />
          {data.analyst && <AnalystBlock analyst={data.analyst} currency={data.chart.currency} />}
          <AnalysisBlock analysis={data.analysis} currency={data.chart.currency} />
        </>
      )}
    </div>
  );
}

function ChartCard({ chart, stats, color }) {
  // chart.points에 MA20, MA60 미리 계산해서 합치기
  const closes = chart.points.map((p) => p.close);
  const windowed = (k, idx) => {
    if (idx + 1 < k) return null;
    const slice = closes.slice(idx + 1 - k, idx + 1);
    return slice.reduce((a, b) => a + b, 0) / k;
  };
  const data = chart.points.map((p, i) => ({
    date: p.date,
    close: p.close,
    ma20: windowed(20, i),
    ma60: windowed(60, i),
  }));

  // X축 라벨: 월 시작 근방만 표시
  const ticks = [];
  let prevMonth = "";
  data.forEach((d) => {
    const m = d.date.slice(0, 7);
    if (m !== prevMonth) {
      ticks.push(d.date);
      prevMonth = m;
    }
  });

  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
        6개월 차트 (종가 / MA20 / MA60)
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="date"
              ticks={ticks}
              tickFormatter={(d) => d.slice(5, 7) + "월"}
              stroke="#64748b"
              fontSize={10}
              tickLine={false}
            />
            <YAxis
              stroke="#64748b"
              fontSize={10}
              tickLine={false}
              domain={["auto", "auto"]}
              width={50}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "6px",
                fontSize: "11px",
              }}
              labelStyle={{ color: "#cbd5e1" }}
            />
            <Line type="monotone" dataKey="close" stroke={color} strokeWidth={1.5} dot={false} name="종가" />
            <Line type="monotone" dataKey="ma20" stroke={color} strokeWidth={1} strokeOpacity={0.5} dot={false} name="MA20" />
            <Line type="monotone" dataKey="ma60" stroke={color} strokeWidth={1} strokeOpacity={0.3} dot={false} name="MA60" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatsBlock({ stats, currency }) {
  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">통계</div>
      <div className="grid grid-cols-3 gap-3 text-xs mb-2 tabular">
        <div>
          <div className="text-slate-500">현재</div>
          <div className="text-slate-100">{formatPrice(stats.current, currency)}</div>
        </div>
        <div>
          <div className="text-slate-500">6M 고</div>
          <div className="text-slate-300">{formatPrice(stats.high6m, currency)}</div>
        </div>
        <div>
          <div className="text-slate-500">6M 저</div>
          <div className="text-slate-300">{formatPrice(stats.low6m, currency)}</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3 text-xs tabular">
        <div>
          <div className="text-slate-500">1W</div>
          <div>{formatPercent(stats.return1w)}</div>
        </div>
        <div>
          <div className="text-slate-500">1M</div>
          <div>{formatPercent(stats.return1m)}</div>
        </div>
        <div>
          <div className="text-slate-500">3M</div>
          <div>{formatPercent(stats.return3m)}</div>
        </div>
        <div>
          <div className="text-slate-500">6M</div>
          <div>{formatPercent(stats.return6m)}</div>
        </div>
      </div>
    </div>
  );
}

function AnalystBlock({ analyst, currency }) {
  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
        애널리스트 컨센서스
      </div>
      <div className="flex items-baseline justify-between text-xs">
        <div>
          <span className="text-slate-500">목표가 평균</span>{" "}
          <span className="text-slate-100 font-medium">{formatPrice(analyst.targetMean, currency)}</span>
          <span className="text-slate-600 ml-2">
            ({formatPrice(analyst.targetLow, currency)} ~ {formatPrice(analyst.targetHigh, currency)})
          </span>
        </div>
        <div className="text-slate-500">
          {analyst.numAnalysts}명 · {analyst.recommendation || "—"}
        </div>
      </div>
    </div>
  );
}

function AnalysisBlock({ analysis, currency }) {
  const v = VALUATION_LABEL[analysis.valuation] || { ko: analysis.valuation, color: "text-slate-400" };
  const e = ENTRY_LABEL[analysis.entry] || { ko: analysis.entry, color: "text-slate-400" };
  const tp = analysis.targetPrice || {};
  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-4 space-y-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">AI 분석</div>

      <div className="flex items-start gap-3 text-xs">
        <TrendingUp size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-slate-500 text-[10px] uppercase mb-0.5">추세</div>
          <div className="text-slate-200 leading-relaxed">{analysis.trend}</div>
        </div>
      </div>

      <div className="flex items-start gap-3 text-xs">
        <Target size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-slate-500 text-[10px] uppercase mb-0.5">AI 목표가</div>
          <div className="text-slate-200">
            {formatPrice(tp.low, currency)} ~ {formatPrice(tp.high, currency)}{" "}
            <span className="text-slate-500">(mid {formatPrice(tp.mid, currency)})</span>
          </div>
          <div className="text-slate-400 text-[11px] mt-1 leading-relaxed">{tp.rationale}</div>
        </div>
      </div>

      <div className="flex items-start gap-3 text-xs">
        <Thermometer size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-slate-500 text-[10px] uppercase mb-0.5">과열도</div>
          <span className={`inline-block px-2 py-0.5 rounded text-[10px] border ${v.color} mb-1`}>
            {v.ko}
          </span>
          <div className="text-slate-300 leading-relaxed">{analysis.valuationComment}</div>
        </div>
      </div>

      <div className="flex items-start gap-3 text-xs">
        <MapPin size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-slate-500 text-[10px] uppercase mb-0.5">진입 시점</div>
          <span className={`inline-block px-2 py-0.5 rounded text-[10px] border ${e.color} mb-1`}>
            {e.ko}
          </span>
          <div className="text-slate-300 leading-relaxed">{analysis.entryComment}</div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: dev 서버 HMR로 import 에러 없는지 확인**

이 파일은 아직 import되지 않아 빌드에 영향 없음. Vite 콘솔에 syntax 에러가 안 뜨는지만 확인.

---

## Task 8: `AssetDashboard.jsx` — TransactionsModal에 탭 추가

**Files:**
- Modify: `C:\dev\client\src\AssetDashboard.jsx`

- [ ] **Step 1: import 추가**

`AssetDashboard.jsx` 상단의 `import NewsSection from "./NewsSection.jsx";` **다음 줄**에 추가:

```jsx
import StockAnalysis from "./StockAnalysis.jsx";
```

- [ ] **Step 2: TransactionsModal에 탭 상태 추가**

`function TransactionsModal({` 함수를 찾는다 (대략 라인 1100 근방). 본문 시작부에서 `const [editingId, setEditingId] = useState(null);` 줄 **위에** 다음 줄 추가:

```jsx
  const [tab, setTab] = useState("transactions"); // transactions | analysis
```

- [ ] **Step 3: 미니 stat 그리드 바로 아래에 탭 바 추가**

`TransactionsModal` JSX 안에서 `<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">` 로 시작하는 미니 stat 그리드 블록의 **닫는 `</div>` 다음**, 그리고 "거래 추가/리스트" 헤더 `<div className="flex items-center justify-between mb-3">` **위**에 다음을 삽입:

```jsx
        {/* 탭 바 */}
        <div className="flex items-center gap-1 mb-5 border-b border-slate-800">
          <button
            onClick={() => setTab("transactions")}
            className={`px-4 py-2 text-sm transition border-b-2 -mb-px ${
              tab === "transactions"
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            거래 내역
          </button>
          <button
            onClick={() => setTab("analysis")}
            className={`px-4 py-2 text-sm transition border-b-2 -mb-px ${
              tab === "analysis"
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            차트 & 분석
          </button>
        </div>
```

- [ ] **Step 4: 거래 내역 영역을 탭 조건부 + 분석 영역 추가**

기존 거래 내역 영역 ("거래 추가/리스트" 헤더부터 `sorted.map(...)`로 끝나는 부분까지 — 즉 `<div className="flex items-center justify-between mb-3">` 부터 그 직후의 `</div>`까지의 전체 블록)을 다음으로 감싸기:

`<div className="flex items-center justify-between mb-3">` 한 줄 위에 추가:

```jsx
        {tab === "transactions" && (
          <>
```

그리고 거래 리스트 마지막 `</div>` (sorted.map 끝나고 닫히는 div) 다음에 닫기:

```jsx
          </>
        )}

        {tab === "analysis" && <StockAnalysis holding={holding} />}
```

> 이 단계는 정확한 시작/끝 위치를 잡기 어려울 수 있다. 우선 `TransactionsModal` JSX 끝부분을 정확히 식별한 뒤 위 변경을 적용. 끝 부분 식별 단서: `sorted.map((tx) =>` 가 있는 블록의 닫는 `)}` `</div>` 뒤가 `</div></div>` 모달 닫힘.

- [ ] **Step 5: HMR로 동작 확인**

브라우저에서 종목 클릭 → 모달 → 탭 바 보임 → "차트 & 분석" 탭 클릭 → 로딩 skeleton → 차트 + 분석 렌더.

---

## Task 9: 최종 동작 검증

**Files:** (코드 변경 없음, 검증만)

- [ ] **Step 1: 백엔드 헬스체크**

```powershell
Invoke-RestMethod -Uri http://localhost:3001/api/health | ConvertTo-Json
```

Expected: `"ai": true`.

- [ ] **Step 2: 국장 종목 검증 (삼성전자)**

```powershell
$body = @{ name = "삼성전자"; category = "kr"; currentPrice = 68500; avgPrice = 68000; quantity = 50 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/stock/005930.KS/analysis" `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) | ConvertTo-Json -Depth 5
```

Expected: chart.points ≈ 125, stats.current ≈ 68500, analysis 필드 채워짐.
analyst 데이터는 005930.KS의 경우 있을 수도 없을 수도 있음 (Yahoo 정책).

- [ ] **Step 3: 미장 종목 검증 (Apple)**

```powershell
$body = @{ name = "Apple"; category = "us"; currentPrice = 188.5; avgPrice = 175.5; quantity = 10 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/stock/AAPL/analysis" `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) | ConvertTo-Json -Depth 5
```

Expected: analyst 데이터 거의 확실히 존재 (AAPL은 메이저 종목).

- [ ] **Step 4: 코인 종목 검증 (Bitcoin)**

```powershell
$body = @{ name = "Bitcoin"; category = "crypto"; currentPrice = 77000; avgPrice = 62000; quantity = 0.05 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/api/stock/BTC-USD/analysis" `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) | ConvertTo-Json -Depth 5
```

Expected: chart.points 채워짐, analyst는 null, analysis는 기술적 분석 위주.

- [ ] **Step 5: 캐시 동작**

같은 body를 다시 호출 → fetchedAt 동일, 응답 즉시.

- [ ] **Step 6: Force 새로고침**

URL에 `?force=1` 붙여 호출 → fetchedAt 갱신.

- [ ] **Step 7: 브라우저 UI 종합 검증**

`http://localhost:5173` 새로고침. 다음 시나리오 확인:

1. 삼성전자 행 클릭 → 거래 모달 → "차트 & 분석" 탭 클릭
2. 로딩 skeleton (~5초) → 차트 + 통계 + 애널리스트(있으면) + AI 분석 표시
3. AAPL 행 클릭 → 같은 흐름 → 애널리스트 카드 채워짐
4. BTC-USD 행 클릭 → 같은 흐름 → 애널리스트 카드 숨김
5. 우상단 ↻ 버튼 → 강제 새로고침 동작
6. 탭 전환 (거래 내역 ↔ 차트 & 분석) → 상태 유지 (재호출 없음, 또는 캐시 즉시)
7. 모달 닫고 다시 열기 → 캐시로 즉시 표시

---

## Self-Review

**Spec coverage:**
- [x] yahoo.js: fetchYahooHistorical, fetchYahooAnalyst → Task 2, 3
- [x] yahoo.js: extractChartPoints 단위 테스트 → Task 1
- [x] analyze.js: computeStats → Task 4 (TDD)
- [x] analyze.js: analyzeStock + 시스템 프롬프트 → Task 5
- [x] server.js: POST /api/stock/:symbol/analysis + 캐시 1h + force → Task 6
- [x] 에러 매핑 (ai_disabled, historical 실패, analyst 실패) → Task 6
- [x] 응답 스키마 {fetchedAt, chart, stats, analyst, analysis} → Task 6
- [x] 프론트 StockAnalysis 컴포넌트 (skeleton, chart, stats, analyst block, analysis block) → Task 7
- [x] valuation/entry enum 색상 매핑 → Task 7
- [x] TransactionsModal 탭 추가 (transactions | analysis) → Task 8
- [x] 모든 카테고리(kr/us/crypto) 동일 UI, analyst만 조건부 → Task 6, 7
- [x] 종목 변경 시 자동 재호출 (useEffect deps에 holding.symbol) → Task 7

**Placeholder scan:** "TODO", "TBD", "implement later" 없음. 각 단계에 실제 코드 포함.

**Type consistency:**
- `computeStats` (analyze.js) ← server.js, StockAnalysis ChartCard에서 사용. 키 일치: current, ma20, ma60, high6m, low6m, return1w, return1m, return3m, return6m.
- `analyzeStock` 시그니처: `{ holding, stats, points, analyst }`. server.js 호출처와 일치.
- 응답 스키마 `chart.points`, `chart.currency`, `chart.period`, `stats.*`, `analyst.*` (또는 null), `analysis.{trend, targetPrice, valuation, valuationComment, entry, entryComment}`: 서버 응답과 프론트 사용 모두 일치 확인.
- enum: `valuation = overheated|neutral|undervalued`, `entry = buy_now|wait|sell`: 서버 프롬프트와 프론트 색상 맵 일치.

**Notes:**
- 프로젝트는 git 저장소가 아님. 모든 태스크에서 git 커밋 단계 생략.
- 백엔드 재시작은 Task 6 step 4에서 1회만 수행 (이후 변경은 프론트만이라 HMR로 처리).
- 이미 OpenAI 키가 `.env`에 있으므로 별도 키 설정 단계 불필요.
