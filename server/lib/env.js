// 부팅 시 필수 env가 모두 있는지 확인. 누락 시 즉시 종료.
const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "ALLOWED_ORIGINS",
];
const RECOMMENDED = [
  "ADMIN_EMAILS",
  "DAILY_AI_LIMIT",
];

export function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error("❌ Missing required env vars:", missing.join(", "));
    process.exit(1);
  }
  const missingRecommended = RECOMMENDED.filter((k) => !process.env[k]);
  if (missingRecommended.length > 0) {
    console.warn("⚠️  Missing recommended env vars:", missingRecommended.join(", "));
  }
}
