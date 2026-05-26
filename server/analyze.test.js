import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCacheKey, buildUserMessage, computeStats } from "./analyze.js";

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
  // 1W = 5 trading days ago = points[129-5] = 100+124 = 224
  // return1w = (229 - 224) / 224
  assert.ok(Math.abs(s.return1w - (229 - 224) / 224) < 0.0001);
  // 1M = 21 days ago = points[129-21] = 100+108 = 208
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
  assert.ok(s.return6m != null); // 10 days = 10/130, return6m is calculated from points[0] which exists
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
