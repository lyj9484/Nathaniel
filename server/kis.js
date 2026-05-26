/* 한국투자증권 KIS Developers API — 국내주식 실시간 시세 */

const KIS_BASE =
  process.env.KIS_BASE || "https://openapi.koreainvestment.com:9443";

// OAuth 토큰 (24h 만료) — 메모리 캐시
let tokenCache = { value: null, expiresAt: 0 };

export function isKoreanSymbol(symbol) {
  return /\.(KS|KQ)$/i.test(symbol);
}

// "005930.KS" → "005930"
function stripSuffix(symbol) {
  return symbol.replace(/\.(KS|KQ)$/i, "");
}

export function isKisConfigured() {
  return !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
}

async function requestNewToken() {
  const appkey = process.env.KIS_APP_KEY;
  const appsecret = process.env.KIS_APP_SECRET;
  if (!appkey || !appsecret) {
    throw new Error("KIS_APP_KEY / KIS_APP_SECRET not configured");
  }
  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey,
      appsecret,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KIS auth HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("KIS auth: no access_token in response");
  }
  return {
    value: data.access_token,
    // expires_in (초) - 5분 일찍 갱신
    expiresAt: Date.now() + ((data.expires_in || 86400) - 300) * 1000,
  };
}

export async function getKisToken() {
  const now = Date.now();
  if (tokenCache.value && tokenCache.expiresAt > now) {
    return tokenCache.value;
  }
  tokenCache = await requestNewToken();
  console.log(
    `[kis] token refreshed, expires ${new Date(tokenCache.expiresAt).toISOString()}`
  );
  return tokenCache.value;
}

export async function fetchKisPrice(symbol) {
  const token = await getKisToken();
  const code = stripSuffix(symbol);
  const url =
    `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price` +
    `?fid_cond_mrkt_div_code=J&fid_input_iscd=${encodeURIComponent(code)}`;

  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      tr_id: "FHKST01010100", // 주식현재가 시세
      "Content-Type": "application/json; charset=utf-8",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KIS HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.rt_cd !== "0") {
    throw new Error(`KIS error: ${data.msg1 || data.rt_cd}`);
  }
  const price = parseFloat(data.output?.stck_prpr);
  if (Number.isNaN(price)) throw new Error("KIS price not found in response");
  return { symbol, price, currency: "KRW", source: "kis" };
}
