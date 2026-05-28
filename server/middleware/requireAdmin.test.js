import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { requireAdmin } from "./requireAdmin.js";

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
});

test("requireAdmin: ADMIN_EMAILS 빈 값 → 503", () => {
  const req = { user: { email: "anyone@example.com" } };
  const res = mockRes();
  requireAdmin(req, res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "admin_disabled");
});

test("requireAdmin: non-admin user → 403", () => {
  process.env.ADMIN_EMAILS = "admin@example.com";
  const req = { user: { email: "user@example.com" } };
  const res = mockRes();
  requireAdmin(req, res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "forbidden");
});

test("requireAdmin: admin user → next()", () => {
  process.env.ADMIN_EMAILS = "admin@example.com";
  const req = { user: { email: "admin@example.com" } };
  const res = mockRes();
  let called = false;
  requireAdmin(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
});

test("requireAdmin: 대소문자 무시 매칭", () => {
  process.env.ADMIN_EMAILS = "Admin@Example.com";
  const req = { user: { email: "ADMIN@example.COM" } };
  const res = mockRes();
  let called = false;
  requireAdmin(req, res, () => { called = true; });
  assert.equal(called, true);
});

test("requireAdmin: 다수 이메일 등록 시 부분 일치", () => {
  process.env.ADMIN_EMAILS = "a@x.com, b@x.com ,c@x.com";
  const req = { user: { email: "b@x.com" } };
  const res = mockRes();
  let called = false;
  requireAdmin(req, res, () => { called = true; });
  assert.equal(called, true);
});

test("requireAdmin: req.user 없음 → 403", () => {
  process.env.ADMIN_EMAILS = "admin@example.com";
  const req = {};
  const res = mockRes();
  requireAdmin(req, res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 403);
});
