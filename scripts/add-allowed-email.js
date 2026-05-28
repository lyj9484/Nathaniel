import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: node add-allowed-email.js <email>");
  process.exit(1);
}
const { error } = await admin.from("allowed_emails").upsert({ email });
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(`✓ Added ${email} to allowed_emails`);
