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

// health는 인증 없이
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    kis: isKisConfigured(),
    ai: isAiConfigured(),
    cacheKeys: cache.keys().length,
    uptime: process.uptime(),
  });
});

// 이하 모든 /api/* 라우트 보호
app.use("/api", authMiddleware);

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

// 차트 period → (range, interval, label) 매핑
const CHART_PERIODS = {
  daily: { range: "6mo", interval: "1d", label: "6M" },
  weekly: { range: "2y", interval: "1wk", label: "2Y" },
  monthly: { range: "5y", interval: "1mo", label: "5Y" },
};

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

// 캐시 비우기 (개발용)
app.post("/api/cache/clear", (req, res) => {
  cache.flushAll();
  res.json({ ok: true });
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`asset-dashboard server: http://localhost:${PORT}`);
  console.log(
    `  KIS: ${isKisConfigured() ? "enabled" : "disabled (Yahoo for KR stocks)"}`
  );
  console.log(`  cache TTL: 300s`);
});
