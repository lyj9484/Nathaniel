import { useEffect, useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { useAuth } from "./AuthProvider.jsx";
import { listFeedback, isAdminEmail, FEEDBACK_CATEGORIES, FEEDBACK_LABEL } from "./lib/feedback.js";
import { navigate } from "./lib/useHashRoute.js";

const PAGE_SIZE = 50;

export default function AdminFeedbackPage() {
  const { user } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [category, setCategory] = useState(null); // null = 전체
  const [items, setItems] = useState([]);
  const [counts, setCounts] = useState({
    design: 0, ui: 0, ux: 0, price_data: 0, other: 0, total: 0,
  });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load(reset = false) {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const next = reset ? 0 : offset;
      const res = await listFeedback({ category, limit: PAGE_SIZE, offset: next });
      setItems(reset ? res.items : [...items, ...res.items]);
      setCounts(res.counts);
      setOffset(next + res.items.length);
    } catch (e) {
      setError(e.message || "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    // category 변경 시 리셋
  }, [category, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 flex-col gap-3">
        <p>권한이 없습니다.</p>
        <button
          onClick={() => navigate("/")}
          className="px-4 py-2 rounded-full bg-amber-500 text-slate-950 text-sm font-medium hover:bg-amber-400"
        >
          대시보드로
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-8 text-slate-100">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-100 text-sm"
          >
            <ArrowLeft size={14} />
            대시보드로
          </button>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <MessageSquare size={18} />
            피드백 관리
          </h1>
          <span className="w-20" /> {/* spacer */}
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <CategoryTab active={category === null} onClick={() => setCategory(null)} label="전체" count={counts.total} />
          {FEEDBACK_CATEGORIES.map((c) => (
            <CategoryTab
              key={c.key}
              active={category === c.key}
              onClick={() => setCategory(c.key)}
              label={c.label}
              count={counts[c.key]}
            />
          ))}
        </div>

        {error && (
          <div className="text-sm text-red-300 bg-red-950/40 border border-red-900/50 px-3 py-2 rounded mb-4">{error}</div>
        )}

        {items.length === 0 && !loading ? (
          <p className="text-sm text-slate-500 text-center py-12">아직 피드백이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="bg-slate-900 rounded-xl border border-slate-700 p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 mb-2">
                  <span className="font-medium text-slate-200">{item.email}</span>
                  <span>·</span>
                  <time>{formatDate(item.created_at)}</time>
                  <span>·</span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">
                    {FEEDBACK_LABEL[item.category] || item.category}
                  </span>
                </div>
                {(item.user_agent || item.page_url) && (
                  <div className="text-[11px] text-slate-500 mb-2 truncate">
                    {item.user_agent && <span title={item.user_agent}>{item.user_agent.slice(0, 80)}</span>}
                    {item.user_agent && item.page_url && " · "}
                    {item.page_url && <span>{item.page_url}</span>}
                  </div>
                )}
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{item.body}</p>
              </li>
            ))}
          </ul>
        )}

        {items.length < (category ? counts[category] : counts.total) && (
          <div className="text-center mt-6">
            <button
              onClick={() => load(false)}
              disabled={loading}
              className="px-4 py-2 rounded-full border border-slate-700 text-slate-300 hover:border-amber-500 hover:text-amber-400 text-sm disabled:opacity-50"
            >
              {loading ? "불러오는 중…" : "더 보기"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryTab({ active, onClick, label, count }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition " +
        (active
          ? "bg-amber-500 text-slate-950 font-medium"
          : "bg-slate-900 border border-slate-700 text-slate-300 hover:border-slate-500")
      }
    >
      {label}
      <span
        className={
          "px-1.5 py-0.5 rounded-full text-[11px] " +
          (active ? "bg-slate-950/20 text-slate-950" : "bg-slate-800 text-slate-400")
        }
      >
        {count}
      </span>
    </button>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
