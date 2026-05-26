# Asset Dashboard Client

자산관리 대시보드 프론트엔드 (Vite + React + Tailwind v4).

## 빠른 시작

```bash
cd client
npm install
npm run dev
```

기본 포트 `http://localhost:5173`.

## 백엔드 연동

Vite 개발 서버가 `/api/*` 요청을 `http://localhost:3001`로 프록시합니다.
백엔드는 별도 셸에서 실행하세요 (`../server/README.md` 참고).

다른 호스트의 백엔드를 쓰려면 `.env`에 `VITE_API_BASE=https://...` 설정.

## 빌드

```bash
npm run build      # → dist/
npm run preview    # 빌드 결과 로컬 미리보기
```

프로덕션 빌드에는 dev 프록시가 없으므로, 배포 환경에서는 `VITE_API_BASE`를
지정하거나 nginx 등으로 `/api`를 백엔드로 라우팅해야 합니다.

## 구조

```
client/
├── index.html
├── vite.config.js          (React + Tailwind v4 + /api 프록시)
├── package.json
├── .env.example
└── src/
    ├── main.jsx            (React 엔트리)
    ├── AssetDashboard.jsx  (메인 컴포넌트)
    └── index.css           (Tailwind import + 전역 배경)
```

## 데이터 저장

브라우저 localStorage에 `asset_dashboard_v1_*` 키로 저장.
헤더의 **내보내기 / 가져오기 / 초기화** 버튼으로 백업/복원/리셋 가능.
