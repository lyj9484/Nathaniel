# Stock Chart + AI Analysis Feature — Design Spec

**Date**: 2026-05-25
**Status**: Approved by user, ready for implementation plan
**Target**: `client/` (Vite + React) + `server/` (Express)
**Predecessor**: News + AI Analysis (`2026-05-25-news-ai-analysis-design.md`)

## Goal

종목 행 클릭 시 거래 내역 모달에 "차트 & 분석" 탭을 추가한다. 6개월 일봉 차트, 통계, 애널리스트 컨센서스(주식), AI가 산정한 목표가·과열도·진입 시점 분석을 한 화면에 보여준다. 국장/미장/코인 모두 동일 UI, 데이터 소스만 차이.

## Key Decisions

| 결정 | 선택 | 이유 |
|---|---|---|
| 목표가 산정 | 애널리스트 컨센서스(Yahoo) + AI 자체 분석 둘 다 | 사용자 선택 |
| 클릭 동작 | 기존 거래 모달에 탭 추가 | 사용자 선택 — 새 모달 안 만들고 한 곳에서 |
| 차트 라이브러리 | 기존 recharts (LineChart) | 사용자 선택, 추가 의존성 없음 |
| AI 트리거 | 탭 첫 클릭 시 자동, 종목별 1h 캐시 | 사용자 선택 |
| 호출 구조 | 단일 endpoint `POST /api/stock/:symbol/analysis` | 뉴스 기능과 같은 패턴 |
| 적용 범위 | 국장/미장/**코인 모두** | 사용자 추가 요청 |

## Architecture

```
[종목 행 클릭]
  ↓
[거래 모달] → 탭 [거래 내역 | 차트 & 분석]
  ↓ (차트 & 분석 탭 첫 클릭)
  ↓ POST /api/stock/:symbol/analysis
  ↓ body: { name, category, currentPrice, avgPrice, quantity }
[Vite proxy → Express :3001]
  ↓
  ┌─ 캐시 확인 (key = stock:${symbol}, TTL 3600s)
  │   hit → 즉시 반환
  │   miss → ↓
  ├─ 병렬 fetch:
  │   • Yahoo historical (range=6mo, 일봉 close)
  │   • Yahoo analyst (주식만, 코인은 skip → null)
  ├─ 서버에서 통계 계산 (MA20, MA60, 6M 고/저, 1W/1M/3M/6M 수익률)
  ├─ OpenAI 호출 (gpt-4o-mini, 카테고리별 프롬프트):
  │   주식: 펀더멘털 + 기술적 + 컨센서스 비교
  │   코인: 기술적 + 모멘텀 + 변동성
  └─ 캐시 저장 → 반환
[프론트]
  ↓ recharts LineChart 렌더 (close + MA20 + MA60)
  ↓ 통계 / 애널리스트 / AI 분석 카드 표시
```

## API

### `POST /api/stock/:symbol/analysis`

**Request body:**
```json
{
  "name": "삼성전자",
  "category": "kr",
  "currentPrice": 68500,
  "avgPrice": 68000,
  "quantity": 50
}
```

**Query**: `?force=1` → 캐시 무시 강제 갱신

**Response:**
```json
{
  "fetchedAt": "2026-05-25T...",
  "chart": {
    "period": "6M",
    "currency": "KRW",
    "points": [
      { "date": "2025-11-25", "close": 63200 },
      { "date": "2025-11-26", "close": 63800 }
    ]
  },
  "stats": {
    "current": 68500,
    "ma20": 67800,
    "ma60": 65400,
    "high6m": 72300,
    "low6m": 61000,
    "return1w": 0.012,
    "return1m": 0.032,
    "return3m": 0.085,
    "return6m": 0.124
  },
  "analyst": {
    "targetMean": 88000,
    "targetHigh": 105000,
    "targetLow": 72000,
    "numAnalysts": 28,
    "recommendation": "buy"
  },
  "analysis": {
    "trend": "상승 추세, 최근 1개월 +3.2%",
    "targetPrice": {
      "low": 80000,
      "mid": 90000,
      "high": 100000,
      "rationale": "근거 한 줄"
    },
    "valuation": "neutral",
    "valuationComment": "한 문장",
    "entry": "wait",
    "entryComment": "한 문장"
  }
}
```

- `analyst`: 데이터 없을 시 `null` (코인 또는 일부 소형주)
- `analysis.valuation` enum: `overheated | neutral | undervalued`
- `analysis.entry` enum: `buy_now | wait | sell`

## Backend

### 파일 변경

```
server/
├── yahoo.js         ← MODIFY: fetchYahooHistorical, fetchYahooAnalyst 추가
├── analyze.js       ← MODIFY: analyzeStock 함수 추가
└── server.js        ← MODIFY: POST /api/stock/:symbol/analysis 라우트
```

신규 파일 없이 기존 모듈 확장. Yahoo 관련은 `yahoo.js`, AI 관련은 `analyze.js`로 응집 유지.

### `yahoo.js` 신규 함수

```js
export async function fetchYahooHistorical(symbol, range = "6mo")
// → { points: [{date: "YYYY-MM-DD", close: number}], currency: "KRW"|"USD" }
// 기존 chart endpoint를 range=6mo, interval=1d로 호출

export async function fetchYahooAnalyst(symbol)
// → { targetMean, targetHigh, targetLow, numAnalysts, recommendation } | null
// quoteSummary endpoint 시도, 실패 시 null
```

### `analyze.js` 신규 함수

```js
export async function analyzeStock({ holding, stats, history, analyst })
// → { trend, targetPrice, valuation, valuationComment, entry, entryComment }
```

**프롬프트 토큰 최적화**:
- 차트 6M = 약 125 일봉. 전부 보내면 ~900 토큰 → 비용 ↑
- AI에 보낼 데이터:
  - 계산된 통계 (current, MA20, MA60, 6M high/low, 1W/1M/3M/6M return)
  - 최근 30일 일봉만 raw
- 프론트에 보낼 차트: 125일 전체

### 시스템 프롬프트 (요지)

```
당신은 개인 투자자를 위한 종목 분석 어시스턴트입니다.
가격 시계열 통계 + (있으면) 애널리스트 데이터를 바탕으로
추세 / 목표가 / 과열도 / 진입 시점을 분석합니다.

JSON 스키마 강제: { analysis: { trend, targetPrice{low,mid,high,rationale}, valuation, valuationComment, entry, entryComment } }

규칙:
- 한국어
- 통화는 현재가와 동일
- 애널리스트 데이터 있으면 컨센서스와 자체 분석 비교
- valuation: fair value 대비 과열/정상/저평가
- entry: 지금 시점 액션 권장
- 코인은 펀더멘털 대신 기술적 흐름·모멘텀 위주
```

### 캐시

- 키: `stock:${symbol}`
- TTL: 3600s
- node-cache 인스턴스 재사용 (3-arg `cache.set(key, val, 3600)`)

### 에러 처리

| 케이스 | 처리 |
|---|---|
| OPENAI_API_KEY 미설정 | 503 `{error:"ai_disabled"}` |
| Yahoo historical 실패 | 502 — 차트 없으면 분석 불가 |
| Yahoo analyst 실패 | 무시 → `analyst: null` |
| OpenAI JSON 파싱 실패 | 1회 재시도 후 500 |

### 비용 추정

- 입력 ~1.5K tok / 출력 ~0.3K tok (gpt-4o-mini)
- 호출당 **~$0.0008 (~1.1원)**
- 1h 캐시 × 종목 10개 × 일 평균 2회 보기 = 20회/일 ≈ **22원/일 (상한)**

## Frontend

### 파일 변경

```
client/src/
├── AssetDashboard.jsx       ← TransactionsModal에 탭 추가
└── StockAnalysis.jsx        ← 신규 (차트 + 분석 영역)
```

### 모달 변경 (TransactionsModal)

- 기존 헤더 + 미니 stat 그리드 유지
- 그 아래 **탭 바**:
  - `거래 내역` (기본 활성)
  - `차트 & 분석`
- 탭 콘텐츠 영역에 active 탭에 따라 조건부 렌더
- 모달 열 때 기본 탭은 거래 내역 (기존 흐름 유지)

### `StockAnalysis.jsx` 컴포넌트

Props: `{ holding }` (symbol, name, category, currentPrice, avgPrice, quantity)

내부:
```js
const [data, setData] = useState(null);
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);

useEffect(() => { load(); }, [holding.symbol]);

async function load(force = false) { ... }
```

### 레이아웃

```
┌─ 차트 & 분석 탭 ──────────────────────┐
│ ── 6M 차트 ──                         │
│   recharts LineChart                  │
│   - close (진한 색, 카테고리 컬러)    │
│   - MA20 (50% 투명도)                 │
│   - MA60 (30% 투명도)                 │
│                                       │
│ ── 통계 ──                            │
│   현재 / 6M 고 / 6M 저                │
│   1W / 1M / 3M / 6M 수익률            │
│                                       │
│ ── 애널리스트 컨센서스 (있을 때만) ──   │
│   목표가 평균 + range                  │
│   애널리스트 수 + 추천 등급            │
│                                       │
│ ── AI 분석 ──                         │
│   📈 추세                              │
│   🎯 AI 목표가 (low/mid/high+근거)    │
│   🌡 과열도 (색상 칩)                  │
│   📍 진입 시점 (색상 칩)               │
└──────────────────────────────────────┘
```

### 색상 매핑 (enum → 색)

- `overheated` / `sell` → rose
- `neutral` / `wait` → amber
- `undervalued` / `buy_now` → emerald

### 상태별 화면

| 상태 | 화면 |
|---|---|
| 탭 진입 (loading) | 차트·분석 영역 skeleton |
| 정상 응답 | 위 레이아웃 |
| `ai_disabled` | 통째로 안내 메시지 ("OPENAI_API_KEY 설정 필요") |
| 그 외 에러 | rose 색 에러 + 재시도 버튼 |

> 단순화: 차트만 별도로 보여주는 부분 노력 안 함. 분석 endpoint가 차트도 함께 반환하므로 한 묶음으로 처리. 차트만 따로 빠르게 보고 싶으면 endpoint 분리 필요한데, YAGNI로 배제.

### 강제 새로고침

- 탭 우상단 ↻ 버튼 → `?force=1` 호출

## Out of Scope

- 기간 선택기 (1M/3M/6M/1Y 토글) — 6M 고정
- 캔들스틱 차트
- 거래량 표시
- 차트에 매수/매도 거래 마커 표시
- 종목별 알림/푸시
- 즐겨찾기/관심종목 분리

## 검증 방법

1. 백엔드만 재시작 후 `curl POST /api/stock/AAPL/analysis` → 정상 응답
2. `analyst` 필드: AAPL/NVDA 같은 미장 메이저는 채워짐, 코인은 null
3. 캐시 hit: 같은 심볼 즉시 재호출 → fetchedAt 동일, <100ms
4. `?force=1` → fetchedAt 갱신
5. UI: 삼성전자 행 클릭 → 거래 모달 → "차트 & 분석" 탭 클릭 → 차트 + 분석 카드 정상 렌더
6. 카테고리별 색상 (국장 파랑, 미장 핑크, 코인 노랑) 차트에 반영
7. 코인 (BTC-USD): `analyst` 카드 영역이 숨겨지고 나머지는 정상
