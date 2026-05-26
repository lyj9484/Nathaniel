# News + AI Analysis Feature — Design Spec

**Date**: 2026-05-25
**Status**: Approved by user, ready for implementation plan
**Target**: `client/` (Vite + React) + `server/` (Express)

## Goal

대시보드 접속 시 국장 / 미장 / 코인 3개 시장의 최신 뉴스를 가져오고,
사용자가 보유한 종목에 어떻게 영향을 미칠지 Claude API로 분석해 보여준다.

## Key Decisions

| 결정 | 선택 | 이유 |
|---|---|---|
| AI 제공자 | Anthropic Claude API | 사용자 선택 |
| 모델 | `claude-haiku-4-5-20251001` | 분류·요약 작업이라 Haiku로 충분, 비용 절감 |
| 캐시 TTL | 3600초 (1시간) | 비용·신선도 균형 |
| 뉴스 소스 | Google News RSS | API 키 불필요, 한국어 가능 |
| 분석 출력 | 시장별 요약 + 보유 종목 영향 | 구조화된 JSON으로 강제 |
| UI 위치 | 통합 탭, 차트 그리드 아래·보유 종목 위 | 사용자 선택 |
| 호출 구조 | 단일 endpoint, 1회 Claude 호출 | 비용 최저, 시장 간 관계 분석 가능 |

## Architecture

```
[Browser]
  ↓ POST /api/news  body: { holdings: [{symbol,name,category}] }
[Vite proxy] → [Express :3001]
  ↓
  ┌─ 캐시 확인 (key = holdings symbols 해시)
  │   hit → 즉시 반환
  │   miss → ↓
  ├─ Google News RSS 병렬 fetch (kr, us, crypto)
  │   각 시장 상위 5개 헤드라인 추출
  ├─ Claude API 호출 (1회, 시스템 프롬프트는 prompt caching)
  │   입력: 시장별 헤드라인 + 보유 종목 컨텍스트
  │   출력: 구조화 JSON
  └─ 캐시 저장 (TTL 1시간) → 반환
[Browser]
  ↓ 통합 탭 NewsSection 렌더
  3 시장 카드 × { 요약 / 헤드라인 리스트 / 보유 종목 영향 }
```

## Backend

### 새 파일

```
server/
├── news.js          ← Google News RSS 페처
├── analyze.js       ← Claude API 호출 + 프롬프트 구성
└── server.js        ← /api/news 라우트 추가
```

### `news.js` — RSS 페처

- 의존성: `rss-parser`
- 시장별 RSS 쿼리:
  - `kr`: `https://news.google.com/rss/search?q=코스피+OR+코스닥+OR+한국+증시&hl=ko&gl=KR&ceid=KR:ko`
  - `us`: `https://news.google.com/rss/search?q=US+stock+market+OR+S%26P+500+OR+Nasdaq&hl=en-US&gl=US&ceid=US:en`
  - `crypto`: `https://news.google.com/rss/search?q=비트코인+OR+이더리움+OR+암호화폐&hl=ko&gl=KR&ceid=KR:ko`
- 각 시장 최근 5개 헤드라인 (`title`, `link`, `pubDate`, `source`) 추출
- RSS 자체 캐시는 두지 않음 — 단일 사용자 환경에서 analyze 캐시(1h)가 이미 RSS 호출도 막아주므로 중복

### `analyze.js` — Claude 호출

- 의존성: `@anthropic-ai/sdk`
- 모델: `claude-haiku-4-5-20251001`
- Prompt caching: system 메시지(지시문)는 `cache_control: ephemeral` 지정 → 1시간 내 재호출 시 90% 할인
- JSON 출력 강제:
  - system 프롬프트에 구체적 JSON schema 명시
  - 응답에 `<json>...</json>` 태그로 감싸도록 지시 → 파싱 안정성
  - 파싱 실패 시 1회 재시도

### `/api/news` 라우트

- Method: **POST**
- Body: `{ holdings: [{ symbol, name, category }] }`
- Query: `?force=1` 시 캐시 무시
- 응답:
```json
{
  "fetchedAt": "2026-05-25T05:23:00.000Z",
  "markets": {
    "kr":     { "summary": "...", "headlines": [{title, link, source, pubDate}, ...], "impacts": [{symbol, name, direction, comment}, ...] },
    "us":     { "summary": "...", "headlines": [...], "impacts": [...] },
    "crypto": { "summary": "...", "headlines": [...], "impacts": [...] }
  }
}
```

`direction`: `"positive" | "negative" | "neutral"`

### 캐시 키 설계

- key: `news:` + 보유 종목 심볼을 정렬한 후 SHA1 8자리 해시
- TTL: 3600초
- 동작:
  - 같은 사용자가 새로고침 → 1시간 동안 동일 응답 (비용 0)
  - 종목 추가/삭제 → 키 변경 → 새 분석
  - 시간 만료 자연 무효화

### 에러 처리

| 케이스 | 처리 |
|---|---|
| `ANTHROPIC_API_KEY` 미설정 | 503 + `{ error: "ai_disabled" }` |
| RSS 1개 실패 | 그 시장만 빈 헤드라인, 다른 시장은 정상 진행 |
| Claude 응답 JSON 파싱 실패 | 재시도 1회, 그래도 실패면 500 + 원문 일부 로깅 |
| Claude rate limit / 5xx | 재시도 1회, 그래도 실패면 500 |

### 환경 변수

`server/.env.example`에 추가:
```
ANTHROPIC_API_KEY=
```

### 비용 추정

- 입력 토큰: 헤드라인 15개(~30 tok) + 보유 종목 10개(~20 tok) + 시스템 ~400 tok ≈ **1K tok**
  (프롬프트 캐싱으로 시스템 부분은 2회차부터 ~90% 할인)
- 출력 토큰: 3 markets × (요약 + 영향 N개) ≈ **0.8K tok**
- Haiku 4.5 가격: 입력 $1/M tok, 출력 $5/M tok
- **호출당 약 $0.005** (~7원 @ 1350 KRW/USD)
- 캐시 미스가 시간당 1회 발생한다고 가정 (사용자가 매 시간 접속):
  - 하루 24회 호출 = **약 170원/일** (상한)
  - 실제로는 접속 분포 따라 평균 30~80원/일 예상

## Frontend

### 파일 변경

```
client/src/
├── AssetDashboard.jsx       ← NewsSection import + 렌더 위치
└── NewsSection.jsx          ← 신규
```

### 호출 시점

- `AssetDashboard` 마운트 시 `useEffect`로 1회 자동 호출
- 시세 새로고침과 독립 (다른 캐시 페이스)
- 뉴스 섹션 우상단 ↻ 버튼 → `?force=1`로 캐시 무시 강제 갱신

### 컴포넌트 — `NewsSection`

Props:
- `holdings: [{symbol, name, category}]` — 백엔드에 보낼 컨텍스트
- `activeTab: "all" | "kr" | "us" | "crypto"` — 시장별 탭일 때 해당 카드만

내부 상태:
```js
const [data, setData] = useState(null);    // 응답
const [loading, setLoading] = useState(false);
const [error, setError] = useState(null);
```

### UI 레이아웃 (통합 탭)

```
┌─ 최근 시장 뉴스 & 영향 ─────────────  업데이트 14:23  [↻] ─┐
│ ┌─ 국장 ──────────┐ ┌─ 미장 ──────────┐ ┌─ 코인 ──────────┐ │
│ │ 시장 요약 2~3줄  │ │ 시장 요약 2~3줄   │ │ 시장 요약 2~3줄   │ │
│ │                  │ │                  │ │                  │ │
│ │ [헤드라인 5개]    │ │ [헤드라인 5개]    │ │ [헤드라인 5개]    │ │
│ │  · 제목 / 출처   │ │  · 제목 / 출처   │ │  · 제목 / 출처    │ │
│ │  ...              │ │  ...              │ │  ...              │ │
│ │                  │ │                  │ │                  │ │
│ │ 내 종목 영향      │ │ 내 종목 영향       │ │ 내 종목 영향       │ │
│ │ ▲ 삼성전자         │ │ ▲ AAPL            │ │ ▲ BTC             │ │
│ │   "코멘트"        │ │   "코멘트"        │ │   "코멘트"         │ │
│ │ ▼ 카카오          │ │ ─ NVDA            │ │                  │ │
│ └──────────────┘ └──────────────┘ └──────────────┘ │
└────────────────────────────────────────────────────────┘
```

- 가로 3카드 (lg), 모바일 stack
- 시장별 탭일 땐 해당 카드 1개만 보여줌

### 카드 구성

1. **헤더**: 시장 이름 + 카테고리 색 점
2. **요약** (`summary`): 2~3줄, italic, 회색
3. **헤드라인** (5개): 제목 클릭 시 새 탭, 작은 글자로 출처/시간
4. **내 종목 영향** (`impacts`):
   - 방향 아이콘: ▲ positive (emerald), ▼ negative (rose), ─ neutral (slate)
   - 종목명 + 한 줄 코멘트
   - 그 시장에 보유 종목 없으면 영역 자체 숨김

### 상태별 화면

| 상태 | 화면 |
|---|---|
| 로딩 (마운트 직후) | 3카드 자리 skeleton 회색 박스 |
| 에러 (`ai_disabled`) | "Anthropic API 키를 server/.env 에 추가하세요" |
| 에러 (그 외) | "분석 실패: {message}" + 재시도 버튼 |
| 보유 종목 0개 | 시장 요약 + 헤드라인만 (영향 영역 생략) |

## Out of Scope (이번 작업에서 제외)

- 종목별 개별 뉴스 (현재 디자인은 시장 단위)
- 스트리밍 응답 (요청-응답 단일 호출)
- 분석 히스토리 / 트렌드 저장
- 사용자별 알림 / 푸시
- 한국어 외 언어 선택 (UI 한국어 고정)

## 검증 방법

1. `ANTHROPIC_API_KEY` 없이 서버 기동 → 프론트에 "AI 비활성" 안내 노출
2. 키 설정 후 첫 호출 → Claude 응답 받아 3 카드 렌더
3. 1분 내 새로고침 → 캐시 히트, 같은 응답
4. 종목 추가/삭제 → 다른 캐시 키 → 새 분석
5. `?force=1` 호출 → 캐시 무시하고 새 응답
6. RSS 일부 실패 시뮬레이션 (예: 네트워크 차단) → 다른 시장은 정상
