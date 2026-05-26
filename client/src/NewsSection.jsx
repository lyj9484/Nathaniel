import { useEffect, useState } from "react";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { apiPost, RateLimitError } from "./lib/api.js";

const MARKET_META = {
  kr: { label: "국장", color: "#60a5fa" },
  us: { label: "미장", color: "#f472b6" },
  crypto: { label: "코인", color: "#fbbf24" },
};

export default function NewsSection({ holdings = [], activeTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const path = `/api/news${force ? "?force=1" : ""}`;
      const body = await apiPost(path, {
        holdings: holdings.map((h) => ({
          symbol: h.symbol,
          name: h.name,
          category: h.category,
        })),
      });
      setData(body);
    } catch (e) {
      if (e instanceof RateLimitError) {
        setError(`오늘 AI 분석 한도(${e.limit}회)를 초과했습니다`);
      } else {
        setError(e.code || e.message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings]);

  const visibleMarkets =
    activeTab === "all" ? ["kr", "us", "crypto"] : [activeTab];

  return (
    <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm text-slate-300">최근 시장 뉴스 & 영향</h3>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {data?.fetchedAt && (
            <span>
              업데이트 {new Date(data.fetchedAt).toLocaleTimeString("ko-KR")}
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-50 transition"
            title="강제 새로고침"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {error === "ai_disabled" && (
        <div className="text-xs text-amber-400 flex items-center gap-2">
          <AlertCircle size={14} />
          AI 분석이 비활성 상태입니다. <code>server/.env</code> 에{" "}
          <code>ANTHROPIC_API_KEY</code> 를 설정하세요.
        </div>
      )}

      {error && error !== "ai_disabled" && (
        <div className="text-xs text-rose-400 flex items-center gap-2">
          <AlertCircle size={14} />
          분석 실패: {error}
          <button
            onClick={() => load(true)}
            className="ml-2 underline hover:text-rose-300"
          >
            재시도
          </button>
        </div>
      )}

      {(!error || data) && (
        <div
          className={`grid gap-4 ${
            visibleMarkets.length === 1
              ? "grid-cols-1"
              : "grid-cols-1 lg:grid-cols-3"
          }`}
        >
          {visibleMarkets.map((m) => (
            <MarketCard
              key={m}
              market={m}
              data={data?.markets?.[m]}
              loading={loading && !data}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MarketCard({ market, data, loading }) {
  const meta = MARKET_META[market];

  if (loading) {
    return (
      <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4 animate-pulse">
        <div className="h-4 w-16 bg-slate-800 rounded mb-3" />
        <div className="h-3 w-full bg-slate-800 rounded mb-2" />
        <div className="h-3 w-4/5 bg-slate-800 rounded mb-4" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-3 w-full bg-slate-800/60 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: meta.color }}
        />
        <h4 className="text-sm font-medium text-slate-200">{meta.label}</h4>
      </div>

      <p className="text-xs text-slate-400 italic leading-relaxed mb-4">
        {data.summary || "—"}
      </p>

      {data.headlines?.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            헤드라인
          </div>
          <ul className="space-y-1.5">
            {data.headlines.map((h, i) => (
              <li key={i} className="text-xs leading-snug">
                <a
                  href={h.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-300 hover:text-amber-300 transition inline-flex items-start gap-1"
                >
                  <span>{h.title}</span>
                  <ExternalLink size={10} className="mt-0.5 flex-shrink-0 opacity-60" />
                </a>
                {h.source && (
                  <span className="text-slate-600 ml-1">· {h.source}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.impacts?.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
            내 종목 영향
          </div>
          <ul className="space-y-2">
            {data.impacts.map((imp, i) => (
              <ImpactRow key={i} imp={imp} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ImpactRow({ imp }) {
  const dirIcon =
    imp.direction === "positive" ? (
      <TrendingUp size={12} className="text-emerald-400 flex-shrink-0" />
    ) : imp.direction === "negative" ? (
      <TrendingDown size={12} className="text-rose-400 flex-shrink-0" />
    ) : (
      <Minus size={12} className="text-slate-500 flex-shrink-0" />
    );
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="mt-0.5">{dirIcon}</span>
      <div>
        <span className="text-slate-200">{imp.name}</span>{" "}
        <span className="text-slate-600 tabular">{imp.symbol}</span>
        <div className="text-slate-400 leading-relaxed">{imp.comment}</div>
      </div>
    </li>
  );
}
