import "dotenv/config";
import express from "express";
import cors from "cors";
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

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

// 5분 메모리 캐시
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

/* ───── 종목 라우팅: .KS/.KQ → KIS (키 있을 때만), 그 외 → Yahoo ───── */
async function fetchPrice(symbol) {
  if (isKoreanSymbol(symbol) && isKisConfigured()) {
    try {
      return await fetchKisPrice(symbol);
    } catch (e) {
      console.warn(`[fallback] KIS failed for ${symbol} → Yahoo:`, e.message);
      return await fetchYahooPrice(symbol);
    }
  }
  return await fetchYahooPrice(symbol);
}

async function getCachedPrice(symbol) {
  const key = `price:${symbol}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const data = await fetchPrice(symbol);
  cache.set(key, data);
  return data;
}

/* ───── 라우트 ───── */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    kis: isKisConfigured(),
    ai: isAiConfigured(),
    cacheKeys: cache.keys().length,
    uptime: process.uptime(),
  });
});

app.get("/api/price/:symbol", async (req, res) => {
  const { symbol } = req.params;
  try {
    const data = await getCachedPrice(symbol);
    res.json(data);
  } catch (e) {
    console.error(`[price] ${symbol}:`, e.message);
    res.status(502).json({ symbol, error: e.message });
  }
});

app.get("/api/prices", async (req, res) => {
  const symbols = String(req.query.symbols || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (symbols.length === 0) {
    return res
      .status(400)
      .json({ error: "symbols query parameter required (comma-separated)" });
  }
  const results = await Promise.allSettled(symbols.map(getCachedPrice));
  const out = symbols.map((symbol, i) => {
    const r = results[i];
    if (r.status === "fulfilled") return r.value;
    return { symbol, error: r.reason?.message || "unknown error" };
  });
  res.json(out);
});

app.get("/api/fx/usdkrw", async (req, res) => {
  try {
    const key = "fx:usdkrw";
    const cached = cache.get(key);
    if (cached) return res.json(cached);
    const data = await fetchYahooPrice("KRW=X");
    cache.set(key, data);
    res.json(data);
  } catch (e) {
    console.error("[fx]", e.message);
    res.status(502).json({ error: e.message });
  }
});

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

// 차트 period → (range, interval, label) 매핑
const CHART_PERIODS = {
  daily: { range: "6mo", interval: "1d", label: "6M" },
  weekly: { range: "2y", interval: "1wk", label: "2Y" },
  monthly: { range: "5y", interval: "1mo", label: "5Y" },
};

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
  const period = CHART_PERIODS[req.query.period] ? req.query.period : "daily";

  if (!isAiConfigured()) {
    return res.status(503).json({ error: "ai_disabled" });
  }

  // 분리된 캐시: AI 분석은 symbol 단위, 차트는 (symbol, period) 단위
  const aiKey = `stock-ai:${symbol}`;
  const chartKey = `stock-chart:${symbol}:${period}`;

  try {
    let aiPart = force ? null : cache.get(aiKey);
    let chartPart = force ? null : cache.get(chartKey);

    // 1) AI/통계/애널리스트 부분 (항상 6mo 일봉 기준)
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
      const analysisResult = await analyzeStock({
        holding: { ...holding, currentPrice: current },
        stats,
        points,
        analyst,
      });
      aiPart = { stats, analyst, analysis: analysisResult.analysis };
      cache.set(aiKey, aiPart, 3600);
    }

    // 2) 차트 부분 (period 따라 다름)
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
    console.error("[stock]", e);
    if (e.code === "ai_disabled") {
      return res.status(503).json({ error: "ai_disabled" });
    }
    res.status(500).json({ error: e.message });
  }
});

// 캐시 비우기 (개발용)
app.post("/api/cache/clear", (req, res) => {
  cache.flushAll();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`asset-dashboard server: http://localhost:${PORT}`);
  console.log(
    `  KIS: ${isKisConfigured() ? "enabled" : "disabled (Yahoo for KR stocks)"}`
  );
  console.log(`  cache TTL: 300s`);
});
