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
