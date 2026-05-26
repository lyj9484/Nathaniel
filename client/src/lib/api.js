import { supabase } from "./supabase.js";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export class RateLimitError extends Error {
  constructor({ used, limit, resetAt }) {
    super("rate_limit");
    this.code = "rate_limit";
    this.used = used;
    this.limit = limit;
    this.resetAt = resetAt;
  }
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not_authenticated");
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function apiGet(path) {
  const headers = await authHeaders();
  const res = await fetch(API_BASE + path, { headers });
  return handle(res);
}

export async function apiPost(path, body) {
  const headers = { ...(await authHeaders()), "Content-Type": "application/json" };
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers,
    body: body == null ? null : JSON.stringify(body),
  });
  return handle(res);
}

async function handle(res) {
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new RateLimitError(body.details || {});
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown" }));
    const err = new Error(body.message || body.error || `HTTP ${res.status}`);
    err.code = body.error;
    err.status = res.status;
    throw err;
  }
  return res.json();
}
