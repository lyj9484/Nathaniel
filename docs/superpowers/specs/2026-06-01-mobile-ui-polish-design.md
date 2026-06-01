# 모바일 UI 다듬기 — 헤더 햄버거 + 요약 카드 2x2

**Date:** 2026-06-01
**Scope:** Phase 5 배포 직전 모바일 화면 정리
**Target file:** `client/src/AssetDashboard.jsx`

## 배경

배포 전 hardening(H10/H11)에서 보유 종목 행은 모바일 카드 stack 레이아웃을 적용해 잘 동작한다. 그러나 375px viewport 캡처에서 두 가지 이슈가 남아 있었다:

1. **헤더 버튼 7개**(내보내기 / 가져오기 / 초기화 / 목표 배분 / 시세 새로고침 / Admin / 로그아웃) — 좁은 가로폭에서 wrap되어 첫 인상이 정돈되지 않음
2. **요약 카드 4개**(총 자산 / 평가손익 / 실현손익 / 수익률) — `md:grid-cols-4`라 모바일에서도 한 줄 4열로 압축되어 글자가 작게 보임

## 결정 요약

| 항목 | 결정 |
|------|------|
| 헤더 패턴 | 햄버거 + 헤더 바로 아래 dropdown 패널 |
| Breakpoint | `sm` 미만(< 640px)에서 햄버거, `sm` 이상은 기존 가로 정렬 |
| 요약 카드 grid | `grid-cols-2 md:grid-cols-4` (모바일 2x2, md 이상 1x4) |
| 외부 클릭 닫힘 / Esc | 범위 밖 (YAGNI) |
| 애니메이션 | 범위 밖 (단순 mount/unmount) |

## 1. 헤더 — 햄버거 + dropdown 패널

### 구조

기존 헤더 (`AssetDashboard.jsx:574-648`):

- `<header>` 안의 우측 버튼 그룹 div를 `hidden sm:flex`로 변경 → 데스크탑만 가로 정렬
- 햄버거 버튼(`sm:hidden`)을 동일 위치에 추가 → 모바일만 노출
- 햄버거 토글 state: `const [mobileMenuOpen, setMobileMenuOpen] = useState(false)`
- 아이콘: 닫힘 상태 `Menu`, 열림 상태 `X` (lucide)

### Dropdown 패널

- 위치: `<header>` 다음 sibling으로 mount
- 가시성: `sm:hidden` + `mobileMenuOpen` true일 때만 렌더
- 스타일: `bg-slate-900/95 border border-slate-800 rounded-2xl p-2 mb-4` (헤더 직후, 마지막 업데이트/에러 영역 이전)
- 내부 레이아웃: `flex flex-col` 세로 배치, 각 항목은 `flex items-center gap-2 px-4 py-3 rounded-xl text-sm hover:bg-slate-800 w-full text-left`
- 색상 유지: 초기화는 rose 톤, Admin은 amber 톤, 시세 새로고침은 강조(밝은 배경)

### 항목 목록 (위 → 아래 순)

1. 내보내기 (`exportJSON`)
2. 가져오기 (`fileInputRef.current?.click()` — 파일 input은 헤더 영역에 그대로 둠)
3. 초기화 (`resetAllData`) — rose 톤
4. 목표 배분 (`setShowTarget(true)`)
5. 시세 새로고침 (`refreshAll`) — 강조, `loading` 시 `RefreshCw` 회전 + "조회중..." 텍스트 유지
6. Admin (`navigate("/admin/feedback")`) — `isAdminEmail(user.email)` true일 때만
7. `{user.email} · 로그아웃` (`signOut`)

각 항목의 onClick은 기존 핸들러 호출 직후 `setMobileMenuOpen(false)`로 자동 닫힘. 단, "시세 새로고침"은 닫지 않아도 무방하지만 일관성 위해 닫음 — 로딩 스피너는 시세 새로고침 버튼에는 안 보여도 헤더 상태에 영향 없음.

### 파일 input

`<input ref={fileInputRef} type="file" ...>`은 위치 그대로 유지 (`hidden`이므로 어디 있어도 무관).

## 2. 요약 카드 — 2x2 grid

`AssetDashboard.jsx:675` 단일 라인 변경:

```diff
- <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-12">
+ <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
```

`SummaryCard` 컴포넌트 내부 변경 없음 (`p-6`, `text-3xl` 그대로). 모바일 2열에서 약 170px 폭 카드, 텍스트가 일부 케이스에서 잘리면 후속 패스에서 `text-2xl sm:text-3xl` 정도로 조정.

## 3. Import 변경

`AssetDashboard.jsx` lucide import에 `Menu` 추가:

```diff
  RotateCcw,
  Pencil,
+ Menu,
  ArrowDownCircle,
```

`X`는 이미 import됨.

## 4. 컴포넌트 분리 여부

Dropdown 패널은 인라인 JSX(~30줄). 별도 컴포넌트로 추출하지 **않음** — `user`, `loading`, `signOut`, `exportJSON`, `importJSON`, `resetAllData`, `setShowTarget`, `refreshAll`, `fileInputRef`, `navigate` 등 의존성이 너무 많아 props drilling 비용이 분리 이득보다 큼.

## 5. 검증 계획

Playwright로 검증 (manual session start 또는 자동):

- **375px viewport** (iPhone SE 크기):
  - 헤더에 햄버거 아이콘만 보임, 데스크탑 버튼 그룹은 안 보임
  - 햄버거 탭 → dropdown 패널 노출, 7개(Admin 권한 없으면 6개) 항목 보임
  - "가져오기" 항목 탭 → 파일 다이얼로그 트리거
  - "시세 새로고침" 항목 탭 → dropdown 자동 닫힘, refresh 동작
  - 요약 카드 4개가 2x2 격자로 보임
- **640px viewport** (sm 시작점):
  - 햄버거 사라지고 기존 가로 정렬 버튼 그룹 노출 — 회귀 없음
- **768px viewport** (md 시작점):
  - 요약 카드 1x4 가로 정렬 회귀 없음

## 6. 범위 밖 (나중에)

- 외부 클릭으로 닫힘
- Esc 키 닫힘
- 슬라이드/페이드 애니메이션
- 다른 모바일 이슈 (긴 테이블 가로 스크롤, FilterTabs wrap 등)
- 요약 카드 폰트 크기 반응형 조정 (필요 시)

## 관련 사전 작업

- 모바일 카드 작업 진행 상태: [[project-pre-deploy-hardening]] H10, H11
- Phase 5 배포 전 체크리스트: [[project-multi-user-rollout-status]]
- 다음 세션 안내 메모: [[project-next-session-mobile-polish]]
