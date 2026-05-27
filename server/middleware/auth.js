import { createRemoteJWKSet, jwtVerify } from "jose";

// Supabase signs session tokens with ES256 via JWT Signing Keys (asymmetric).
// We verify via the published JWKS — no shared secret needed.
//
// SUPABASE_JWT_SECRET (legacy HS256 env var) is no longer used.

let jwks = null;
function defaultJwks() {
  if (!jwks) {
    const url = new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    jwks = createRemoteJWKSet(url);
  }
  return jwks;
}

// test-only: inject a key set
let jwksOverride = null;
export function _setJwksForTests(fn) { jwksOverride = fn; }
function getJwks() { return jwksOverride ?? defaultJwks(); }

export async function authMiddleware(req, res, next) {
  const h = req.headers?.authorization;
  if (!h || !h.startsWith("Bearer ")) {
    return res.status(401).json({ error: "no_token", message: "인증 토큰이 없습니다" });
  }
  const token = h.slice(7);
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `${process.env.SUPABASE_URL}/auth/v1`,
      algorithms: ["ES256", "RS256"],
    });
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (e) {
    if (process.env.AUTH_DEBUG) console.error("authMiddleware verify failed:", e?.code, e?.message);
    return res.status(401).json({ error: "invalid_token", message: "토큰이 유효하지 않습니다" });
  }
}
