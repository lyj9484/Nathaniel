import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { authMiddleware } from "./auth.js";

const SECRET = "test-secret-1234567890";
process.env.SUPABASE_JWT_SECRET = SECRET;
process.env.SUPABASE_URL = "https://proj.supabase.co";

async function makeToken({ sub = "user-123", email = "a@b.com", expiresIn = "1h", issuer } = {}) {
  return new SignJWT({ sub, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer ?? "https://proj.supabase.co/auth/v1")
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(SECRET));
}

function mockReq(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}
function mockRes() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(body)   { this.body = body; return this; },
  };
}

test("auth: valid token sets req.user", async () => {
  const token = await makeToken();
  const req = mockReq(token);
  let nextCalled = false;
  await authMiddleware(req, mockRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.id, "user-123");
  assert.equal(req.user.email, "a@b.com");
});

test("auth: missing Authorization → 401 no_token", async () => {
  const res = mockRes();
  await authMiddleware(mockReq(null), res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "no_token");
});

test("auth: expired token → 401 invalid_token", async () => {
  const token = await makeToken({ expiresIn: "-1m" }); // already expired
  const res = mockRes();
  await authMiddleware(mockReq(token), res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "invalid_token");
});

test("auth: wrong issuer → 401", async () => {
  const token = await makeToken({ issuer: "https://evil.example.com" });
  const res = mockRes();
  await authMiddleware(mockReq(token), res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 401);
});

test("auth: tampered signature → 401", async () => {
  const token = (await makeToken()).slice(0, -3) + "XYZ";
  const res = mockRes();
  await authMiddleware(mockReq(token), res, () => assert.fail("next must not be called"));
  assert.equal(res.statusCode, 401);
});
