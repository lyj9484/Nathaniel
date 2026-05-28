// admin 라우트 게이트. ADMIN_EMAILS env (쉼표 구분, 대소문자 무시) 매칭.
// 빈 값이면 503 (오타로 모두 admin 되는 사고 방지).
//
// 매 호출마다 env를 읽어 테스트에서 동적으로 토글 가능하게 함.
export function requireAdmin(req, res, next) {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) {
    return res.status(503).json({ error: "admin_disabled" });
  }
  const email = req.user?.email?.toLowerCase();
  if (!email || !list.includes(email)) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}
