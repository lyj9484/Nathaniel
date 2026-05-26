import { jwtVerify } from "jose";

let secretKey = null;
function getSecret() {
  if (!secretKey) {
    const s = process.env.SUPABASE_JWT_SECRET;
    if (!s) throw new Error("SUPABASE_JWT_SECRET missing");
    secretKey = new TextEncoder().encode(s);
  }
  return secretKey;
}

export async function authMiddleware(req, res, next) {
  const h = req.headers?.authorization;
  if (!h || !h.startsWith("Bearer ")) {
    return res.status(401).json({ error: "no_token", message: "인증 토큰이 없습니다" });
  }
  const token = h.slice(7);
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: `${process.env.SUPABASE_URL}/auth/v1`,
      algorithms: ["HS256"],
    });
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token", message: "토큰이 유효하지 않습니다" });
  }
}
