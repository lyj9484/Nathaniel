import React, { useState, useMemo, useEffect } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  Plus,
  RefreshCw,
  Trash2,
  TrendingUp,
  TrendingDown,
  Target,
  Wallet,
  X,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

/* ──────────────────────────────────────────────────────────
   자산관리 대시보드 (국장 / 미장 / 코인)
   - Yahoo Finance API (via CORS proxy)
   - 단일 사용자 / 세션 메모리 (localStorage는 본인 환경에서 추가)
   ────────────────────────────────────────────────────────── */

const CATEGORIES = {
  kr: { label: "국장", color: "#60a5fa", suffix: "₩", locale: "ko-KR" },
  us: { label: "미장", color: "#f472b6", suffix: "$", locale: "en-US" },
  crypto: { label: "코인", color: "#fbbf24", suffix: "$", locale: "en-US" },
};

// 샘플 데이터 — 바로 화면이 차도록
const SAMPLE = [
  { id: 1, category: "kr", symbol: "005930.KS", name: "삼성전자", quantity: 50, avgPrice: 68000, currentPrice: null },
  { id: 2, category: "kr", symbol: "035720.KS", name: "카카오", quantity: 30, avgPrice: 52000, currentPrice: null },
  { id: 3, category: "us", symbol: "AAPL", name: "Apple", quantity: 10, avgPrice: 175.5, currentPrice: null },
  { id: 4, category: "us", symbol: "NVDA", name: "NVIDIA", quantity: 5, avgPrice: 480, currentPrice: null },
  { id: 5, category: "crypto", symbol: "BTC-USD", name: "Bitcoin", quantity: 0.05, avgPrice: 62000, currentPrice: null },
  { id: 6, category: "crypto", symbol: "ETH-USD", name: "Ethereum", quantity: 0.8, avgPrice: 3200, currentPrice: null },
];

const DEFAULT_TARGET = { kr: 30, us: 50, crypto: 20 };

// Yahoo Finance 단일 종목 시세 fetch
async function fetchYahooPrice(symbol) {
  const upstream = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const proxied = `https://corsproxy.io/?${encodeURIComponent(upstream)}`;
  const res = await fetch(proxied);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (price == null) throw new Error("price not found");
  return price;
}

function formatNumber(n, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatKRW(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return "₩" + Math.round(n).toLocaleString("ko-KR");
}

export default function AssetDashboard() {
  const [holdings, setHoldings] = useState(SAMPLE);
  const [fxRate, setFxRate] = useState(1380); // USD → KRW 기본값
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [tab, setTab] = useState("all"); // all | kr | us | crypto
  const [showAdd, setShowAdd] = useState(false);
  const [showTarget, setShowTarget] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errors, setErrors] = useState([]);

  // 페이지 로드 시 자동으로 시세 한 번 가져오기
  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAll() {
    setLoading(true);
    setErrors([]);
    const errs = [];

    // 환율
    try {
      const rate = await fetchYahooPrice("KRW=X");
      setFxRate(rate);
    } catch (e) {
      errs.push("환율(USD/KRW) 조회 실패 — 기본값 1380원 사용");
    }

    // 보유 종목들 — 병렬로
    const results = await Promise.allSettled(
      holdings.map((h) => fetchYahooPrice(h.symbol))
    );

    setHoldings((prev) =>
      prev.map((h, i) => {
        const r = results[i];
        if (r.status === "fulfilled") {
          return { ...h, currentPrice: r.value };
        } else {
          errs.push(`${h.symbol} 시세 조회 실패`);
          return h;
        }
      })
    );

    setLastUpdated(new Date());
    setErrors(errs);
    setLoading(false);
  }

  // 한 종목만 다시
  async function refreshOne(id) {
    const h = holdings.find((x) => x.id === id);
    if (!h) return;
    try {
      const price = await fetchYahooPrice(h.symbol);
      setHoldings((prev) =>
        prev.map((x) => (x.id === id ? { ...x, currentPrice: price } : x))
      );
    } catch (e) {
      setErrors((p) => [...p, `${h.symbol} 시세 조회 실패`]);
    }
  }

  // 평가금액(KRW)
  function evalKRW(h) {
    if (h.currentPrice == null) return null;
    const native = h.currentPrice * h.quantity;
    return h.category === "kr" ? native : native * fxRate;
  }
  function costKRW(h) {
    const native = h.avgPrice * h.quantity;
    return h.category === "kr" ? native : native * fxRate;
  }

  const totals = useMemo(() => {
    let totalEval = 0;
    let totalCost = 0;
    const byCat = { kr: 0, us: 0, crypto: 0 };
    holdings.forEach((h) => {
      const ev = evalKRW(h);
      const co = costKRW(h);
      if (ev != null) {
        totalEval += ev;
        byCat[h.category] += ev;
      }
      totalCost += co;
    });
    const pnl = totalEval - totalCost;
    const pnlRate = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
    return { totalEval, totalCost, pnl, pnlRate, byCat };
  }, [holdings, fxRate]);

  const visibleHoldings =
    tab === "all" ? holdings : holdings.filter((h) => h.category === tab);

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-slate-100 font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Fraunces', serif; font-optical-sizing: auto; }
        .font-sans { font-family: 'DM Sans', system-ui, sans-serif; }
        .tabular { font-variant-numeric: tabular-nums; }
        .grain::before {
          content: '';
          position: fixed; inset: 0; pointer-events: none; opacity: 0.025;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
          z-index: 100;
        }
      `}</style>
      <div className="grain" />

      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* 헤더 */}
        <header className="flex items-end justify-between mb-10">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-2">
              Personal Portfolio · {new Date().toLocaleDateString("ko-KR")}
            </div>
            <h1 className="font-display text-5xl font-medium leading-none">
              자산관리<span className="text-amber-400">.</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowTarget(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-700 hover:border-slate-500 text-sm transition"
            >
              <Target size={14} /> 목표 배분
            </button>
            <button
              onClick={refreshAll}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-100 text-slate-900 hover:bg-white text-sm font-medium transition disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {loading ? "조회중..." : "시세 새로고침"}
            </button>
          </div>
        </header>

        {/* 마지막 업데이트 & 에러 */}
        <div className="mb-8 flex items-center gap-3 text-xs">
          {lastUpdated && (
            <span className="flex items-center gap-1.5 text-slate-500">
              <CheckCircle2 size={12} className="text-emerald-400" />
              마지막 업데이트 {lastUpdated.toLocaleTimeString("ko-KR")} · USD/KRW {formatNumber(fxRate, 2)}
            </span>
          )}
          {errors.length > 0 && (
            <span className="flex items-center gap-1.5 text-amber-400">
              <AlertCircle size={12} /> {errors.length}건 조회 실패 (수동 입력 가능)
            </span>
          )}
        </div>

        {/* 상단 요약 카드 */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          <div className="bg-gradient-to-br from-slate-900/80 to-slate-950 border border-slate-800 rounded-2xl p-6">
            <div className="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
              <Wallet size={12} /> 총 자산 (KRW 환산)
            </div>
            <div className="font-display text-4xl tabular">
              {formatKRW(totals.totalEval)}
            </div>
          </div>
          <div className="bg-gradient-to-br from-slate-900/80 to-slate-950 border border-slate-800 rounded-2xl p-6">
            <div className="text-xs text-slate-500 mb-2">평가손익</div>
            <div
              className={`font-display text-4xl tabular ${
                totals.pnl >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {totals.pnl >= 0 ? "+" : ""}
              {formatKRW(totals.pnl)}
            </div>
          </div>
          <div className="bg-gradient-to-br from-slate-900/80 to-slate-950 border border-slate-800 rounded-2xl p-6">
            <div className="text-xs text-slate-500 mb-2">수익률</div>
            <div
              className={`font-display text-4xl tabular flex items-center gap-2 ${
                totals.pnlRate >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {totals.pnlRate >= 0 ? (
                <TrendingUp size={28} />
              ) : (
                <TrendingDown size={28} />
              )}
              {totals.pnlRate >= 0 ? "+" : ""}
              {totals.pnlRate.toFixed(2)}%
            </div>
          </div>
        </section>

        {/* 탭 */}
        <div className="flex items-center gap-1 mb-6 border-b border-slate-800">
          {[
            { id: "all", label: "통합" },
            { id: "kr", label: "국장" },
            { id: "us", label: "미장" },
            { id: "crypto", label: "코인" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-sm transition border-b-2 -mb-px ${
                tab === t.id
                  ? "border-amber-400 text-amber-400"
                  : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto pb-2">
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-amber-400 text-slate-950 font-medium hover:bg-amber-300 transition"
            >
              <Plus size={14} /> 종목 추가
            </button>
          </div>
        </div>

        {/* 통합 탭: 차트 + 배분 */}
        {tab === "all" && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm text-slate-400 mb-4">카테고리별 비중</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={Object.entries(totals.byCat).map(([k, v]) => ({
                        name: CATEGORIES[k].label,
                        value: v,
                        key: k,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={2}
                    >
                      {Object.keys(CATEGORIES).map((k) => (
                        <Cell key={k} fill={CATEGORIES[k].color} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(v) => formatKRW(v)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-4 mt-2 text-xs">
                {Object.entries(CATEGORIES).map(([k, c]) => (
                  <div key={k} className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: c.color }}
                    />
                    <span className="text-slate-400">{c.label}</span>
                    <span className="tabular text-slate-200">
                      {totals.totalEval > 0
                        ? ((totals.byCat[k] / totals.totalEval) * 100).toFixed(1)
                        : 0}
                      %
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
              <h3 className="text-sm text-slate-400 mb-4">목표 vs 실제 배분</h3>
              <div className="space-y-5">
                {Object.entries(CATEGORIES).map(([k, c]) => {
                  const actual =
                    totals.totalEval > 0
                      ? (totals.byCat[k] / totals.totalEval) * 100
                      : 0;
                  const goal = target[k];
                  const diff = actual - goal;
                  return (
                    <div key={k}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-slate-300">{c.label}</span>
                        <span className="tabular text-slate-400">
                          실제 {actual.toFixed(1)}% · 목표 {goal}%{" "}
                          <span
                            className={
                              Math.abs(diff) < 2
                                ? "text-slate-500"
                                : diff > 0
                                ? "text-amber-400"
                                : "text-sky-400"
                            }
                          >
                            ({diff >= 0 ? "+" : ""}
                            {diff.toFixed(1)}%)
                          </span>
                        </span>
                      </div>
                      <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="absolute top-0 left-0 h-full opacity-30"
                          style={{ width: `${goal}%`, background: c.color }}
                        />
                        <div
                          className="absolute top-0 left-0 h-full"
                          style={{
                            width: `${Math.min(actual, 100)}%`,
                            background: c.color,
                          }}
                        />
                        <div
                          className="absolute top-0 h-full w-px bg-white/60"
                          style={{ left: `${goal}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500 mt-5 leading-relaxed">
                얇은 흰선은 목표 비중, 진한 색은 현재 비중입니다. 차이가
                ±2%p 이상이면 리밸런싱을 고려해보세요.
              </p>
            </div>
          </section>
        )}

        {/* 보유 종목 리스트 */}
        <section className="bg-slate-900/40 border border-slate-800 rounded-2xl overflow-hidden mb-10">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm text-slate-300">
              보유 종목{" "}
              <span className="text-slate-500">({visibleHoldings.length})</span>
            </h3>
          </div>

          {visibleHoldings.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">
              보유 종목이 없습니다. 우측 상단의 "종목 추가"로 시작하세요.
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              <div className="grid grid-cols-12 gap-3 px-6 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                <div className="col-span-4">종목</div>
                <div className="col-span-2 text-right">수량</div>
                <div className="col-span-2 text-right">평단</div>
                <div className="col-span-2 text-right">현재가</div>
                <div className="col-span-2 text-right">손익률</div>
              </div>
              {visibleHoldings.map((h) => {
                const c = CATEGORIES[h.category];
                const pnlRate =
                  h.currentPrice != null
                    ? ((h.currentPrice - h.avgPrice) / h.avgPrice) * 100
                    : null;
                return (
                  <div
                    key={h.id}
                    className="grid grid-cols-12 gap-3 px-6 py-4 items-center hover:bg-slate-900/40 transition group"
                  >
                    <div className="col-span-4 flex items-center gap-3">
                      <span
                        className="w-1 h-8 rounded-full"
                        style={{ background: c.color }}
                      />
                      <div>
                        <div className="font-medium">{h.name}</div>
                        <div className="text-xs text-slate-500 tabular">
                          {h.symbol} · {c.label}
                        </div>
                      </div>
                    </div>
                    <div className="col-span-2 text-right tabular text-sm">
                      {h.quantity}
                    </div>
                    <div className="col-span-2 text-right tabular text-sm text-slate-400">
                      {c.suffix}
                      {formatNumber(
                        h.avgPrice,
                        h.category === "crypto" ? 2 : h.category === "us" ? 2 : 0
                      )}
                    </div>
                    <div className="col-span-2 text-right tabular text-sm">
                      {h.currentPrice != null ? (
                        <>
                          {c.suffix}
                          {formatNumber(
                            h.currentPrice,
                            h.category === "crypto" ? 2 : h.category === "us" ? 2 : 0
                          )}
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            const v = prompt(
                              `${h.symbol} 현재가 수동 입력 (${c.suffix})`
                            );
                            const n = parseFloat(v);
                            if (!Number.isNaN(n))
                              setHoldings((p) =>
                                p.map((x) =>
                                  x.id === h.id ? { ...x, currentPrice: n } : x
                                )
                              );
                          }}
                          className="text-xs text-amber-400 hover:underline"
                        >
                          수동 입력
                        </button>
                      )}
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-2">
                      {pnlRate != null && (
                        <span
                          className={`tabular text-sm font-medium ${
                            pnlRate >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {pnlRate >= 0 ? "+" : ""}
                          {pnlRate.toFixed(2)}%
                        </span>
                      )}
                      <button
                        onClick={() => refreshOne(h.id)}
                        className="opacity-0 group-hover:opacity-100 transition p-1 text-slate-500 hover:text-slate-200"
                        title="시세 갱신"
                      >
                        <RefreshCw size={12} />
                      </button>
                      <button
                        onClick={() =>
                          setHoldings((p) => p.filter((x) => x.id !== h.id))
                        }
                        className="opacity-0 group-hover:opacity-100 transition p-1 text-slate-500 hover:text-rose-400"
                        title="삭제"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <footer className="text-[11px] text-slate-600 text-center leading-relaxed">
          시세 데이터: Yahoo Finance (corsproxy.io 경유) · 환율은 USD/KRW 기준
          <br />
          ※ 이 화면은 프로토타입입니다. 새로고침 시 데이터가 초기화됩니다.
        </footer>
      </div>

      {/* 종목 추가 모달 */}
      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onAdd={(item) => {
            setHoldings((p) => [...p, { ...item, id: Date.now(), currentPrice: null }]);
            setShowAdd(false);
          }}
        />
      )}

      {/* 목표 배분 모달 */}
      {showTarget && (
        <TargetModal
          target={target}
          onClose={() => setShowTarget(false)}
          onSave={(t) => {
            setTarget(t);
            setShowTarget(false);
          }}
        />
      )}
    </div>
  );
}

/* ───────── 종목 추가 모달 ───────── */
function AddModal({ onClose, onAdd }) {
  const [category, setCategory] = useState("kr");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [avgPrice, setAvgPrice] = useState("");

  function submit() {
    if (!symbol || !name || !quantity || !avgPrice) return;
    onAdd({
      category,
      symbol: symbol.trim(),
      name: name.trim(),
      quantity: parseFloat(quantity),
      avgPrice: parseFloat(avgPrice),
    });
  }

  const hints = {
    kr: "예: 005930.KS (삼성전자) · 035720.KS (카카오) · .KS=코스피, .KQ=코스닥",
    us: "예: AAPL, NVDA, TSLA, MSFT",
    crypto: "예: BTC-USD, ETH-USD, SOL-USD",
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl p-7 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-2xl">종목 추가</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-2 block">카테고리</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(CATEGORIES).map(([k, c]) => (
                <button
                  key={k}
                  onClick={() => setCategory(k)}
                  className={`py-2 rounded-lg text-sm transition border ${
                    category === k
                      ? "border-amber-400 bg-amber-400/10 text-amber-300"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-2 block">티커</label>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder={
                  category === "kr"
                    ? "005930.KS"
                    : category === "us"
                    ? "AAPL"
                    : "BTC-USD"
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-amber-400 outline-none tabular"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-2 block">이름</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="삼성전자"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-amber-400 outline-none"
              />
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">{hints[category]}</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-2 block">수량</label>
              <input
                type="number"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="10"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-amber-400 outline-none tabular"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-2 block">
                평단가 ({CATEGORIES[category].suffix})
              </label>
              <input
                type="number"
                step="any"
                value={avgPrice}
                onChange={(e) => setAvgPrice(e.target.value)}
                placeholder={category === "kr" ? "68000" : "175.5"}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-amber-400 outline-none tabular"
              />
            </div>
          </div>

          <button
            onClick={submit}
            className="w-full mt-2 py-3 bg-amber-400 text-slate-950 rounded-lg font-medium hover:bg-amber-300 transition"
          >
            추가하기
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────── 목표 배분 모달 ───────── */
function TargetModal({ target, onClose, onSave }) {
  const [t, setT] = useState(target);
  const sum = (t.kr || 0) + (t.us || 0) + (t.crypto || 0);

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl p-7 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-2xl">목표 자산 배분</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {Object.entries(CATEGORIES).map(([k, c]) => (
            <div key={k} className="flex items-center gap-4">
              <span
                className="w-3 h-3 rounded-full"
                style={{ background: c.color }}
              />
              <span className="w-16 text-sm text-slate-300">{c.label}</span>
              <input
                type="number"
                value={t[k]}
                onChange={(e) =>
                  setT({ ...t, [k]: parseFloat(e.target.value) || 0 })
                }
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-amber-400 outline-none tabular text-right"
              />
              <span className="text-slate-500 text-sm">%</span>
            </div>
          ))}

          <div className="flex justify-between text-xs pt-2 border-t border-slate-800">
            <span className="text-slate-500">합계</span>
            <span
              className={`tabular ${
                sum === 100 ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {sum}% {sum !== 100 && "(100%이 되어야 합니다)"}
            </span>
          </div>

          <button
            onClick={() => sum === 100 && onSave(t)}
            disabled={sum !== 100}
            className="w-full mt-2 py-3 bg-amber-400 text-slate-950 rounded-lg font-medium hover:bg-amber-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
