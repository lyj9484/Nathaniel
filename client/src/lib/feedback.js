import { apiPost, apiGet } from "./api.js";

export const FEEDBACK_CATEGORIES = [
  { key: "design",     label: "디자인" },
  { key: "ui",         label: "UI" },
  { key: "ux",         label: "UX" },
  { key: "price_data", label: "시세 오류" },
  { key: "other",      label: "기타" },
];

export const FEEDBACK_LABEL = Object.fromEntries(
  FEEDBACK_CATEGORIES.map((c) => [c.key, c.label])
);

export function submitFeedback({ category, body }) {
  return apiPost("/api/feedback", {
    category,
    body,
    page_url: window.location.href.slice(0, 500),
  });
}

export function listFeedback({ category, limit = 50, offset = 0 } = {}) {
  const qs = new URLSearchParams();
  if (category) qs.set("category", category);
  qs.set("limit", String(limit));
  qs.set("offset", String(offset));
  return apiGet(`/api/admin/feedback?${qs.toString()}`);
}

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
