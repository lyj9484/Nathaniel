/* OpenAI 호출 + 프롬프트 구성 + 캐시 키 */
import { createHash } from "node:crypto";
import OpenAI from "openai";
import { chargeAiUsage } from "./lib/usage.js";

const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 2048;

const DAILY_LIMIT = Number(process.env.DAILY_AI_LIMIT) || 20;

const MARKET_LABELS = { kr: "국장 (한국)", us: "미장 (미국)", crypto: "코인" };

const SYSTEM_PROMPT = `당신은 개인 투자자를 위한 시장 분석 어시스턴트입니다.
사용자가 제공하는 시장별 뉴스 헤드라인과 보유 종목 정보를 바탕으로,
시장 동향 요약과 보유 종목별 영향을 분석합니다.

응답은 반드시 아래 형식의 JSON으로만 출력하세요.

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
    return6m:
      n > 0 && points[0].close > 0
        ? (current - points[0].close) / points[0].close
        : null,
  };
}

export function isAiConfigured() {
  return !!process.env.OPENAI_API_KEY;
}

let openaiClient = null;
function getClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      const err = new Error("ai_disabled");
      err.code = "ai_disabled";
      throw err;
    }
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

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

  // 1회 재시도 (네트워크 오류 또는 드물게 JSON 파싱 실패)
  try {
    return await callOnce();
  } catch (e) {
    console.warn("[analyze] first attempt failed, retrying:", e.message);
    return await callOnce();
  }
}

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

export async function analyzeStock({ holding, stats, points, analyst }, userId) {
  if (userId) await chargeAiUsage(userId, DAILY_LIMIT);
  const client = getClient();
  const recentPoints = points.slice(-30);
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
