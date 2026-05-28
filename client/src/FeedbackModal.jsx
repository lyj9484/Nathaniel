import { useState } from "react";
import { X, Send, Check } from "lucide-react";
import { FEEDBACK_CATEGORIES, submitFeedback } from "./lib/feedback.js";

const MAX_LEN = 2000;

export default function FeedbackModal({ onClose }) {
  const [category, setCategory] = useState(null);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const trimmed = body.trim();
  const canSend = category && trimmed.length > 0 && trimmed.length <= MAX_LEN && !submitting;

  async function handleSend() {
    if (!canSend) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitFeedback({ category, body: trimmed });
      setSuccess(true);
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      setError(e.message || "전송에 실패했습니다");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-slate-100">피드백 보내기</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="p-10 flex flex-col items-center gap-3 text-emerald-400">
            <Check size={32} />
            <p className="text-sm">감사합니다, 잘 받았습니다!</p>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div>
              <div className="text-xs text-slate-400 mb-2">카테고리</div>
              <div className="flex flex-wrap gap-2">
                {FEEDBACK_CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCategory(c.key)}
                    className={
                      "px-3 py-1.5 rounded-full border text-sm transition " +
                      (category === c.key
                        ? "bg-amber-500 text-slate-950 border-amber-500"
                        : "bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500")
                    }
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-300 bg-red-950/40 border border-red-900/50 px-3 py-2 rounded">
                {error}
              </div>
            )}

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-slate-400">내용</label>
                <span
                  className={
                    "text-[11px] " +
                    (trimmed.length > MAX_LEN ? "text-red-500" : "text-slate-500")
                  }
                >
                  {trimmed.length} / {MAX_LEN}
                </span>
              </div>
              <textarea
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="어떤 점이 불편하셨나요? 자유롭게 적어주세요."
                className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder:text-slate-600 resize-none focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 text-sm hover:bg-slate-800"
              >
                취소
              </button>
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-slate-950 text-sm font-medium hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={14} />
                {submitting ? "전송 중…" : "SEND"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
