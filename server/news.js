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
