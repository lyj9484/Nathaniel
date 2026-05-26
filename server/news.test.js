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
