import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  RefreshCw,
  AlertCircle,
  TrendingUp,
  Target,
  Thermometer,
  MapPin,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

const CATEGORY_COLORS = {
  kr: "#60a5fa",
  us: "#f472b6",
  crypto: "#fbbf24",
};

const VALUATION_LABEL = {
  overheated: { ko: "과열", color: "text-rose-400 bg-rose-500/10 border-rose-500/30" },
  neutral: { ko: "중립", color: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
  undervalued: { ko: "저평가", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
};

const ENTRY_LABEL = {
  buy_now: { ko: "매수 권장", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
  wait: { ko: "관망", color: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
  sell: { ko: "매도 고려", color: "text-rose-400 bg-rose-500/10 border-rose-500/30" },
};

function formatPrice(n, currency) {
  if (n == null) return "—";
  const symbol = currency === "KRW" ? "₩" : "$";
  return symbol + n.toLocaleString("ko-KR", {
    maximumFractionDigits: currency === "KRW" ? 0 : 2,
  });
}

function formatPercent(v) {
  if (v == null) return "—";
  const pct = v * 100;
  const sign = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? "text-emerald-400" : "text-rose-400";
  return <span className={color}>{sign}{pct.toFixed(2)}%</span>;
}

const PERIODS = [
  { key: "daily", label: "일" },
  { key: "weekly", label: "주" },
  { key: "monthly", label: "월" },
];

export default function StockAnalysis({ holding }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState("daily");

  async function load(force = false, periodOverride = null) {
    setLoading(true);
    setError(null);
    try {
      const p = periodOverride || period;
      const params = new URLSearchParams({ period: p });
      if (force) params.set("force", "1");
      const url = `${API_BASE}/api/stock/${encodeURIComponent(holding.symbol)}/analysis?${params.toString()}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: holding.name,
          category: holding.category,
          currentPrice: holding.currentPrice,
          avgPrice: holding.avgPrice,
          quantity: holding.quantity,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding.symbol, period]);

  if (error === "ai_disabled") {
    return (
      <div className="text-xs text-amber-400 flex items-center gap-2 py-8">
        <AlertCircle size={14} />
        AI 분석이 비활성 상태입니다. <code>server/.env</code>에 <code>OPENAI_API_KEY</code>를 설정하세요.
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-rose-400 flex items-center gap-2 py-8">
        <AlertCircle size={14} />
        분석 실패: {error}
        <button onClick={() => load(true)} className="ml-2 underline hover:text-rose-300">
          재시도
        </button>
      </div>
    );
  }

  const color = CATEGORY_COLORS[holding.category] || "#94a3b8";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 -mb-2">
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              disabled={loading}
              className={`px-3 py-1 text-xs rounded-full border transition ${
                period === p.key
                  ? "border-amber-400 bg-amber-400/10 text-amber-300"
                  : "border-slate-700 text-slate-400 hover:border-slate-500"
              } disabled:opacity-50`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {data?.fetchedAt && (
            <span>업데이트 {new Date(data.fetchedAt).toLocaleTimeString("ko-KR")}</span>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="p-1 text-slate-400 hover:text-slate-100 disabled:opacity-50"
            title="강제 새로고침"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {!data ? (
        <div className="space-y-3">
          <div className="h-48 bg-slate-800/40 rounded-lg animate-pulse" />
          <div className="h-20 bg-slate-800/40 rounded-lg animate-pulse" />
          <div className="h-32 bg-slate-800/40 rounded-lg animate-pulse" />
        </div>
      ) : (
        <>
          <ChartCard chart={data.chart} stats={data.stats} color={color} />
          <StatsBlock stats={data.stats} currency={data.chart.currency} />
          {data.analyst && <AnalystBlock analyst={data.analyst} currency={data.chart.currency} />}
          <AnalysisBlock analysis={data.analysis} currency={data.chart.currency} />
        </>
      )}
    </div>
  );
}

const CHART_HEADER = {
  daily: "6개월 차트 (일봉, MA20·MA60)",
  weekly: "2년 차트 (주봉, MA20·MA60)",
  monthly: "5년 차트 (월봉, MA20·MA60)",
};

function ChartCard({ chart, stats, color }) {
  const periodKey = chart.periodKey || "daily";
  const closes = chart.points.map((p) => p.close);
  const windowed = (k, idx) => {
    if (idx + 1 < k) return null;
    const slice = closes.slice(idx + 1 - k, idx + 1);
    return slice.reduce((a, b) => a + b, 0) / k;
  };
  const data = chart.points.map((p, i) => ({
    date: p.date,
    close: p.close,
    ma20: windowed(20, i),
    ma60: windowed(60, i),
  }));

  // tick 밀도: monthly는 연 단위, 그 외엔 월 단위
  const tickGroupOf =
    periodKey === "monthly" ? (d) => d.slice(0, 4) : (d) => d.slice(0, 7);
  const tickFormatter =
    periodKey === "monthly"
      ? (d) => d.slice(2, 4) + "년"
      : (d) => d.slice(5, 7) + "월";
  const ticks = [];
  let prev = "";
  data.forEach((d) => {
    const k = tickGroupOf(d.date);
    if (k !== prev) {
      ticks.push(d.date);
      prev = k;
    }
  });

  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
        {CHART_HEADER[periodKey] || CHART_HEADER.daily}
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="date"
              ticks={ticks}
              tickFormatter={tickFormatter}
              stroke="#64748b"
              fontSize={10}
              tickLine={false}
            />
            <YAxis
              stroke="#64748b"
              fontSize={10}
              tickLine={false}
              domain={["auto", "auto"]}
              width={50}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "6px",
                fontSize: "11px",
              }}
              labelStyle={{ color: "#cbd5e1" }}
            />
            <Line type="monotone" dataKey="close" stroke={color} strokeWidth={1.5} dot={false} name="종가" />
            <Line type="monotone" dataKey="ma20" stroke={color} strokeWidth={1} strokeOpacity={0.5} dot={false} name="MA20" />
            <Line type="monotone" dataKey="ma60" stroke={color} strokeWidth={1} strokeOpacity={0.3} dot={false} name="MA60" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatsBlock({ stats, currency }) {
  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">통계</div>
      <div className="grid grid-cols-3 gap-3 text-xs mb-2 tabular">
        <div>
          <div className="text-slate-500">현재</div>
          <div className="text-slate-100">{formatPrice(stats.current, currency)}</div>
        </div>
        <div>
          <div className="text-slate-500">6M 고</div>
          <div className="text-slate-300">{formatPrice(stats.high6m, currency)}</div>
        </div>
        <div>
          <div className="text-slate-500">6M 저</div>
          <div className="text-slate-300">{formatPrice(stats.low6m, currency)}</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3 text-xs tabular">
        <div>
          <div className="text-slate-500">1W</div>
          <div>{formatPercent(stats.return1w)}</div>
        </div>
        <div>
          <div className="text-slate-500">1M</div>
          <div>{formatPercent(stats.return1m)}</div>
        </div>
        <div>
          <div className="text-slate-500">3M</div>
          <div>{formatPercent(stats.return3m)}</div>
        </div>
        <div>
          <div className="text-slate-500">6M</div>
          <div>{formatPercent(stats.return6m)}</div>
        </div>
      </div>
    </div>
  );
}

function AnalystBlock({ analyst, currency }) {
  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
        애널리스트 컨센서스
      </div>
      <div className="flex items-baseline justify-between text-xs">
        <div>
          <span className="text-slate-500">목표가 평균</span>{" "}
          <span className="text-slate-100 font-medium">{formatPrice(analyst.targetMean, currency)}</span>
          <span className="text-slate-600 ml-2">
            ({formatPrice(analyst.targetLow, currency)} ~ {formatPrice(analyst.targetHigh, currency)})
          </span>
        </div>
        <div className="text-slate-500">
          {analyst.numAnalysts}명 · {analyst.recommendation || "—"}
        </div>
      </div>
    </div>
  );
}

function AnalysisBlock({ analysis, currency }) {
  const v = VALUATION_LABEL[analysis.valuation] || { ko: analysis.valuation, color: "text-slate-400" };
  const e = ENTRY_LABEL[analysis.entry] || { ko: analysis.entry, color: "text-slate-400" };
  const tp = analysis.targetPrice || {};
  return (
    <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-4 space-y-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">AI 분석</div>

      <div className="flex items-start gap-3 text-xs">
        <TrendingUp size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-slate-500 text-[10px] uppercase mb-0.5">추세</div>
          <div className="text-slate-200 leading-relaxed">{analysis.trend}</div>
        </div>
      </div>

      <div className="flex items-start gap-3 text-xs">
        <Target size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-slate-500 text-[10px] uppercase mb-0.5">AI 목표가</div>
          <div className="text-slate-200">
            {formatPrice(tp.low, currency)} ~ {formatPrice(tp.high, currency)}{" "}
            <span className="text-slate-500">(mid {formatPrice(tp.mid, currency)})</span>
          </div>
          <div className="text-slate-400 text-[11px] mt-1 leading-relaxed">{tp.rationale}</div>
        </div>
      </div>

      <div className="flex items-start gap-3 text-xs">
        <Thermometer size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-slate-500 text-[10px] uppercase mb-0.5">과열도</div>
          <span className={`inline-block px-2 py-0.5 rounded text-[10px] border ${v.color} mb-1`}>
            {v.ko}
          </span>
          <div className="text-slate-300 leading-relaxed">{analysis.valuationComment}</div>
        </div>
      </div>

      <div className="flex items-start gap-3 text-xs">
        <MapPin size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-slate-500 text-[10px] uppercase mb-0.5">진입 시점</div>
          <span className={`inline-block px-2 py-0.5 rounded text-[10px] border ${e.color} mb-1`}>
            {e.ko}
          </span>
          <div className="text-slate-300 leading-relaxed">{analysis.entryComment}</div>
        </div>
      </div>
    </div>
  );
}
