import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Treemap,
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
  Download,
  Upload,
  RotateCcw,
  Pencil,
  Menu,
  ArrowDownCircle,
  ArrowUpCircle,
  History,
  MessageSquare,
} from "lucide-react";
import NewsSection from "./NewsSection.jsx";
import StockAnalysis from "./StockAnalysis.jsx";
import { useHoldings, useTransactions, useSettings } from "./lib/useRemoteState.js";
import { signOut, useAuth } from "./AuthProvider.jsx";
import { apiPost, apiGet, RateLimitError } from "./lib/api.js";
import FeedbackModal from "./FeedbackModal.jsx";
import { isAdminEmail } from "./lib/feedback.js";
import { navigate } from "./lib/useHashRoute.js";

/* ──────────────────────────────────────────────────────────
   자산관리 대시보드 v2
   - Supabase Postgres + RLS 기반 멀티유저
   - 거래 내역 기반 평단 자동 계산 (이동평균법)
   - 차트: 카테고리 비중 / 목표vs실제 / 월별 추이 / 트리맵
   ────────────────────────────────────────────────────────── */

const CATEGORIES = {
  kr: { label: "국장", color: "#60a5fa", suffix: "₩", locale: "ko-KR" },
  us: { label: "미장", color: "#f472b6", suffix: "$", locale: "en-US" },
  crypto: { label: "코인", color: "#fbbf24", suffix: "$", locale: "en-US" },
};

/* ───── 거래 → 보유 종목 파생 계산 (이동평균법) ───── */
function deriveHolding(holding, txs) {
  const sorted = txs
    .filter((t) => t.holdingId === holding.id)
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let qty = 0;
  let avgPrice = 0;
  let totalBuyAmount = 0; // 누적 매수금액(수수료 포함)
  let realizedPnL = 0;

  for (const tx of sorted) {
    const fee = tx.fee || 0;
    if (tx.type === "buy") {
      const cost = tx.price * tx.quantity + fee;
      const newQty = qty + tx.quantity;
      if (newQty > 0) {
        avgPrice = (avgPrice * qty + cost) / newQty;
      }
      qty = newQty;
      totalBuyAmount += cost;
    } else {
      // 매도: 실현손익 = (매도가 - 평단) × 수량 - 수수료. 평단가는 유지.
      realizedPnL += (tx.price - avgPrice) * tx.quantity - fee;
      qty -= tx.quantity;
      if (qty < 1e-12) qty = 0;
    }
  }

  return { ...holding, quantity: qty, avgPrice, realizedPnL, totalBuyAmount };
}

/* ───── 백엔드 API ───── */
// 비어있으면 상대경로 → Vite dev 서버 프록시가 /api/* 를 백엔드로 전달
const API_BASE = import.meta.env.VITE_API_BASE || "";

async function fetchPrice(symbol) {
  const data = await apiGet(`/api/price/${encodeURIComponent(symbol)}`);
  if (data?.error || data?.price == null) {
    throw new Error(data?.error || "price unavailable");
  }
  return data.price;
}

async function fetchPricesBatch(symbols) {
  if (symbols.length === 0) return [];
  return apiGet(`/api/prices?symbols=${encodeURIComponent(symbols.join(","))}`);
}

async function fetchFxRate() {
  const data = await apiGet(`/api/fx/usdkrw`);
  if (data?.error || data?.price == null) {
    throw new Error(data?.error || "fx unavailable");
  }
  return data.price;
}

/* ───── 포맷 헬퍼 ───── */
function formatNumber(n, decimals = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
function formatKRW(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + "₩" + Math.round(Math.abs(n)).toLocaleString("ko-KR");
}
function formatKRWShort(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}억`;
  if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)}만`;
  return formatKRW(n);
}

/* ───── 색상 헬퍼: 카테고리 베이스 색상을 명도 단계로 분배 ───── */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
function shadeColor(baseHex, idx, total) {
  if (total <= 1) return baseHex;
  const { h, s } = hexToHsl(baseHex);
  // 명도 35% ~ 75% 범위
  const newL = 75 - (idx / Math.max(total - 1, 1)) * 40;
  return hslToHex(h, s, newL);
}

/* ───── 메인 컴포넌트 ───── */
export default function AssetDashboard() {
  const { user } = useAuth();
  const {
    holdings: holdingsRawDb,
    loading: holdingsLoading,
    add: addHoldingRemote,
    remove: removeHoldingRemote,
  } = useHoldings();
  const {
    transactions,
    loading: transactionsLoading,
    add: addTransactionRemote,
    update: updateTransactionRemote,
    remove: removeTransactionRemote,
  } = useTransactions();
  const { target, fxRate, loading: settingsLoading, saveTarget, saveFxRate } = useSettings();

  // currentPrice는 DB에 저장하지 않고 런타임 상태(시세 API 응답)로만 보관
  const [currentPrices, setCurrentPrices] = useState({}); // { [holdingId]: number }

  // DB의 holdings + 런타임 currentPrice 머지
  const holdingsRaw = useMemo(
    () => holdingsRawDb.map((h) => ({ ...h, currentPrice: currentPrices[h.id] ?? null })),
    [holdingsRawDb, currentPrices]
  );

  const [tab, setTab] = useState("all"); // all | kr | us | crypto
  const [showAdd, setShowAdd] = useState(false);
  const [showTarget, setShowTarget] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [txDetailHoldingId, setTxDetailHoldingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [errors, setErrors] = useState([]);
  const fileInputRef = useRef(null);

  // 보유 종목 = raw + 거래내역 파생 데이터
  const holdings = useMemo(
    () => holdingsRaw.map((h) => deriveHolding(h, transactions)),
    [holdingsRaw, transactions]
  );

  // 모든 원격 상태가 로드된 후에만 가격/뉴스를 가져온다.
  // settings만 보고 trigger하면 holdings가 늦게 끝났을 때 빈 배열로 closure가 갇혀
  // 시세 fetch가 누락된다.
  const allLoaded = !holdingsLoading && !transactionsLoading && !settingsLoading;
  useEffect(() => {
    if (!allLoaded) return;
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLoaded]);

  async function refreshAll() {
    setLoading(true);
    setErrors([]);
    const errs = [];

    try {
      const rate = await fetchFxRate();
      await saveFxRate(rate);
    } catch (e) {
      errs.push(`환율(USD/KRW) 조회 실패: ${e.message} — 저장된 환율 사용`);
    }

    if (holdingsRaw.length > 0) {
      try {
        const results = await fetchPricesBatch(holdingsRaw.map((h) => h.symbol));
        const bySymbol = Object.fromEntries(results.map((r) => [r.symbol, r]));
        setCurrentPrices((prev) => {
          const next = { ...prev };
          for (const h of holdingsRaw) {
            const r = bySymbol[h.symbol];
            if (r && !r.error && r.price != null) {
              next[h.id] = r.price;
            } else if (r?.error) {
              errs.push(`${h.symbol}: ${r.error}`);
            }
          }
          return next;
        });
      } catch (e) {
        errs.push(`시세 일괄 조회 실패: ${e.message}`);
      }
    }

    setLastUpdated(new Date());
    setErrors(errs);
    setLoading(false);
  }

  async function refreshOne(id) {
    const h = holdingsRaw.find((x) => x.id === id);
    if (!h) return;
    try {
      const price = await fetchPrice(h.symbol);
      setCurrentPrices((prev) => ({ ...prev, [id]: price }));
    } catch (e) {
      setErrors((p) => [...p, `${h.symbol} 시세 조회 실패: ${e.message}`]);
    }
  }

  /* ───── 평가/원가 (KRW 환산) ───── */
  function evalKRW(h) {
    if (h.currentPrice == null || h.quantity <= 0) return null;
    const native = h.currentPrice * h.quantity;
    return h.category === "kr" ? native : native * fxRate;
  }
  function costKRW(h) {
    if (h.quantity <= 0) return 0;
    const native = h.avgPrice * h.quantity;
    return h.category === "kr" ? native : native * fxRate;
  }
  function totalBuyKRW(h) {
    const native = h.totalBuyAmount;
    return h.category === "kr" ? native : native * fxRate;
  }
  function realizedKRW(h) {
    const native = h.realizedPnL;
    return h.category === "kr" ? native : native * fxRate;
  }

  const totals = useMemo(() => {
    let totalEval = 0;
    let totalCost = 0;
    let totalRealized = 0;
    let totalBuy = 0;
    const byCat = { kr: 0, us: 0, crypto: 0 };
    holdings.forEach((h) => {
      const ev = evalKRW(h);
      const co = costKRW(h);
      const rz = realizedKRW(h);
      const tb = totalBuyKRW(h);
      if (ev != null) {
        totalEval += ev;
        byCat[h.category] += ev;
      }
      totalCost += co;
      totalRealized += rz;
      totalBuy += tb;
    });
    const pnl = totalEval - totalCost;
    const pnlRate = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
    return { totalEval, totalCost, totalRealized, totalBuy, pnl, pnlRate, byCat };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, fxRate]);

  /* ───── 월별 평가금액 추이 (최근 12개월, 현재가 기준 근사) ───── */
  const monthlySeries = useMemo(() => {
    const now = new Date();
    const points = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const cutoff = d.getTime();
      const txsUntil = transactions.filter(
        (t) => new Date(t.date).getTime() <= cutoff
      );
      let totalValue = 0;
      for (const h of holdingsRaw) {
        const derived = deriveHolding(h, txsUntil);
        if (derived.quantity > 0 && h.currentPrice != null) {
          const native = derived.quantity * h.currentPrice;
          totalValue += h.category === "kr" ? native : native * fxRate;
        }
      }
      points.push({
        month: `${String(d.getFullYear()).slice(2)}/${String(
          d.getMonth() + 1
        ).padStart(2, "0")}`,
        value: Math.round(totalValue),
      });
    }
    return points;
  }, [transactions, holdingsRaw, fxRate]);

  /* ───── 트리맵 데이터 ───── */
  const treemapData = useMemo(() => {
    const items = [];
    for (const catKey of Object.keys(CATEGORIES)) {
      const cat = CATEGORIES[catKey];
      const sameCat = holdings.filter(
        (h) => h.category === catKey && evalKRW(h) != null && evalKRW(h) > 0
      );
      sameCat.forEach((h, idx) => {
        items.push({
          name: h.name,
          symbol: h.symbol,
          category: cat.label,
          size: evalKRW(h),
          fill: shadeColor(cat.color, idx, sameCat.length),
        });
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, fxRate]);

  const visibleHoldings =
    tab === "all" ? holdings : holdings.filter((h) => h.category === tab);

  /* ───── 데이터 초기화 / 내보내기 / 가져오기 ───── */
  async function resetAllData() {
    if (
      !window.confirm(
        "모든 데이터를 삭제합니다.\n(보유 종목, 거래 내역, 목표 배분 모두 삭제)\n진행할까요?"
      )
    )
      return;
    // holdings 삭제 시 CASCADE로 transactions도 함께 삭제됨
    for (const h of holdingsRawDb) {
      await removeHoldingRemote(h.id);
    }
    setCurrentPrices({});
    await saveTarget({ kr: 30, us: 50, crypto: 20 });
    await saveFxRate(1380);
  }

  function exportJSON() {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      holdings: holdingsRaw,
      transactions,
      target,
      fxRate,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `asset_dashboard_backup_${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const stagedHoldingIds = [];
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.holdings) || !Array.isArray(data.transactions))
          throw new Error("형식 오류");
        if (
          !window.confirm(
            `백업에서 ${data.holdings.length}개 종목, ${data.transactions.length}개 거래를 가져옵니다.\n\n` +
            `성공 시 현재 데이터는 모두 교체됩니다. 중간에 실패하면 기존 데이터는 그대로 유지되고 새로 추가된 항목만 정리됩니다.\n\n` +
            `진행할까요?`
          )
        )
          return;

        // 1) 새 holdings + transactions를 먼저 모두 stage
        const idMap = new Map();
        for (const h of data.holdings) {
          const created = await addHoldingRemote({
            category: h.category,
            symbol: h.symbol,
            name: h.name,
          });
          idMap.set(h.id, created.id);
          stagedHoldingIds.push(created.id);
        }
        for (const t of data.transactions) {
          const newHoldingId = idMap.get(t.holdingId);
          if (newHoldingId == null) continue;
          await addTransactionRemote({
            holdingId: newHoldingId,
            type: t.type,
            quantity: t.quantity,
            price: t.price,
            date: t.date,
            fee: t.fee || 0,
          });
        }

        // 2) 신규 stage 성공. 이제 기존 데이터 삭제 (스테이징 시점 스냅샷 사용).
        const oldHoldings = holdingsRawDb.filter((h) => !stagedHoldingIds.includes(h.id));
        for (const h of oldHoldings) {
          await removeHoldingRemote(h.id);
        }
        setCurrentPrices({});

        // 3) settings는 안전 (overwrite)
        if (data.target) await saveTarget(data.target);
        if (data.fxRate) await saveFxRate(data.fxRate);
      } catch (err) {
        // 신규 stage 도중 실패 → 추가된 부분만 롤백, 기존 유지
        for (const id of stagedHoldingIds) {
          try { await removeHoldingRemote(id); } catch {}
        }
        alert("가져오기 실패: " + err.message + "\n기존 데이터는 유지되었습니다.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  /* ───── 사용자에게 보이는 에러 헬퍼 ───── */
  function pushError(msg) {
    setErrors((prev) => [...prev, msg]);
    setTimeout(() => setErrors((prev) => prev.slice(1)), 5000);
  }

  /* ───── 거래 CRUD ───── */
  async function addTransaction(tx) {
    try {
      await addTransactionRemote(tx);
    } catch (e) {
      pushError("거래 추가 실패: " + (e.message || "알 수 없는 오류"));
      throw e; // 호출자(폼)가 인지하도록 재던짐
    }
  }
  async function updateTransaction(id, patch) {
    try {
      await updateTransactionRemote(id, patch);
    } catch (e) {
      pushError("거래 수정 실패: " + (e.message || "알 수 없는 오류"));
      throw e;
    }
  }
  async function deleteTransaction(id) {
    if (!window.confirm("이 거래를 삭제할까요?")) return;
    try {
      await removeTransactionRemote(id);
    } catch (e) {
      pushError("거래 삭제 실패: " + (e.message || "알 수 없는 오류"));
    }
  }

  /* ───── 종목 CRUD ───── */
  async function addHolding({ category, symbol, name, initialQuantity, initialPrice, initialDate }) {
    try {
      const created = await addHoldingRemote({ category, symbol, name });
      if (initialQuantity > 0 && initialPrice > 0) {
        await addTransactionRemote({
          holdingId: created.id,
          type: "buy",
          quantity: initialQuantity,
          price: initialPrice,
          date: initialDate || new Date().toISOString().slice(0, 10),
          fee: 0,
        });
      }
    } catch (e) {
      pushError("종목 추가 실패: " + (e.message || "알 수 없는 오류"));
      throw e;
    }
  }
  async function deleteHolding(id) {
    if (!window.confirm("이 종목과 관련 거래 내역을 모두 삭제합니다.")) return;
    try {
      await removeHoldingRemote(id);
      setCurrentPrices((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e) {
      pushError("종목 삭제 실패: " + (e.message || "알 수 없는 오류"));
    }
  }

  const txDetailHolding = holdings.find((h) => h.id === txDetailHoldingId);

  if (holdingsLoading || transactionsLoading || settingsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0e1a] text-slate-400 text-sm">
        데이터 로딩 중…
      </div>
    );
  }

  // 신규 사용자: holdings가 0이면 차트/뉴스 숨기고 환영 화면만 표시
  const isEmpty = holdingsRawDb.length === 0;

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
        <header className="flex items-end justify-between mb-10 gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-2">
              Personal Portfolio · {new Date().toLocaleDateString("ko-KR")}
            </div>
            <h1 className="font-display text-5xl font-medium leading-none">
              자산관리<span className="text-amber-400">.</span>
            </h1>
          </div>
          {/* 햄버거 (모바일) */}
          <button
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="sm:hidden flex items-center justify-center w-10 h-10 rounded-full border border-slate-700 hover:border-slate-500 transition"
            aria-label={mobileMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>

          {/* 데스크탑 가로 정렬 (sm 이상) */}
          <div className="hidden sm:flex items-center gap-2 flex-wrap">
            <button
              onClick={exportJSON}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-slate-700 hover:border-slate-500 text-xs transition"
              title="JSON으로 백업"
            >
              <Download size={13} /> 내보내기
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-slate-700 hover:border-slate-500 text-xs transition"
              title="JSON 백업 복원"
            >
              <Upload size={13} /> 가져오기
            </button>
            <button
              onClick={resetAllData}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-rose-900/60 hover:border-rose-700 text-xs text-rose-300 transition"
              title="모든 데이터 삭제"
            >
              <RotateCcw size={13} /> 초기화
            </button>
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
            {user && (
              <>
                {isAdminEmail(user.email) && (
                  <button
                    onClick={() => navigate("/admin/feedback")}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-amber-500 text-amber-400 hover:bg-amber-500/10 text-xs transition"
                    title="피드백 관리"
                  >
                    Admin
                  </button>
                )}
                <button
                  onClick={signOut}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-slate-700 hover:border-slate-500 text-xs transition"
                  title="로그아웃"
                >
                  {user.email} · 로그아웃
                </button>
              </>
            )}
          </div>

          {/* 공유 파일 input — 헤더 최상위 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={importJSON}
          />
        </header>

        {/* 모바일 메뉴 dropdown */}
        {mobileMenuOpen && (
          <div className="sm:hidden bg-slate-900/95 border border-slate-800 rounded-2xl p-2 mb-6 flex flex-col">
            <button
              onClick={() => { exportJSON(); setMobileMenuOpen(false); }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm hover:bg-slate-800 w-full text-left transition"
            >
              <Download size={14} /> 내보내기
            </button>
            <button
              onClick={() => { fileInputRef.current?.click(); setMobileMenuOpen(false); }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm hover:bg-slate-800 w-full text-left transition"
            >
              <Upload size={14} /> 가져오기
            </button>
            <button
              onClick={() => { resetAllData(); setMobileMenuOpen(false); }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-rose-300 hover:bg-rose-500/10 w-full text-left transition"
            >
              <RotateCcw size={14} /> 초기화
            </button>
            <button
              onClick={() => { setShowTarget(true); setMobileMenuOpen(false); }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm hover:bg-slate-800 w-full text-left transition"
            >
              <Target size={14} /> 목표 배분
            </button>
            <button
              onClick={() => { refreshAll(); setMobileMenuOpen(false); }}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm bg-slate-100 text-slate-900 hover:bg-white font-medium w-full text-left transition disabled:opacity-50 mt-1"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {loading ? "조회중..." : "시세 새로고침"}
            </button>
            {user && (
              <>
                {isAdminEmail(user.email) && (
                  <button
                    onClick={() => { navigate("/admin/feedback"); setMobileMenuOpen(false); }}
                    className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-amber-400 hover:bg-amber-500/10 w-full text-left transition mt-1"
                  >
                    Admin
                  </button>
                )}
                <button
                  onClick={() => { signOut(); setMobileMenuOpen(false); }}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs hover:bg-slate-800 w-full text-left transition border-t border-slate-800 mt-1 pt-3"
                >
                  {user.email} · 로그아웃
                </button>
              </>
            )}
          </div>
        )}

        {/* 마지막 업데이트 & 에러 */}
        <div className="mb-8 flex items-center gap-3 text-xs flex-wrap">
          {lastUpdated && (
            <span className="flex items-center gap-1.5 text-slate-500">
              <CheckCircle2 size={12} className="text-emerald-400" />
              마지막 업데이트 {lastUpdated.toLocaleTimeString("ko-KR")} · USD/KRW{" "}
              {formatNumber(fxRate, 2)}
            </span>
          )}
          {errors.length > 0 && (
            <div className="flex flex-col gap-1 w-full mt-1">
              {errors.map((msg, i) => (
                <span
                  key={i}
                  className="flex items-start gap-1.5 text-amber-400 text-[11px] bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1"
                >
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />
                  <span className="break-all">{msg}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 상단 요약 카드 */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          <SummaryCard
            icon={<Wallet size={12} />}
            label="총 자산 (KRW 환산)"
            value={formatKRW(totals.totalEval)}
          />
          <SummaryCard
            label="평가손익"
            value={`${totals.pnl >= 0 ? "+" : ""}${formatKRW(totals.pnl)}`}
            tone={totals.pnl >= 0 ? "emerald" : "rose"}
          />
          <SummaryCard
            label="실현손익 (누적)"
            value={`${totals.totalRealized >= 0 ? "+" : ""}${formatKRW(
              totals.totalRealized
            )}`}
            tone={totals.totalRealized >= 0 ? "emerald" : "rose"}
          />
          <SummaryCard
            label="수익률"
            value={
              <span className="flex items-center gap-2">
                {totals.pnlRate >= 0 ? (
                  <TrendingUp size={28} />
                ) : (
                  <TrendingDown size={28} />
                )}
                {totals.pnlRate >= 0 ? "+" : ""}
                {totals.pnlRate.toFixed(2)}%
              </span>
            }
            tone={totals.pnlRate >= 0 ? "emerald" : "rose"}
          />
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

        {/* 통합 탭: 차트 그리드 — 빈 상태에서는 숨김 */}
        {tab === "all" && !isEmpty && (
          <>
            {/* 1단: 파이 + 목표vs실제 */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <ChartCard title="카테고리별 비중">
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
                          <Cell
                            key={k}
                            fill={CATEGORIES[k].color}
                            stroke="none"
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={tooltipStyle}
                        itemStyle={{ color: "#fbbf24" }}
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
                          ? (
                              (totals.byCat[k] / totals.totalEval) *
                              100
                            ).toFixed(1)
                          : 0}
                        %
                      </span>
                    </div>
                  ))}
                </div>
              </ChartCard>

              <ChartCard title="목표 vs 실제 배분">
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
              </ChartCard>
            </section>

            {/* 2단: 월별 추이 + 트리맵 */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
              <ChartCard title="월별 평가금액 추이 (최근 12개월)">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={monthlySeries}
                      margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#1e293b"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="month"
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                      />
                      <YAxis
                        stroke="#64748b"
                        fontSize={11}
                        tickLine={false}
                        tickFormatter={(v) => formatKRWShort(v)}
                        width={60}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v) => formatKRW(v)}
                        labelStyle={{ color: "#cbd5e1" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#fbbf24"
                        strokeWidth={2}
                        dot={{ fill: "#fbbf24", r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                  ※ 각 월말 시점의 보유수량 × 현재가 기준 근사값입니다.
                </p>
              </ChartCard>

              <ChartCard title="종목별 비중 (트리맵)">
                <div className="h-64">
                  {treemapData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-500">
                      평가 가능한 종목이 없습니다.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <Treemap
                        data={treemapData}
                        dataKey="size"
                        stroke="#0a0e1a"
                        content={<TreemapCell />}
                      >
                        <Tooltip
                          contentStyle={tooltipStyle}
                          itemStyle={{ color: "#fbbf24" }}
                          formatter={(v) => formatKRW(v)}
                        />
                      </Treemap>
                    </ResponsiveContainer>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                  같은 카테고리는 같은 색 계열, 큰 종목일수록 큰 사각형.
                </p>
              </ChartCard>
            </section>
          </>
        )}

        {/* 뉴스 + AI 분석 — 빈 상태에서는 호출 안 함 (AI quota 보존) */}
        {!isEmpty && <NewsSection holdings={holdingsRaw} activeTab={tab} />}

        {isEmpty && (
          <section className="bg-slate-900/40 border border-slate-800 rounded-2xl p-10 mb-10 text-center">
            <Wallet size={36} className="mx-auto text-amber-400 mb-4" />
            <h2 className="text-xl font-semibold mb-2">환영합니다 👋</h2>
            <p className="text-sm text-slate-400 mb-6">
              아직 등록된 종목이 없습니다. 첫 종목을 추가해 시작하세요.
              <br />
              한국 주식, 미국 주식, 코인을 한 곳에서 관리할 수 있습니다.
            </p>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-amber-500 text-slate-950 font-medium hover:bg-amber-400 transition"
            >
              <Plus size={16} /> 첫 종목 추가하기
            </button>
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
              <div className="hidden sm:grid grid-cols-12 gap-3 px-6 py-3 text-[11px] uppercase tracking-wider text-slate-500">
                <div className="col-span-4">종목</div>
                <div className="col-span-2 text-right">수량</div>
                <div className="col-span-2 text-right">평단</div>
                <div className="col-span-2 text-right">현재가</div>
                <div className="col-span-2 text-right">손익률</div>
              </div>
              {visibleHoldings.map((h) => (
                <HoldingRow
                  key={h.id}
                  h={h}
                  fxRate={fxRate}
                  onOpenDetail={() => setTxDetailHoldingId(h.id)}
                  onRefresh={() => refreshOne(h.id)}
                  onDelete={() => deleteHolding(h.id)}
                  onManualPrice={(price) => {
                    setCurrentPrices((prev) => ({ ...prev, [h.id]: price }));
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <div className="flex justify-center mb-6">
          <button
            onClick={() => setShowFeedback(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-slate-700 text-slate-300 hover:border-amber-500 hover:text-amber-400 text-sm transition"
          >
            <MessageSquare size={14} />
            피드백 보내기
          </button>
        </div>

        <footer className="text-[11px] text-slate-600 text-center leading-relaxed">
          시세 데이터: 백엔드{" "}
          <code className="text-slate-500">{API_BASE || "/api (vite proxy)"}</code>{" "}
          (Yahoo Finance / KIS Developers) · 환율 USD/KRW
          <br />
          데이터는 Supabase Postgres에 본인 계정 단위로 저장됩니다.
        </footer>
      </div>

      {/* 종목 추가 모달 */}
      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onAdd={async (item) => {
            await addHolding(item);
            setShowAdd(false);
          }}
        />
      )}

      {/* 피드백 모달 */}
      {showFeedback && (
        <FeedbackModal onClose={() => setShowFeedback(false)} />
      )}

      {/* 목표 배분 모달 */}
      {showTarget && (
        <TargetModal
          target={target}
          onClose={() => setShowTarget(false)}
          onSave={async (t) => {
            await saveTarget(t);
            setShowTarget(false);
          }}
        />
      )}

      {/* 거래 내역 상세 모달 */}
      {txDetailHolding && (
        <TransactionsModal
          holding={txDetailHolding}
          transactions={transactions.filter(
            (t) => t.holdingId === txDetailHolding.id
          )}
          fxRate={fxRate}
          evalKRW={evalKRW}
          costKRW={costKRW}
          totalBuyKRW={totalBuyKRW}
          realizedKRW={realizedKRW}
          onClose={() => setTxDetailHoldingId(null)}
          onAdd={(tx) => addTransaction({ ...tx, holdingId: txDetailHolding.id })}
          onUpdate={updateTransaction}
          onDelete={deleteTransaction}
        />
      )}
    </div>
  );
}

/* ───────── 헬퍼: 차트 카드 ───────── */
function ChartCard({ title, children }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
      <h3 className="text-sm text-slate-400 mb-4">{title}</h3>
      {children}
    </div>
  );
}

const tooltipStyle = {
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: "8px",
  fontSize: "12px",
};

/* ───────── 헬퍼: 요약 카드 ───────── */
function SummaryCard({ icon, label, value, tone }) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-400"
      : tone === "rose"
      ? "text-rose-400"
      : "";
  return (
    <div className="bg-gradient-to-br from-slate-900/80 to-slate-950 border border-slate-800 rounded-2xl p-6">
      <div className="text-xs text-slate-500 mb-2 flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className={`font-display text-3xl tabular ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

/* ───────── 헬퍼: 트리맵 셀 렌더 ───────── */
function TreemapCell(props) {
  const { x, y, width, height, name, symbol, fill, value } = props;
  if (width < 2 || height < 2) return null;
  const showLabel = width > 60 && height > 30;
  const showSymbol = width > 80 && height > 50;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{ fill: fill || "#475569", stroke: "#0a0e1a", strokeWidth: 2 }}
      />
      {showLabel && (
        <text
          x={x + 8}
          y={y + 18}
          fill="#0a0e1a"
          fontSize={12}
          fontWeight={600}
        >
          {name}
        </text>
      )}
      {showSymbol && (
        <text
          x={x + 8}
          y={y + 34}
          fill="#0a0e1a"
          fontSize={10}
          opacity={0.7}
        >
          {symbol}
        </text>
      )}
    </g>
  );
}

/* ───────── 보유 종목 행 ───────── */
function HoldingRow({ h, fxRate, onOpenDetail, onRefresh, onDelete, onManualPrice }) {
  const c = CATEGORIES[h.category];
  const pnlRate =
    h.currentPrice != null && h.avgPrice > 0
      ? ((h.currentPrice - h.avgPrice) / h.avgPrice) * 100
      : null;
  const ev = h.currentPrice != null && h.quantity > 0
    ? h.currentPrice * h.quantity * (h.category === "kr" ? 1 : fxRate)
    : null;
  const co = h.quantity > 0
    ? h.avgPrice * h.quantity * (h.category === "kr" ? 1 : fxRate)
    : 0;
  const pnl = ev != null ? ev - co : null;
  const totalBuy = h.totalBuyAmount * (h.category === "kr" ? 1 : fxRate);
  const realized = h.realizedPnL * (h.category === "kr" ? 1 : fxRate);
  const isSoldOut = h.quantity === 0 && h.totalBuyAmount > 0;

  return (
    <div className="hover:bg-slate-900/40 transition group">
      <div className="flex flex-col gap-2 px-6 pt-4 sm:grid sm:grid-cols-12 sm:gap-3 sm:items-center">
        <button
          onClick={onOpenDetail}
          className="sm:col-span-4 flex items-center gap-3 text-left"
        >
          <span
            className="w-1 h-8 rounded-full"
            style={{ background: c.color }}
          />
          <div>
            <div className="font-medium group-hover:text-amber-300 transition flex items-center gap-2">
              {h.name}
              {isSoldOut && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                  전량매도
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 tabular">
              {h.symbol} · {c.label}
            </div>
          </div>
        </button>
        <div className="flex justify-between sm:block sm:col-span-2 sm:text-right tabular text-sm">
          <span className="sm:hidden text-xs text-slate-500">수량</span>
          <span>{formatNumber(h.quantity, h.category === "crypto" ? 4 : 0)}</span>
        </div>
        <div className="flex justify-between sm:block sm:col-span-2 sm:text-right tabular text-sm text-slate-400">
          <span className="sm:hidden text-xs text-slate-500">평단</span>
          <span>
            {c.suffix}
            {formatNumber(
              h.avgPrice,
              h.category === "crypto" ? 2 : h.category === "us" ? 2 : 0
            )}
          </span>
        </div>
        <div className="flex justify-between sm:block sm:col-span-2 sm:text-right tabular text-sm">
          <span className="sm:hidden text-xs text-slate-500">현재가</span>
          <span>
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
                const v = prompt(`${h.symbol} 현재가 수동 입력 (${c.suffix})`);
                const n = parseFloat(v);
                if (!Number.isNaN(n)) onManualPrice(n);
              }}
              className="text-xs text-amber-400 hover:underline"
            >
              수동 입력
            </button>
          )}
          </span>
        </div>
        <div className="flex justify-between items-center sm:col-span-2 sm:justify-end gap-2">
          <span className="sm:hidden text-xs text-slate-500">손익률</span>
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
            onClick={onOpenDetail}
            className="opacity-60 group-hover:opacity-100 transition p-1 text-slate-500 hover:text-slate-200"
            title="거래 내역"
          >
            <History size={12} />
          </button>
          <button
            onClick={onRefresh}
            className="opacity-60 group-hover:opacity-100 transition p-1 text-slate-500 hover:text-slate-200"
            title="시세 갱신"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={onDelete}
            className="opacity-60 group-hover:opacity-100 transition p-1 text-slate-500 hover:text-rose-400"
            title="삭제"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {/* 서브 라인: 총 매수금액 / 실현손익 / 평가손익 */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 px-6 pb-4 pt-1.5 text-[11px] text-slate-500">
        <div className="hidden sm:block sm:col-span-4" />
        <div className="sm:col-span-8 flex flex-wrap justify-between sm:justify-end gap-4 tabular">
          <span>
            총 매수{" "}
            <span className="text-slate-300">{formatKRWShort(totalBuy)}</span>
          </span>
          <span>
            실현{" "}
            <span
              className={
                realized > 0
                  ? "text-emerald-400"
                  : realized < 0
                  ? "text-rose-400"
                  : "text-slate-400"
              }
            >
              {realized >= 0 ? "+" : ""}
              {formatKRWShort(realized)}
            </span>
          </span>
          <span>
            평가손익{" "}
            <span
              className={
                pnl == null
                  ? "text-slate-400"
                  : pnl >= 0
                  ? "text-emerald-400"
                  : "text-rose-400"
              }
            >
              {pnl == null ? "—" : (pnl >= 0 ? "+" : "") + formatKRWShort(pnl)}
            </span>
          </span>
        </div>
      </div>
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
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    if (!symbol || !name || !quantity || !avgPrice || submitting) return;
    setSubmitting(true);
    try {
      await onAdd({
        category,
        symbol: symbol.trim(),
        name: name.trim(),
        initialQuantity: parseFloat(quantity),
        initialPrice: parseFloat(avgPrice),
        initialDate: date,
      });
    } finally {
      setSubmitting(false);
    }
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
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 mb-2 block">
              카테고리
            </label>
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

          <p className="text-[11px] text-slate-500 leading-relaxed">
            {hints[category]}
          </p>

          <div className="border-t border-slate-800 pt-4">
            <div className="text-xs text-slate-400 mb-3">초기 매수 거래</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 mb-2 block">수량</label>
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
                <label className="text-xs text-slate-500 mb-2 block">
                  매수가 ({CATEGORIES[category].suffix})
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
            <div className="mt-3">
              <label className="text-xs text-slate-500 mb-2 block">매수일</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:border-amber-400 outline-none tabular"
              />
            </div>
          </div>

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full mt-2 py-3 bg-amber-400 text-slate-950 rounded-lg font-medium hover:bg-amber-300 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "추가하는 중…" : "추가하기"}
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
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200"
          >
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

/* ───────── 거래 내역 모달 ───────── */
function TransactionsModal({
  holding,
  transactions,
  fxRate,
  evalKRW,
  costKRW,
  totalBuyKRW,
  realizedKRW,
  onClose,
  onAdd,
  onUpdate,
  onDelete,
}) {
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState("transactions"); // transactions | analysis
  const c = CATEGORIES[holding.category];

  const sorted = transactions
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const ev = evalKRW(holding);
  const co = costKRW(holding);
  const tb = totalBuyKRW(holding);
  const rz = realizedKRW(holding);
  const pnl = ev != null ? ev - co : null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl p-7 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span
                className="w-1 h-7 rounded-full"
                style={{ background: c.color }}
              />
              <h2 className="font-display text-2xl">{holding.name}</h2>
            </div>
            <div className="text-xs text-slate-500 tabular ml-4">
              {holding.symbol} · {c.label}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200"
          >
            <X size={20} />
          </button>
        </div>

        {/* 요약 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <MiniStat
            label="보유 수량"
            value={formatNumber(
              holding.quantity,
              holding.category === "crypto" ? 4 : 0
            )}
          />
          <MiniStat
            label="평단"
            value={`${c.suffix}${formatNumber(
              holding.avgPrice,
              holding.category === "kr" ? 0 : 2
            )}`}
          />
          <MiniStat label="총 매수금액" value={formatKRWShort(tb)} />
          <MiniStat
            label="실현손익"
            value={`${rz >= 0 ? "+" : ""}${formatKRWShort(rz)}`}
            tone={rz > 0 ? "emerald" : rz < 0 ? "rose" : null}
          />
          <MiniStat
            label="평가손익"
            value={pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}${formatKRWShort(pnl)}`}
            tone={pnl == null ? null : pnl >= 0 ? "emerald" : "rose"}
          />
          <MiniStat
            label="현재가"
            value={
              holding.currentPrice != null
                ? `${c.suffix}${formatNumber(
                    holding.currentPrice,
                    holding.category === "kr" ? 0 : 2
                  )}`
                : "—"
            }
          />
          <MiniStat
            label="평가금액 (KRW)"
            value={ev == null ? "—" : formatKRWShort(ev)}
          />
          <MiniStat label="거래 수" value={transactions.length.toString()} />
        </div>

        {/* 탭 바 */}
        <div className="flex items-center gap-1 mb-5 border-b border-slate-800">
          <button
            onClick={() => setTab("transactions")}
            className={`px-4 py-2 text-sm transition border-b-2 -mb-px ${
              tab === "transactions"
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            거래 내역
          </button>
          <button
            onClick={() => setTab("analysis")}
            className={`px-4 py-2 text-sm transition border-b-2 -mb-px ${
              tab === "analysis"
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            차트 & 분석
          </button>
        </div>

        {tab === "transactions" && (
          <>
        {/* 거래 추가/리스트 */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm text-slate-300">거래 내역</h3>
          {!adding && !editingId && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full bg-amber-400 text-slate-950 font-medium hover:bg-amber-300 transition"
            >
              <Plus size={12} /> 거래 추가
            </button>
          )}
        </div>

        {adding && (
          <TransactionForm
            category={holding.category}
            onCancel={() => setAdding(false)}
            onSubmit={async (tx) => {
              try {
                await onAdd(tx);
                setAdding(false);
              } catch {
                // 부모가 toast 표시. 폼은 열린 채로 유지해 재시도 가능.
              }
            }}
          />
        )}

        {sorted.length === 0 && !adding && (
          <div className="py-10 text-center text-sm text-slate-500">
            거래가 없습니다.
          </div>
        )}

        <div className="space-y-2">
          {sorted.map((tx) =>
            editingId === tx.id ? (
              <TransactionForm
                key={tx.id}
                category={holding.category}
                initial={tx}
                onCancel={() => setEditingId(null)}
                onSubmit={async (patch) => {
                  try {
                    await onUpdate(tx.id, patch);
                    setEditingId(null);
                  } catch {
                    // 부모가 toast. 폼 유지.
                  }
                }}
              />
            ) : (
              <TransactionRow
                key={tx.id}
                tx={tx}
                category={holding.category}
                onEdit={() => setEditingId(tx.id)}
                onDelete={() => onDelete(tx.id)}
              />
            )
          )}
        </div>
          </>
        )}

        {tab === "analysis" && <StockAnalysis holding={holding} />}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-400"
      : tone === "rose"
      ? "text-rose-400"
      : "text-slate-100";
  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={`tabular text-sm font-medium ${toneClass}`}>{value}</div>
    </div>
  );
}

function TransactionRow({ tx, category, onEdit, onDelete }) {
  const c = CATEGORIES[category];
  const total = tx.price * tx.quantity + (tx.fee || 0);
  const isBuy = tx.type === "buy";
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-slate-950/40 border border-slate-800 rounded-lg group hover:border-slate-700 transition">
      <div
        className={`flex items-center gap-2 w-20 text-xs font-medium ${
          isBuy ? "text-emerald-400" : "text-rose-400"
        }`}
      >
        {isBuy ? <ArrowDownCircle size={14} /> : <ArrowUpCircle size={14} />}
        {isBuy ? "매수" : "매도"}
      </div>
      <div className="flex-1 grid grid-cols-3 gap-3 text-xs tabular">
        <div>
          <div className="text-slate-500 text-[10px]">수량</div>
          <div className="text-slate-200">
            {formatNumber(tx.quantity, category === "crypto" ? 4 : 0)}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[10px]">가격</div>
          <div className="text-slate-200">
            {c.suffix}
            {formatNumber(tx.price, category === "kr" ? 0 : 2)}
          </div>
        </div>
        <div>
          <div className="text-slate-500 text-[10px]">금액</div>
          <div className="text-slate-200">
            {c.suffix}
            {formatNumber(total, category === "kr" ? 0 : 2)}
          </div>
        </div>
      </div>
      <div className="text-xs text-slate-500 tabular w-24 text-right">
        {tx.date}
        {tx.fee > 0 && (
          <div className="text-[10px] text-slate-600">
            수수료 {c.suffix}
            {formatNumber(tx.fee, category === "kr" ? 0 : 2)}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
        <button
          onClick={onEdit}
          className="p-1.5 text-slate-500 hover:text-slate-200"
          title="수정"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-slate-500 hover:text-rose-400"
          title="삭제"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function TransactionForm({ category, initial, onSubmit, onCancel }) {
  const [type, setType] = useState(initial?.type || "buy");
  const [quantity, setQuantity] = useState(initial?.quantity?.toString() || "");
  const [price, setPrice] = useState(initial?.price?.toString() || "");
  const [date, setDate] = useState(
    initial?.date || new Date().toISOString().slice(0, 10)
  );
  const [fee, setFee] = useState(initial?.fee?.toString() || "0");
  const c = CATEGORIES[category];

  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    const q = parseFloat(quantity);
    const p = parseFloat(price);
    const f = parseFloat(fee) || 0;
    if (!q || !p || !date || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ type, quantity: q, price: p, date, fee: f });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-slate-950/60 border border-amber-400/40 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setType("buy")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
            type === "buy"
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/50"
              : "border border-slate-700 text-slate-400"
          }`}
        >
          <ArrowDownCircle size={12} /> 매수
        </button>
        <button
          onClick={() => setType("sell")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
            type === "sell"
              ? "bg-rose-500/20 text-rose-300 border border-rose-500/50"
              : "border border-slate-700 text-slate-400"
          }`}
        >
          <ArrowUpCircle size={12} /> 매도
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">수량</label>
          <input
            type="number"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs focus:border-amber-400 outline-none tabular"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">
            가격 ({c.suffix})
          </label>
          <input
            type="number"
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs focus:border-amber-400 outline-none tabular"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">
            수수료 ({c.suffix})
          </label>
          <input
            type="number"
            step="any"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs focus:border-amber-400 outline-none tabular"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 mb-1 block">날짜</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs focus:border-amber-400 outline-none tabular"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="px-3 py-1.5 bg-amber-400 text-slate-950 rounded text-xs font-medium hover:bg-amber-300 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "저장 중…" : "저장"}
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          className="px-3 py-1.5 border border-slate-700 text-slate-400 rounded text-xs hover:border-slate-500 transition disabled:opacity-50"
        >
          취소
        </button>
      </div>
    </div>
  );
}
