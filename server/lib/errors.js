export class RateLimitError extends Error {
  constructor({ used, limit, resetAt }) {
    super("rate_limit");
    this.code = "rate_limit";
    this.used = used;
    this.limit = limit;
    this.resetAt = resetAt;
  }
}

export class ValidationError extends Error {
  constructor(details) {
    super("validation_error");
    this.code = "validation_error";
    this.details = details;
  }
}

// Express 에러 핸들러: 모든 throw를 일관된 JSON으로
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof RateLimitError) {
    return res.status(429).json({
      error: "rate_limit",
      message: `오늘 AI 분석 한도(${err.limit}회)를 초과했습니다`,
      details: { used: err.used, limit: err.limit, resetAt: err.resetAt },
    });
  }
  if (err instanceof ValidationError) {
    return res.status(400).json({
      error: "validation_error",
      message: "입력 검증 실패",
      details: err.details,
    });
  }
  if (err.code === "ai_disabled") {
    return res.status(503).json({ error: "ai_disabled", message: "AI 기능 비활성" });
  }
  console.error("[unhandled]", err);
  res.status(500).json({ error: "internal_error", message: "서버 오류" });
}
