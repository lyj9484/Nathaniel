import { test } from "node:test";
import assert from "node:assert/strict";
import { StockSymbolSchema, NewsBodySchema, StockAnalysisBodySchema } from "./validators.js";

test("StockSymbolSchema: valid US/KR/crypto symbols", () => {
  assert.doesNotThrow(() => StockSymbolSchema.parse("AAPL"));
  assert.doesNotThrow(() => StockSymbolSchema.parse("005930.KS"));
  assert.doesNotThrow(() => StockSymbolSchema.parse("BTC-USD"));
});

test("StockSymbolSchema: rejects script injection", () => {
  assert.throws(() => StockSymbolSchema.parse("<script>"));
  assert.throws(() => StockSymbolSchema.parse("a; drop table"));
  assert.throws(() => StockSymbolSchema.parse(""));
  assert.throws(() => StockSymbolSchema.parse("A".repeat(16)));
});

test("NewsBodySchema: holdings array", () => {
  const ok = NewsBodySchema.parse({
    holdings: [{ symbol: "AAPL", name: "Apple", category: "us" }],
  });
  assert.equal(ok.holdings.length, 1);
});

test("NewsBodySchema: rejects >50 holdings", () => {
  const big = { holdings: Array(51).fill({ symbol: "AAPL", name: "Apple", category: "us" }) };
  assert.throws(() => NewsBodySchema.parse(big));
});

test("StockAnalysisBodySchema: valid", () => {
  const ok = StockAnalysisBodySchema.parse({
    name: "Apple", category: "us",
    currentPrice: 188.5, avgPrice: 150, quantity: 10,
  });
  assert.equal(ok.category, "us");
});
