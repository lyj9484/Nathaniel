import { supabaseAdmin } from "./supabaseAdmin.js";
import { RateLimitError } from "./errors.js";

export function todayUTC(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export async function chargeAiUsage(userId, dailyLimit = 20) {
  const today = todayUTC();
  const { data, error } = await supabaseAdmin().rpc("increment_ai_usage", {
    p_user_id: userId,
    p_date: today,
  });
  if (error) {
    const err = new Error("usage_error");
    err.code = "usage_error";
    err.cause = error;
    throw err;
  }
  // data는 [{ count: <int> }] 형태
  const count = Array.isArray(data) ? data[0]?.count : data?.count;
  if (count == null) {
    throw new Error("usage_error: unexpected response");
  }
  if (count > dailyLimit) {
    throw new RateLimitError({
      used: count,
      limit: dailyLimit,
      resetAt: `${today}T23:59:59Z`,
    });
  }
  return count;
}
