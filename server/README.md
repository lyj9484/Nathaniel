# Asset Dashboard Server

자산관리 대시보드 백엔드. Yahoo Finance를 서버 측에서 호출해 CORS 프록시 의존을 제거하고,
한국 주식은 한국투자증권 KIS Developers API로 실시간 시세를 가져옵니다.

## 빠른 시작

```bash
cd server
npm install
cp .env.example .env   # (선택) KIS 키 입력
npm start
```

`http://localhost:3001`에서 동작합니다.

## 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/price/:symbol` | 단일 종목 시세 |
| GET | `/api/prices?symbols=AAPL,NVDA,BTC-USD` | 일괄 조회 |
| GET | `/api/fx/usdkrw` | USD/KRW 환율 |
| GET | `/api/health` | 헬스체크 (KIS 활성화 여부 포함) |
| POST | `/api/cache/clear` | 캐시 비우기 (개발용) |

### 응답 포맷

```json
{
  "symbol": "AAPL",
  "price": 187.32,
  "currency": "USD",
  "source": "yahoo"
}
```

일괄 조회는 위 객체의 배열. 개별 실패 시 `{ symbol, error }` 형태로 반환됩니다.

## 종목 라우팅

- `*.KS`, `*.KQ` (국내 주식): **KIS API** (키 미설정 시 Yahoo로 폴백)
- 그 외 (AAPL, NVDA, BTC-USD, KRW=X 등): **Yahoo Finance**

응답 포맷은 일관되므로 프론트엔드는 라우팅을 신경 쓰지 않아도 됩니다.

## 캐시

`node-cache` 5분 TTL. 짧은 시간 내 같은 종목 요청은 캐시 응답.

## KIS API 키 발급

1. [KIS Developers](https://apiportal.koreainvestment.com) 가입
2. 앱 등록 → `APP_KEY`, `APP_SECRET` 발급
3. `.env`에 입력
4. 모의투자로 먼저 테스트 시 `.env`에 `KIS_BASE=https://openapivts.koreainvestment.com:29443` 추가

OAuth 토큰은 24시간 만료 — 자동 갱신됩니다.

## 트러블슈팅

- **Yahoo 401/429**: User-Agent 헤더 변경 또는 일정 시간 대기. 캐시 5분으로 호출 빈도 자체는 낮음
- **KIS auth 실패**: 콘솔 로그에 `KIS_APP_KEY / KIS_APP_SECRET not configured` 또는 `KIS auth HTTP ...` 확인. `.env` 로드 여부, 키 오타, 모의/실전 URL 일치 확인
- **포트 충돌**: `.env`의 `PORT` 변경 (프론트도 함께 수정 필요)
