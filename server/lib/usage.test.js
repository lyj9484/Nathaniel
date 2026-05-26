import { test } from "node:test";
import assert from "node:assert/strict";
import { todayUTC } from "./usage.js";

test("todayUTC: returns YYYY-MM-DD in UTC", () => {
  const s = todayUTC(new Date("2026-05-26T14:30:00Z"));
  assert.equal(s, "2026-05-26");
});

test("todayUTC: handles KST evening near UTC midnight", () => {
  // KST 2026-05-27 08:00 = UTC 2026-05-26 23:00
  const s = todayUTC(new Date("2026-05-26T23:00:00Z"));
  assert.equal(s, "2026-05-26");
  const s2 = todayUTC(new Date("2026-05-27T00:30:00Z"));
  assert.equal(s2, "2026-05-27");
});
