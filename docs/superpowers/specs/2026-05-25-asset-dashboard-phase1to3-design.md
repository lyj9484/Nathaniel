# 자산관리 대시보드 Phase 1–3 설계

날짜: 2026-05-25
대상 파일: `C:\dev\asset_dashboard.jsx` → `C:\dev\asset-dashboard\` Vite 프로젝트로 이전 후 확장

## 1. 범위

이 스펙은 사용자 요청 5건 중 프론트엔드 묶음(Phase 1–3)만 다룬다. Phase 4(Express 백엔드)와 Phase 5(KIS API)는 별도 스펙에서 다룬다.

| Phase | 내용 | 의존성 |
|---|---|---|
| 0 | Vite + React 프로젝트 스캐폴딩 (`asset_dashboard.jsx` 통합) | — |
| 1 | localStorage 영구 저장 (`useLocalStorage` 훅, JSON export/import, 초기화) | Phase 0 |
| 2 | 거래내역(transactions) 모델 + 평단/실현손익 자동계산 | Phase 1 (저장 키 함께 설계) |
| 3 | 월별 평가금액 LineChart, 종목별 비중 Treemap | Phase 2 (월별은 거래내역 필요) |

전 Phase는 사용자 검증 게이트가 있다. Phase N 완료 후 사용자가 동작 확인 → Phase N+1 시작.

## 2. 빌드 환경 (Phase 0)

`C:\dev\asset-dashboard\` 폴더에 Vite + React (JavaScript) 프로젝트를 생성한다.

- 템플릿: `npm create vite@latest asset-dashboard -- --template react`
- 의존성 추가: `recharts`, `lucide-react`
- Tailwind 도입: `tailwindcss` + `postcss` + `autoprefixer` (현 파일이 Tailwind 유틸리티를 광범위하게 쓰므로)
- 기존 `asset_dashboard.jsx`를 `src/AssetDashboard.jsx`로 옮기고 `src/App.jsx`에서 import
- Fraunces / DM Sans 폰트는 `index.html`의 `<head>`로 이전 (현재 컴포넌트 내부 `<style>` 임포트는 매 렌더마다 중복 로딩 위험)

**검증 게이트**: `npm run dev` → `http://localhost:5173` 에서 현재 동작과 동일하게 보이는지 사용자가 확인.

## 3. 데이터 모델

Phase 1과 2를 동시에 설계해야 저장 스키마가 충돌 없이 한 번에 정해진다.

### 3.1 스키마 버전

두 단계의 스키마가 존재한다. Phase 1은 기존 구조에 localStorage만 입히는 단계이므로 `schemaVersion: 1`. Phase 2에서 거래내역 모델로 전환하며 `schemaVersion: 2`로 마이그레이션.

**v1 (Phase 1 적용 후)** — 키 prefix `asset_dashboard_v1_`:
- `asset_dashboard_v1_meta` → `{ schemaVersion: 1, fxRate, target }`
- `asset_dashboard_v1_holdings` → `[{ id, category, symbol, name, quantity, avgPrice }]` (기존 SAMPLE 구조 그대로, `currentPrice`는 휘발성으로 저장 제외)

**v2 (Phase 2 적용 후)** — 동일 키 prefix 유지 (`v1_`은 *prefix 버전*, `schemaVersion`은 *데이터 구조 버전*으로 의미 분리):
- `asset_dashboard_v1_meta` → `{ schemaVersion: 2, fxRate, target }`
- `asset_dashboard_v1_holdings` → `[{ id, category, symbol, name }]` (quantity/avgPrice 필드 제거, derived로 전환)
- `asset_dashboard_v1_transactions` → 신규 키
  ```js
  [{
    id,                       // crypto.randomUUID()
    holdingId,                // holdings[].id 참조
    type: 'buy' | 'sell',
    quantity: number,         // > 0
    price: number,            // native 통화
    fee: number,              // native 통화, 기본 0
    date: 'YYYY-MM-DD',
    memo: string | null,      // 최대 100자
  }]
  ```

**키 prefix `v1_` 의 의미**: 키 네이밍 충돌 방지용 네임스페이스. 데이터 구조 변경은 `meta.schemaVersion`으로 추적. 키 prefix 자체를 바꿀 일은 다른 앱과 keystore 충돌이 발생할 때만.

**저장 분리 이유**: 각 키를 분리하면 한 영역 손상 시 다른 영역은 살릴 수 있고, JSON export/import 시 일부만 덮어쓰기도 가능.

### 3.2 파생 계산

`holdings`에서 transactions를 그룹화하여 다음을 계산 (메모이즈):

```js
// 종목별 누적 상태 (transactions를 date 순으로 walk)
{
  quantity,              // 현재 보유 수량
  avgPrice,              // 매수 이동평균 (매도시 변경 없음)
  totalBuyAmount,        // 누적 매수금액 (수수료 포함)
  totalSellAmount,       // 누적 매도금액 (수수료 차감 전)
  realizedPnL,           // 실현손익
  liquidated,            // quantity === 0
}
```

**이동평균 갱신 규칙**:
- 매수: `newAvg = (prevAvg × prevQty + price × qty + fee) / (prevQty + qty)`
- 매도: `avgPrice 그대로`, `realizedPnL += (price - avgPrice) × qty - fee`
- 보유수량 부족한 매도는 입력 거부 (모달에서 validation)

**거래 수정/삭제**: 트랜잭션 한 건 변경 시 해당 종목 거래 전체를 처음부터 다시 walk → 단순하고 정확. 종목당 거래 수가 수백 건이어도 메모이즈로 충분.

## 4. Phase 1: localStorage

### 4.1 `useLocalStorage(key, initialValue)` 훅

```js
function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return initialValue;
      return JSON.parse(raw);
    } catch {
      return initialValue;  // 손상 시 폴백
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // QuotaExceeded 등은 무시 (UI에 토스트는 향후)
    }
  }, [key, value]);
  return [value, setValue];
}
```

Phase 1 단계에서는 `holdings`, `target`, `fxRate`를 각각 이 훅으로 감싼다. Phase 2에서 `holdings` 키는 새 스키마로 마이그레이션된다.

### 4.2 UI 추가

헤더에 세 버튼을 추가:

- **"백업"**: 현재 `asset_dashboard_v1_*` 키 전부를 `{ schemaVersion, keys: {...} }` 형태로 묶어 `asset-dashboard-backup-YYYYMMDD.json` 다운로드. 단순 `<a download>` 트릭 사용.
- **"불러오기"**: file input → JSON 파싱 → 스키마 검증(`schemaVersion` 호환 확인, v2 파일을 v1 코드가 못 읽으면 거부 prompt) → 확인 prompt → 모든 키 덮어쓰기 → `window.location.reload()`.
- **"초기화"**: `confirm("모든 데이터가 삭제됩니다. 계속하시겠습니까?")` → 모든 `asset_dashboard_v1_*` 키 삭제 → reload.

세 버튼은 헤더 우측에 작은 아이콘 버튼 그룹으로. (메인 액션 "시세 새로고침"보다 시각적 비중 낮춤)

### 4.3 검증 게이트

- 종목 추가 → 새로고침 → 그대로 있음
- 목표 배분 변경 → 새로고침 → 유지됨
- JSON 백업 → 초기화 → JSON 불러오기 → 복원됨
- 손상된 JSON 붙여넣기 → 초기값으로 폴백, 에러 알림

## 5. Phase 2: 거래내역 기반 평단

### 5.1 마이그레이션

`asset_dashboard_v1_holdings`를 읽었을 때 항목에 `quantity`/`avgPrice`가 남아 있으면 (= 구 스키마):

```js
// 각 holding → transaction 1건으로 변환
const tx = {
  id: uuid(),
  holdingId: h.id,
  type: 'buy',
  quantity: h.quantity,
  price: h.avgPrice,
  fee: 0,
  date: today,        // 정확한 매수일 모름 → 오늘
  memo: '초기 마이그레이션',
};
```

`holdings`에서는 `quantity`/`avgPrice` 필드 제거, transactions에 push. 마이그레이션 후 `meta.schemaVersion = 2`. (Phase 1은 v1, Phase 2 적용 후 v2.)

마이그레이션은 앱 로드 시 1회만 실행. v2 데이터를 만난 v1 코드는 없으므로 위험 없음.

### 5.2 UI 변경

**보유 종목 행**: 기존 4열(수량/평단/현재가/손익률) → 종목 클릭 시 거래내역 모달 오픈. 행 자체에는 다음 정보 표시 (가로폭이 빠듯하므로 작은 글씨 보조 라인 활용):

```
[색] 종목명                수량 N        평단 ₩X      현재가 ₩Y      +Z.Z%
     SYMBOL · 카테고리       총매수 ₩A    실현 +₩B      평가 ₩C
```

- "총매수": 누적 매수금액
- "실현": 실현손익 (있을 때만, 색상)
- "평가": 현재 평가금액

**거래내역 모달** (`TransactionsModal`):
- 종목 헤더 (이름, 심볼, 색 라인)
- 시간순 (최신 → 과거) 거래 리스트, 각 행: 날짜 · 매수/매도 뱃지 · 수량 · 가격 · 수수료 · 메모 · [수정][삭제] 아이콘
- 하단에 "+ 거래 추가" 버튼
- 거래 추가/수정은 인라인 폼 (별도 모달 없이)
- 매수/매도 토글, 매도 시 보유수량 표시 + 초과 입력 시 빨간 헬프 텍스트

**청산 완료 탭**: 기존 `[통합, 국장, 미장, 코인]` 탭에 `청산` 추가. quantity === 0인 종목만 표시. 종목당 실현손익 합계 한 줄로.

### 5.3 검증 게이트

- SAMPLE 데이터 → Phase 2 적용 후에도 평단/수량 동일 (마이그레이션 정합성)
- 매수 → 평단 가중평균 정확
- 매도 → 평단 유지, 실현손익 = (매도가 − 평단)×수량 − 수수료
- 전량 매도 → 청산 탭 이동, 보유 탭에서 사라짐
- 거래 삭제 → 그 거래 빼고 처음부터 재계산 → 평단/실현손익 일관

## 6. Phase 3: 차트 확장

기존 통합 탭의 1행(파이 + 목표 막대) 아래에 2행 추가.

### 6.1 월별 평가금액 추이 (LineChart)

최근 12개월 각 월말 시점:
1. 거래내역에서 해당 월말까지 누적된 종목별 수량 계산
2. 평가금액 = `Σ (수량 × 현재가)` (USD는 fxRate 환산)
3. 데이터 포인트 12개

```js
{ month: '2025-06', value: 12340000 }
```

월 라벨은 `MMM` 짧게 (예: `Jun`), tooltip에서 풀 날짜 + 평가금액. 라인 색은 amber 계열.

**한계 명시**: 과거 시세가 아닌 "현재 시점 가격 × 과거 수량"이므로 시장 변동이 아닌 **포지션 증감**만 반영. 차트 캡션에 명시: *"포지션 변화 추이 (가격은 현재 시점 고정)"*.

### 6.2 종목별 비중 Treemap

전체 평가금액 대비 종목별 비중. 같은 카테고리 종목은 같은 색 계열, 큰 비중일수록 명도 높음.

색 계산: 카테고리 베이스 색을 HSL로 변환 → L 값을 `40 ~ 70` 사이에서 비중 순위로 보간.

레이블: 종목명 (셀이 작으면 심볼만, 더 작으면 숨김), 비중 %.

### 6.3 검증 게이트

- 12개월 라인이 거래 패턴과 일치 (매수 후 증가, 전량 매도 후 감소 또는 평탄)
- Treemap 비중 합 ≈ 100% (반올림 오차)
- 카테고리 색 명도 그라데이션 가시성

## 7. 파일 구조 (Phase 3 종료 시점)

```
C:\dev\asset-dashboard\
  package.json
  vite.config.js
  tailwind.config.js
  postcss.config.js
  index.html
  src/
    main.jsx
    App.jsx
    AssetDashboard.jsx          // 메인
    hooks/
      useLocalStorage.js
    lib/
      storage.js                // 키 상수, export/import, 초기화, 마이그레이션
      transactions.js           // walk → {quantity, avgPrice, realized...}
      format.js                 // formatKRW, formatNumber
      yahoo.js                  // fetchYahooPrice (Phase 4에서 백엔드 호출로 교체)
    components/
      Header.jsx
      SummaryCards.jsx
      Tabs.jsx
      HoldingsList.jsx
      LiquidatedList.jsx
      AddHoldingModal.jsx
      TransactionsModal.jsx
      TargetModal.jsx
      charts/
        CategoryPie.jsx
        TargetBars.jsx
        MonthlyValueChart.jsx
        AllocationTreemap.jsx
    constants.js                // CATEGORIES, DEFAULT_TARGET, SAMPLE
```

현재 759줄 단일 파일은 Phase 2 추가 시 1000줄을 넘기므로 컴포넌트 분리는 필수. Phase 0 스캐폴딩 단계에서 이미 분리해서 시작.

## 8. 명시적 비범위 (Out of Scope)

- Phase 4 (Express 백엔드, CORS 프록시 제거) → 별도 스펙
- Phase 5 (KIS API 통합) → Phase 4 의존, 별도 스펙
- 다중 사용자, 인증
- 거래내역 CSV 내보내기 (JSON 백업으로 충분)
- 모바일 최적화 (현 디자인은 데스크탑 우선, md 브레이크포인트만 기본 지원)
- 종목별 historical price 차트 (Yahoo historical API 호출 필요 → Phase 4 후 검토)
- 다국어, 다중 기준통화 (KRW 고정)

## 9. 리스크와 완화책

| 리스크 | 완화 |
|---|---|
| CORS 프록시(corsproxy.io) 다운 → 시세 조회 전부 실패 | 수동 입력 fallback 유지. Phase 4에서 자체 프록시로 교체 예정 |
| localStorage 5MB 초과 (거래 수천 건) | 비현실적 시나리오. 도달 시 IndexedDB 이전 검토 (별도 작업) |
| 거래 수정/삭제 → 전체 재계산 비용 | 종목당 거래 수가 보통 수십 건. `useMemo`로 종목별 캐싱 |
| 마이그레이션 1회 실패 시 데이터 손상 | 마이그레이션 실행 전 `asset_dashboard_v1_holdings_backup_pre_v2` 키로 백업 저장 |

## 10. 진행 게이트 요약

각 Phase는 다음 순서로 진행:
1. 구현
2. `npm run dev` 실행
3. 사용자에게 동작 시연 (스크린샷 또는 직접 확인 요청)
4. 사용자 확인 후 다음 Phase 시작

Phase 3 종료 후 사용자가 Phase 4 진입 결정 → 새 스펙 작성.
