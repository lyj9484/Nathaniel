/* Yahoo Finance 시세 페처 — CORS 프록시 없이 서버에서 직접 호출 */

function guessCurrency(symbol) {
  if (/\.(KS|KQ)$/i.test(symbol)) return "KRW";
  if (/-USD$/i.test(symbol)) return "USD";
  return "USD";
}

export async function fetchYahooPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=1d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AssetDashboard/1.0; +https://localhost)",
    },
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice;
  const currency = result?.meta?.currency;
  if (price == null) throw new Error("price not found");
  return {
    symbol,
    price: Number(price),
    currency: currency || guessCurrency(symbol),
    source: "yahoo",
  };
}

/* ───── Historical (range/interval 가변) ───── */
export async function fetchYahooHistorical(symbol, range = "6mo", interval = "1d") {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
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
    if (!res.ok) return null;
    const data = await res.json();
    const fd = data.quoteSummary?.result?.[0]?.financialData;
    if (!fd) return null;
    const numAnalysts = fd.numberOfAnalystOpinions?.raw;
    if (!numAnalysts) return null;
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
